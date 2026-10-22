"""Build the static report page from results/.

Reads only files in results/, so the page rebuilds offline and every number on it comes
from a file anyone can open. Worked episode plots come from results/examples.json, which
`make_examples` writes once (it re-runs those few episodes with traces kept).
"""

from __future__ import annotations

import json
from html import escape
from pathlib import Path

import numpy as np

from . import svg
from .fleet import COMMUNITY, _json
from .ladder import RUNG_NAMES
from .ledger import findings, ledger_rows, load, rank_fingerprints, robot_lags

REPO = "https://github.com/avidesai/episode-triage"
PLAIN = {
    "sensing.stale_camera.wrist camera": "wrist camera froze while the arm moved",
    "sensing.stale_camera.fixed camera": "scene camera froze while the arm moved",
    "sensing.stale_state.joint_stream": "joint stream repeated while commanded to move",
    "actuation.not_following": "joint stopped following its command",
    "actuation.rest_offset": "follower sits offset from its leader at rest",
    "actuation.gain_mismatch": "follower and leader calibrated over different spans",
    "actuation.not_tracking": "follower doesn't track its leader on a joint",
    "actuation.bus_glitch": "impossible one frame jumps on a motor",
    "actuation.pinned": "joint pinned at its limit while pushed further",
    "task.stall": "stopped making progress for 2 s or more",
    "task.missed_grasp_sequence": "2 or more missed grasps in a row",
    "task.missed_grasp": "single missed grasp",
    "integrity.short": "episode under 2 s",
    "integrity.frame_index": "frame index has gaps",
    "integrity.frame_count": "video and joint row counts disagree",
    "integrity.decode_error": "video failed to decode",
}


def plain(fp: str) -> str:
    if fp in PLAIN:
        return PLAIN[fp]
    for k, v in PLAIN.items():
        if fp.startswith(k + "."):
            part = fp[len(k) + 1:]
            return f"{v} ({part.replace('_', ' ')})"
    return fp


# ---------------------------------------------------------------- examples

def make_examples(results: Path, picks: list[tuple[str, int, str]]) -> None:
    """Re-run chosen episodes with traces and save the series the page plots."""
    from .fleet import load_video_frames
    from .pipeline import profile_for, triage_episode
    from .readers import open_robot

    out = []
    for rid, ep_i, why in picks:
        d = Path(".cache/community_v3") / rid
        robot = open_robot(d, robot_id=rid, remote=COMMUNITY)
        prof = profile_for(robot)
        frames = load_video_frames(robot, [ep_i])[ep_i]
        ok = {k: v for k, v in frames.items() if isinstance(v, np.ndarray)}
        r = triage_episode(robot.episode(ep_i), prof, frames_override=ok, keep_traces=True)
        sig = r.traces.pop("_signals")
        inc = max(r.incidents, key=lambda i: i.rung) if r.incidents else None
        focus = (inc.cause or inc.anchor) if inc else None
        j = sig.names.index(focus.component) if focus and focus.component in sig.names else sig.arm_idx[1]
        g = sig.gripper_idx[0] if sig.gripper_idx else None
        series = {
            "t": (np.arange(r.n_frames) / r.fps).round(3).tolist(),
            "joint": sig.names[j],
            "joint_cmd": (100 * sig.an[:, j]).round(2).tolist(),
            "joint_pos": (100 * sig.sn[:, j]).round(2).tolist(),
            "gripper_cmd": (100 * sig.an[:, g]).round(2).tolist() if g is not None else [],
            "gripper_pos": (100 * sig.sn[:, g]).round(2).tolist() if g is not None else [],
            "cams": {k: {"change": np.nan_to_num(v["change"]).round(3).tolist(),
                         "motion": (100 * v["motion"]).round(3).tolist()} for k, v in r.traces.items()},
        }
        out.append({"robot_id": rid, "episode": ep_i, "why": why, "rung": r.rung,
                    "incidents": [i.to_dict() for i in r.incidents],
                    "events": [e.to_dict() for e in r.events], "series": series})
    (results / "examples.json").write_text(json.dumps(out, default=_json))


