"""Build the viewer's data from results/: the inbox, one bundle per incident, and the
numbers the page quotes. The viewer itself is a static page (docs/index.html, docs/app.js)
that reads these files; the live monitor writes the same bundle shape into docs/live/.

Contributors are never named on the page. Each dataset becomes "arm NNNN" through a
stable index saved in results/robot_index.json, so anyone can map back.
"""

from __future__ import annotations

import json
import time
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np

from .checks import THRESHOLDS
from .fleet import COMMUNITY, _json, _read_energies, score_video_sample
from .ladder import RUNG_NAMES
from .ledger import fingerprint as fp_of
from .ledger import findings, ledger_rows, load, rank_fingerprints
from .monitor import package_incident
from .pipeline import profile_for, triage_episode
from .readers import open_robot
from .report import PLAIN, plain

FIX_BY = {1: "robot", 2: "ticket", 3: "training", 4: "person"}
CACHE = Path(".cache/community_v3")

CHECKS = [
    # layer, id, name, signal, threshold, why
    ("sensing", "sensing.stale_camera", "Camera froze",
     "Picture change between consecutive frames (80x60 gray) while the joints that move or are seen by that camera are moving",
     f"change under {THRESHOLDS['stale_tau_e']} gray levels for {THRESHOLDS['stale_min_frames']}+ frames while arm motion is over {THRESHOLDS['stale_tau_m'] * 100:g}% of range per frame",
     "A still scene and a frozen camera look the same in the image alone; the joints are what separate a dead sensor from a quiet room. The change level was calibrated on injected freezes through LeRobot's own video compression."),
    ("sensing", "sensing.stale_state", "Joint stream repeated",
     "Every arm joint reads bit identical while the lag corrected command is moving",
     f"{THRESHOLDS['stale_state_min_frames']}+ identical frames while the command moves",
     "One joint going flat is an actuator. All of them going flat at once is the data path: a cached bus read or duplicated rows."),
    ("sensing", "sensing.camera_lag", "Camera runs late",
     "Delay at which picture change lines up best with arm motion",
     f"judged per arm as a median over runs; flagged at 3 frames (100 ms) or more",
     "A single run's estimate moves by a frame, so it is never used against one run."),
    ("actuation", "actuation.not_following", "Joint not following its command",
     "Gap between the follower's position and its command from a few frames earlier, after removing the arm's own calibration fit",
     f"gap over {THRESHOLDS['follow_err'] * 100:g}% of range for {THRESHOLDS['follow_min_s']} s; under {THRESHOLDS['follow_recover_s']} s and caught up means the robot cleared it",
     "Healthy followers stay under 7% at the 99th percentile. A limp or stalled servo passes 15% within a few hundred ms. The mode (stalled, sagging, lagging, held) comes from how far command and follower each travelled."),
    ("actuation", "actuation.rest_offset", "Offset at rest",
     "Median follower minus leader during pauses",
     f"over {THRESHOLDS['offset_err'] * 100:g}% of range in the same direction in {THRESHOLDS['offset_agree'] * 100:g}% of pauses",
     "A reseated horn or a stale calibration file. A policy learns to compensate until it can't, which looks like a worse model."),
    ("actuation", "actuation.gain_mismatch", "Calibration mismatch",
     "Slope of follower against leader over all of the arm's data",
     f"slope off by more than {THRESHOLDS['gain_err'] * 100:g}% on a joint that moved over a quarter of the arm's span",
     "Leader and follower are calibrated separately, so their readings can disagree by a gain. Reported once per arm, not as repeated tracking loss."),
    ("actuation", "actuation.bus_glitch", "Bad bus reads",
     "One frame jump in a joint reading that comes straight back",
     f"jump over {THRESHOLDS['glitch_jump'] * 100:g}% of range returning within {THRESHOLDS['glitch_return_frames']} frames; {THRESHOLDS['glitch_ticket_count']} on one motor is a ticket",
     "An STS3215 can't move a quarter of its range in 33 ms. One is logged; three on the same motor is a harness or bus problem."),
    ("actuation", "actuation.command_wrap", "Leader angle wrap",
     "One frame command jump that stays",
     f"over {THRESHOLDS['wrap_jump'] * 100:g}% of range in one frame, not returning",
     "The leader's reading wrapping past +-180 degrees sends the follower the long way round. This is the cause; the tracking loss that follows is the symptom."),
    ("actuation", "actuation.pinned", "Pinned at a limit",
     "Follower at the edge of its observed range while the command pushes further and keeps moving",
     f"within {THRESHOLDS['pin_margin'] * 100:g}% of the extreme, command {THRESHOLDS['pin_push'] * 100:g}% past it for {THRESHOLDS['pin_min_s']} s",
     "A joint limit or a calibration range that is too narrow."),
    ("task", "task.stall", "Stall",
     "Command and position still on every joint",
     f"for {THRESHOLDS['stall_min_s']} s or more, ignoring the first and last {THRESHOLDS['stall_edge_s']} s of a run",
     "The trigger deployed home robots use to call for help: the robot stalls for some time. Measured from motion, so the onset is when the robot stopped, not when anyone noticed."),
    ("task", "task.missed_grasp_sequence", "Missed grasps in a row",
     "After each close command, how far short of the command the gripper stopped",
     f"within {THRESHOLDS['empty_gap'] * 100:g}% of range is an empty close; {THRESHOLDS['holding_gap'] * 100:g}% or more short is holding something; 2 or more empties in a row with nothing held between is a sequence",
     "A metric home robot fleets publish. One empty close followed by a good grasp is the robot clearing its own miss."),
]

