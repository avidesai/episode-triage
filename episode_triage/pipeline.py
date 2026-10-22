"""Run every check on one episode, then the ladder.

The order matters: joint checks first (cheap, always available), then video if asked,
then cause ordering and the ladder over everything at once.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from .checks import (Event, RobotProfile, build_profile, chain_motion, check_camera_lag,
                     check_stale_camera, check_video_integrity, episode_signals, image_energy,
                     run_parquet_checks)
from .ladder import Coverage, Incident, episode_rung, triage
from .readers import Episode, RobotData
from .video import VideoError


@dataclass
class EpisodeResult:
    robot_id: str
    episode: int
    fps: float
    n_frames: int
    events: list[Event]
    incidents: list[Incident]
    coverage: Coverage
    facts: dict = field(default_factory=dict)
    traces: dict = field(default_factory=dict)   # per camera image change and motion, for plots

    @property
    def rung(self) -> int:
        return episode_rung(self.incidents)

    def to_dict(self) -> dict:
        return {
            "robot_id": self.robot_id, "episode": self.episode, "fps": self.fps,
            "n_frames": self.n_frames, "rung": self.rung, "facts": self.facts,
            "cameras_checked": self.coverage.cameras_checked,
            "cameras_missing": self.coverage.cameras_missing,
            "events": [e.to_dict() for e in self.events],
            "incidents": [i.to_dict() for i in self.incidents],
        }


def profile_for(robot: RobotData) -> RobotProfile:
    state = np.stack(robot.data["observation.state"].to_numpy())
    return build_profile(robot.all_actions(), state, robot.gripper_idx)


def triage_episode(ep: Episode, prof: RobotProfile, video: bool = True,
                   keep_traces: bool = False, frames_override: dict | None = None) -> EpisodeResult:
    sig = episode_signals(ep.action, ep.state, ep.fps, ep.joint_names, ep.gripper_idx, prof)
    events = run_parquet_checks(sig, prof, ep.action, ep.state, ep.frame_index)
    cov = Coverage()
    ts_err = float(np.max(np.abs(ep.timestamp - ep.frame_index / ep.fps))) if ep.n else float("nan")
    facts = {"timestamp_max_dev_s": ts_err, "timestamps_synthetic": bool(ts_err < 1e-4),
             "duration_s": round(ep.duration_s, 2)}
    traces = {}

    if video and ep.cameras:
        energies, motions = {}, {}
        for key, cam in ep.cameras.items():
            err = None
            try:
                frames = frames_override[key] if frames_override and key in frames_override else ep.frames(key)
            except VideoError as e:
                frames, err = None, str(e)
            n_frames = 0 if frames is None else len(frames)
            bad = check_video_integrity(key, n_frames, ep.n, ep.fps, err)
            events += bad
            if bad:
                cov.cameras_missing.append(key)
                continue
            energies[key] = image_energy(frames)
            motions[key] = chain_motion(sig, cam.chain)
            cov.cameras_checked.append(key)
        lags = {}
        for key in energies:
            lag, ev, lag_events = check_camera_lag(key, energies[key], motions[key], ep.fps)
            lags[key] = lag
            facts[f"lag.{key}"] = ev
            events += lag_events
        for key, e in energies.items():
            others = [o for k, o in energies.items() if k != key]
            events += check_stale_camera(key, e, motions[key], ep.fps, others, lag=lags.get(key) or 0)
            if keep_traces:
                traces[key] = {"change": e, "motion": motions[key]}
    else:
        cov.cameras_missing = list(ep.cameras) if ep.cameras else ["no cameras"]

    if keep_traces:
        traces["_signals"] = sig
    incidents = triage(events, cov)
    return EpisodeResult(ep.robot_id, ep.episode_index, ep.fps, ep.n, events, incidents, cov, facts, traces)
