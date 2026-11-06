import { useEffect, useState } from "preact/hooks";
import { LadderBar } from "../components/LadderBar";
import { useBundle } from "../components/QueuePane";
import { RungTag } from "../components/RungTag";
import { defaultRange, Signals, type RangeMode } from "../components/Signals";
import { Empty, Skel } from "../components/States";
import { changeStatus, StatusControl } from "../components/StatusControl";
import { Trace } from "../components/Trace";
import { byId, data } from "../data";
import { incidentsByFp, pagerOrder, problemByFp, titleOf } from "../derive";
import { coFaultOf, evidenceRows, type EvRow } from "../evidence";
import { camWords, fixed, num, partWords, secs, span } from "../format";
import { useKeys } from "../keys";
import { go, href } from "../router";
import { calls, localLine, pushRecent, setCall, type Call } from "../state";
import type { Bundle, Data, Summary } from "../types";

const list = (w: string[]) => (w.length <= 1 ? w[0] ?? "" : w.slice(0, -1).join(", ") + " and " + w[w.length - 1]);

export function Incident({ id }: { id: string }) {
  const d = data.value;
  const s = d ? byId.value.get(id) ?? null : null;
  const { bundle, error, loading, retry } = useBundle(s?.bundle ?? null);
  const [mode, setMode] = useState<RangeMode>("fail");
  useEffect(() => {
    if (bundle) setMode(defaultRange(bundle));
  }, [bundle]);
  useEffect(() => {
    if (s) {
      document.title = `${titleOf(s)} · ${s.robot_id} · Triage`;
      pushRecent({ kind: "Incident", text: s.id, meta: s.route, to: href(["i", s.id]) });
    }
  }, [s?.id]);

  const pager = s ? pagerOrder(s.id) : { ids: [], q: {} };
  const pos = s ? pager.ids.indexOf(s.id) : -1;
  const prev = pos > 0 ? pager.ids[pos - 1] : null;
  const next = pos >= 0 && pos < pager.ids.length - 1 ? pager.ids[pos + 1] : null;
  const back = () => go(["queue"], { ...pager.q, sel: s?.id });

  useKeys({
    Escape: back,
    "[": () => prev && go(["i", prev], {}, true),
    "]": () => next && go(["i", next], {}, true),
    a: () => s && changeStatus(s.id, "ack"),
    r: () => s && changeStatus(s.id, "resolved"),
    w: () => bundle && setMode(mode === "fail" ? "whole" : "fail"),
    "1": () => s?.rung === 4 && toggleCall(s.id, "task"),
    "2": () => s?.rung === 4 && toggleCall(s.id, "arm"),
    "3": () => s?.rung === 4 && toggleCall(s.id, "unsure"),
  });

  if (!d) return <IncidentShell />;
  if (!s)
    return (
      <>
        <Crumbs />
        <main class="inc-wrap" id="main">
          <h1 class="sr">Incident not found</h1>
          <Empty title={`No incident ${id} in this data.`} actions={<a class="btn" href={href(["queue"])}>Back to the queue</a>} />
        </main>
      </>
    );

  const p = problemByFp.value.get(s.fingerprint);
  const label = p?.base ?? s.label ?? s.fingerprint;
  const ev = bundle ? bundle.incident.cause ?? bundle.incident.anchor : null;
  const conf = ev?.confidence;

  return (
    <>
      <header class="crumbs">
        <a href={href([])} aria-label="Triage home">
          <span class="mark" aria-hidden="true">
            <i />
            <i />
            <i />
            <i />
          </span>
        </a>
        <nav aria-label="Breadcrumb">
          <a href={href(["queue"], pager.q)}>Queue</a>
          <span>/</span>
          <a href={href(["queue"], { open: s.fingerprint })}>{label}</a>
          <span>/</span>
          <span class="num" style="color:var(--text)">
            {s.id}
          </span>
        </nav>
        <div class="pager">
          <a class="btn" href={href(["queue"], { ...pager.q, sel: s.id })} style="height:30px">
            <span class="kbd">Esc</span> Queue
          </a>
          <a
            class="btn icon"
            href={prev ? href(["i", prev]) : undefined}
            aria-label="Previous incident"
            aria-disabled={prev ? undefined : "true"}
            style={`height:30px;width:30px${prev ? "" : ";opacity:.45;pointer-events:none"}`}
          >
            ‹
          </a>
          <span class="num">
            {num(pos + 1)} of {num(pager.ids.length)}
          </span>
          <a
            class="btn icon"
            href={next ? href(["i", next]) : undefined}
            aria-label="Next incident"
            aria-disabled={next ? undefined : "true"}
            style={`height:30px;width:30px${next ? "" : ";opacity:.45;pointer-events:none"}`}
          >
            ›
          </a>
          <a href={s.bundle} target="_blank" rel="noopener" class="mono" style="margin-left:8px;font-size:12px">
            Raw bundle .json
          </a>
        </div>
      </header>
      <main class="inc-wrap" id="main">
        <section class="verdict" aria-label="Verdict">
          <div class="verdict-main">
            <div class="tagrow">
              <RungTag rung={s.rung} lg />
              <span class="tag mono">Rule {s.rule}</span>
              <span class="tag">{s.layer}</span>
              {conf ? <span class="tag">{conf} confidence</span> : null}
              <span class="tag">{s.source}</span>
            </div>
            <h1 class="h-incident">{titleOf(s)}</h1>
            <div class="idline">
              {s.component && s.component !== "arm" ? partWords(s.component, { fingerprint: s.fingerprint }) + " · " : ""}
              {s.robot_id} · run {s.run} · at {secs(s.t, 2)}
            </div>
            <div class="engine">
              <span class="lbl">Engine verdict</span>
              <span class="mono">{s.route}</span>
            </div>
            {s.rung === 4 ? <Candidates s={s} /> : null}
          </div>
          <DestCard s={s} d={d} bundle={bundle} />
        </section>

        <div class="inc-grid">
          {bundle ? (
            <Signals b={bundle} s={s} th={d.thresholds} mode={mode} setMode={setMode} />
          ) : error ? (
            <section class="card inc-signals" aria-label="Signals">
              <div class="card-head">
                <h2 class="h2">Signals</h2>
              </div>
              <div style="display:flex;gap:10px;align-items:center;margin:0 16px 16px;padding:10px 12px;border:1px dashed var(--border-strong);border-radius:8px;color:var(--text-2);font-size:13px">
                The evidence file {s.bundle} didn't load. The verdict above still stands.
                <button type="button" class="btn" style="height:28px;margin-left:auto" onClick={retry}>
                  Retry
                </button>
              </div>
            </section>
          ) : (
            <SignalsSkeleton />
          )}

          <aside class="inc-side">
            <section class="card card-pad" aria-labelledby="why">
              <h2 id="why" class="lbl" style="margin-bottom:12px">
                Why this verdict
              </h2>
              {bundle?.incident.trace?.length ? (
                <Trace lines={bundle.incident.trace} subs />
              ) : loading ? (
                <div style="display:flex;flex-direction:column;gap:8px" aria-busy="true">
                  <Skel h={12} w="80%" />
                  <Skel h={12} w="60%" />
                  <Skel h={12} w="70%" />
                </div>
              ) : (
                <p class="t-3" style="font-size:12px">
                  The trace is in the evidence file, which didn't load.
                </p>
              )}
              {s.rung === 4 ? <RuleBox s={s} d={d} /> : null}
            </section>
            {ev ? <EvidenceCard s={s} d={d} b={bundle!} /> : null}
            {bundle ? <Coverage s={s} b={bundle} /> : null}
            <StatusControl id={s.id} />
            <MoreOnArm s={s} />
          </aside>
        </div>
      </main>
    </>
  );
}

