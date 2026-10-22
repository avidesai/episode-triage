"""Validation against a known answer.

inject_eval: software faults injected into real community episodes. One set of robots
calibrates the one threshold that is tuned on data (the stale camera image change
level); a separate set of robots, never seen during calibration, is scored with every
threshold frozen.

bench_eval: episodes recorded on a physical arm with recorder/record_labeled.py, where
the flight recorder's sidecar holds the true frame ages and the exact fault schedule.
"""

from __future__ import annotations

import copy
import json
import random
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np

from .checks import THRESHOLDS, chain_motion, episode_signals
from .fleet import COMMUNITY, _json, robot_id, so_arm_dirs
from .inject import (decode_rgb, delay_frames, freeze_frames, inject_glitches, inject_offset,
                     inject_stale_state, inject_stall, reencode_gray)
from .pipeline import profile_for, triage_episode
from .readers import open_robot
from .signals import image_energy, runs, xcorr_lag, rolling_max
from .video import decode_gray

FREEZE_LENGTHS = [3, 6, 10, 20]
TOL_S = 0.3

EXPECT = {
    # kind: (check, expected rung)
    "freeze": ("sensing.stale_camera", 1),
    "stall": ("actuation.not_following", 2),
    "offset": ("actuation.rest_offset", 2),
    "glitch": ("actuation.bus_glitch", 2),
    "stale_state": ("sensing.stale_state", 1),
}


def _moving_start(m: np.ndarray, n: int, rng: random.Random, tau: float, margin: int) -> int | None:
    ok = m > tau
    starts = [a for a, b in runs(ok, n + 2) for a in range(a + 1, b - n)]
    starts = [s for s in starts if margin <= s < len(m) - margin - n]
    return rng.choice(starts) if starts else None


def _pick_episodes(root: Path, n: int, seed: int, exclude: set[str]) -> list[tuple[Path, int]]:
    rng = random.Random(seed)
    dirs = [d for d in so_arm_dirs(root) if robot_id(d) not in exclude]
    rng.shuffle(dirs)
    out = []
    for d in dirs:
        if len(out) >= n:
            break
        robot = open_robot(d, robot_id=robot_id(d))
        if not robot.camera_keys or robot.fps != 30:
            continue
        lens = robot.episodes_meta.set_index("episode_index")["length"]
        good = [int(i) for i, L in lens.items() if L >= 10 * robot.fps]
        if good:
            out.append((d, rng.choice(good)))
    return out


def _variant(ep, state=None):
    e = copy.copy(ep)
    if state is not None:
        e.state = state
    return e


def _scored(res, kind, comp, t0, t1, expect_check):
    """Did the expected check fire on the right part in the right window, and which rung
    did its incident get?"""
    hits = [ev for ev in res.events if ev.check == expect_check and comp in ev.component
            and ev.onset <= t1 + TOL_S and ev.t_end >= t0 - TOL_S]
    if not hits:
        return {"caught": False, "rung": None, "rule": None, "onset_err_s": None}
    h = min(hits, key=lambda e: abs(e.onset - t0))
    inc = [i for i in res.incidents if i.involves(h)]
    return {"caught": True, "rung": inc[0].rung if inc else None, "rule": inc[0].rule if inc else None,
            "onset_err_s": round(h.onset - t0, 3)}


def _episode_cases(d: Path, ep_i: int, rng: random.Random, k: int):
    robot = open_robot(d, robot_id=robot_id(d), remote=COMMUNITY)
    prof = profile_for(robot)
    ep = robot.episode(ep_i)
    cams = list(ep.cameras)
    cam = rng.choice(cams)
    c = ep.cameras[cam]
    rgb = decode_rgb(c.path, c.from_ts, c.to_ts, ep.fps)
    others = {}
    for key in cams:
        if key != cam:
            o = ep.cameras[key]
            others[key] = decode_gray(o.path, o.from_ts, o.to_ts, ep.fps)
    clean_gray = reencode_gray(rgb, ep.fps)
    sig = episode_signals(ep.action, ep.state, ep.fps, ep.joint_names, ep.gripper_idx, prof)
    m = chain_motion(sig, c.chain)
    return robot, prof, ep, cam, rgb, others, clean_gray, sig, m


