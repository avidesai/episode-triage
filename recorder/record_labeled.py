"""Flight recorder for an SO 101 leader/follower arm, with scheduled fault injection.

Writes a normal LeRobot v3.0 dataset plus a sidecar per episode
(<root>/sidecar/episode_XXXXXX.jsonl, one line per control tick) holding what the dataset
format throws away:

  t_wall, loop_ms        real wall clock and loop period (LeRobot writes frame_index / fps)
  <cam>.age_ms, <cam>.new host receive age of the frame used this tick, and whether it is
                         a frame the camera hadn't delivered before
  servo.*                Present_Load, Present_Temperature, Present_Voltage, Status, read
                         round robin at 5 Hz so the extra bus traffic stays small
  fault, fault_target, fault_active
                         the injected fault and the exact ticks it was active

Faults are applied inside the same loop, either on a schedule or when you press Enter
(--trigger key), so the log and the injection can't disagree.

With --monitor, every tick also goes through the online triage monitor, and incidents
appear in the viewer served by `triage serve` while the arm keeps running.

Built against lerobot 0.6.1 and checked against 0.6.2. Run every hardware step yourself, with the arm low over the
table and a hand near it for torque_off.

Example:
  python recorder/record_labeled.py --follower-port /dev/tty.usbmodemA --leader-port /dev/tty.usbmodemB \\
      --wrist-cam 0 --scene-cam 1 --root data/so101_bench --repo-id avidesai/so101_bench \\
      --task "fold the towel in half" --episode-s 25 --fault torque_off --fault-target wrist_flex \\
      --fault-start-s 8 --fault-len-s 2
"""

from __future__ import annotations

import argparse
import collections
import json
import sys
import threading
import time
from pathlib import Path

from lerobot.cameras.opencv import OpenCVCameraConfig
from lerobot.datasets import LeRobotDataset
from lerobot.robots.so_follower import SO101Follower, SO101FollowerConfig
from lerobot.teleoperators.so_leader import SO101Leader, SO101LeaderConfig
from lerobot.utils.feature_utils import build_dataset_frame, hw_to_dataset_features
from lerobot.utils.robot_utils import precise_sleep

FAULTS = {
    "none": "baseline",
    "air_grasps": "label only: the operator closes on air twice, then grasps",
    "camera_stall": "label only: a physical stall (lights off, or a 1080p capture on the same hub)",
    "camera_freeze": "serve the same frame for the window, the way read_latest does when capture stalls",
    "camera_delay": "serve the frame from --delay-ticks ago for the window",
    "torque_off": "write Torque_Enable = 0 to the target motor for the window; the joint really sags",
    "calibration_shift": "add --offset to the target's goal before send_action, record the raw leader value",
    "camera_bump": "label only: the operator nudges the scene camera mount at the scheduled time",
}
SERVO_REGS = ["Present_Load", "Present_Temperature", "Present_Voltage", "Status"]


def parse():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--follower-port", required=True)
    p.add_argument("--leader-port", required=True)
    p.add_argument("--follower-id", default="so101_follower")
    p.add_argument("--leader-id", default="so101_leader")
    p.add_argument("--wrist-cam", default="0")
    p.add_argument("--scene-cam", default="1")
    p.add_argument("--cam-width", type=int, default=640)
    p.add_argument("--cam-height", type=int, default=480)
    p.add_argument("--fps", type=int, default=30)
    p.add_argument("--root", required=True, type=Path)
    p.add_argument("--repo-id", required=True)
    p.add_argument("--task", required=True)
    p.add_argument("--episode-s", type=float, default=25.0)
    p.add_argument("--episodes", type=int, default=1)
    p.add_argument("--fault", choices=sorted(FAULTS), default="none")
    p.add_argument("--fault-target", default="", help="motor name or camera key (wrist or scene)")
    p.add_argument("--fault-start-s", type=float, default=8.0)
    p.add_argument("--fault-len-s", type=float, default=2.0)
    p.add_argument("--offset", type=float, default=8.0, help="calibration_shift, in the arm's own units")
    p.add_argument("--delay-ticks", type=int, default=3)
    p.add_argument("--trigger", choices=["schedule", "key"], default="schedule",
                   help="schedule: the fault runs at --fault-start-s; key: it runs when you press Enter in this terminal")
    p.add_argument("--monitor", action="store_true",
                   help="run the online triage monitor on every tick and post incidents to --site")
    p.add_argument("--site", type=Path, default=Path("docs"), help="viewer folder served by `triage serve`")
    p.add_argument("--profile", type=Path, help="profile.json from `triage baseline`; default builds one from --root")
    return p.parse_args()