function toggleCall(id: string, c: Call) {
  setCall(id, calls.value[id] === c ? null : c);
}

/** Crumbs bar with only the home mark, while data loads or for an unknown id. */
const Crumbs = () => (
  <header class="crumbs">
    <a href={href([])} aria-label="Triage home">
      <span class="mark" aria-hidden="true">
        <i />
        <i />
        <i />
        <i />
      </span>
    </a>
    <nav aria-label="Breadcrumb">
      <a href={href(["queue"])}>Queue</a>
    </nav>
  </header>
);

function IncidentShell() {
  return (
    <>
      <Crumbs />
      <main class="inc-wrap" id="main" aria-busy="true">
        <h1 class="sr">Loading the incident</h1>
        <div style="display:flex;flex-direction:column;gap:12px">
          <Skel h={30} w="240px" />
          <Skel h={28} w="50%" />
          <Skel h={14} w="30%" />
        </div>
        <SignalsSkeleton />
      </main>
    </>
  );
}

function SignalsSkeleton() {
  return (
    <section class="card inc-signals" aria-label="Signals, loading" aria-busy="true" style="overflow:hidden">
      <div class="card-head">
        <h2 class="h2">Signals</h2>
      </div>
      <div class="panel" style="grid-template-columns:120px minmax(0,1fr)">
        <Skel h={12} w="80%" />
        <Skel h={160} />
      </div>
      <div class="panel" style="grid-template-columns:120px minmax(0,1fr)">
        <Skel h={12} w="60%" />
        <Skel h={56} />
      </div>
      <div class="panel last" style="grid-template-columns:120px minmax(0,1fr);padding-bottom:16px">
        <Skel h={12} w="60%" />
        <Skel h={56} />
      </div>
    </section>
  );
}