def inject_eval(sample: Path, root: Path, out: Path, seed: int = 11, n_calib: int = 20, n_test: int = 40,
                reuse_calibration: Path | None = None):
    rng = random.Random(seed)
    picks = _pick_episodes(root, n_calib + n_test, seed, exclude=set())
    calib, test = picks[:n_calib], picks[n_calib:]
    print(f"{len(calib)} calibration robots, {len(test)} test robots", flush=True)
    if reuse_calibration is not None:
        # The threshold is already frozen in checks.py from an earlier calibration run on the
        # same calibration robots; only the held out robots are scored again.
        calibration = json.loads(reuse_calibration.read_text())["calibration"]
        assert abs(THRESHOLDS["stale_tau_e"] - calibration["stale_tau_e"]) < 1e-9, "frozen threshold differs"
        calib = []

    # ---- 1. calibrate the stale camera threshold on the calibration robots only
    frozen_e, moving_e = [], []
    for k, (d, ep_i) in enumerate(calib):
        try:
            robot, prof, ep, cam, rgb, others, clean_gray, sig, m = _episode_cases(d, ep_i, rng, k)
        except Exception as e:
            print("skip", robot_id(d), e)
            continue
        tau_m = THRESHOLDS["stale_tau_m"]
        moving = (m > tau_m) & (np.roll(m, 1) > tau_m)
        e_clean = image_energy(clean_gray)
        moving_e += list(e_clean[moving & np.isfinite(e_clean)])
        for n in FREEZE_LENGTHS:
            t0 = _moving_start(m, n, rng, tau_m, int(ep.fps))
            if t0 is None:
                continue
            g = reencode_gray(freeze_frames(rgb, t0, n), ep.fps)
            frozen_e += list(image_energy(g)[t0:t0 + n])
        print(f"calib [{k + 1}/{len(calib)}] {robot.robot_id}")
    if reuse_calibration is not None:
        return _score_test(test, rng, calibration, out, seed)
    frozen_e, moving_e = np.array(frozen_e), np.array(moving_e)
    grid = np.round(np.arange(0.02, 1.5, 0.01), 2)
    tpr = np.array([(frozen_e < t).mean() for t in grid])
    fpr = np.array([(moving_e < t).mean() for t in grid])
    best = float(grid[int(np.argmax(tpr - fpr))])
    calibration = {
        "stale_tau_e": best, "n_frozen_frames": int(len(frozen_e)), "n_moving_frames": int(len(moving_e)),
        "tpr_at_tau": float(tpr[grid == best][0]), "fpr_at_tau": float(fpr[grid == best][0]),
        "frozen_e_percentiles": np.percentile(frozen_e, [50, 90, 95, 99]).round(3).tolist(),
        "moving_e_percentiles": np.percentile(moving_e, [1, 5, 10, 50]).round(3).tolist(),
        "robots": [robot_id(d) for d, _ in calib],
        "note": "moving frames are clean episodes and can hold natural stale frames, so fpr is an upper bound",
    }
    THRESHOLDS["stale_tau_e"] = best
    print("calibrated", calibration, flush=True)
    return _score_test(test, rng, calibration, out, seed)


