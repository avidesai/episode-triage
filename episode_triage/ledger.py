"""Fleet ledger: every incident as a row, fingerprints ranked by how much of the fleet they hit.

A fingerprint is layer level check plus the part it names, with camera names folded into
"wrist camera" or "fixed camera" so the same fault on differently named cameras counts
once. Priority is robots affected times episodes affected times a rung weight, so a fault
on many robots outranks a fault repeated many times on one.
"""

from __future__ import annotations

import gzip
import json
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np

RUNG_WEIGHT = {0: 0.0, 1: 0.5, 2: 3.0, 3: 2.0, 4: 2.0}
RECUR_ROBOTS = 2
RECUR_ON_ONE = 3
LAG_FLAG = 3


def load(path: Path) -> list[dict]:
    """JSON lines, plain or gzipped (results are committed gzipped to keep the repo small)."""
    gz = path.with_name(path.name + ".gz")
    if path.exists():
        text = path.read_text()
    elif gz.exists():
        text = gzip.decompress(gz.read_bytes()).decode()
    else:
        return []
    return [json.loads(l) for l in text.splitlines() if l.strip()]


def fold_component(comp: str, mounts: dict[str, str] | None = None) -> str:
    if comp.startswith("observation.images."):
        name = comp.split(".")[-1].lower()
        return "wrist camera" if any(k in name for k in ("wrist", "hand", "gripper")) else "fixed camera"
    return comp


def fingerprint(inc: dict) -> str:
    ev = inc.get("cause") or inc.get("anchor") or {}
    if not ev:
        return "unknown"
    return f"{ev['check']}.{fold_component(ev['component'])}"


def ledger_rows(robots: list[dict], source: str) -> list[dict]:
    rows = []
    for r in robots:
        for e in r.get("episodes", []):
            for inc in e["incidents"]:
                rows.append({"robot_id": r["robot_id"], "episode": e["episode"], "source": source,
                             "rung": inc["rung"], "rule": inc["rule"], "fingerprint": fingerprint(inc),
                             "layer": inc["layer"], "onset": inc["onset"], "route": inc["route"]})
    return rows


def rank_fingerprints(rows: list[dict], top: int | None = None) -> list[dict]:
    by = defaultdict(list)
    for r in rows:
        if r["rung"] == 0 or r["fingerprint"] == "unknown":
            continue
        by[r["fingerprint"]].append(r)
    out = []
    for fp, rs in by.items():
        robots = Counter(r["robot_id"] for r in rs)
        episodes = {(r["robot_id"], r["episode"]) for r in rs}
        rung = Counter(r["rung"] for r in rs).most_common(1)[0][0]
        recurring = len(robots) >= RECUR_ROBOTS or max(robots.values()) >= RECUR_ON_ONE
        out.append({"fingerprint": fp, "robots": len(robots), "episodes": len(episodes), "count": len(rs),
                    "rung": rung, "recurring": recurring,
                    "priority": len(robots) * len(episodes) * RUNG_WEIGHT[rung],
                    "example": rs[0]["route"]})
    out.sort(key=lambda x: -x["priority"])
    return out[:top] if top else out


def robot_lags(video: list[dict]) -> list[dict]:
    """Median camera lag per robot and camera over that robot's sampled episodes."""
    out = []
    for r in video:
        per_cam = defaultdict(list)
        for e in r.get("episodes", []):
            for k, v in e["facts"].items():
                if k.startswith("lag.") and v.get("lag_frames") is not None:
                    per_cam[k[4:]].append(v["lag_frames"])
        for cam, lags in per_cam.items():
            out.append({"robot_id": r["robot_id"], "camera": cam, "mount": fold_component(cam),
                        "fps": r["fps"], "n": len(lags), "median_lag": float(np.median(lags)),
                        "lags": lags})
    return out