def _example_svg(ex: dict) -> str:
    s = ex["series"]
    t = np.array(s["t"])
    panels = [{"label": f"{s['joint'].replace('_', ' ')}: command and position, % of range",
               "series": [{"y": np.array(s["joint_cmd"]), "cls": "b", "name": "command (leader)"},
                          {"y": np.array(s["joint_pos"]), "cls": "a", "name": "position (follower)"}]}]
    for k, c in s["cams"].items():
        panels.append({"label": f"{k.split('.')[-1]} camera: image change (line) and arm motion (shade)",
                       "series": [{"y": np.clip(np.array(c["motion"]) * 0.6, 0, 6), "cls": "c", "name": "arm motion"},
                                  {"y": np.clip(np.array(c["change"]), 0, 6), "cls": "a", "name": "image change"}],
                       "ylim": (0, 6)})
    if s["gripper_cmd"]:
        panels.append({"label": "gripper: command and position",
                       "series": [{"y": np.array(s["gripper_cmd"]), "cls": "b", "name": "command"},
                                  {"y": np.array(s["gripper_pos"]), "cls": "a", "name": "position"}]})
    bands = []
    top = max(ex["incidents"], key=lambda i: i["rung"]) if ex["incidents"] else None
    if top:
        if top.get("anchor"):
            a = top["anchor"]
            bands.append({"t0": a["t_start"], "t1": a["t_end"], "cls": "anchor", "label": "what a person would see"})
        if top.get("cause") and top["cause"] is not top.get("anchor"):
            c = top["cause"]
            if not top.get("anchor") or c["t_start"] != top["anchor"]["t_start"]:
                bands.append({"t0": c["t_start"], "t1": max(c["t_end"], c["t_start"] + 0.15), "cls": "cause",
                              "label": "what started it"})
    for e in ex["events"]:
        if e["check"] == "sensing.stale_camera" and not any(abs(b["t0"] - e["t_start"]) < 1e-6 for b in bands):
            bands.append({"t0": e["t_start"], "t1": e["t_end"] + 0.05, "cls": "context", "label": ""})
    return svg.timeline(t, panels, bands, title=ex["why"])


# ---------------------------------------------------------------- page

def build(results: Path, out: Path) -> None:
    joints = load(results / "fleet_joints.jsonl")
    video = load(results / "fleet_video.jsonl")
    inj = json.loads((results / "inject_eval.json").read_text()) if (results / "inject_eval.json").exists() else None
    bench = json.loads((results / "bench_eval.json").read_text()) if (results / "bench_eval.json").exists() else None
    examples = json.loads((results / "examples.json").read_text()) if (results / "examples.json").exists() else []

    F = findings(joints, video)
    rows = ledger_rows(video, "video") + ledger_rows(joints, "joints")
    top = rank_fingerprints(ledger_rows(joints, "joints"), top=10)
    top_video = rank_fingerprints(ledger_rows(video, "video"), top=8)
    lags = robot_lags(video)
    data = {"findings": F, "top_fingerprints_fleet": top, "top_fingerprints_video": top_video,
            "injection": inj["summary"] if inj else None, "calibration": inj["calibration"] if inj else None,
            "bench": bench, "camera_lags": lags, "dataset": {"repo": COMMUNITY[0], "revision": COMMUNITY[1]}}
    out.mkdir(parents=True, exist_ok=True)
    (out / "data.json").write_text(json.dumps(data, indent=1, default=_json))
    _write_ledger(results, rows)
    (out / "index.html").write_text(page(F, top, top_video, inj, bench, examples, lags))
    print(f"wrote {out / 'index.html'} ({(out / 'index.html').stat().st_size // 1024} KB)")
    readme = Path("README.md")
    if readme.exists():
        from .page import readme_finding, readme_validation
        text = readme.read_text()
        text = _splice(text, "FINDING", readme_finding(F, top))
        text = _splice(text, "VALIDATION", readme_validation(inj, bench))
        readme.write_text(text)


def _splice(text: str, name: str, body: str) -> str:
    a, b = f"<!-- {name}:start -->", f"<!-- {name}:end -->"
    i, j = text.index(a) + len(a), text.index(b)
    return text[:i] + "\n" + body.strip() + "\n" + text[j:]


def _write_ledger(results: Path, rows: list[dict]) -> None:
    import pandas as pd
    if rows:
        pd.DataFrame(rows).to_csv(results / "ledger.csv.gz", index=False, compression="gzip")


def page(F, top, top_video, inj, bench, examples, lags) -> str:
    from .page import render
    return render(F=F, top=top, top_video=top_video, inj=inj, bench=bench, examples=examples, lags=lags,
                  example_svg=_example_svg, plain=plain, rung_names=RUNG_NAMES, repo=REPO, svg=svg,
                  escape=escape)
