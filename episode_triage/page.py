"""HTML for the report page. Every number comes from the findings dict, never typed in."""

from __future__ import annotations

CSS = """
:root{--bg:#fbfaf7;--fg:#1d1d1b;--muted:#6b6a65;--line:#dcd9d0;--card:#ffffff;
--a:#1f5fa8;--b:#b0762a;--c:#d9d4c7;--cause:#c2412d;--anchor:#1f5fa8;--ctx:#8a8778;--hot:#c2412d;--bar:#8fa6bf;
--r0:#9aa79a;--r1:#5f9b6a;--r2:#c98a2e;--r3:#5b7fb8;--r4:#b5483a}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#151514;--fg:#ecebe6;--muted:#a3a19a;
--line:#34332f;--card:#1d1d1b;--a:#7fb0ea;--b:#e0a95c;--c:#3a3934;--cause:#ef7a62;--anchor:#7fb0ea;--ctx:#8f8c80;
--hot:#ef7a62;--bar:#5d7690}}
:root[data-theme="dark"]{--bg:#151514;--fg:#ecebe6;--muted:#a3a19a;--line:#34332f;--card:#1d1d1b;--a:#7fb0ea;
--b:#e0a95c;--c:#3a3934;--cause:#ef7a62;--anchor:#7fb0ea;--ctx:#8f8c80;--hot:#ef7a62;--bar:#5d7690}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:760px;margin:0 auto;padding:28px 16px 64px}
h1{font-size:30px;line-height:1.15;margin:0 0 8px;letter-spacing:-.01em}
h2{font-size:20px;margin:44px 0 10px;padding-top:14px;border-top:1px solid var(--line)}
h3{font-size:16px;margin:22px 0 6px}
p{margin:0 0 12px}
.lede{font-size:18px}
.muted,.note{color:var(--muted)}
.note{font-size:14px}
.indep{font-size:13px;color:var(--muted);margin-bottom:22px}
.finding{background:var(--card);border:1px solid var(--line);border-left:4px solid var(--cause);padding:14px 16px;border-radius:6px;margin:18px 0}
.finding p:last-child{margin:0}
.num{font-variant-numeric:tabular-nums;font-weight:650}
code{font:13px ui-monospace,SFMono-Regular,Menlo,monospace;background:var(--card);border:1px solid var(--line);padding:1px 4px;border-radius:4px}
a{color:var(--a)}
.ladder{display:grid;gap:8px;margin:14px 0}
.rung{display:grid;grid-template-columns:44px 1fr;gap:10px;align-items:start;background:var(--card);border:1px solid var(--line);border-radius:6px;padding:10px 12px}
.rung .k{font-size:22px;font-weight:700;text-align:center;border-radius:5px;color:#fff;padding:2px 0}
.rung .t{font-weight:650}
.rung .ex{font-size:13px;color:var(--muted);margin-top:2px}
.r0 .k{background:var(--r0)}.r1 .k{background:var(--r1)}.r2 .k{background:var(--r2)}.r3 .k{background:var(--r3)}.r4 .k{background:var(--r4)}
table{border-collapse:collapse;width:100%;font-size:14px;margin:10px 0 6px;font-variant-numeric:tabular-nums}
th,td{text-align:left;padding:6px 8px;border-bottom:1px solid var(--line);vertical-align:top}
th{font-weight:650;color:var(--muted);font-size:12px;text-transform:uppercase;letter-spacing:.03em}
td.n{text-align:right}
.scroll{overflow-x:auto}
figure{margin:16px 0 26px}
figcaption{font-size:14px;color:var(--muted);margin-top:6px}
svg{width:100%;height:auto;display:block}
.tl .ln{fill:none;stroke-width:1.4}.tl .ln.a{stroke:var(--a)}.tl .ln.b{stroke:var(--b);stroke-dasharray:4 3}
.tl .ln.c{stroke:var(--c);stroke-width:5;opacity:.9}
.tl .axis{stroke:var(--line)}.tl text{fill:var(--muted);font-size:11px}.tl .plabel{fill:var(--fg);font-size:12px}
.tl .band.cause{fill:var(--cause);opacity:.22}.tl .band.anchor{fill:var(--anchor);opacity:.12}.tl .band.context{fill:var(--ctx);opacity:.18}
.tl .bandlabel{font-size:11px;font-weight:650}.tl .bandlabel.cause{fill:var(--cause)}.tl .bandlabel.anchor{fill:var(--anchor)}
.bars .bar{fill:var(--bar)}.bars .bar.hot{fill:var(--hot)}.bars text{fill:var(--fg);font-size:13px}.bars .bval{fill:var(--muted);font-size:12px}
.route{font:13px ui-monospace,SFMono-Regular,Menlo,monospace;background:var(--card);border:1px solid var(--line);border-radius:6px;padding:8px 10px;margin:8px 0;white-space:pre-wrap}
ul{padding-left:20px}li{margin:4px 0}
footer{margin-top:48px;font-size:13px;color:var(--muted)}
"""