def cam_index(x: str):
    return int(x) if x.isdigit() else x


def main():
    a = parse()
    cams = {
        "wrist": OpenCVCameraConfig(index_or_path=cam_index(a.wrist_cam), fps=a.fps,
                                    width=a.cam_width, height=a.cam_height),
        "scene": OpenCVCameraConfig(index_or_path=cam_index(a.scene_cam), fps=a.fps,
                                    width=a.cam_width, height=a.cam_height),
    }
    robot = SO101Follower(SO101FollowerConfig(port=a.follower_port, id=a.follower_id, cameras=cams))
    leader = SO101Leader(SO101LeaderConfig(port=a.leader_port, id=a.leader_id))
    robot.connect()
    leader.connect()

    features = {**hw_to_dataset_features(robot.action_features, "action"),
                **hw_to_dataset_features(robot.observation_features, "observation")}
    if (a.root / "meta" / "info.json").exists():
        dataset = LeRobotDataset.resume(a.repo_id, root=a.root)
    else:
        dataset = LeRobotDataset.create(a.repo_id, fps=a.fps, features=features, root=a.root,
                                        robot_type="so101_follower", use_videos=True)
    (a.root / "sidecar").mkdir(parents=True, exist_ok=True)
    motors = list(robot.bus.motors)
    mon = make_monitor(a, motors) if a.monitor else None
    trig = KeyTrigger() if a.trigger == "key" else None

    try:
        for _ in range(a.episodes):
            input(f"Reset the scene, then press Enter to record ({a.fault}, {a.fault_target or 'no target'})")
            ep_index = dataset.meta.total_episodes
            rows = record_episode(a, robot, leader, dataset, motors, mon, trig)
            dataset.save_episode()
            side = a.root / "sidecar" / f"episode_{ep_index:06d}.jsonl"
            side.write_text("\n".join(json.dumps(r) for r in rows) + "\n")
            print(f"saved episode {ep_index}: {len(rows)} ticks, sidecar {side}")
    finally:
        if a.fault == "torque_off" and a.fault_target:
            robot.bus.enable_torque(a.fault_target)
        dataset.finalize()
        robot.disconnect()
        leader.disconnect()


class KeyTrigger:
    """Press Enter in the terminal to start the fault now. Works any number of times."""

    def __init__(self):
        self.fired_at: int | None = None
        self.pending = False
        threading.Thread(target=self._read, daemon=True).start()

    def _read(self):
        for _ in sys.stdin:
            self.pending = True

    def take(self, tick: int) -> None:
        if self.pending:
            self.pending = False
            self.fired_at = tick


def make_monitor(a, motors):
    from episode_triage.checks import RobotProfile
    from episode_triage.monitor import LiveSite, Monitor

    if a.profile:
        prof = RobotProfile.from_dict(json.loads(a.profile.read_text()))
    elif (a.root / "meta" / "info.json").exists():
        from episode_triage.pipeline import profile_for
        from episode_triage.readers import open_robot
        prof = profile_for(open_robot(a.root, robot_id=a.root.name))
    else:
        sys.exit("--monitor needs a profile: run `triage baseline <clean runs>` first, or record clean runs into --root")
    arm = [i for i, m in enumerate(motors) if m != "gripper"]
    cams = {"observation.images.wrist": arm, "observation.images.scene": arm}
    site = LiveSite(a.site, a.follower_id, fleet_name="live")

    def on_inc(live):
        site.add(live)
        inc = live.incident
        print(f"\n  >> [{live.t_abs:6.1f} s] rung {inc['rung']} {inc['rung_name']}: {inc['route']}", flush=True)

    return Monitor(a.follower_id, prof, a.fps, motors, [motors.index("gripper")], cams, on_incident=on_inc)