def _score_test(test, rng, calibration, out: Path, seed: int):
    """Score every fault kind on the held out robots, thresholds frozen."""
    rows = []
    lag_rows = []
    for k, (d, ep_i) in enumerate(test):
        try:
            robot, prof, ep, cam, rgb, others, clean_gray, sig, m = _episode_cases(d, ep_i, rng, k)
        except Exception as e:
            print("skip", robot_id(d), e)
            continue
        base = {**others, cam: clean_gray}
        clean = triage_episode(ep, prof, frames_override=base)
        clean_fp = Counter(e.fingerprint for e in clean.events)
        rid = robot.robot_id
        moved = [j for j in sig.arm_idx if prof.moved is None or prof.moved[j]]

        def add(kind, comp, t0, t1, res, **extra):
            check, rung = EXPECT[kind]
            sc = _scored(res, kind, comp, t0, t1, check)
            new = Counter(e.fingerprint for e in res.events) - clean_fp
            new.pop(f"{check}.{comp}", None)
            rows.append({"robot_id": rid, "episode": ep.episode_index, "kind": kind, "component": comp,
                         "t0": round(t0, 2), "t1": round(t1, 2), "expect_check": check,
                         "expect_rung": rung, **sc, "new_other_events": sum(new.values()), **extra})

        # camera freeze, several lengths
        for n in FREEZE_LENGTHS:
            t0 = _moving_start(m, n, rng, THRESHOLDS["stale_tau_m"], int(ep.fps))
            if t0 is None:
                continue
            g = reencode_gray(freeze_frames(rgb, t0, n), ep.fps)
            res = triage_episode(ep, prof, frames_override={**others, cam: g})
            add("freeze", cam, t0 / ep.fps, (t0 + n) / ep.fps, res, frames=n)

        # camera delay: the lag estimate should move by the injected amount
        e_c, e_d = image_energy(clean_gray), image_energy(reencode_gray(delay_frames(rgb, 3), ep.fps))
        valid = rolling_max(m, 15) > THRESHOLDS["stale_tau_m"]
        l0, c0, _ = xcorr_lag(e_c, m, valid)
        l1, c1, _ = xcorr_lag(e_d, m, valid)
        lag_rows.append({"robot_id": rid, "camera": cam, "clean_lag": l0, "delayed_lag": l1,
                         "shift": None if l0 is None or l1 is None else l1 - l0})

        # joint faults, video left clean so every layer is checked
        if moved:
            j = rng.choice(moved)
            # start where the joint is moving; the stall then holds it still for 1.5 s
            t0 = _moving_start(sig.a_speed[:, j], int(0.3 * ep.fps), rng, THRESHOLDS["moving"], int(1.5 * ep.fps))
            if t0 is not None:
                st = inject_stall(ep.state, j, t0, int(1.5 * ep.fps))
                res = triage_episode(_variant(ep, st), prof, frames_override=base)
                add("stall", ep.joint_names[j], t0 / ep.fps, t0 / ep.fps + 1.5, res)
            j = rng.choice(moved)
            st = inject_offset(ep.state, j, 0.08 * prof.ranges[j])
            res = triage_episode(_variant(ep, st), prof, frames_override=base)
            n_rest = len(runs(sig.rest, int(THRESHOLDS["rest_min_s"] * ep.fps)))
            add("offset", ep.joint_names[j], 0.0, ep.duration_s, res, rest_periods=n_rest)
            j = rng.choice(moved)
            at = sorted(rng.sample(range(int(ep.fps), ep.n - int(ep.fps)), 3))
            st = inject_glitches(ep.state, j, at, 0.4 * prof.ranges[j])
            res = triage_episode(_variant(ep, st), prof, frames_override=base)
            add("glitch", "follower." + ep.joint_names[j], at[0] / ep.fps, at[-1] / ep.fps, res)
        lagged = sig.a_speed[:, sig.arm_idx].sum(axis=1)
        t0 = _moving_start(lagged, 6, rng, 2 * THRESHOLDS["stale_tau_m"], int(ep.fps))
        if t0 is not None:
            st = inject_stale_state(ep.state, t0, 6)
            res = triage_episode(_variant(ep, st), prof, frames_override=base)
            add("stale_state", "joint_stream", t0 / ep.fps, (t0 + 6) / ep.fps, res)
        print(f"test [{k + 1}/{len(test)}] {rid}", flush=True)

    summary = summarize(rows, lag_rows)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps({"calibration": calibration, "summary": summary, "rows": rows,
                               "lag_rows": lag_rows, "seed": seed}, indent=1, default=_json))
    print(json.dumps(summary, indent=1, default=_json))


