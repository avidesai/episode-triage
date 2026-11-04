"""Template reader: the one file a new log format needs.

Everything downstream (checks, cause ordering, the ladder, the inbox, the live monitor)
reads `Episode` objects and nothing else. To run the tool on your own logs, fill in the
two functions below and point `open_robot_from(...)` at a log directory. The LeRobot
reader in readers.py is the worked example.

What an Episode needs:
  action      (T, J) float   the command sent to each joint at each tick
  state       (T, J) float   the measured position of each joint at each tick
  fps         float          the control rate the two were sampled at
  joint_names list[str]      one per column; gripper columns are found by name ("gripper", "claw")
  cameras     per camera: whether it is wrist mounted or fixed, and a way to get its frames
              as (T, 60, 80) uint8 grayscale, one per tick, time aligned with the joint rows

If your logs carry real capture timestamps per frame, keep them: put the frame age per
tick in a sidecar DataFrame (see recorder/record_labeled.py for the columns) and the
frozen camera check becomes a lookup instead of an inference.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd

from .readers import Camera, Episode, RobotData, camera_chain


def load_joint_table(log_dir: Path) -> pd.DataFrame:
    """Return one row per control tick with columns: action (array J), observation.state
    (array J), timestamp, frame_index, episode_index, index. Replace this body."""
    raise NotImplementedError("read your joint log here")


def load_frames(log_dir: Path, camera: str, run: int, fps: float) -> np.ndarray:
    """Return (T, 60, 80) uint8 grayscale frames for one camera and one run, one frame per
    joint row. Downsample with area averaging. Replace this body."""
    raise NotImplementedError("decode your camera stream here")


def open_robot_from(log_dir: str | Path, robot_id: str, fps: float, joint_names: list[str],
                    cameras: dict[str, str]) -> RobotData:
    """cameras maps a camera key to "wrist" or "fixed"."""
    log_dir = Path(log_dir)
    data = load_joint_table(log_dir)
    runs = sorted(int(i) for i in data["episode_index"].unique())
    meta = pd.DataFrame([{"episode_index": r,
                          "dataset_from_index": int(data.index[data["episode_index"] == r].min()),
                          "dataset_to_index": int(data.index[data["episode_index"] == r].max()) + 1,
                          "length": int((data["episode_index"] == r).sum())} for r in runs])
    info = {"codebase_version": "v3.0", "fps": fps, "robot_type": robot_id,
            "features": {"action": {"dtype": "float32", "shape": [len(joint_names)], "names": joint_names},
                         "observation.state": {"dtype": "float32", "shape": [len(joint_names)],
                                               "names": joint_names},
                         **{k: {"dtype": "video", "shape": [480, 640, 3],
                                "info": {"curation": {"mount_type": "robot_mounted" if m == "wrist" else "fixed"}}}
                            for k, m in cameras.items()}},
            "video_path": "{video_key}/{chunk_index}/{file_index}"}
    gripper_idx = [i for i, n in enumerate(joint_names) if "grip" in n.lower() or "claw" in n.lower()]
    robot = RobotData(robot_id=robot_id, root=log_dir, info=info, episodes_meta=meta, data=data,
                      joint_names=joint_names, gripper_idx=gripper_idx)

    def episode(run: int) -> Episode:
        ep = RobotData.episode(robot, run)
        for key, cam in ep.cameras.items():
            cam.chain = camera_chain(cam, joint_names, gripper_idx)
            frames = load_frames(log_dir, key, run, fps)
            ep.frames = lambda k, _f={**getattr(ep, "_f", {}), key: frames}: _f[k]   # noqa: E731
        return ep

    robot.episode = episode   # type: ignore[method-assign]
    return robot