def record_episode(a, robot, leader, dataset, motors, mon=None, trig=None):
    period = 1.0 / a.fps
    n_ticks = int(a.episode_s * a.fps)
    f0 = int(a.fault_start_s * a.fps)
    f1 = f0 + int(a.fault_len_s * a.fps)
    last_ts = {k: None for k in robot.cameras}
    held = {}
    ring = collections.deque(maxlen=max(a.delay_ticks, 1) + 1)
    cam_key = {"wrist": "wrist", "scene": "scene"}.get(a.fault_target, a.fault_target)
    rows = []
    torque_cut = False
    t_start = time.perf_counter()
    t_prev = t_start

    n_fault = int(a.fault_len_s * a.fps)
    for tick in range(n_ticks):
        t0 = time.perf_counter()
        if trig is not None:
            trig.take(tick)
            f0 = trig.fired_at if trig.fired_at is not None else n_ticks + 1
            f1 = f0 + n_fault
        active = a.fault != "none" and f0 <= tick < f1
        if a.fault != "none" and tick in (f0, f1):
            # label only faults are performed by the operator on this cue
            print(f"\a{'NOW' if tick == f0 else 'END'}: {a.fault} {a.fault_target}", flush=True)

        if a.fault == "torque_off":
            if active and not torque_cut:
                robot.bus.disable_torque(a.fault_target)
                torque_cut = True
            elif not active and torque_cut:
                robot.bus.enable_torque(a.fault_target)
                torque_cut = False

        obs = robot.get_observation()
        now = time.perf_counter()
        row = {"tick": tick, "t_wall": round(now - t_start, 5), "loop_ms": round(1000 * (t0 - t_prev), 2)}
        t_prev = t0

        for key, cam in robot.cameras.items():
            ts = cam.latest_timestamp
            row[f"observation.images.{key}.age_ms"] = round(1000 * (now - ts), 2) if ts else None
            row[f"observation.images.{key}.new"] = bool(ts is not None and ts != last_ts[key])
            last_ts[key] = ts

        # camera faults change what the dataset receives, and the sidecar says so
        if cam_key in robot.cameras:
            full = f"observation.images.{cam_key}"
            if a.fault == "camera_delay":
                ring.append(obs[cam_key])
                if active and len(ring) > a.delay_ticks:
                    obs[cam_key] = ring[0]
                    row[f"{full}.age_ms"] = (row[f"{full}.age_ms"] or 0) + 1000 * a.delay_ticks * period
            if a.fault == "camera_freeze":
                if active:
                    if "frame" not in held:
                        held["frame"] = obs[cam_key]
                    obs[cam_key] = held["frame"]
                    row[f"{full}.new"] = False
                else:
                    held.clear()

        act = leader.get_action()
        sent = dict(act)
        if a.fault == "calibration_shift" and a.fault_target:
            # the whole episode, like a reseated horn; the dataset keeps the raw leader value
            sent[f"{a.fault_target}.pos"] = act[f"{a.fault_target}.pos"] + a.offset
        robot.send_action(sent)

        if tick % 6 == 0:
            reg = SERVO_REGS[(tick // 6) % len(SERVO_REGS)]
            try:
                vals = robot.bus.sync_read(reg, motors, normalize=False)
                for m, v in vals.items():
                    row[f"servo.{m}.{reg}"] = int(v)
            except Exception as e:     # a failed diagnostic read must never stop the recording
                row["servo.error"] = str(e)[:80]

        row["fault"] = a.fault
        row["fault_target"] = a.fault_target
        row["fault_active"] = bool(active or (a.fault == "calibration_shift"))

        frame = {**build_dataset_frame(dataset.features, obs, prefix="observation"),
                 **build_dataset_frame(dataset.features, act, prefix="action"),
                 "task": a.task}
        dataset.add_frame(frame)
        rows.append(row)

        if mon is not None:
            from episode_triage.monitor import Tick, gray_small
            import numpy as np
            mon.push(Tick(
                action=np.array([act[f"{m}.pos"] for m in motors], dtype=float),
                state=np.array([obs[f"{m}.pos"] for m in motors], dtype=float),
                gray={f"observation.images.{k}": gray_small(obs[k]) for k in robot.cameras},
                t_wall=now,
                truth={"fault": a.fault, "target": a.fault_target, "active": bool(row["fault_active"])}))
        precise_sleep(max(period - (time.perf_counter() - t0), 0.0))
    return rows


if __name__ == "__main__":
    main()