RULES = [
    ("R0", 4, "Data missing or unusable, or a layer wasn't checked", "a person, with one line saying what's missing"),
    ("R1", 1, "A camera or the joint stream froze and came back within 1 s", "the robot: restart the stream, hold, retry"),
    ("R1b", 2, "A camera froze for longer, or 3 or more times", "ticket: camera or USB link"),
    ("R2r", 1, "A joint stopped following and caught up within 1 s", "the robot: reenable torque, rehome"),
    ("R2", 2, "A joint stopped following, sat pinned, is miscalibrated, or the leader's angle wrapped", "ticket naming the joint"),
    ("R3", 2, "3 or more impossible one frame jumps on one motor", "ticket: bus or harness"),
    ("R4", 3, "A stall or missed grasps with fresh pictures and joints that followed", "training, with the clip"),
    ("R5", 4, "Two causes too close to call, a standing fault on the arm, or contact versus a dead joint", "a person, with both candidates"),
    ("R6", 1, "One missed grasp then a good one, or one bad bus read", "logged only"),
]


def build(results: Path, out: Path, max_joint_examples: int = 4) -> None:
    joints = load(results / "fleet_joints.jsonl")
    video = load(results / "fleet_video.jsonl")
    inj = json.loads((results / "inject_eval.json").read_text()) if (results / "inject_eval.json").exists() else None
    bench = json.loads((results / "bench_eval.json").read_text()) if (results / "bench_eval.json").exists() else None
    F = findings(joints, video)

    anon = _robot_index(results, joints, video)
    inc_dir = out / "incidents"
    inc_dir.mkdir(parents=True, exist_ok=True)
    for f in inc_dir.glob("*.json"):
        f.unlink()

    # ---- bundles for every incident in the video sample (all layers checked)
    summaries: list[dict] = []
    by_fp: dict[str, list[str]] = defaultdict(list)
    sample = json.loads((results / "video_sample.json").read_text())
    for rid, eps in sample["picks"]:
        fz = results / "energy" / (rid.replace("/", "__") + ".npz")
        d = CACHE / rid
        if not fz.exists() or not (d / "meta").exists():
            continue
        try:
            robot = open_robot(d, robot_id=rid)
            prof = profile_for(robot)
        except Exception:
            continue
        energies = _read_energies(fz)
        for i in eps:
            res = triage_episode(robot.episode(i), prof, video=True, keep_traces=True,
                                 energy_override=energies.get(i, {}))
            for k, inc in enumerate(res.incidents):
                if inc.rung == 0:
                    continue
                ident = f"{anon[rid]}-r{i}-{k}"
                live = package_incident(res, inc, anon[rid], i, ident=ident)
                _write_bundle(inc_dir, live, "video sample")
                summaries.append(_summary(live, "video sample"))
                by_fp[fp_of(live.incident)].append(ident)

    # ---- examples for fleet wide fingerprints that have no video example
    fleet_rows = ledger_rows(joints, "joints")
    want = defaultdict(list)
    for r in fleet_rows:
        if r["rung"] == 0 or r["fingerprint"].startswith("integrity."):
            continue
        if len(by_fp.get(r["fingerprint"], [])) + len(want[r["fingerprint"]]) < max_joint_examples:
            want[r["fingerprint"]].append((r["robot_id"], r["episode"]))
    need = defaultdict(set)
    for fp, lst in want.items():
        for rid, ep in lst:
            need[rid].add(ep)
    for rid, eps in need.items():
        try:
            robot = open_robot(CACHE / rid, robot_id=rid)
            prof = profile_for(robot)
        except Exception:
            continue
        for i in sorted(eps):
            res = triage_episode(robot.episode(i), prof, video=False, keep_traces=True)
            for k, inc in enumerate(res.incidents):
                if inc.rung == 0:
                    continue
                fp = fp_of(inc.to_dict())
                if (rid, i) not in want.get(fp, []):
                    continue
                ident = f"{anon[rid]}-r{i}-{k}"
                if (inc_dir / f"{ident}.json").exists():
                    continue    # already bundled with cameras from the video sample
                live = package_incident(res, inc, anon[rid], i, ident=ident)
                _write_bundle(inc_dir, live, "joint pass")
                summaries.append(_summary(live, "joint pass"))
                by_fp[fp].append(ident)

    # ---- the inbox: fingerprints ranked across the fleet
    inbox = []
    fleet_rank = rank_fingerprints(fleet_rows, layers=("sensing", "actuation"))
    video_rank = rank_fingerprints(ledger_rows(video, "video"), layers=("task",))
    for scope, ranked in (("joints", fleet_rank), ("video", video_rank)):
        for t in ranked:
            rung = t["rung"]
            inbox.append({"fingerprint": t["fingerprint"], "label": plain(t["fingerprint"]), "rung": rung,
                          "rung_name": RUNG_NAMES[rung], "fix_by": FIX_BY.get(rung, "none"),
                          "layer": t["fingerprint"].split(".")[0], "robots": t["robots"],
                          "episodes": t["episodes"], "count": t["count"], "recurring": t["recurring"],
                          "priority": t["priority"], "example": t["example"],
                          "scope": ("all arms, joint and data checks" if scope == "joints"
                                    else "sampled arms with cameras checked"),
                          "examples": by_fp.get(t["fingerprint"], [])[:12]})
    inbox.sort(key=lambda x: -x["priority"])

    rule_counts = Counter(i["rule"] for r in video if "episodes" in r for e in r["episodes"] for i in e["incidents"])
    rule_counts_fleet = Counter(i["rule"] for r in joints if "episodes" in r for e in r["episodes"] for i in e["incidents"])

    data = {
        "mode": "fleet",
        "generated_at": time.time(),
        "fleet": {"name": "LeRobot community arms", "robots": F["joints"]["robots"],
                  "runs": F["joints"]["episodes"], "hours": F["joints"]["hours"],
                  "sampled_robots": F["video"]["robots"], "sampled_runs": F["video"]["episodes_all_cameras"],
                  "dataset": COMMUNITY[0], "revision": COMMUNITY[1]},
        "findings": F,
        "inbox": inbox,
        "incidents": sorted(summaries, key=lambda s: (-s["rung"], s["id"])),
        "rules": [{"rule": r, "rung": g, "rung_name": RUNG_NAMES[g], "when": w, "to": to,
                   "count_sample": rule_counts.get(r, 0), "count_fleet": rule_counts_fleet.get(r, 0)}
                  for r, g, w, to in RULES],
        "checks": [{"layer": l, "id": i, "name": n, "signal": s, "threshold": t, "why": w}
                   for l, i, n, s, t, w in CHECKS],
        "thresholds": THRESHOLDS,
        "plain": PLAIN,
        "validation": {"summary": inj["summary"], "calibration": inj["calibration"]} if inj else None,
        "bench": bench,
    }
    (out / "data.json").write_text(json.dumps(data, default=_json))
    print(f"wrote {out / 'data.json'} ({(out / 'data.json').stat().st_size // 1024} KB), "
          f"{len(summaries)} incident bundles")

    readme = Path("README.md")
    if readme.exists():
        from .page import readme_finding, readme_validation
        from .report import _splice
        text = readme.read_text()
        text = _splice(text, "FINDING", readme_finding(F, fleet_rank[:8]))
        text = _splice(text, "VALIDATION", readme_validation(inj, bench))
        readme.write_text(text)


def _robot_index(results: Path, joints, video) -> dict[str, str]:
    ids = sorted({r["robot_id"] for r in joints + video})
    anon = {rid: f"arm {k + 1:04d}" for k, rid in enumerate(ids)}
    (results / "robot_index.json").write_text(json.dumps(anon, indent=0))
    return anon


def _summary(live, source: str) -> dict:
    inc = live.incident
    return {"id": live.id, "robot_id": live.robot_id, "run": live.coverage.get("run"), "t": round(live.t_abs, 2),
            "rung": inc["rung"], "rung_name": inc["rung_name"], "rule": inc["rule"], "route": inc["route"],
            "fingerprint": fp_of(inc), "layer": inc["layer"], "self_recovery": inc["self_recovery"],
            "source": source, "bundle": f"incidents/{live.id}.json"}


def _write_bundle(inc_dir: Path, live, source: str) -> None:
    d = live.to_dict()
    d["source"] = source
    (inc_dir / f"{live.id}.json").write_text(json.dumps(d, default=_json))