def _n(x) -> str:
    return f'<span class="num">{x:,}</span>' if isinstance(x, int) else f'<span class="num">{x}</span>'


def render(F, top, top_video, inj, bench, examples, lags, example_svg, plain, rung_names, repo, svg, escape) -> str:
    J, V = F["joints"], F["video"]
    anchors = V["anchors"]
    n_anchor = sum(anchors.values())
    began = anchors.get("began with sensing or actuation", 0)
    training = anchors.get("training, inputs healthy", 0)
    inc_rungs = {int(k): v for k, v in V["incident_rungs"].items()}

    # one real route line per rung, from the sampled episodes
    ex_route = {}
    for ex in examples:
        for i in ex["incidents"]:
            ex_route.setdefault(i["rung"], i["route"])
    ladder_ex = F.get("rung_examples", {})
    for k, v in ladder_ex.items():
        ex_route.setdefault(int(k), v)

    h = []
    h.append(f"""<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Episode Triage</title>
<meta name="description" content="Triage of {J['episodes']:,} robot episodes from {J['robots']:,} community arms: where progress stopped, which layer started it, and who should fix it.">
<style>{CSS}</style></head><body><main>
<h1>Episode triage</h1>
<p class="lede">A tool that reads robot episode logs, finds where the robot stopped making progress
or did something wrong, works out whether a camera, a joint, or the task started it, and puts
each event on a ladder: clean, the robot can clear it itself, a ticket for a named part, send it
to training, or a person has to look.</p>
<p class="indep">Independent project by Avi Desai. Not affiliated with Weave Robotics. Data: the
LeRobot community dataset (Apache 2.0), {J['robots']:,} SO 100 and SO 101 arms built and
calibrated by different people. Code and every number below: <a href="{repo}">{repo.replace('https://', '')}</a>.</p>
""")

    h.append(f"""<div class="finding">
<p>All {_n(J['timestamps_synthetic'])} of {_n(J['episodes'])} episodes have a perfectly regular
timestamp column, because the recorder writes <code>frame_index / fps</code> instead of a measured
time, so no timing check on the clock can find anything. Reading each camera's pictures against the
joints that move it, {_n(V['episodes_stale_camera'])} of {_n(V['episodes_all_cameras'])} sampled
episodes from {_n(V['robots_stale_camera'])} robots had a camera that stopped updating while the arm
was moving.</p>
<p>Of the {_n(n_anchor)} stalls and missed grasp sequences in those episodes, {_n(began)} began with a
sensing or actuation fault, and a triage that only looked at the task would have sent them to training
as policy failures. Across all {_n(J['robots'])} robots, {_n(J['robots_any_actuation_ticket'])} carry
a joint level fault worth a ticket.</p>
</div>
""")

    # ladder
    h.append("<h2>The ladder</h2>")
    h.append(f"""<p>Ordered rules, first match wins. Rule 0 runs first: if a layer wasn't checked or the
data is broken, the event goes to a person with one line saying what's missing, and nothing is ever
sent to training on a guess. Counts are incidents in the {_n(V['episodes_all_cameras'])} episodes where
every camera and every joint was checked.</p><div class="ladder">""")
    blurbs = {0: "nothing fired", 1: "restart a stream, rehome a joint, retry a grasp",
              2: "camera or USB link, joint, bus or harness, calibration, recorder",
              3: "a stall or missed grasps with fresh inputs and healthy tracking",
              4: "data missing, causes too close to call, or contact versus a dead joint"}
    clean_eps = int(V["episode_rungs"].get("0", V["episode_rungs"].get(0, 0)))
    for k in range(5):
        cnt = clean_eps if k == 0 else inc_rungs.get(k, 0)
        unit = "episodes" if k == 0 else "incidents"
        ex = ex_route.get(k)
        exh = f'<div class="ex">e.g. {escape(ex)}</div>' if ex and k else ""
        h.append(f'<div class="rung r{k}"><div class="k">{k}</div><div><div class="t">{escape(rung_names[k])}'
                 f' <span class="muted">{cnt:,} {unit}</span></div><div class="ex">{escape(blurbs[k])}</div>{exh}</div></div>')
    h.append("</div>")

    # worked episodes
    if examples:
        h.append("<h2>Three episodes, one clock</h2>")
        h.append("""<p>Each panel shares one time axis. The red band is what started it, the blue band
is what a person would have been called for. Cause is the earliest sensing or actuation event that
began before the failure; anything that started after is context, never the cause.</p>""")
        for ex in examples:
            top_i = ex["incidents"][ex["focus"]] if ex["incidents"] else None
            route = top_i["route"] if top_i else "clean"
            h.append(f"<figure>{example_svg(ex)}<figcaption><b>{escape(ex['why'])}</b><br>"
                     f'<span class="route">rung {top_i["rung"] if top_i else 0}, {top_i["rule"] if top_i else "R7"}: '
                     f"{escape(route)}</span>"
                     f"{escape(ex['robot_id'])}, episode {ex['episode']}</figcaption></figure>")

    # fleet pareto
    h.append("<h2>What to fix first, across the fleet</h2>")
    h.append(f"""<p>Every incident becomes a ledger row with a fingerprint (check plus the part it names).
Fingerprints are ranked by robots affected times episodes affected times rung weight, so a fault on many
arms outranks one repeated on a single arm. Red bars cross the recurring bar: 2 or more robots, or 3 or
more times on one. Joint and task checks on all {_n(J['episodes'])} episodes
({J['hours']} hours).</p>""")
    rows = [{"label": plain(t["fingerprint"]), "robots": t["robots"], "recurring": t["recurring"]} for t in top]
    h.append(f'<figure>{svg.bars(rows, "robots", "label", mark="recurring", note="robots affected")}'
             f'<figcaption>Robots affected, top {len(rows)} fingerprints by priority.</figcaption></figure>')
    h.append('<div class="scroll"><table><tr><th>fingerprint</th><th>rung</th><th class="n">robots</th>'
             '<th class="n">episodes</th><th>example route</th></tr>')
    for t in top:
        h.append(f'<tr><td><code>{escape(t["fingerprint"])}</code></td><td>{t["rung"]}</td>'
                 f'<td class="n">{t["robots"]:,}</td><td class="n">{t["episodes"]:,}</td>'
                 f'<td>{escape(t["example"])}</td></tr>')
    h.append("</table></div>")

    # camera lag
    lm = {float(k): v for k, v in V["lag_medians"].items()}
    if lm:
        lag_rows = [{"label": f"{int(k)} frames ({k / 30 * 1000:.0f} ms at 30 fps)" if k >= 0 else f"{int(k)} frames",
                     "count": v, "hot": k >= 3} for k, v in sorted(lm.items())]
        h.append("<h2>Camera to joint lag</h2>")
        h.append(f"""<p>The delay at which a camera's image change best lines up with the motion of the
joints it sees, as a median over each robot's sampled episodes. A single episode's estimate moves by a
frame, so this is judged per robot. {_n(V['camera_streams_lag_ge_3'])} camera streams on
{_n(V['robots_lag_ge_3'])} robots trail their joints by 3 frames or more, and the spread across robots is
{V['lag_spread_frames']:g} frames: merged for training, those datasets disagree about when the gripper
saw the object.</p>""")
        h.append(f'<figure>{svg.bars(lag_rows, "count", "label", mark="hot", note="camera streams by median lag")}'
                 f"<figcaption>Camera streams by median lag (robots with 2 or more estimated episodes).</figcaption></figure>")

    # validation
    h.append("<h2>Does it find what it says it finds?</h2>")
    if inj:
        cal, S = inj["calibration"], inj["summary"]
        h.append(f"""<p>Faults were injected into real community episodes with a known answer. Video faults
were reencoded with LeRobot's own defaults (AV1, crf 30, GOP 2), so a frozen frame reaches the
detector through the same compression a real one would. One threshold was tuned on data: the image
change level for a frozen frame, set to {cal['stale_tau_e']} gray levels on {len(cal['robots'])}
calibration robots. Everything was then frozen and scored on different robots. Raw counts, misses
included.</p>""")
        names = {"freeze_3": "camera frozen 3 frames", "freeze_6": "camera frozen 6 frames",
                 "freeze_10": "camera frozen 10 frames", "freeze_20": "camera frozen 20 frames",
                 "stall": "joint stalls for 1.5 s", "offset": "joint offset 8% of range",
                 "glitch": "3 bad reads on one motor", "stale_state": "joint stream repeats 6 frames"}
        h.append('<div class="scroll"><table><tr><th>injected fault</th><th class="n">n</th><th class="n">caught</th>'
                 '<th class="n">missed</th><th class="n">right rung</th><th class="n">other new events</th></tr>')
        for k, v in S["faults"].items():
            h.append(f'<tr><td>{names.get(k, k)}</td><td class="n">{v["n"]}</td><td class="n">{v["caught"]}</td>'
                     f'<td class="n">{v["missed"]}</td><td class="n">{v["right_rung"]}</td>'
                     f'<td class="n">{v["new_other_events"]}</td></tr>')
        L = S["lag"]
        h.append("</table></div>")
        h.append(f"""<p class="note">Camera delayed by 3 frames: the lag estimate moved by 3 plus or minus 1 on
{L['within_1_of_3']} of {L['estimated']} episodes where both estimates existed ({L['n']} tried). "Other new
events" counts anything else the injection made fire. Injected faults test the detectors and the ladder;
they don't test whether natural faults look the same.</p>""")
    if bench:
        sf = bench["stale_frames"]
        h.append("<h3>Physical faults on an SO 101</h3>")
        h.append(f"""<p>Recorded on my own arm with the flight recorder in <code>recorder/</code>, which logs
the true age of every camera frame and the exact fault schedule. Stale frames, frame by frame: {sf.get('true_stale', 0)}
true, {sf.get('caught', 0)} caught, {sf.get('missed', 0)} missed, {sf.get('false_alarm', 0)} false alarms.</p>""")
        h.append('<div class="scroll"><table><tr><th>episode</th><th>fault</th><th>target</th><th>caught</th>'
                 '<th>rung</th><th>expected</th></tr>')
        for r in bench["rows"]:
            h.append(f'<tr><td>{r["episode"]}</td><td>{escape(r["fault"])}</td><td>{escape(r["target"])}</td>'
                     f'<td>{r.get("caught")}</td><td>{r.get("rung")}</td><td>{r.get("expect_rung")}</td></tr>')
        h.append("</table></div>")

    # what to record
    h.append("<h2>What a robot should record so this stops being inference</h2>")
    h.append("""<ul>
<li><b>Capture time per frame</b>, from the camera or a hardware trigger, next to the loop time. With
those, stale frames and camera lag become a subtraction instead of a cross check.</li>
<li><b>Real loop period.</b> A slow loop is only a log line today; nothing about it reaches the data.</li>
<li><b>Per motor load, temperature, voltage and status byte.</b> The servos on these arms report all
four over the same bus and none is recorded by default. They would turn "not following" into "unloaded
on overload" or "brownout".</li>
<li><b>The goal actually sent</b> after any clipping, beside the leader or policy command.</li>
<li><b>Every takeover</b> with the progress score and subsystem health at that moment. Each one is a
labeled anchor.</li>
</ul>
<p>The flight recorder in <code>recorder/</code> logs the first four on an SO 101 as a sidecar to a
normal LeRobot dataset.</p>""")

    # what's wrong
    h.append("<h2>What's wrong with it</h2>")
    h.append(f"""<ul>
<li>Stale camera and lag are inferred from picture content against joint motion, because the data has
no real clock. A camera pointed at a blank surface while moving can look frozen; those runs get low
confidence and stay off the counts.</li>
<li>"Policy" in teleop data means the operator. Rung 3 here is task level stalls and misses, not a learned
policy failing.</li>
<li>Proprioception alone can't always tell a thin cloth grasp from an empty close.</li>
<li>Each dataset counts as one robot. Some people recorded several datasets on one arm, so robot counts
are an upper bound.</li>
<li>The video checks ran on a seeded sample ({V['robots']:,} robots, up to 3 episodes each), not every
episode.</li>
<li>Injected faults are cleaner than natural ones.</li>
</ul>
<p>More, and what I'd build next, in the <a href="{repo}#whats-wrong-with-it">README</a>.</p>""")

    h.append(f"""<footer>Built from <code>lerobot/community_dataset_v3</code> pinned at a fixed revision.
Every number on this page is computed in <code>episode_triage/ledger.py</code> from the files in
<code>results/</code>; <a href="data.json">data.json</a> holds them. Your logs never leave your machine:
the tool runs locally and the page is static.</footer>""")
    h.append("</main></body></html>")
    return "\n".join(h)


