"""Plumbing test for the reader and bench scorer on a tiny dataset built on disk.

The trajectory is hand built; this checks that a fault logged in the sidecar is matched
to the right event, not anything about real robots.
"""

import json

import numpy as np
import pandas as pd

from episode_triage.readers import open_robot
from episode_triage.validate import bench_eval
from test_checks import FPS, NAMES, trajectory


def write_dataset(root, episodes):
    (root / "meta" / "episodes" / "chunk-000").mkdir(parents=True)
    (root / "data" / "chunk-000").mkdir(parents=True)
    info = {"codebase_version": "v3.0", "fps": int(FPS), "robot_type": "so101_follower",
            "features": {"action": {"dtype": "float32", "shape": [6], "names": [f"{n}.pos" for n in NAMES]},
                         "observation.state": {"dtype": "float32", "shape": [6],
                                               "names": [f"{n}.pos" for n in NAMES]}},
            "data_path": "data/chunk-{chunk_index:03d}/file-{file_index:03d}.parquet"}
    (root / "meta" / "info.json").write_text(json.dumps(info))
    rows, meta, idx = [], [], 0
    for i, (a, s) in enumerate(episodes):
        n = len(a)
        meta.append({"episode_index": i, "dataset_from_index": idx, "dataset_to_index": idx + n, "length": n})
        for t in range(n):
            rows.append({"action": a[t].astype(np.float32), "observation.state": s[t].astype(np.float32),
                         "timestamp": np.float32(t / FPS), "frame_index": t, "episode_index": i, "index": idx + t})
        idx += n
    pd.DataFrame(rows).to_parquet(root / "data" / "chunk-000" / "file-000.parquet")
    pd.DataFrame(meta).to_parquet(root / "meta" / "episodes" / "chunk-000" / "file-000.parquet")


def test_reader_and_bench_eval(tmp_path):
    a0, s0 = trajectory(seed=0)
    a1, s1 = trajectory(seed=1)
    # episode 1: wrist_flex torque cut from 8.0 to 10.0 s, the joint sags under gravity
    lo, hi = int(8.0 * FPS), int(10.0 * FPS)
    s1 = s1.copy()
    s1[lo:hi, 3] = s1[lo, 3] - np.linspace(0, 25, hi - lo)
    write_dataset(tmp_path, [(a0, s0), (a1, s1)])
    side = tmp_path / "sidecar"
    side.mkdir()
    for ep, (fault, target) in enumerate([("none", ""), ("torque_off", "wrist_flex")]):
        lines = [json.dumps({"tick": t, "fault": fault, "fault_target": target,
                             "fault_active": fault != "none" and lo <= t < hi}) for t in range(len(a0))]
        (side / f"episode_{ep:06d}.jsonl").write_text("\n".join(lines))

    robot = open_robot(tmp_path)
    assert robot.joint_names == NAMES and robot.gripper_idx == [5]
    assert robot.episode(1).sidecar is not None

    out = tmp_path / "bench.json"
    bench_eval(tmp_path, out)
    rows = json.loads(out.read_text())["rows"]
    assert len(rows) == 1
    r = rows[0]
    assert r["fault"] == "torque_off" and r["caught"] and r["rung"] == 2
    assert abs(r["onset_err_s"]) < 0.5
