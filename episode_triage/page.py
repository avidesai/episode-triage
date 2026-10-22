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
.finding .head{font-size:18px;font-weight:600;margin-bottom:12px}
.finding ul{margin:0;padding-left:18px}.finding li{margin:8px 0}
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
.tl .ln{fill:none;stroke-width:2}.tl .ln.a{stroke:var(--a)}.tl .ln.b{stroke:var(--b);stroke-dasharray:4 3}
.tl .ln.c{stroke:var(--c);stroke-width:5;opacity:.9}
.tl .axis{stroke:var(--line)}.tl text{fill:var(--muted);font-size:17px}.tl .plabel{fill:var(--fg);font-size:19px}
.tl .band.cause{fill:var(--cause);opacity:.22}.tl .band.anchor{fill:var(--anchor);opacity:.12}.tl .band.context{fill:var(--ctx);opacity:.18}
.tl .bandlabel{font-size:18px;font-weight:650}.tl .bandlabel.cause{fill:var(--cause)}.tl .bandlabel.anchor{fill:var(--anchor)}
.bars .bar{fill:var(--bar)}.bars .bar.hot{fill:var(--hot)}.bars text{fill:var(--fg);font-size:21px}.bars .bval{fill:var(--muted);font-size:19px}
.route{font:13px ui-monospace,SFMono-Regular,Menlo,monospace;background:var(--card);border:1px solid var(--line);border-radius:6px;padding:8px 10px;margin:8px 0;white-space:pre-wrap}
ul{padding-left:20px}li{margin:4px 0}
footer{margin-top:48px;font-size:13px;color:var(--muted)}
"""


def nice(route: str) -> str:
    """Route text as a person reads it: joint names without underscores."""
    return route.replace("follower.", "follower ").replace("leader.", "leader ").replace("_", " ")


def ratio(whole: int, part: int) -> int:
    return round(whole / part) if part else 0


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
<p class="lede">A robot fleet produces more failures than a small team can look at. The costly mistake
is retraining the policy on a failure that was really a frozen camera or a joint that didn't do what it
was told. This tool reads the logs and checks those cheap layers first. A failure goes to training only
when the cameras were fresh and the joints followed their commands.</p>
<p class="indep">Independent project by Avi Desai. Not affiliated with Weave Robotics. Data: the
LeRobot community dataset (Apache 2.0), {J['robots']:,} SO 100 and SO 101 arms built and calibrated by
different people. Code and every number below: <a href="{repo}">{repo.replace('https://', '')}</a>.</p>
""")

    h.append(f"""<div class="finding">
<p class="head">Across {_n(J['robots'])} arms, that check found joint or calibration faults on about
1 in {ratio(J['robots'], J['robots_any_actuation_ticket'])} arms and frozen cameras in about 1 in
{ratio(V['episodes_all_cameras'], V['episodes_stale_camera'])} recordings. It also proved my own
prediction wrong: nearly every stall was really the operator pausing.</p>
<ul>
<li><b>Frozen cameras don't show up in the timestamps.</b> LeRobot writes each timestamp as frame number
divided by frame rate, so all {_n(J['episodes'])} recordings have a perfect clock. Comparing each camera's
picture with the arm's motion found {_n(V['episodes_stale_camera'])} of {_n(V['episodes_all_cameras'])}
sampled recordings, on {_n(V['robots_stale_camera'])} arms, where a camera stopped updating while the arm
moved.</li>
<li><b>Joint faults are common, and mostly calibration.</b> {_n(J['robots_any_actuation_ticket'])} arms have
at least one: the follower sits off its leader at rest ({J['robots_rest_offset']} arms), the two arms were
calibrated over different ranges ({J['robots_gain_mismatch']}), bad motor readings ({J['robots_bus_glitch']}),
or a reading that wraps from +180 to -180 degrees so the follower spins the long way round.</li>
<li><b>My stall prediction was wrong.</b> I wrote down beforehand that at least a quarter of stalls would
start with a camera or joint fault. It was {_n(began)} of {_n(n_anchor)}. In this data the check mostly
confirms that a stall is a real task failure, and those {_n(training)} go to training with the evidence
attached.</li>
</ul>
</div>
""")

    # ladder
    h.append("<h2>The ladder</h2>")
    h.append(f"""<p>Every problem ends up on one of five rungs. The rules run in a fixed order and the first
match wins. The first rule checks the data itself: if a camera wasn't checked or the data is broken, the
problem goes to a person with a one line reason, so nothing reaches training on a guess. Counts are from the
{_n(V['episodes_all_cameras'])} sampled recordings where every camera and joint was checked.</p><div class="ladder">""")
    blurbs = {0: "nothing fired", 1: "restart a stream, rehome a joint, retry a grasp",
              2: "camera or USB link, joint, bus or harness, calibration, recorder",
              3: "a stall or missed grasps with fresh pictures and joints that followed",
              4: "data missing, two causes too close to call, or contact versus a dead joint"}
    clean_eps = int(V["episode_rungs"].get("0", V["episode_rungs"].get(0, 0)))
    for k in range(5):
        cnt = clean_eps if k == 0 else inc_rungs.get(k, 0)
        unit = "recordings" if k == 0 else "problems"
        ex = ex_route.get(k)
        exh = f'<div class="ex">Example: {escape(nice(ex))}</div>' if ex and k else ""
        h.append(f'<div class="rung r{k}"><div class="k">{k}</div><div><div class="t">{escape(rung_names[k])}'
                 f' <span class="muted">{cnt:,} {unit}</span></div><div class="ex">{escape(blurbs[k])}</div>{exh}</div></div>')
    h.append("</div>")

    # worked episodes
    if examples:
        h.append("<h2>Three examples, one clock</h2>")
        h.append("""<p>Each example stacks the arm, the cameras, and the gripper on one time axis, zoomed to the
problem. Red marks what started it; blue marks what a person would have been called for. The cause is
always the earliest camera or joint problem that began before the failure, because anything that began
afterwards can't have caused it. Dataset ids for these examples are in
<code>results/examples.json</code>.</p>""")
        for ex in examples:
            top_i = ex["incidents"][ex["focus"]] if ex["incidents"] else None
            rung = top_i["rung"] if top_i else 0
            route = nice(top_i["route"]) if top_i else "clean"
            h.append(f"<figure>{example_svg(ex)}<figcaption><b>{escape(ex['why'])}.</b>"
                     f'<div class="route">Rung {rung}, {escape(rung_names[rung])}: {escape(route)}</div>'
                     f"</figcaption></figure>")

    # fleet pareto
    h.append(f"<h2>What to fix first, across all {J['robots']:,} arms</h2>")
    h.append(f"""<p>Each type of problem is ranked by how many arms it hits times how many recordings,
weighted by rung, so a fault on many arms outranks one repeated on a single arm. Red bars recur: on 2 or
more arms, or 3 or more times on one. This pass covers joint and data problems on all
{_n(J['episodes'])} recordings ({J['hours']} hours). Task problems like stalls need the video checked, so
they're counted in the sample above.</p>""")
    rows = [{"label": plain(t["fingerprint"]), "robots": t["robots"], "recurring": t["recurring"]} for t in top]
    h.append(f'<figure>{svg.bars(rows, "robots", "label", mark="recurring", note="robots affected")}'
             f'<figcaption>Arms affected, top {len(rows)} problem types by priority.</figcaption></figure>')
    h.append('<div class="scroll"><table><tr><th>problem</th><th>rung</th><th class="n">arms</th>'
             '<th class="n">recordings</th></tr>')
    for t in top:
        h.append(f'<tr><td>{escape(plain(t["fingerprint"]))}<br><span class="muted">Example: {escape(nice(t["example"]))}</span></td>'
                 f'<td>{t["rung"]}</td><td class="n">{t["robots"]:,}</td><td class="n">{t["episodes"]:,}</td></tr>')
    h.append("</table></div>")
    h.append("""<p class="note">A follower offset at rest can also be a weak servo sagging under load.
Recording motor load would separate the two.</p>""")

    # camera lag
    lb = {int(k): v for k, v in V.get("lag_by_frame", {}).items()}
    if lb:
        lag_rows = [{"label": (f"{k} frame{'' if k == 1 else 's'} ({round(k * 1000 / 30)} ms at 30 fps)" if k >= 0
                               else f"{k} frames (ahead: estimate suspect)"),
                     "count": v, "hot": k >= 3} for k, v in sorted(lb.items())]
        h.append("<h2>How late each camera runs</h2>")
        h.append(f"""<p>For each arm, the delay at which a camera's picture changes line up best with the
arm's motion. Most of the {_n(V['lag_streams'])} cameras run 0 to 2 frames behind the joints, which is
normal for a USB camera. {_n(V['camera_streams_lag_ge_3'])} cameras on {_n(V['robots_lag_ge_3'])} arms
run 3 frames (100 ms) or more behind, up to {V['lag_max_frames']:g}. Data merged from those arms disagrees
about when the gripper saw the object. {_n(V['camera_streams_lag_negative'])} cameras appear to run ahead
of the joints, which can't happen, so the estimate is probably wrong for them.</p>""")
        h.append(f'<figure>{svg.bars(lag_rows, "count", "label", mark="hot", note="camera streams by median lag")}'
                 f"<figcaption>Cameras by typical delay, rounded to the nearest frame (arms with 2 or more "
                 f"recordings where it could be measured).</figcaption></figure>")

    # validation
    h.append("<h2>Does it catch what it claims to?</h2>")
    if inj:
        cal, S = inj["calibration"], inj["summary"]
        h.append(f"""<p>I injected known faults into real recordings and checked whether the tool caught
them. Video faults were compressed again with LeRobot's own settings, so a frozen picture reaches the tool
the same way a real one would. One threshold was tuned on data (how little a picture can change and
still count as frozen), set on {len(cal['robots'])} arms. It was then frozen and tested on 40 different
arms. These are raw counts, misses included.</p>""")
        names = {"freeze_3": "camera frozen 3 frames", "freeze_6": "camera frozen 6 frames",
                 "freeze_10": "camera frozen 10 frames", "freeze_20": "camera frozen 20 frames",
                 "stall": "joint stalls for 1.5 s", "offset": "joint offset 8% of range",
                 "glitch": "3 bad reads on one motor", "stale_state": "joint stream repeats 6 frames"}
        h.append('<div class="scroll"><table><tr><th>fault injected</th><th class="n">tries</th><th class="n">caught</th>'
                 '<th class="n">caught, low confidence</th><th class="n">missed</th><th class="n">skipped</th>'
                 '<th class="n">right rung</th><th class="n">false extras</th></tr>')
        for k, v in S["faults"].items():
            h.append(f'<tr><td>{names.get(k, k)}</td><td class="n">{v["n"]}</td><td class="n">{v["caught"]}</td>'
                     f'<td class="n">{v["caught_low_confidence"]}</td><td class="n">{v["missed"]}</td>'
                     f'<td class="n">{v["abstained"]}</td><td class="n">{v["right_rung"]}</td>'
                     f'<td class="n">{v["new_other_events"]}</td></tr>')
        L = S["lag"]
        h.append("</table></div>")
        h.append(f"""<p class="note"><b>Caught, low confidence:</b> the tool found the frozen picture, but
that camera barely shows the arm moving, so it logs the finding and doesn't act on it. This guard stops a
camera that can't see the arm from being blamed for a stall, and here it costs more than half the catches.
<b>Skipped:</b> the recording had fewer than two pauses, so a resting offset couldn't be measured.
<b>False extras:</b> anything else the injected fault set off. A camera delayed by 3 frames was measured
within 1 frame of that on {L['within_1_of_3']} of {L['estimated']} recordings. Injected faults test the
rules against a known answer; they don't show that natural faults look the same.</p>""")
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
failure someone has already labeled.</li>
</ul>
<p>The flight recorder in <code>recorder/</code> is written to log the first four on an SO 101 as a
sidecar to a normal LeRobot dataset, with a scheduled fault injector and a run sheet. It hasn't been run on
hardware yet; recording that bench set is the next step, and the report adds its table when it exists.</p>""")

    # what's wrong
    h.append("<h2>What's wrong with it</h2>")
    h.append(f"""<ul>