def summarize(rows: list[dict], lag_rows: list[dict]) -> dict:
    by = defaultdict(list)
    for r in rows:
        key = r["kind"] if r["kind"] != "freeze" else f"freeze_{r['frames']}"
        by[key].append(r)
    table = {}
    for k, rs in sorted(by.items()):
        rung_ok = sum(1 for r in rs if r["caught"] and r["rung"] == r["expect_rung"])
        abstained = sum(1 for r in rs if not r["caught"] and r.get("rest_periods", 99) < 2)
        table[k] = {"n": len(rs), "caught": sum(r["caught"] for r in rs),
                    "missed": sum(not r["caught"] for r in rs) - abstained, "abstained": abstained,
                    "right_rung": rung_ok, "rungs": dict(Counter(str(r["rung"]) for r in rs)),
                    "new_other_events": sum(r["new_other_events"] for r in rs)}
    shifts = [r["shift"] for r in lag_rows if r["shift"] is not None]
    return {"faults": table, "lag": {"n": len(lag_rows), "estimated": len(shifts),
                                     "shift_counts": dict(Counter(shifts)),
                                     "within_1_of_3": sum(abs(s - 3) <= 1 for s in shifts)}}


# ---------------------------------------------------------------- bench set (physical arm)

def bench_eval(dataset: Path, out: Path):
    """Score triage on episodes recorded with recorder/record_labeled.py.

    The sidecar gives, per tick, each camera's frame age and whether it was a new frame,
    and the exact fault schedule. Faults are matched to events the same way as the
    injection eval; stale camera is also scored frame by frame against the true flags.
    """
    robot = open_robot(dataset, robot_id=dataset.name)
    prof = profile_for(robot)
    rows, frame_counts = [], Counter()
    for i in robot.episode_indices:
        ep = robot.episode(i)
        if ep.sidecar is None:
            continue
        res = triage_episode(ep, prof)
        sc = ep.sidecar
        faults = sc[sc["fault_active"]] if "fault_active" in sc else sc.iloc[0:0]
        for name, g in faults.groupby("fault"):
            t0, t1 = g["tick"].min() / ep.fps, (g["tick"].max() + 1) / ep.fps
            target = str(g["fault_target"].iloc[0])
            check, rung = BENCH_EXPECT.get(name, (None, None))
            sc_ = _scored(res, name, target, t0, t1, check) if check else {"caught": None}
            rows.append({"episode": i, "fault": name, "target": target, "t0": t0, "t1": t1,
                         "expect_check": check, "expect_rung": rung, **sc_})
        for cam in ep.cameras:
            col = f"{cam}.new"
            if col not in sc:
                continue
            truth = ~sc[col].to_numpy(bool)[: ep.n]
            pred = np.zeros(ep.n, bool)
            for e in res.events:
                if e.check == "sensing.stale_camera" and e.component == cam:
                    pred[e.start:e.end] = True
            frame_counts["true_stale"] += int(truth.sum())
            frame_counts["caught"] += int((truth & pred).sum())
            frame_counts["missed"] += int((truth & ~pred).sum())
            frame_counts["false_alarm"] += int((~truth & pred).sum())
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps({"rows": rows, "stale_frames": dict(frame_counts)}, indent=1, default=_json))
    print(json.dumps({"faults": len(rows), "stale_frames": frame_counts}, indent=1))


BENCH_EXPECT = {
    "camera_freeze": ("sensing.stale_camera", 1),
    "camera_stall": ("sensing.stale_camera", 1),
    "torque_off": ("actuation.not_following", 2),
    "calibration_shift": ("actuation.rest_offset", 2),
    "camera_delay": (None, 2),
    "air_grasps": ("task.missed_grasp_sequence", 3),
}