/** Rung 4: the two candidates the engine could not tell apart. */
function Candidates({ s }: { s: Summary }) {
  const co = coFaultOf(s.route, s.co_faults);
  const left = s.route.split(", on a recording")[0].split(";")[0];
  const contact = /contact with the world or a dead joint/.test(s.route);
  return (
    <div style="display:flex;flex-direction:column;gap:8px;max-width:820px">
      <span class="lbl">Two candidates, too close to call</span>
      <div class="cands">
        <div class="cand" style="background:var(--r3-bg);box-shadow:inset 0 0 0 1px var(--r3-line)">
          <span class="lbl rtext-3">{contact ? "If it's contact with the world · training" : "If it's the task · training"}</span>
          <b>{contact ? left.split(":")[0] : left}</b>
          <span class="t-2" style="font-size:12px">
            {contact ? "Something in the scene held the joint. The clip shows what." : "The blue band. Every joint still, cameras live."}
          </span>
        </div>
        <div class="cand" style="background:var(--r2-bg);box-shadow:inset 0 0 0 1px var(--r2-line)">
          <span class="lbl rtext-2">If it's the arm · hardware</span>
          <b>{co ? `${co.label} on ${partWords(co.component)}` : contact ? "a dead joint" : "a fault on the arm"}</b>
          <span class="t-2" style="font-size:12px">
            {co ? "A standing fault on this recording. A policy compensates for it until it can't." : "The joint stopped answering its command. Position alone can't tell which."}
          </span>
        </div>
      </div>
    </div>
  );
}