def findings(joints: list[dict], video: list[dict]) -> dict:
    """Every number the page and README quote, computed in one place."""
    j_ok = [r for r in joints if "episodes" in r]
    v_ok = [r for r in video if "episodes" in r]
    j_eps = [e for r in j_ok for e in r["episodes"]]
    v_eps = [(r, e) for r in v_ok for e in r["episodes"]]
    full = [(r, e) for r, e in v_eps if e["cameras_checked"] and not e["cameras_missing"]]

    def has(e, check, conf=("high", "medium")):
        return any(v["check"] == check and v["confidence"] in conf for v in e["events"])

    stale_eps = [(r, e) for r, e in full if has(e, "sensing.stale_camera")]
    stale_runs = [v for _, e in full for v in e["events"]
                  if v["check"] == "sensing.stale_camera" and v["confidence"] in ("high", "medium")]
    anchors = Counter()
    for _, e in full:
        for inc in e["incidents"]:
            a = inc.get("anchor")
            if not a or a["check"] not in ("task.stall", "task.missed_grasp_sequence"):
                continue
            c = inc.get("cause")
            if c and c["layer"] in ("sensing", "actuation"):
                anchors["began with sensing or actuation"] += 1
            elif inc["rule"] == "R4":
                anchors["training, inputs healthy"] += 1
            else:
                anchors["a person: " + inc["rule"]] += 1

    lags = robot_lags(v_ok)
    by_robot = defaultdict(list)
    for l in lags:
        by_robot[l["robot_id"]].append(l)
    lagged = [l for l in lags if l["median_lag"] >= LAG_FLAG and l["n"] >= 2]

    def robots_with(check):
        return sorted({r["robot_id"] for r in j_ok for e in r["episodes"]
                       if any(v["check"] == check for v in e["events"])})

    rung_j = Counter(e["rung"] for e in j_eps)
    rung_full = Counter(e["rung"] for _, e in full)
    inc_full = Counter(i["rung"] for _, e in full for i in e["incidents"])
    return {
        "joints": {
            "robots": len(j_ok), "robots_failed": len(joints) - len(j_ok), "episodes": len(j_eps),
            "hours": round(sum(e["n_frames"] / e["fps"] for e in j_eps) / 3600, 1),
            "timestamps_synthetic": sum(e["facts"]["timestamps_synthetic"] for e in j_eps),
            "episode_rungs": dict(sorted(rung_j.items())),
            "robots_gain_mismatch": len(robots_with("actuation.gain_mismatch")),
            "robots_not_tracking": len(robots_with("actuation.not_tracking")),
            "robots_rest_offset": len(robots_with("actuation.rest_offset")),
            "robots_bus_glitch": len(robots_with("actuation.bus_glitch")),
            "robots_not_following": len(robots_with("actuation.not_following")),
            "robots_stale_state": len(robots_with("sensing.stale_state")),
            "robots_any_actuation_ticket": len({r["robot_id"] for r in j_ok for e in r["episodes"]
                                                for i in e["incidents"]
                                                if i["rung"] == 2 and i["layer"] == "actuation"}),
            "episodes_missed_grasp_sequence": sum(has(e, "task.missed_grasp_sequence", ("medium", "high", "low")) for e in j_eps),
            "episodes_stall": sum(has(e, "task.stall", ("medium", "high", "low")) for e in j_eps),
        },
        "video": {
            "robots": len(v_ok), "robots_failed": len(video) - len(v_ok), "episodes": len(v_eps),
            "episodes_all_cameras": len(full),
            "episodes_stale_camera": len(stale_eps),
            "robots_stale_camera": len({r["robot_id"] for r, _ in stale_eps}),
            "stale_runs": len(stale_runs),
            "stale_frames": int(sum(v["evidence"]["frames"] for v in stale_runs)),
            "stale_run_frames_median": float(np.median([v["evidence"]["frames"] for v in stale_runs])) if stale_runs else None,
            "stale_episodes_timestamps_synthetic": sum(e["facts"]["timestamps_synthetic"] for _, e in stale_eps),
            "stale_by_mount": dict(Counter(fold_component(v["component"]) for v in stale_runs)),
            "anchors": dict(anchors),
            "episode_rungs": dict(sorted(rung_full.items())),
            "incident_rungs": dict(sorted(inc_full.items())),
            "robots_with_lag": len(by_robot),
            "lag_medians": dict(Counter(l["median_lag"] for l in lags if l["n"] >= 2)),
            "camera_streams_lag_ge_3": len(lagged),
            "robots_lag_ge_3": len({l["robot_id"] for l in lagged}),
            "lag_spread_frames": (max(l["median_lag"] for l in lags if l["n"] >= 2) -
                                  min(l["median_lag"] for l in lags if l["n"] >= 2)) if lags else None,
        },
    }
