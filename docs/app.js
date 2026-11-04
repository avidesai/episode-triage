/* Triage inbox viewer. Reads data.json (the fleet) and, when present, live/data.json
   (a running monitor). One renderer draws every incident from its bundle. */
(function () {
  "use strict";
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"}[c]));
  const num = (x) => (typeof x === "number" ? x.toLocaleString("en-US") : x);
  const nice = (s) => String(s).replace(/follower\./g, "follower ").replace(/leader\./g, "leader ").replace(/_/g, " ");
  const short = (cam) => String(cam).split(".").pop().replace(/_/g, " ");
  const RUNG = {0: "clean", 1: "robot can clear it", 2: "ticket for a named part", 3: "send to training", 4: "a person has to look"};
  const FIX = [["all", "All"], ["robot", "Robot can clear it"], ["ticket", "Ticket"], ["training", "Training"], ["person", "Needs a person"]];
  const LAYER = [["all", "Any layer"], ["sensing", "Camera and timing"], ["actuation", "Joints"], ["task", "Task"]];
  let DATA = null, LIVE = null, T = {};
  const state = {fix: "all", layer: "all", open: null, rule: null, seen: new Set()};

  // ---------------------------------------------------------------- evidence vs threshold
  const pct = (x) => (100 * x).toFixed(1) + "% of range";
  const EVID = {
    "sensing.stale_camera": (e) => [
      ["picture change", e.mean_change.toFixed(2) + " gray levels", "under " + T.stale_tau_e],
      ["arm motion while frozen", pct(e.motion) + " per frame", "over " + (100 * T.stale_tau_m) + "%"],
      ["frames", e.frames, T.stale_min_frames + " or more"],
      ["typical change on this camera", e.typical_change == null ? "?" : e.typical_change.toFixed(2), "context"]],
    "sensing.stale_state": (e) => [["identical frames", e.frames, T.stale_state_min_frames + " or more"],
      ["command speed meanwhile", pct(e.command_speed) + " per frame", "over " + (100 * T.stale_tau_m) + "%"]],
    "sensing.duplicated_rows": (e) => [["moving rows that repeat", (100 * e.share).toFixed(0) + "%", "25% or more"]],
    "actuation.not_following": (e) => [["largest gap from command", pct(e.peak_err), "over " + (100 * T.follow_err) + "%"],
      ["mode", e.mode, "stalled, sagging, lagging, or held"],
      ["other joints still tracking", (100 * e.others_tracking).toFixed(0) + "%", "context"]],
    "actuation.rest_offset": (e) => [["offset at rest", pct(Math.abs(e.offset)), "over " + (100 * T.offset_err) + "%"],
      ["pauses that agree", (100 * e.agree).toFixed(0) + "% of " + e.rest_segments, (100 * T.offset_agree) + "% or more"]],
    "actuation.gain_mismatch": (e) => [["follower gain vs leader", e.gain.toFixed(2), "outside 1 ± " + T.gain_err]],
    "actuation.not_tracking": (e) => [["follower vs leader correlation", e.corr.toFixed(2), "under " + T.track_min_r]],
    "actuation.bus_glitch": (e) => [["one frame jump", pct(e.jump), "over " + (100 * T.glitch_jump) + "%, back within " + T.glitch_return_frames + " frames"]],
    "actuation.command_wrap": (e) => [["one frame command jump", pct(Math.abs(e.jump)), "over " + (100 * T.wrap_jump) + "%, not returning"]],
    "actuation.pinned": (e) => [["at its " + e.limit + ", command pushing", pct(e.push), "over " + (100 * T.pin_push) + "% for " + T.pin_min_s + " s"]],
    "task.stall": (e) => [["nothing moving for", e.seconds.toFixed(1) + " s", T.stall_min_s + " s or more"]],
    "task.missed_grasp_sequence": (e) => [["empty closes in a row", e.empty_closes, "2 or more"],
      ["gripper gaps after each close", e.gaps.map((g) => (100 * g).toFixed(1) + "%").join(", "), "under " + (100 * T.empty_gap) + "% is empty"]],
    "task.missed_grasp": (e) => [["empty closes", e.empty_closes, "1"], ["then a good grasp", e.recovered ? "yes" : "no", ""]],
    "sensing.camera_lag": (e) => [["camera behind the joints", e.lag_frames + " frames", "3 or more"]],
  };
  function evidenceRows(ev) {
    const f = EVID[ev.check];
    if (!f) return Object.entries(ev.evidence || {}).map(([k, v]) => [k, String(v), ""]);
    try { return f(ev.evidence); } catch (err) { return Object.entries(ev.evidence || {}).map(([k, v]) => [k, String(v), ""]); }
  }
  const plainCheck = (c) => (DATA && DATA.plain && DATA.plain[c]) || c;

  // ---------------------------------------------------------------- timeline (SVG)
  function timeline(clip, bands) {
    const t = clip.t;
    if (!t || t.length < 2) return '<p class="note">No signal clip for this incident (the run failed an integrity check).</p>';
    const panels = [];
    for (const [name, j] of Object.entries(clip.joints)) {
      panels.push({label: (j.gripper ? "gripper" : name.replace(/_/g, " ")) + ": command (dashed) and position, % of range",
        series: [{y: j.cmd, cls: "b"}, {y: j.pos, cls: "a"}]});
    }
    for (const [k, c] of Object.entries(clip.cams)) {
      panels.push({label: short(k) + " camera: picture change (line) and arm motion (shade)",
        series: [{y: c.motion.map((v) => Math.min(6, v * 0.6)), cls: "c"}, {y: c.change.map((v) => Math.min(6, v)), cls: "a"}], ylim: [0, 6]});
    }
    const W = 680, left = 8, right = 8, top = 50, gap = 34, ph = 70;
    const plotW = W - left - right, h = top + panels.length * (ph + gap) + 34;
    const t0 = t[0], t1 = t[t.length - 1];
    const X = (v) => left + (v - t0) / Math.max(t1 - t0, 1e-9) * plotW;
    let out = `<svg viewBox="0 0 ${W} ${h}" class="tl" role="img" aria-label="incident timeline">`;
    let labelled = 0;
    for (const b of bands) {
      const x0 = X(Math.max(b.t0, t0)), x1 = X(Math.min(b.t1, t1));
      if (x1 < left || x0 > left + plotW) continue;
      out += `<rect class="band ${b.cls}" x="${x0.toFixed(1)}" y="${top - 4}" width="${Math.max(x1 - x0, 2).toFixed(1)}" height="${h - top - 12}"/>`;
      if (b.label) {
        const anchor = x0 > left + 0.6 * plotW ? "end" : "start";
        const tx = anchor === "end" ? x0 - 3 : x0 + 3;
        out += `<text class="bandlabel ${b.cls}" x="${tx.toFixed(1)}" y="${18 + 20 * (labelled % 2)}" text-anchor="${anchor}">${esc(b.label)}</text>`;
        labelled++;
      }
    }
    panels.forEach((p, i) => {
      const y0 = top + i * (ph + gap) + 24;
      let lo, hi;
      if (p.ylim) { [lo, hi] = p.ylim; } else {
        const all = p.series.flatMap((s) => s.y).filter(Number.isFinite).sort((a, b) => a - b);
        lo = all[Math.floor(all.length * 0.01)]; hi = all[Math.floor(all.length * 0.99)];
        const pad = 0.08 * ((hi - lo) || 1); lo -= pad; hi += pad;
      }
      const Y = (v) => y0 + ph - (Math.min(hi, Math.max(lo, v)) - lo) / Math.max(hi - lo, 1e-9) * ph;
      out += `<text class="plabel" x="${left}" y="${y0 - 6}">${esc(p.label)}</text>`;
      out += `<line class="axis" x1="${left}" x2="${left + plotW}" y1="${y0 + ph}" y2="${y0 + ph}"/>`;
      for (const s of p.series) {
        const step = Math.max(1, Math.floor(t.length / 360));
        const pts = [];
        for (let k = 0; k < t.length; k += step) if (Number.isFinite(s.y[k])) pts.push(`${X(t[k]).toFixed(1)},${Y(s.y[k]).toFixed(1)}`);
        out += `<path class="ln ${s.cls}" d="M${pts.join(" L")}"/>`;
      }
    });
    const span = t1 - t0, stepT = [1, 2, 5, 10, 20, 30, 60].find((s) => span / s <= 8) || 120;
    for (let v = Math.ceil(t0 / stepT) * stepT; v <= t1 + 1e-9; v += stepT) {
      out += `<text class="tick" x="${X(v).toFixed(1)}" y="${h - 6}" text-anchor="middle">${+v.toFixed(1)} s</text>`;
    }
    return out + "</svg>";
  }

  function bandsFor(b) {
    const inc = b.incident, bands = [];
    const tAbs = (e) => (e.t_abs != null ? e.t_abs : e.t_start);
    const tEnd = (e) => tAbs(e) + (e.t_end - e.t_start);
    for (const tr of b.truth || []) bands.push({t0: tr.t0, t1: tr.t1, cls: "truth", label: "injected: " + nice(tr.fault) + (tr.target ? " on " + nice(tr.target) : "")});
    if (inc.anchor) bands.push({t0: tAbs(inc.anchor), t1: tEnd(inc.anchor), cls: "anchor", label: "what a person would see"});
    const span = b.clip.t && b.clip.t.length > 1 ? b.clip.t[b.clip.t.length - 1] - b.clip.t[0] : 0;
    const standing = (e) => span > 0 && (e.t_end - e.t_start) > 0.8 * span;   // a fault of the whole run, not a moment
    if (inc.cause && !standing(inc.cause) && (!inc.anchor || inc.cause.t_start !== inc.anchor.t_start || inc.cause.check !== inc.anchor.check)) {
      bands.push({t0: tAbs(inc.cause), t1: Math.max(tEnd(inc.cause), tAbs(inc.cause) + 0.15), cls: "cause", label: "what started it"});
    }
    for (const e of (inc.related || []).filter((e) => !standing(e))) bands.push({t0: tAbs(e), t1: Math.max(tEnd(e), tAbs(e) + 0.1), cls: "cause", label: ""});
    for (const e of inc.context || []) bands.push({t0: tAbs(e), t1: Math.max(tEnd(e), tAbs(e) + 0.1), cls: "context", label: ""});
    return bands;
  }

  // ---------------------------------------------------------------- incident panel
  async function openIncident(ref, meta) {
    const el = $("#incident");
    el.innerHTML = '<div class="panel"><p class="note">loading incident</p></div>';
    let b;
    try { b = await (await fetch(ref, {cache: "no-store"})).json(); } catch (err) { el.innerHTML = '<div class="panel"><p class="bad">Could not load ' + esc(ref) + '</p></div>'; return; }
    const inc = b.incident;
    const where = b.robot_id + (b.coverage && b.coverage.run != null && b.coverage.run !== "live" ? ", run " + b.coverage.run : "") + ", at " + (b.t).toFixed(1) + " s";
    const cov = b.coverage || {};
    const covLine = (cov.cameras_checked && cov.cameras_checked.length ? "Checked joints and " + cov.cameras_checked.map(short).join(", ") + " camera" + (cov.cameras_checked.length > 1 ? "s" : "") : "Checked joints only") +
      (cov.cameras_missing && cov.cameras_missing.length ? "; not checked: " + cov.cameras_missing.map(short).join(", ") : "") + ".";
    const evs = (b.events || []).filter((e) => e.confidence !== "low" || e.check !== "sensing.stale_camera");
    let evTable = "";
    if (evs.length) {
      evTable = '<div class="scroll"><table><tr><th>what fired</th><th>when</th><th>measured</th><th>threshold</th></tr>' +
        evs.map((e) => {
          const rows = evidenceRows(e);
          const when = ((e.t_abs != null ? e.t_abs : e.t_start)).toFixed(1) + " s" + (e.t_end > e.t_start + 0.05 ? " for " + (e.t_end - e.t_start).toFixed(1) + " s" : "");
          return rows.map((r, i) => `<tr>${i === 0 ? `<td rowspan="${rows.length}"><b>${esc(plainCheck(e.check))}</b><br><span class="muted">${esc(nice(e.component.startsWith("observation.") ? short(e.component) + " camera" : e.component))}${e.confidence !== "high" ? ", " + e.confidence + " confidence" : ""}</span></td><td rowspan="${rows.length}">${when}</td>` : ""}<td>${esc(r[0])}: ${esc(r[1])}</td><td class="muted">${esc(r[2])}</td></tr>`).join("");
        }).join("") + "</table></div>";
    }
    const lowN = (b.events || []).filter((e) => e.confidence === "low" && e.check === "sensing.stale_camera").length;
    el.innerHTML = `<div class="panel" id="incpanel">
      <div class="hd"><span class="k r${inc.rung}">${inc.rung}</span><div class="route">${esc(nice(inc.route))}</div></div>
      <p class="note">${esc(RUNG[inc.rung])}, rule ${inc.rule}. ${esc(where)}. ${esc(covLine)}${inc.supersedes ? " Escalated from an earlier verdict." : ""}</p>
      ${inc.self_recovery ? `<p><b>Robot can try:</b> ${esc(inc.self_recovery)}</p>` : ""}
      ${inc.cause && b.clip.t && b.clip.t.length > 1 && (inc.cause.t_end - inc.cause.t_start) > 0.8 * (b.clip.t[b.clip.t.length - 1] - b.clip.t[0]) ? '<p class="note">This fault holds for the whole run, so there is no single moment to mark. Compare the dashed command with the solid position.</p>' : ""}
      <div class="legend"><span><i class="lc"></i>what started it</span><span><i class="la"></i>what a person would see</span><span><i class="lx"></i>after it (context)</span>${(b.truth || []).length ? '<span><i class="lt"></i>injected on purpose (ground truth)</span>' : ""}</div>
      ${timeline(b.clip, bandsFor(b))}
      <h3>Why this verdict</h3>
      <ol class="trace">${(inc.trace || []).map((l) => `<li>${esc(nice(l))}</li>`).join("")}</ol>
      <h3>Evidence in this window</h3>
      ${evTable || '<p class="note">No check fired inside this window beyond the verdict itself.</p>'}
      ${lowN ? `<p class="note">${lowN} low confidence frozen camera run${lowN > 1 ? "s" : ""} in this window not shown: that camera barely sees the arm move, so a still picture proves little and never drives a verdict.</p>` : ""}
      <p class="note">Bundle: <a href="${esc(ref)}">${esc(ref)}</a></p>
    </div>`;
    if (!meta || !meta.noScroll) el.scrollIntoView({behavior: "smooth", block: "start"});
    history.replaceState(null, "", "#inc=" + encodeURIComponent(ref));
  }

  // ---------------------------------------------------------------- inbox
  function chips(el, opts, key) {
    el.innerHTML = opts.map(([v, l]) => `<button class="chip ${state[key] === v ? "on" : ""}" data-v="${v}">${l}</button>`).join("");
    el.querySelectorAll(".chip").forEach((c) => c.onclick = () => { state[key] = c.dataset.v; state.rule = null; renderInbox(); });
  }
  function renderInbox() {
    chips($("#fixchips"), FIX, "fix"); chips($("#layerchips"), LAYER, "layer");
    const list = $("#inboxlist");
    let rows = DATA.inbox;
    if (state.rule) {
      const ids = DATA.incidents.filter((i) => i.rule === state.rule);
      list.innerHTML = `<p class="note">Incidents decided by rule ${state.rule} in the sampled runs (${ids.length}). <a href="#inbox" id="clearrule">Back to the inbox</a></p>` +
        (ids.length ? ids.slice(0, 60).map(incLine).join("") : '<div class="empty">None in the sample.</div>');
      $("#clearrule").onclick = (ev) => { ev.preventDefault(); state.rule = null; renderInbox(); };
      wireIncLines(list);
      return;
    }
    rows = rows.filter((r) => (state.fix === "all" || r.fix_by === state.fix) && (state.layer === "all" || r.layer === state.layer));
    if (!rows.length) { list.innerHTML = '<div class="empty">Nothing in this view.</div>'; return; }
    list.innerHTML = rows.map((r, i) => `
      <div class="row" data-i="${i}"><span class="k r${r.rung}">${r.rung}</span>
        <div><div class="t">${esc(r.label)}${r.recurring ? '<span class="dot" title="recurring"></span>' : ""}</div>
          <div class="ex">${esc(RUNG[r.rung])}. Example: ${esc(nice(r.example))}</div>
          <div class="ex">${esc(r.scope)}</div></div>
        <div class="n"><b>${num(r.robots)}</b>arms<br><b>${num(r.episodes)}</b>runs</div></div>
      <div class="sub hidden" id="sub${i}"></div>`).join("");
    list.querySelectorAll(".row").forEach((el) => el.onclick = () => {
      const i = +el.dataset.i, sub = $("#sub" + i), r = rows[i];
      if (!sub.classList.contains("hidden")) { sub.classList.add("hidden"); return; }
      const ex = r.examples.map((id) => DATA.incidents.find((x) => x.id === id)).filter(Boolean);
      sub.innerHTML = ex.length ? ex.map(incLine).join("") : '<div class="inc">No clip bundled for this one.</div>';
      sub.classList.remove("hidden");
      wireIncLines(sub);
    });
  }
  function incLine(s) {
    return `<div class="inc" data-ref="${esc(s.bundle)}"><span class="k r${s.rung}">${s.rung}</span> ${esc(nice(s.route))}<div class="w">${esc(s.robot_id)}${s.run != null ? ", run " + s.run : ""}, ${(+s.t).toFixed(1)} s${s.source ? ", " + s.source : ""}</div></div>`;
  }
  function wireIncLines(root) {
    root.querySelectorAll(".inc[data-ref]").forEach((el) => el.onclick = (ev) => { ev.stopPropagation(); openIncident(el.dataset.ref); });
  }

  // ---------------------------------------------------------------- how it decides, trust, found
  function renderHow() {
    const byLayer = {sensing: [], actuation: [], task: []};
    for (const c of DATA.checks) byLayer[c.layer].push(c);
    const names = {sensing: "Camera and timing", actuation: "Joints", task: "Task"};
    $("#checks").innerHTML = Object.entries(byLayer).map(([l, cs]) => `<details ${l === "sensing" ? "open" : ""}><summary>${names[l]}: ${cs.length} checks</summary>
      <div class="scroll"><table><tr><th>check</th><th>what it looks at</th><th>fires when</th><th>why</th></tr>
      ${cs.map((c) => `<tr><td><b>${esc(c.name)}</b></td><td>${esc(c.signal)}</td><td>${esc(c.threshold)}</td><td class="muted">${esc(c.why)}</td></tr>`).join("")}</table></div></details>`).join("");
    $("#rules").innerHTML = DATA.rules.map((r) => `<div class="rl"><span class="id">${r.rule}</span><span class="k r${r.rung}">${r.rung}</span>
      <div>${esc(r.when)}<div class="c">to ${esc(r.to)}. <a href="#inbox" data-rule="${r.rule}">${num(r.count_sample)} in the sample</a>, ${num(r.count_fleet)} in all runs</div></div></div>`).join("");
    $("#rules").querySelectorAll("a[data-rule]").forEach((a) => a.onclick = (ev) => { ev.preventDefault(); state.rule = a.dataset.rule; renderInbox(); $("#inbox").scrollIntoView(); });
  }
  function renderTrust() {
    const v = DATA.validation, el = $("#trust_body");
    if (!v) { el.innerHTML = '<p class="note">No validation run yet.</p>'; return; }
    const names = {freeze_3: "camera frozen 3 frames", freeze_6: "camera frozen 6 frames", freeze_10: "camera frozen 10 frames", freeze_20: "camera frozen 20 frames",
      stall: "joint stalls for 1.5 s", offset: "joint offset 8% of range", glitch: "3 bad reads on one motor", stale_state: "joint stream repeats 6 frames"};
    const S = v.summary, cal = v.calibration;
    let html = `<p>Known faults were injected into real runs and the tool was scored on whether it caught them and put them on the right rung. Video faults were compressed again with the recorder's own settings, so a frozen picture reaches the tool as a real one would. One threshold was tuned on data (how little a picture can change and still count as frozen), set at ${cal.stale_tau_e} gray levels on ${cal.robots.length} arms, then frozen and scored on 40 different arms. Raw counts, misses included.</p>
      <div class="scroll"><table><tr><th>fault injected</th><th class="n">tries</th><th class="n">caught</th><th class="n">caught, low confidence</th><th class="n">missed</th><th class="n">skipped</th><th class="n">right rung</th><th class="n">false extras</th></tr>`;
    for (const [k, r] of Object.entries(S.faults)) html += `<tr><td>${names[k] || k}</td><td class="n">${r.n}</td><td class="n">${r.caught}</td><td class="n">${r.caught_low_confidence}</td><td class="n">${r.missed}</td><td class="n">${r.abstained}</td><td class="n">${r.right_rung}</td><td class="n">${r.new_other_events}</td></tr>`;
    html += `</table></div><p class="note"><b>Caught, low confidence:</b> found, but that camera barely shows the arm moving, so it is logged and not acted on. <b>Skipped:</b> the run had fewer than two pauses, so a resting offset couldn't be measured. <b>False extras:</b> anything else the injected fault set off. A camera delayed by 3 frames was measured within 1 frame of that on ${S.lag.within_1_of_3} of ${S.lag.estimated} runs.</p>`;
    if (DATA.bench) {
      const sf = DATA.bench.stale_frames || {};
      html += `<h3>Faults caused on purpose on a physical arm</h3><p>Recorded with the flight recorder in the repo, which logs the true age of every camera frame and the exact fault schedule. Frozen frames, frame by frame: ${sf.true_stale || 0} true, ${sf.caught || 0} caught, ${sf.missed || 0} missed, ${sf.false_alarm || 0} false alarms.</p>
        <div class="scroll"><table><tr><th>run</th><th>fault</th><th>target</th><th>caught</th><th>rung</th><th>expected</th></tr>${DATA.bench.rows.map((r) => `<tr><td>${r.episode}</td><td>${esc(r.fault)}</td><td>${esc(r.target)}</td><td>${r.caught}</td><td>${r.rung}</td><td>${r.expect_rung}</td></tr>`).join("")}</table></div>`;
    } else {
      html += `<p class="note">Physical arm: the recorder and run sheet are in the repo and the live monitor is what runs during a session; a scored set of faults caused on purpose is the next step and appears here when it exists.</p>`;
    }
    el.innerHTML = html;
  }
  function renderFound() {
    const F = DATA.findings, J = F.joints, V = F.video, A = V.anchors || {};
    const nA = Object.values(A).reduce((a, b) => a + b, 0), began = A["began with sensing or actuation"] || 0, train = A["training, inputs healthy"] || 0;
    $("#found_body").innerHTML = `<div class="finding"><p>Across ${num(J.robots)} arms, checking the cameras and joints before blaming the task found joint or calibration faults on about 1 in ${Math.round(J.robots / J.robots_any_actuation_ticket)} arms and frozen cameras in about 1 in ${Math.round(V.episodes_all_cameras / V.episodes_stale_camera)} runs. It also proved my own prediction wrong: nearly every stall was the operator pausing.</p></div>
      <ul>
      <li><b>Frozen cameras don't show up in the timestamps.</b> The recorder writes each timestamp as frame number divided by frame rate, so all ${num(J.episodes)} runs have a perfect clock. Comparing pictures with arm motion found ${num(V.episodes_stale_camera)} of ${num(V.episodes_all_cameras)} sampled runs, on ${num(V.robots_stale_camera)} arms, where a camera stopped updating while the arm moved.</li>
      <li><b>Joint faults are common, and mostly calibration.</b> ${num(J.robots_any_actuation_ticket)} arms have at least one: offset at rest (${J.robots_rest_offset}), calibrated over different ranges (${J.robots_gain_mismatch}), a joint whose follower doesn't track at all (${J.robots_not_tracking}), bad bus reads (${J.robots_bus_glitch}), or a reading that wraps past 180 degrees so the follower spins the long way round.</li>
      <li><b>My stall prediction was wrong.</b> I wrote down beforehand that at least a quarter of stalls would start with a camera or joint fault. It was ${began} of ${nA}. In teleoperated data nearly every stall is a person pausing, so ${train} went to training with every layer checked.</li>
      <li><b>Cameras run late by different amounts.</b> Most of ${num(V.lag_streams)} cameras run 0 to 2 frames behind the joints; ${V.camera_streams_lag_ge_3} on ${V.robots_lag_ge_3} arms run 3 frames (100 ms) or more behind. Data merged from those arms disagrees about when the gripper saw the object.</li>
      </ul>`;
  }

  // ---------------------------------------------------------------- live
  async function pollLive() {
    let d = null;
    try { const r = await fetch("live/data.json", {cache: "no-store"}); if (r.ok) d = await r.json(); } catch (err) { d = null; }
    if (!d) { setTimeout(pollLive, 5000); return; }
    const first = LIVE === null;
    LIVE = d;
    $("#livetab").classList.remove("hidden"); $("#livesec").classList.remove("hidden");
    $("#fleetbadge").textContent = "live: " + d.robot_id; $("#fleetbadge").classList.add("live");
    $("#livenote").textContent = `Incidents from ${d.robot_id} as the monitor finds them (${d.incidents.length} so far). Newest first. The green band in an incident is the fault the recorder injected on purpose; red is what the checks found.`;
    const list = $("#livelist");
    const rows = d.incidents.slice().reverse();
    list.innerHTML = rows.length ? rows.map((s) => `<div class="live-row ${state.seen.has(s.id) || first ? "" : "new"}" data-ref="${esc(s.bundle)}"><span class="k r${s.rung}">${s.rung}</span>
      <div><div><b>${esc(RUNG[s.rung])}</b>: ${esc(nice(s.route))}</div><div class="muted" style="font-size:13px">at ${(+s.t).toFixed(1)} s${s.truth && s.truth.length ? ", injected: " + esc(s.truth.map((t) => nice(t.fault)).join(", ")) : ""}${s.self_recovery ? ". Robot can try: " + esc(s.self_recovery) : ""}</div></div></div>`).join("")
      : '<div class="empty">Monitor running, nothing fired yet.</div>';
    const newest = rows.find((s) => !state.seen.has(s.id));
    rows.forEach((s) => state.seen.add(s.id));
    list.querySelectorAll(".live-row").forEach((el) => el.onclick = () => openIncident(el.dataset.ref));
    if (newest && !first) openIncident(newest.bundle, {noScroll: false});
    if (first && location.hash === "#live") $("#live").scrollIntoView();
    setTimeout(pollLive, 2000);
  }

  // ---------------------------------------------------------------- boot
  async function boot() {
    DATA = await (await fetch("data.json", {cache: "no-store"})).json();
    T = DATA.thresholds;
    const f = DATA.fleet;
    $("#fleetbadge").textContent = `demo fleet: ${num(f.robots)} arms, ${num(f.runs)} runs, ${f.hours} h`;
    $("#nrobots").textContent = num(f.robots);
    renderInbox(); renderHow(); renderTrust(); renderFound();
    $("#foot").innerHTML = `Built from <code>${esc(f.dataset)}</code> pinned at revision <code>${esc(f.revision.slice(0, 8))}</code>. Every number here is computed by <code>episode_triage/ledger.py</code> from the files in <code>results/</code>; <a href="data.json">data.json</a> holds them and <code>incidents/</code> holds every clip. Arms are numbered, not named; <code>results/robot_index.json</code> maps them back. Logs never leave your machine: the tool runs locally and this page is static.`;
    const m = location.hash.match(/^#inc=(.+)$/);
    if (m) openIncident(decodeURIComponent(m[1]));
    pollLive();
  }
  boot().catch((err) => { $("#inboxlist").innerHTML = '<div class="empty">Could not load data.json: ' + esc(err) + "</div>"; });
})();