/** "Who fixes it": the ladder bar, what happens next, and one line of context. */
function DestCard({ s, d, bundle }: { s: Summary; d: Data; bundle: Bundle | null }) {
  const comp = s.component ?? "";
  const words = partWords(comp, { fingerprint: s.fingerprint });
  let box: { title: string; body: string } | null = null;
  let line: preact.ComponentChildren = null;
  if (s.rung === 1) {
    box = { title: "Robot can try", body: s.self_recovery ?? "" };
    if (s.rule === "R2r") line = `Nobody is paged. If it doesn't catch up within ${d.thresholds.follow_recover_s.toFixed(1)} s, it becomes a ticket naming the joint (rule R2).`;
    else if (s.rule === "R6" && s.fingerprint.startsWith("task.missed_grasp")) line = "Logged only. 2 or more in a row goes to training (rule R4).";
    else if (s.rule === "R6") line = `Logged only. ${d.thresholds.glitch_ticket_count} or more bad reads on one motor make a ticket (rule R2).`;
    else if (s.fingerprint.startsWith("sensing.stale_state")) line = "Nobody is paged. If the joint stream freezes 3 or more times in one recording, it becomes a ticket for the joint stream (rule R1b).";
    else line = "Nobody is paged. If this camera freezes 3 or more times in one recording, it becomes a ticket for the camera or its USB link (rule R1b).";
  } else if (s.rung === 2) {
    const cam = s.fingerprint.startsWith("sensing.stale_camera") || /camera/.test(words);
    const bus = s.fingerprint.startsWith("actuation.bus_glitch");
    const action = s.route.includes("; ") ? s.route.slice(s.route.lastIndexOf("; ") + 2) : d.rules.find((r) => r.rule === s.rule)?.to ?? "";
    box = { title: bus ? "Ticket: bus or harness" : cam ? "Ticket naming the camera" : "Ticket naming the joint", body: `${words}: ${action}` };
    const same = (incidentsByFp.value.get(s.fingerprint) ?? []).filter((x) => x.robot_id === s.robot_id && x.id !== s.id);
    const runs = [...new Set(same.map((x) => x.run))].filter((r) => r !== s.run);
    line = runs.length ? (
      <>
        Same problem on this arm in run{runs.length > 1 ? "s" : ""} {list(runs.map(String))} too. <a href={href(["arm", s.robot_id])}>See {s.robot_id}</a>
      </>
    ) : (
      "First time this arm has shown it in the bundled sample."
    );
  } else if (s.rung === 3) {
    const t = bundle?.clip.t ?? [];
    const cams = (bundle?.coverage.cameras_checked ?? []).map(camWords);
    box = {
      title: "Training, with the clip",
      body: t.length ? `${span(t[0], t[t.length - 1], 1)}, ${list(cams)} camera${cams.length === 1 ? "" : "s"}, every layer checked first` : "the clip, every layer checked first",
    };
    line = "Most community runs are teleoperated, so on this fleet rung 3 is mostly the operator pausing, not a learned policy failing.";
  } else {
    box = { title: "The engine abstained", body: "It says so instead of guessing. Your call routes it." };
  }
  const call = calls.value[s.id] ?? null;
  return (
    <div class="card destcard">
      <span class="lbl">Who fixes it</span>
      <LadderBar rung={s.rung} />
      {box ? (
        <div class={`try r${s.rung}`}>
          <b class={s.rung < 4 ? `rtext-${s.rung}` : undefined}>{box.title}</b>
          <span>{box.body}</span>
        </div>
      ) : null}
      {line ? (
        <p class="t-2" style="font-size:12px">
          {line}
        </p>
      ) : null}
      {s.rung === 4 ? (
        <div style="display:flex;flex-direction:column;gap:6px">
          <div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px">
            <span class="lbl">Your call</span>
            <span class="local">{localLine()}</span>
          </div>
          <div class="seg" role="group" aria-label="Your call" style="align-self:flex-start">
            {(
              [
                ["task", "The task", "1"],
                ["arm", "The arm", "2"],
                ["unsure", "Not sure", "3"],
              ] as [Call, string, string][]
            ).map(([v, l, k]) => (
              <button key={v} type="button" aria-pressed={call === v ? "true" : "false"} aria-keyshortcuts={k} onClick={() => toggleCall(s.id, v)}>
                {l}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Rung 4: the rule that sent it to a person, under the trace. */
function RuleBox({ s, d }: { s: Summary; d: Data }) {
  const r = d.rules.find((x) => x.rule === s.rule);
  if (!r) return null;
  return (
    <div style="margin-top:4px;padding:10px 12px;border-radius:8px;background:var(--surface-2);border:1px solid var(--border-soft);font-size:12px;color:var(--text-2)">
      <b style="color:var(--text)">Rule {r.rule}</b> {r.when}. To: {r.to}.
    </div>
  );
}

function EvidenceCard({ s, d, b }: { s: Summary; d: Data; b: Bundle }) {
  const ev = b.incident.cause ?? b.incident.anchor!;
  const first = b.incident.context?.[0];
  const rows: EvRow[] = evidenceRows(ev, d.thresholds, {
    rung: s.rung,
    route: s.route,
    coFaults: s.co_faults,
    firstBefore: first ? partWords(first.component) : null,
  });
  return (
    <section class="card card-pad" aria-labelledby="ev">
      <div style="display:flex;align-items:baseline;justify-content:space-between;gap:8px;margin-bottom:4px;flex-wrap:wrap">
        <h2 id="ev" class="lbl">
          Evidence
        </h2>
        <span class="mono t-3" style="font-size:11.5px">
          {ev.check} · {fixed(ev.t_start, 2)} to {fixed(ev.t_end, 2)} s
        </span>
      </div>
      {rows.map((r) => (
        <div key={r.label} class={r.ctx ? "ev ctx" : "ev"}>
          <span>{r.label}</span>
          <span class="val">
            {r.value} <span>{r.threshold}</span>
          </span>
          {r.meter ? (
            <span class="meter" aria-hidden="true">
              <i style={`width:${Math.min(100, (100 * r.meter.value) / r.meter.max)}%;background:${r.meter.fill}`} />
              <b style={`left:${Math.min(100, (100 * r.meter.thr) / r.meter.max)}%`} />
            </span>
          ) : null}
        </div>
      ))}
    </section>
  );
}

function Coverage({ s, b }: { s: Summary; b: Bundle }) {
  const checked = b.coverage?.cameras_checked ?? [];
  const missing = b.coverage?.cameras_missing ?? [];
  let line: string | null = null;
  if (s.rung === 3) line = "Every layer checked, which is what lets this count as a task failure.";
  else if (missing.length) line = `${missing.length} camera${missing.length > 1 ? "s" : ""} missing on this run.`;
  else if (s.rung !== 4) line = `No cameras missing on this run.${b.events.length <= 1 && !b.incident.context?.length ? " Nothing else fired in this window." : ""}`;
  return (
    <section class="card card-pad" aria-labelledby="cov" style="display:flex;flex-direction:column;gap:8px">
      <h2 id="cov" class="lbl">
        What was checked
      </h2>
      <div class="cov">
        <span class="chip ok">✓ joints</span>
        {checked.map((c) => (
          <span key={c} class="chip ok">
            ✓ {camWords(c)} camera
          </span>
        ))}
        {missing.map((c) => (
          <span key={c} class="chip miss">
            {camWords(c)} camera
          </span>
        ))}
      </div>
      {line ? (
        <p class="t-2" style="font-size:12px">
          {line}
        </p>
      ) : null}
    </section>
  );
}

/** Other bundled incidents on this arm (rung 1, 2, 4), or what recurs on it (rung 3). */
function MoreOnArm({ s }: { s: Summary }) {
  const d = data.value!;
  if (s.rung === 3) {
    const same = d.incidents.filter((x) => x.robot_id === s.robot_id && x.fingerprint === s.fingerprint);
    if (same.length < 2) return null;
    const runs = new Set(same.map((x) => x.run));
    const others = same.filter((x) => x.id !== s.id);
    const noun = s.fingerprint.startsWith("task.stall") ? "stalls" : "incidents";
    return (
      <section class="card card-pad" style="display:flex;flex-direction:column;gap:6px">
        <span class="lbl">Recurring on {s.robot_id}</span>
        <span class="t-2" style="font-size:12px">
          {num(same.length)} {noun} in {num(runs.size)} sampled run{runs.size > 1 ? "s" : ""}
        </span>
        {[...others, s].slice(-6).map((x) => (
          <a key={x.id} href={href(["i", x.id])}>
            {x.route.split(", with ")[0]} <span class="t-3">· run {x.run}</span>
          </a>
        ))}
      </section>
    );
  }
  const others = d.incidents
    .filter((x) => x.robot_id === s.robot_id && x.id !== s.id && x.rule !== "R6")
    .sort((a, b) => Number(b.run === s.run) - Number(a.run === s.run) || Number(a.run) - Number(b.run))
    .slice(0, 5);
  if (!others.length) return null;
  return (
    <section class="card card-pad" style="display:flex;flex-direction:column;gap:6px">
      <span class="lbl">More on {s.robot_id}</span>
      {others.map((x) => (
        <a key={x.id} href={href(["i", x.id])}>
          {x.route.split(", with ")[0]} <span class="t-3">· run {x.run}</span>
        </a>
      ))}
    </section>
  );
}