# ---------------------------------------------------------------- README sections

FAULT_NAMES = {"freeze_3": "camera frozen 3 frames", "freeze_6": "camera frozen 6 frames",
               "freeze_10": "camera frozen 10 frames", "freeze_20": "camera frozen 20 frames",
               "stall": "joint stalls for 1.5 s", "offset": "joint offset 8% of range",
               "glitch": "3 bad reads on one motor", "stale_state": "joint stream repeats 6 frames"}


def readme_finding(F, top) -> str:
    J, V = F["joints"], F["video"]
    A = V["anchors"]
    n_anchor = sum(A.values())
    began = A.get("began with sensing or actuation", 0)
    training = A.get("training, inputs healthy", 0)
    lines = [
        f"Pointed at the LeRobot community dataset: {J['robots']:,} SO 100 and SO 101 arms, "
        f"{J['episodes']:,} episodes, {J['hours']} hours.",
        "",
        f"- **The clock says nothing.** All {J['timestamps_synthetic']:,} of {J['episodes']:,} episodes have "
        f"timestamps exactly equal to `frame_index / fps`, so any check on the timestamp column passes by "
        f"construction.",
        f"- **Cameras freeze while the arm moves.** In a seeded sample of {V['episodes_all_cameras']:,} episodes "
        f"from {V['robots']:,} robots with every camera checked, {V['episodes_stale_camera']:,} episodes on "
        f"{V['robots_stale_camera']:,} robots had at least one camera stop updating for 3 frames or more while "
        f"the joints it sees were moving ({V['stale_runs']:,} runs, {V['stale_frames']:,} frames, median run "
        f"{V['stale_run_frames_median']:g} frames). Every one of those episodes has a perfect timestamp column.",
        f"- **Task failures that weren't the task.** Of {n_anchor:,} stalls and missed grasp sequences in those "
        f"episodes, {began:,} began with a sensing or actuation fault and {training:,} went to training with "
        f"healthy inputs; the rest went to a person. A triage that only looked at the task would have labeled all "
        f"{n_anchor:,} as policy failures.",
        f"- **Joint level faults across the fleet.** {J['robots_any_actuation_ticket']:,} of {J['robots']:,} "
        f"robots carry at least one actuation ticket: {J['robots_gain_mismatch']:,} with leader and follower "
        f"calibrated over different spans, {J['robots_not_tracking']:,} with a joint whose follower doesn't track "
        f"its leader, {J['robots_rest_offset']:,} with a follower offset at rest, and {J['robots_bus_glitch']:,} "
        f"with impossible one frame jumps (bad bus reads).",
        f"- **Camera lag differs by robot.** {V['camera_streams_lag_ge_3']:,} camera streams on "
        f"{V['robots_lag_ge_3']:,} robots trail their joints by 3 frames (100 ms) or more, and median lag spans "
        f"{V['lag_spread_frames']:g} frames across robots.",
        "",
        "Top fingerprints by priority across all robots:",
        "",
        "| fingerprint | rung | robots | episodes |",
        "|---|---|---|---|",
    ]
    for t in top[:8]:
        lines.append(f"| `{t['fingerprint']}` | {t['rung']} | {t['robots']:,} | {t['episodes']:,} |")
    lines += ["", "Every number here is computed by `episode_triage/ledger.py` from `results/`, and the same "
                  "numbers are in `docs/data.json`."]
    return "\n".join(lines)


