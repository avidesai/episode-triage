"""Run triage across a fleet: every episode's joint checks, and video checks on a sample.

Each dataset in the LeRobot community collection is treated as one robot: one arm,
built and calibrated by one person, in one room. Some people recorded several datasets
on the same arm, so robot counts here are an upper bound on physical arms.
"""

from __future__ import annotations

import json
import random
import traceback
from collections import defaultdict
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import numpy as np

from .pipeline import profile_for, triage_episode
from .readers import RobotData, open_robot
from .signals import image_energy
from .video import VideoError, decode_many

COMMUNITY = ("lerobot/community_dataset_v3", "ab92ac3fa4d0c08336e21b8e51cb9dc279535539")
SO_TYPES = {"so100", "so101", "so100_follower", "so101_follower"}
SO_JOINTS = ["shoulder_pan", "shoulder_lift", "elbow_flex", "wrist_flex", "wrist_roll", "gripper"]


def so_arm_dirs(root: str | Path) -> list[Path]:
    """Single SO 100 or SO 101 arms with the standard six joints, leader/follower style."""
    out = []
    for info_f in sorted(Path(root).glob("*/*/meta/info.json")):
        info = json.loads(info_f.read_text())
        if info.get("robot_type") not in SO_TYPES:
            continue
        names = info["features"].get("action", {}).get("names")
        if isinstance(names, dict):
            names = next(iter(names.values()), None)
        if not isinstance(names, list):
            continue
        clean = [str(n).replace("main_", "").replace(".pos", "") for n in names]
        if clean != SO_JOINTS:
            continue
        d = info_f.parents[1]
        if any((d / "data").glob("chunk-*/file-*.parquet")) and any((d / "meta" / "episodes").glob("*/*.parquet")):
            out.append(d)
    return out


def robot_id(d: Path) -> str:
    return f"{d.parent.name}/{d.name}"


def _summary(r) -> dict:
    d = r.to_dict()
    d["rules"] = [i["rule"] for i in d["incidents"]]
    return d


def run_joint_checks(d: Path) -> dict:
    """Every episode of one robot, joint and task checks only."""
    try:
        robot = open_robot(d, robot_id=robot_id(d))
        prof = profile_for(robot)
        eps = []
        for i in robot.episode_indices:
            r = triage_episode(robot.episode(i), prof, video=False)
            eps.append(_summary(r))
        return {"robot_id": robot.robot_id, "robot_type": robot.robot_type, "fps": robot.fps,
                "codec": robot.video_codec, "lag": prof.lag.tolist(), "episodes": eps}
    except Exception as e:   # one bad dataset must not stop a fleet run
        return {"robot_id": robot_id(d), "error": f"{type(e).__name__}: {e}"}


def fleet_joint_run(root: str | Path, out: Path, workers: int = 8) -> list[dict]:
    dirs = so_arm_dirs(root)
    out.parent.mkdir(parents=True, exist_ok=True)
    results = []
    with ProcessPoolExecutor(workers) as ex, out.open("w") as f:
        for res in ex.map(run_joint_checks, dirs, chunksize=4):
            results.append(res)
            f.write(json.dumps(res, default=_json) + "\n")
    return results


def pick_video_sample(dirs: list[Path], n_robots: int, eps_per_robot: int, seed: int) -> list[tuple[Path, list[int]]]:
    rng = random.Random(seed)
    chosen = rng.sample(dirs, min(n_robots, len(dirs)))
    picks = []
    for d in chosen:
        robot = open_robot(d, robot_id=robot_id(d))
        eps = robot.episode_indices
        picks.append((d, sorted(rng.sample(eps, min(eps_per_robot, len(eps))))))
    return picks


def load_video_frames(robot: RobotData, episodes: list[int]) -> dict[int, dict[str, np.ndarray | str]]:
    """Frames for several episodes, grouped so each MP4 file is opened once."""
    frames: dict[int, dict] = defaultdict(dict)
    eps = {i: robot.episode(i) for i in episodes}
    groups = defaultdict(list)
    for i, ep in eps.items():
        for key, cam in ep.cameras.items():
            groups[(key, cam.path)].append((cam.from_ts, cam.to_ts, i))
    for (key, path), spans in groups.items():
        spans.sort()
        try:
            got = decode_many(path, [(a, b) for a, b, _ in spans], robot.fps)
            for (_, _, i), f in zip(spans, got):
                frames[i][key] = f
        except VideoError as e:
            for _, _, i in spans:
                frames[i][key] = f"decode error: {e}"
    return frames


def fetch_energies(d: Path, episodes: list[int], cache_dir: Path) -> dict:
    """Decode the sampled episodes' video once and keep only each camera's image change
    trace. That trace is all the video checks need, and it is small enough to commit."""
    f = cache_dir / (robot_id(d).replace("/", "__") + ".npz")
    if f.exists():
        return _read_energies(f)
    robot = open_robot(d, robot_id=robot_id(d), remote=COMMUNITY)
    frames = load_video_frames(robot, episodes)
    store = {}
    for i, cams in frames.items():
        for key, v in cams.items():
            if isinstance(v, np.ndarray):
                store[f"{i}|{key}|E"] = image_energy(v).astype(np.float32)
                store[f"{i}|{key}|n"] = np.array([len(v)])
            else:
                store[f"{i}|{key}|err"] = np.array([v])
    cache_dir.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(f, **store)
    return _read_energies(f)


def _read_energies(f: Path) -> dict:
    out: dict[int, dict] = defaultdict(dict)
    with np.load(f, allow_pickle=False) as z:
        for k in z.files:
            i, key, kind = k.split("|")
            if kind == "E":
                out[int(i)][key] = (z[k].astype(np.float64), int(z[f"{i}|{key}|n"][0]))
            elif kind == "err":
                out[int(i)][key] = str(z[k][0])
    return out


def run_video_sample(d: Path, episodes: list[int], cache_dir: Path) -> dict:
    try:
        energies = fetch_energies(d, episodes, cache_dir)
        return score_video_sample(d, episodes, energies)
    except Exception as e:
        return {"robot_id": robot_id(d), "error": f"{type(e).__name__}: {e}",
                "trace": traceback.format_exc(limit=3)}


def score_video_sample(d: Path, episodes: list[int], energies: dict) -> dict:
    robot = open_robot(d, robot_id=robot_id(d))
    prof = profile_for(robot)
    eps = []
    for i in episodes:
        ep = robot.episode(i)
        r = triage_episode(ep, prof, video=True, energy_override=energies.get(i, {}))
        eps.append(_summary(r))
    return {"robot_id": robot.robot_id, "robot_type": robot.robot_type, "fps": robot.fps,
            "codec": robot.video_codec, "lag": prof.lag.tolist(), "episodes": eps}


def _json(o):
    if isinstance(o, (np.integer,)):
        return int(o)
    if isinstance(o, (np.floating,)):
        return float(o)
    if isinstance(o, np.ndarray):
        return o.tolist()
    if isinstance(o, (np.bool_,)):
        return bool(o)
    raise TypeError(type(o))
