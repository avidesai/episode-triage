"""Stream a recorded run back through the online monitor, tick by tick.

Used to rehearse the live demo without the arm and to check that the online monitor
finds what the batch run found on the same data.
"""

from __future__ import annotations

import time
from pathlib import Path

import numpy as np

from .checks import RobotProfile
from .fleet import COMMUNITY
from .monitor import LiveSite, Monitor, Tick
from .pipeline import profile_for
from .readers import open_robot


def replay(dataset: Path, site: Path, episodes: list[int] | None = None, speed: float = 1.0,
           profile: Path | None = None, remote: bool = False, fleet_name: str = "replay") -> list:
    robot = open_robot(dataset, robot_id=dataset.name if not remote else f"{dataset.parent.name}/{dataset.name}",
                       remote=COMMUNITY if remote else None)
    prof = RobotProfile.from_dict(__import__("json").loads(profile.read_text())) if profile else profile_for(robot)
    eps = episodes or robot.episode_indices
    site_w = LiveSite(site, robot.robot_id, fleet_name)
    found = []

    def on_inc(live):
        found.append(live)
        site_w.add(live)
        inc = live.incident
        print(f"  [{live.t_abs:7.1f} s] rung {inc['rung']} {inc['rung_name']}: {inc['route']}", flush=True)

    first = robot.episode(eps[0])
    cams = {k: c.chain for k, c in first.cameras.items()}
    mon = Monitor(robot.robot_id, prof, robot.fps, robot.joint_names, robot.gripper_idx, cams,
                  on_incident=on_inc)
    period = 1.0 / robot.fps / max(speed, 1e-6)
    for i in eps:
        ep = robot.episode(i)
        frames = {k: ep.frames(k) for k in ep.cameras} if ep.cameras else {}
        truth = _truth_rows(ep)
        print(f"run {i}: {ep.n} ticks", flush=True)
        for t in range(ep.n):
            gray = {k: (f[t] if t < len(f) else None) for k, f in frames.items()}
            mon.push(Tick(ep.action[t], ep.state[t], gray, t_wall=time.time(), truth=truth[t] if truth else {}))
            if speed > 0:
                time.sleep(period)
        for live in mon.flush():
            pass
    return found


def _truth_rows(ep) -> list[dict]:
    sc = ep.sidecar
    if sc is None or "fault" not in sc:
        return []
    return [{"fault": r.get("fault"), "target": r.get("fault_target", ""), "active": bool(r.get("fault_active"))}
            for r in sc.to_dict("records")][: ep.n]
