"""Read LeRobot v3.0 datasets into Episode objects.

Everything downstream of this file reads `Episode` and `RobotData` only, so a new log
format (MCAP, a fleet's own logs) needs a new reader and nothing else.

No torch and no `lerobot` import. pyarrow and pandas for the tables, PyAV for video.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import pandas as pd

from .video import decode_gray

SUPPORTED_VERSIONS = {"v3.0"}
HF_RESOLVE = "https://huggingface.co/datasets/{repo}/resolve/{rev}/{path}"
GRIPPER_PAT = re.compile(r"grip|claw|hand$", re.I)
WRIST_PAT = re.compile(r"wrist|hand|gripper", re.I)


@dataclass
class Camera:
    key: str                 # e.g. "observation.images.wrist"
    mount: str               # "wrist" (moves with the arm) or "fixed"
    chain: list[int]         # joint columns that move this camera's view
    path: str | None         # local file or URL of the MP4 holding this episode
    from_ts: float
    to_ts: float


@dataclass
class Episode:
    robot_id: str
    episode_index: int
    fps: float
    software_version: str
    joint_names: list[str]
    action: np.ndarray        # (T, J) commanded. In leader/follower data this is the leader arm.
    state: np.ndarray         # (T, J) measured follower arm
    timestamp: np.ndarray     # (T,) as written in the dataset
    frame_index: np.ndarray   # (T,)
    gripper_idx: list[int]
    cameras: dict[str, Camera] = field(default_factory=dict)
    video_codec: str | None = None
    sidecar: pd.DataFrame | None = None   # ground truth from the flight recorder, own arm only

    @property
    def n(self) -> int:
        return len(self.action)

    @property
    def duration_s(self) -> float:
        return self.n / self.fps

    def frames(self, cam: str) -> np.ndarray:
        """(T, 60, 80) uint8 grayscale frames for one camera, decoded on demand."""
        c = self.cameras[cam]
        return decode_gray(c.path, c.from_ts, c.to_ts, self.fps)


@dataclass
class RobotData:
    """One dataset, treated as one robot. Holds every episode's arrays so per robot
    statistics (joint ranges, follower lag) come from all of its data, never one episode."""

    robot_id: str
    root: Path
    info: dict
    episodes_meta: pd.DataFrame
    data: pd.DataFrame
    joint_names: list[str]
    gripper_idx: list[int]
    remote: tuple[str, str] | None = None   # (repo_id, revision) for streaming video

    @property
    def fps(self) -> float:
        return float(self.info["fps"])

    @property
    def version(self) -> str:
        return self.info.get("codebase_version", "?")

    @property
    def robot_type(self) -> str:
        return str(self.info.get("robot_type"))

    @property
    def camera_keys(self) -> list[str]:
        return [k for k, v in self.info["features"].items() if v.get("dtype") == "video"]

    @property
    def video_codec(self) -> str | None:
        for k in self.camera_keys:
            codec = (self.info["features"][k].get("info") or {}).get("video.codec")
            if codec:
                return codec
        return None

    @property
    def episode_indices(self) -> list[int]:
        return [int(i) for i in self.episodes_meta["episode_index"]]

    def all_actions(self) -> np.ndarray:
        return np.stack(self.data["action"].to_numpy())

    def episode(self, ep: int) -> Episode:
        row = self.episodes_meta.loc[self.episodes_meta["episode_index"] == ep].iloc[0]
        lo, hi = int(row["dataset_from_index"]), int(row["dataset_to_index"])
        d = self.data[(self.data["index"] >= lo) & (self.data["index"] < hi)]
        if len(d) == 0:
            # Some converted datasets keep a per file index; fall back to episode_index.
            d = self.data[self.data["episode_index"] == ep]
        d = d.sort_values("frame_index")
        cams = {}
        for key in self.camera_keys:
            cams[key] = Camera(
                key=key,
                mount=camera_mount(key, self.info["features"][key]),
                chain=[],
                path=self._video_path(key, row),
                from_ts=float(row.get(f"videos/{key}/from_timestamp", 0.0)),
                to_ts=float(row.get(f"videos/{key}/to_timestamp", 0.0)),
            )
        for c in cams.values():
            c.chain = camera_chain(c, self.joint_names, self.gripper_idx)
        return Episode(
            robot_id=self.robot_id,
            episode_index=ep,
            fps=self.fps,
            software_version=self.version,
            joint_names=self.joint_names,
            action=np.stack(d["action"].to_numpy()).astype(np.float64),
            state=np.stack(d["observation.state"].to_numpy()).astype(np.float64),
            timestamp=d["timestamp"].to_numpy(dtype=np.float64),
            frame_index=d["frame_index"].to_numpy(),
            gripper_idx=self.gripper_idx,
            cameras=cams,
            video_codec=self.video_codec,
            sidecar=load_sidecar(self.root, ep),
        )

    def _video_path(self, key: str, row) -> str | None:
        chunk = row.get(f"videos/{key}/chunk_index")
        file = row.get(f"videos/{key}/file_index")
        if chunk is None or file is None or pd.isna(chunk):
            return None
        rel = self.info["video_path"].format(video_key=key, chunk_index=int(chunk), file_index=int(file))
        local = self.root / rel
        if local.exists():
            return str(local)
        if self.remote:
            repo, rev = self.remote
            prefix = f"{self.robot_id}/" if repo.endswith("community_dataset_v3") else ""
            return HF_RESOLVE.format(repo=repo, rev=rev, path=prefix + rel)
        return None


def open_robot(root: str | Path, robot_id: str | None = None,
               remote: tuple[str, str] | None = None) -> RobotData:
    """Open one LeRobot v3.0 dataset directory. Fails loudly on any other format version."""
    root = Path(root)
    info = json.loads((root / "meta" / "info.json").read_text())
    version = info.get("codebase_version")
    if version not in SUPPORTED_VERSIONS:
        raise ValueError(f"{root}: codebase_version {version!r} is not supported (need one of {SUPPORTED_VERSIONS})")
    for key in ("action", "observation.state"):
        if key not in info["features"]:
            raise ValueError(f"{root}: no {key!r} feature, nothing to triage")

    ep_files = sorted((root / "meta" / "episodes").glob("chunk-*/file-*.parquet"))
    if not ep_files:
        raise FileNotFoundError(f"{root}: no meta/episodes parquet files")
    meta_cols = None
    frames = []
    for f in ep_files:
        t = pd.read_parquet(f)
        keep = [c for c in t.columns if not c.startswith("stats/")]
        frames.append(t[keep])
        meta_cols = keep
    episodes_meta = pd.concat(frames, ignore_index=True)

    data_files = sorted((root / "data").glob("chunk-*/file-*.parquet"))
    if not data_files:
        raise FileNotFoundError(f"{root}: no data parquet files")
    cols = ["action", "observation.state", "timestamp", "frame_index", "episode_index", "index"]
    data = pd.concat([pd.read_parquet(f, columns=cols) for f in data_files], ignore_index=True)

    names = joint_names(info)
    return RobotData(
        robot_id=robot_id or root.name,
        root=root,
        info=info,
        episodes_meta=episodes_meta,
        data=data,
        joint_names=names,
        gripper_idx=[i for i, n in enumerate(names) if GRIPPER_PAT.search(n)],
        remote=remote,
    )


def joint_names(info: dict) -> list[str]:
    feat = info["features"]["action"]
    n = int(feat["shape"][0])
    names = feat.get("names")
    if isinstance(names, dict):
        names = next(iter(names.values()), None)
    if not isinstance(names, list) or len(names) != n:
        names = [f"joint_{i}" for i in range(n)]
    # SO arms record "main_shoulder_pan" or "shoulder_pan.pos"; keep the joint itself.
    return [re.sub(r"^main_|\.pos$", "", str(x)) for x in names]


def camera_mount(key: str, feature: dict) -> str:
    """Prefer the dataset's own curation label; fall back to the camera's name."""
    cur = ((feature.get("info") or {}).get("curation") or {}).get("mount_type")
    if cur == "robot_mounted":
        return "wrist"
    if cur == "fixed":
        return "fixed"
    return "wrist" if WRIST_PAT.search(key.split(".")[-1]) else "fixed"


def camera_chain(cam: Camera, names: list[str], gripper_idx: list[int]) -> list[int]:
    """Joints whose motion should change what this camera sees.

    A wrist camera is moved by every arm joint on its own arm. A fixed camera sees the
    arm, so every arm joint counts. Grippers are left out of both: a gripper opening
    barely changes a wrist view and is small in a scene view.
    """
    arm = [i for i in range(len(names)) if i not in gripper_idx]
    short = cam.key.split(".")[-1].lower()
    for side in ("left", "right"):
        if side in short:
            same_side = [i for i in arm if side in names[i].lower()]
            if same_side:
                return same_side
    return arm


def load_sidecar(root: Path, ep: int) -> pd.DataFrame | None:
    f = root / "sidecar" / f"episode_{ep:06d}.jsonl"
    if not f.exists():
        return None
    return pd.read_json(f, lines=True)