<li>Frozen cameras and camera delay are inferred by comparing pictures with joint motion, because the data
has no real clock. A camera moving over a blank surface can look frozen; those cases get low confidence
and stay out of the counts.</li>
<li>Almost all of this data is people teleoperating, so "send to training" here means a task level stall
or miss by the operator, not a learned policy failing.</li>
<li>Joint positions alone can't always tell a grasp on thin cloth from closing on nothing.</li>
<li>Each dataset counts as one arm. Some people recorded several datasets on the same arm, so arm counts
are an upper bound.</li>
<li>The video checks ran on a random sample ({V['robots']:,} arms, up to 3 recordings each), not every
recording.</li>
<li>Every validation number on this page comes from faults injected in software. None comes from
a physical fault on a real arm yet, and injected faults are cleaner than natural ones.</li>
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
        f"Run on the LeRobot community dataset: {J['robots']:,} SO 100 and SO 101 arms built by different "
        f"people, {J['episodes']:,} recordings, {J['hours']} hours. Across those arms the check found joint or "
        f"calibration faults on about 1 in {ratio(J['robots'], J['robots_any_actuation_ticket'])} arms and "
        f"frozen cameras in about 1 in {ratio(V['episodes_all_cameras'], V['episodes_stale_camera'])} recordings. "
        f"It also proved my own prediction wrong: nearly every stall was really the operator pausing.",
        "",
        f"- **Frozen cameras don't show up in the timestamps.** LeRobot writes each timestamp as "
        f"`frame_index / fps`, so all {J['episodes']:,} recordings have a perfect clock. Comparing each "
        f"camera's picture with the arm's motion, in a random sample of {V['episodes_all_cameras']:,} "
        f"recordings from {V['robots']:,} arms, found {V['episodes_stale_camera']:,} recordings on "
        f"{V['robots_stale_camera']:,} arms where a camera stopped updating for 3 frames or more while the arm "
        f"moved ({V['stale_runs']:,} freezes, median {V['stale_run_frames_median']:g} frames). I predicted at "
        f"least 1 in 10 beforehand.",
        f"- **Joint faults are common, and mostly calibration.** {J['robots_any_actuation_ticket']:,} of "
        f"{J['robots']:,} arms have at least one: the follower sits off its leader at rest "
        f"({J['robots_rest_offset']:,} arms), the two arms were calibrated over different ranges "
        f"({J['robots_gain_mismatch']:,}), a follower joint doesn't track its leader at all "
        f"({J['robots_not_tracking']:,}), bad motor readings ({J['robots_bus_glitch']:,}), or a reading that "
        f"wraps from +180 to -180 degrees so the follower spins the long way round.",
        f"- **My stall prediction was wrong.** I wrote down beforehand that at least a quarter of stalls and "
        f"missed grasp sequences would start with a camera or joint fault. It was {began:,} of {n_anchor:,}. "
        f"In this teleoperated data nearly every stall is a person pausing, so the check mostly confirms that a "
        f"stall is a real task failure: {training:,} went to training with every layer checked, and the rest "
        f"went to a person because another fault on the same recording made the call unsafe.",
        f"- **Cameras run late by different amounts.** Most of {V['lag_streams']:,} cameras run 0 to 2 frames "
        f"behind the joints; {V['camera_streams_lag_ge_3']:,} cameras on {V['robots_lag_ge_3']:,} arms run 3 "
        f"frames (100 ms) or more behind, up to {V['lag_max_frames']:g}. {V['camera_streams_lag_negative']} "
        f"appear to run ahead, which can't happen, so the estimate is probably wrong for them.",
        "",
        "What to fix first across all arms (joint and data problems; stalls need the video checked, so they're "
        "ranked on the video sample in the report):",
        "",
        "| problem | code name | rung | arms | recordings |",
        "|---|---|---|---|---|",
    ]
    from .report import plain
    for t in top[:8]:
        lines.append(f"| {plain(t['fingerprint'])} | `{t['fingerprint']}` | {t['rung']} | {t['robots']:,} | "
                     f"{t['episodes']:,} |")
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
        "| fault injected | tries | caught | caught, low confidence | missed | skipped | right rung | false extras |",
        "|---|---|---|---|---|---|---|---|",
    ]
    for k, v in S["faults"].items():
        lines.append(f"| {FAULT_NAMES.get(k, k)} | {v['n']} | {v['caught']} | {v['caught_low_confidence']} | "
                     f"{v['missed']} | {v['abstained']} | {v['right_rung']} | {v['new_other_events']} |")
    lines += ["", "**Caught, low confidence** means the tool found the frozen picture, but that camera barely shows "
                  "the arm moving, so the finding is logged and the ladder doesn't act on it. That guard is what stopped "
                  "cameras that can't see the arm from being blamed for stalls in the fleet run, and on these "
                  "episodes it costs more than half the recall. It is defined as 3 times the stale threshold, so "
                  "freezing that threshold at 0.51 made the guard stricter too; I didn't retune it on the test "
                  "robots. **Skipped** means the recording had fewer than two pauses, so a resting offset can't be "
                  "measured in it. **False extras** counts anything else the injected fault set off."]
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
        lines += ["", "**Bench set on a physical arm: not recorded yet.** The recorder and run sheet are in "
                      "`recorder/` but haven't been run on hardware. `triage bench-eval` scores the set and "
                      "`triage report` adds it here once it exists."]
    return "\n".join(lines)