def readme_validation(inj, bench) -> str:
    if not inj:
        return "Not run yet."
    cal, S = inj["calibration"], inj["summary"]
    lines = [
        "Faults injected into real community episodes with a known answer. Video faults were reencoded with "
        "LeRobot's default encoder settings so they reach the detector through real compression.",
        "",
        f"One threshold was tuned on data: the stale camera image change level, set to {cal['stale_tau_e']} "
        f"gray levels on {len(cal['robots'])} calibration robots ({cal['n_frozen_frames']:,} injected frozen "
        f"frames against {cal['n_moving_frames']:,} moving frames: {cal['tpr_at_tau'] * 100:.0f}% of frozen "
        f"frames below it, {cal['fpr_at_tau'] * 100:.1f}% of moving frames below it, and the moving frames "
        f"include natural freezes, so that second number is an upper bound). Then every threshold was frozen and "
        f"the faults below were scored on different robots.",
        "",
        "| injected fault | n | caught | missed | right rung | other new events |",
        "|---|---|---|---|---|---|",
    ]
    for k, v in S["faults"].items():
        lines.append(f"| {FAULT_NAMES.get(k, k)} | {v['n']} | {v['caught']} | {v['missed']} | {v['right_rung']} | "
                     f"{v['new_other_events']} |")
    L = S["lag"]
    lines += ["", f"Camera delayed by 3 frames: the lag estimate moved by 3 plus or minus 1 on {L['within_1_of_3']} "
                  f"of {L['estimated']} episodes where both estimates existed ({L['n']} tried). Shifts seen: "
                  f"{', '.join(f'{k}: {v}' for k, v in sorted(L['shift_counts'].items(), key=lambda x: int(x[0])))}.",
              "", "Raw rows are in `results/inject_eval.json`."]
    if bench:
        sf = bench["stale_frames"]
        lines += ["", "**Bench set on a physical SO 101** (`recorder/`, `results/bench_eval.json`): stale frames "
                      f"{sf.get('true_stale', 0)} true, {sf.get('caught', 0)} caught, {sf.get('missed', 0)} missed, "
                      f"{sf.get('false_alarm', 0)} false alarms; {len(bench['rows'])} scheduled faults scored."]
    else:
        lines += ["", "**Bench set on a physical arm:** the recorder and protocol are in `recorder/`; "
                      "`triage bench-eval` scores it and `triage report` adds it here."]
    return "\n".join(lines)
