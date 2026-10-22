"""The checks. Each one reads aligned arrays and returns Events.

Layers, cheapest evidence first:
  S  sensing and timing   did fresh, intact data reach the robot?
  A  actuation            did the joints do what they were told?
  T  task                 with good inputs and good tracking, did the task progress?

Every threshold lives in THRESHOLDS with the physical reason for its value. All
positional values are fractions of a joint's range (see signals.joint_ranges).
Thresholds were written down before the validation and fleet runs; docs/THRESHOLDS.md
records how each one was set.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from .signals import (follow_lag, image_energy, joint_ranges, rolling_max, runs, shift,
                      speed, xcorr_lag)

THRESHOLDS = {
    # S1 stale camera. A frame is stale when the picture didn't change although the
    # joints that move (or are seen by) that camera did.
    "stale_tau_e": 0.35,          # gray levels at 80x60; set from the fleet's E histogram valley
    "stale_tau_m": 0.02,          # summed state speed over the chain, fraction of range per frame
    "stale_min_frames": 3,        # 100 ms at 30 fps
    # S3 camera to joint lag
    "lag_flag_frames": 3,         # 100 ms at 30 fps; a USB camera read with read_latest normally adds 1 to 2
    "lag_min_sharpness": 0.10,
    "lag_min_corr": 0.30,
    # S5 stale joint stream
    "stale_state_min_frames": 3,
    # A1 joint not following
    "follow_err": 0.15,           # healthy SO followers stay under 0.07 at the 99th percentile
    "follow_min_s": 0.4,          # a limp or stalled servo passes 0.15 within a few hundred ms
    "follow_recover_s": 1.0,      # shorter than this and the robot cleared it itself
    "moving": 0.01,               # fraction of range per frame
    # A2 calibration offset at rest
    "rest_speed": 0.005,
    "rest_min_s": 1.0,
    "offset_err": 0.05,           # healthy robots sit within 0.02 of their leader at rest
    "offset_agree": 0.8,          # share of rest segments that must agree in sign and size
    # A3 bus read glitch
    "glitch_jump": 0.25,          # an STS3215 can't move a quarter of its range in one frame
    "glitch_return": 0.05,
    "glitch_return_frames": 3,
    "glitch_ticket_count": 3,
    # A4 pinned at a range limit
    "pin_margin": 0.01,
    "pin_push": 0.02,
    "pin_min_s": 0.5,
    # T1 stall
    "stall_speed": 0.005,
    "stall_min_s": 2.0,
    "stall_edge_s": 1.5,
    # T2 missed grasp (Weave's metric: 2 or more consecutive missed grasps)
    "close_zone": 0.15,           # command within 15% of range of the closed end
    "close_settle_s": 0.3,
    "empty_gap": 0.03,            # follower reached the command: nothing in the jaws
    "holding_gap": 0.05,          # follower stopped short: something is held
    "gripper_min_range_frac": 0.10,
    # Integrity
    "min_episode_s": 2.0,
}


@dataclass
class Event:
    check: str
    layer: str
    component: str
    start: int
    end: int
    fps: float
    confidence: str = "medium"
    evidence: dict = field(default_factory=dict)

    @property
    def onset(self) -> float:
        return self.start / self.fps

    @property
    def t_end(self) -> float:
        return self.end / self.fps

    @property
    def duration(self) -> float:
        return (self.end - self.start) / self.fps

    @property
    def fingerprint(self) -> str:
        return f"{self.check}.{self.component}"

    def to_dict(self) -> dict:
        return {
            "check": self.check, "layer": self.layer, "component": self.component,
            "t_start": round(self.onset, 3), "t_end": round(self.t_end, 3),
            "confidence": self.confidence, "fingerprint": self.fingerprint,
            "evidence": {k: (round(v, 4) if isinstance(v, float) else v) for k, v in self.evidence.items()},
        }


@dataclass
class RobotProfile:
    """Per robot statistics, computed once from all of a robot's frames."""

    ranges: np.ndarray
    lag: np.ndarray
    state_lo: np.ndarray
    state_hi: np.ndarray
    gripper_closed_low: dict[int, bool]
    gripper_active: dict[int, bool]
    gripper_closed_value: dict[int, float]   # the command at the closed end (1st or 99th pct)


def build_profile(action: np.ndarray, state: np.ndarray, gripper_idx: list[int]) -> RobotProfile:
    ranges = joint_ranges(action, gripper_idx)
    an, sn = action / ranges, state / ranges
    lag = follow_lag(an, sn)
    lo, hi = np.nanpercentile(state, [0.1, 99.9], axis=0)
    arm = [i for i in range(action.shape[1]) if i not in gripper_idx]
    arm_scale = np.median(ranges[arm]) if arm else 1.0
    closed_low, active, closed_value = {}, {}, {}
    for g in gripper_idx:
        a_lo, a_hi = np.nanpercentile(action[:, g], [1, 99])
        r = a_hi - a_lo
        active[g] = bool(r >= THRESHOLDS["gripper_min_range_frac"] * arm_scale)
        closed_low[g], closed_value[g] = True, float(a_lo)
        if not active[g]:
            continue
        a = (action[:, g] - a_lo) / r
        s = (state[:, g] - a_lo) / r
        low, high = a < THRESHOLDS["close_zone"], a > 1 - THRESHOLDS["close_zone"]
        # A gripper closed on an object stops short of its command, so the closed end is
        # the end where the follower sits short of the leader.
        gap_low = np.median((s - a)[low]) if low.any() else 0.0
        gap_high = np.median((a - s)[high]) if high.any() else 0.0
        closed_low[g] = not (gap_high > gap_low + 0.02)
        closed_value[g] = float(a_lo if closed_low[g] else a_hi)
    return RobotProfile(ranges, lag, lo, hi, closed_low, active, closed_value)


@dataclass
class EpisodeSignals:
    """Normalized arrays for one episode, shared by every check."""

    fps: float
    names: list[str]
    gripper_idx: list[int]
    arm_idx: list[int]
    an: np.ndarray      # action / range
    sn: np.ndarray      # state / range
    err: np.ndarray     # lag corrected tracking error, an(t - d) - sn(t)
    a_speed: np.ndarray
    s_speed: np.ndarray
    rest: np.ndarray    # (T,) every joint's command still, neighbourhood smoothed


def episode_signals(action, state, fps, names, gripper_idx, prof: RobotProfile) -> EpisodeSignals:
    an, sn = action / prof.ranges, state / prof.ranges
    err = np.stack([shift(an[:, j], int(prof.lag[j])) - sn[:, j] for j in range(an.shape[1])], 1)
    a_speed, s_speed = speed(an), speed(sn)
    w = max(3, int(round(0.2 * fps)))
    rest = (rolling_max(a_speed, w) < THRESHOLDS["rest_speed"]).all(axis=1)
    arm = [i for i in range(an.shape[1]) if i not in gripper_idx]
    return EpisodeSignals(fps, names, gripper_idx, arm, an, sn, err, a_speed, s_speed, rest)


def _frames(s: float, fps: float) -> int:
    return max(1, int(round(s * fps)))


# ---------------------------------------------------------------- S: sensing and timing

def check_integrity(action, state, frame_index, fps) -> list[Event]:
    """S2. Anything here means the episode can't be trusted, and triggers rule 0."""
    T = THRESHOLDS
    out = []
    n = len(action)
    bad = ~np.isfinite(action).all(axis=1) | ~np.isfinite(state).all(axis=1)
    for a, b in runs(bad, 1):
        out.append(Event("integrity.nan", "sensing", "joint_stream", a, b, fps, "high",
                         {"rows": b - a}))
    if n < T["min_episode_s"] * fps:
        out.append(Event("integrity.short", "sensing", "episode", 0, n, fps, "high",
                         {"duration_s": n / fps}))
    gaps = np.flatnonzero(np.diff(frame_index) != 1)
    if len(gaps):
        out.append(Event("integrity.frame_index", "sensing", "episode", int(gaps[0]), int(gaps[0]) + 1, fps,
                         "high", {"discontinuities": int(len(gaps))}))
    return out


def check_video_integrity(cam: str, n_frames: int, n_rows: int, fps: float, err: str | None) -> list[Event]:
    if err:
        return [Event("integrity.decode_error", "sensing", cam, 0, n_rows, fps, "high", {"error": err[:120]})]
    if abs(n_frames - n_rows) > 1:
        return [Event("integrity.frame_count", "sensing", cam, min(n_frames, n_rows), n_rows, fps, "high",
                      {"video_frames": n_frames, "rows": n_rows})]
    return []


def chain_motion(sig: EpisodeSignals, chain: list[int]) -> np.ndarray:
    idx = chain or sig.arm_idx
    return sig.s_speed[:, idx].sum(axis=1)


def check_camera_lag(cam: str, e: np.ndarray, m: np.ndarray, fps: float):
    """S3. Returns (lag or None, evidence dict, events)."""
    T = THRESHOLDS
    valid = rolling_max(m, 15) > T["stale_tau_m"]
    lag, corr, sharp = xcorr_lag(e, m, valid)
    ev = {"lag_frames": lag, "peak_corr": corr, "sharpness": sharp}
    if lag is None or corr < T["lag_min_corr"] or sharp < T["lag_min_sharpness"]:
        return None, ev, []
    out = []
    if abs(lag) >= T["lag_flag_frames"]:
        conf = "high" if sharp >= 0.2 else "medium"
        out.append(Event("sensing.camera_lag", "sensing", cam, 0, len(e), fps, conf,
                         {"lag_frames": int(lag), "lag_ms": round(1000 * lag / fps, 1),
                          "peak_corr": corr, "sharpness": sharp}))
    return lag, ev, out


def check_stale_camera(cam: str, e: np.ndarray, m: np.ndarray, fps: float,
                       other_e: list[np.ndarray], lag: int = 0) -> list[Event]:
    """S1. The picture stayed the same while the joints say it should have changed.

    A still scene and a frozen camera look identical in the image alone. Cross checking
    against joint motion is what separates a dead sensor from a quiet room.
    """
    T = THRESHOLDS
    m_al = shift(m, int(np.clip(lag, 0, 5)))      # motion as this camera would see it
    moving = (m_al > T["stale_tau_m"]) & (shift(m_al, 1) > T["stale_tau_m"])
    stale = moving & (e < T["stale_tau_e"])
    stale[0] = False
    typical = float(np.nanmedian(e[moving])) if moving.sum() > 30 else float("nan")
    out = []
    for a, b in runs(stale, T["stale_min_frames"]):
        others_live = [float(np.nanmean(o[a:b] >= T["stale_tau_e"])) for o in other_e if len(o) == len(e)]
        if not np.isfinite(typical) or typical < 3 * T["stale_tau_e"]:
            conf = "low"            # this camera barely sees the arm move, so a still frame proves little
        elif others_live and max(others_live) >= 0.5 and b - a >= 5:
            conf = "high"
        else:
            conf = "medium"
        out.append(Event("sensing.stale_camera", "sensing", cam, a, b, fps, conf,
                         {"frames": b - a, "ms": round(1000 * (b - a) / fps, 1),
                          "mean_change": float(np.nanmean(e[a:b])), "typical_change": typical,
                          "motion": float(m[a:b].mean()),
                          "other_camera_live": max(others_live) if others_live else None}))
    return out


def check_stale_state(sig: EpisodeSignals, prof: RobotProfile) -> list[Event]:
    """S5. Every arm joint reads bit identical while the (lag corrected) command moves.

    One joint going flat is an actuator. All of them going flat at once is the data
    path: a cached bus read, or rows duplicated when the episode was resampled.
    """
    T = THRESHOLDS
    arm = sig.arm_idx
    same = np.concatenate([[False], (np.diff(sig.sn[:, arm], axis=0) == 0).all(axis=1)])
    lagged = np.stack([shift(sig.a_speed[:, j], int(prof.lag[j])) for j in arm], 1).sum(axis=1)
    flat = same & (lagged > T["stale_tau_m"])
    flat[: int(prof.lag.max()) + 1] = False   # the lagged command isn't defined yet
    out = []
    for a, b in runs(flat, T["stale_state_min_frames"]):
        out.append(Event("sensing.stale_state", "sensing", "joint_stream", a, b, sig.fps, "medium",
                         {"frames": b - a, "command_speed": float(lagged[a:b].mean())}))
    moving = lagged > T["stale_tau_m"]
    if moving.sum() > 60:
        # A quarter of moving rows repeating exactly is a resampled or duplicated stream.
        share = float(same[moving].mean())
        if share >= 0.25:
            out.append(Event("sensing.duplicated_rows", "sensing", "joint_stream", 0, len(same), sig.fps,
                             "high", {"repeated_rows": int(same[moving].sum()), "share": round(share, 3)}))
    return out


# ---------------------------------------------------------------- A: actuation

def check_not_following(sig: EpisodeSignals) -> list[Event]:
    """A1. A joint's measured position left its command and stayed away.

    The joint's own resting offset is removed first (A2 reports that separately), so A1
    only fires on excursions. The mode says what the follower was doing:
      stalled  command moving, follower not      (overload, dead bus, stripped horn)
      sagging  command still, follower drifting  (torque off, limp joint under gravity)
      lagging  both moving, follower far behind  (weak servo, clipped goal)
      held     both still, steady gap            (contact with the world, or a dead joint)
    """
    T = THRESHOLDS
    out = []
    n_min = _frames(T["follow_min_s"], sig.fps)
    for j in sig.arm_idx:
        e = sig.err[:, j]
        base = np.median(e[sig.rest]) if sig.rest.sum() >= _frames(T["rest_min_s"], sig.fps) else np.median(e)
        dev = np.abs(e - base)
        for a, b in runs(dev > T["follow_err"], n_min):
            av = float(sig.a_speed[a:b, j].mean())
            sv = float(sig.s_speed[a:b, j].mean())
            if av > T["moving"] and sv < 0.3 * av:
                mode = "stalled"
            elif av < 0.5 * T["moving"] and sv > 0.5 * T["moving"]:
                mode = "sagging"
            elif av > T["moving"]:
                mode = "lagging"
            else:
                mode = "held"
            others = [k for k in sig.arm_idx if k != j]
            others_ok = float(np.mean(np.abs(sig.err[a:b, others] - np.median(sig.err[:, others], 0)) < T["follow_err"])) if others else 0.0
            conf = "high" if mode in ("stalled", "sagging") and others_ok > 0.8 else "medium"
            if mode == "held":
                conf = "low"
            out.append(Event("actuation.not_following", "actuation", sig.names[j], a, b, sig.fps, conf,
                             {"mode": mode, "peak_err": float(dev[a:b].max()), "action_speed": av,
                              "state_speed": sv, "others_tracking": others_ok}))
    return out


def check_rest_offset(sig: EpisodeSignals) -> list[Event]:
    """A2. At rest, the follower sits offset from its leader by the same amount every time.

    A reseated horn or a stale calibration file does this. A policy trained on the data
    learns to compensate, which shows up later as a model that seems worse on another arm.
    """
    T = THRESHOLDS
    segs = runs(sig.rest, _frames(T["rest_min_s"], sig.fps))
    if len(segs) < 2:
        return []
    out = []
    for j in sig.arm_idx:
        med = np.array([np.median(sig.err[a:b, j]) for a, b in segs])
        big = np.abs(med) > T["offset_err"]
        sign = np.sign(np.median(med))
        agree = float(np.mean(big & (np.sign(med) == sign)))
        if agree >= T["offset_agree"]:
            conf = "high" if len(segs) >= 3 else "medium"
            out.append(Event("actuation.rest_offset", "actuation", sig.names[j], segs[0][0], segs[-1][1],
                             sig.fps, conf, {"offset": float(np.median(med)), "rest_segments": len(segs),
                                             "agree": agree}))
    return out


def check_bus_glitch(sig: EpisodeSignals) -> list[Event]:
    """A3. A one frame jump no real joint can make, that comes straight back.

    Checked on the follower (state) and on the leader (action), since both are read over
    a serial bus. Which side glitches tells you which harness to look at.
    """
    T = THRESHOLDS
    out = []
    k = T["glitch_return_frames"]
    for side, x in (("follower", sig.sn), ("leader", sig.an)):
        for j in range(x.shape[1]):
            v = x[:, j]
            jumps = np.flatnonzero(np.abs(np.diff(v)) > T["glitch_jump"]) + 1
            for t in jumps:
                before = v[t - 1]
                after = v[t + 1:t + 1 + k]
                if len(after) and np.min(np.abs(after - before)) < T["glitch_return"]:
                    out.append(Event("actuation.bus_glitch", "actuation", f"{side}.{sig.names[j]}", int(t),
                                     int(t) + 1, sig.fps, "high",
                                     {"jump": float(abs(v[t] - before))}))
    return out


def check_pinned(sig: EpisodeSignals, prof: RobotProfile) -> list[Event]:
    """A4. The follower sits at the end of its observed range while the command asks for more."""
    T = THRESHOLDS
    out = []
    lo = prof.state_lo / prof.ranges
    hi = prof.state_hi / prof.ranges
    for j in sig.arm_idx:
        s, a = sig.sn[:, j], shift(sig.an[:, j], int(prof.lag[j]))
        at_lo = (s - lo[j] < T["pin_margin"]) & (a < s - T["pin_push"])
        at_hi = (hi[j] - s < T["pin_margin"]) & (a > s + T["pin_push"])
        for end, mask in (("min", at_lo), ("max", at_hi)):
            for a0, b0 in runs(mask, _frames(T["pin_min_s"], sig.fps)):
                out.append(Event("actuation.pinned", "actuation", sig.names[j], a0, b0, sig.fps, "medium",
                                 {"limit": end, "push": float(np.abs(a - s)[a0:b0].mean())}))
    return out


# ---------------------------------------------------------------- T: task and progress

def check_stall(sig: EpisodeSignals) -> list[Event]:
    """T1. The robot stopped making progress: nothing commanded and nothing moving.

    This is the "stalls for some time" trigger, measured from the robot's own motion so
    its onset is when the robot stopped, not when anyone noticed.
    """
    T = THRESHOLDS
    w = max(3, _frames(0.2, sig.fps))
    still = ((rolling_max(sig.a_speed, w) < T["stall_speed"]) &
             (rolling_max(sig.s_speed, w) < T["stall_speed"])).all(axis=1)
    edge = _frames(T["stall_edge_s"], sig.fps)
    still[:edge] = False
    still[-edge:] = False
    return [Event("task.stall", "task", "arm", a, b, sig.fps, "medium", {"seconds": (b - a) / sig.fps})
            for a, b in runs(still, _frames(T["stall_min_s"], sig.fps))]


def grasp_attempts(sig: EpisodeSignals, prof: RobotProfile, g: int) -> list[dict]:
    """Every close command on gripper g, classified empty, holding, or ambiguous."""
    T = THRESHOLDS
    # Work in raw units against the robot's own closed end, so one episode can't move it.
    r = prof.ranges[g]
    a, s = sig.an[:, g] * r, sig.sn[:, g] * r
    closed = prof.gripper_closed_value[g]
    if prof.gripper_closed_low[g]:
        closing = (a - closed) / r < T["close_zone"]
        gap = (s - a) / r
    else:
        closing = (closed - a) / r < T["close_zone"]
        gap = (a - s) / r
    settle = _frames(T["close_settle_s"], sig.fps)
    out = []
    for st, en in runs(closing, settle + 2):
        if st == 0 or en == len(a):
            continue    # gripper already closed at the start, or the rest close at the end
        g_after = float(np.median(gap[st + settle:en]))
        kind = "empty" if g_after < T["empty_gap"] else "holding" if g_after >= T["holding_gap"] else "ambiguous"
        out.append({"start": st, "end": en, "gap": g_after, "kind": kind})
    return out


def check_missed_grasp(sig: EpisodeSignals, prof: RobotProfile) -> list[Event]:
    """T2. Weave's published metric: 2 or more consecutive missed grasps.

    A single empty close followed by a holding close is a recovered miss (the robot
    cleared it itself). Two or more empties in a row with no hold between them is a
    missed grasp sequence.
    """
    out = []
    for g in sig.gripper_idx:
        if not prof.gripper_active.get(g):
            continue
        att = grasp_attempts(sig, prof, g)
        i = 0
        while i < len(att):
            if att[i]["kind"] != "empty":
                i += 1
                continue
            k = i
            while k + 1 < len(att) and att[k + 1]["kind"] == "empty":
                k += 1
            n_empty = k - i + 1
            recovered = k + 1 < len(att) and att[k + 1]["kind"] == "holding"
            check = "task.missed_grasp_sequence" if n_empty >= 2 else "task.missed_grasp"
            out.append(Event(check, "task", sig.names[g], att[i]["start"], att[k]["end"], sig.fps,
                             "medium", {"empty_closes": n_empty, "recovered": recovered,
                                        "gaps": [round(x["gap"], 3) for x in att[i:k + 1]]}))
            i = k + 1
    return out


def run_parquet_checks(sig: EpisodeSignals, prof: RobotProfile, action, state, frame_index) -> list[Event]:
    ev = check_integrity(action, state, frame_index, sig.fps)
    if any(e.check == "integrity.nan" for e in ev):
        return ev
    ev += check_stale_state(sig, prof)
    ev += check_not_following(sig)
    ev += check_rest_offset(sig)
    ev += check_bus_glitch(sig)
    ev += check_pinned(sig, prof)
    ev += check_stall(sig)
    ev += check_missed_grasp(sig, prof)
    return ev


__all__ = ["THRESHOLDS", "Event", "RobotProfile", "EpisodeSignals", "build_profile", "episode_signals",
           "image_energy", "chain_motion", "check_camera_lag", "check_stale_camera",
           "check_video_integrity", "run_parquet_checks", "grasp_attempts"]
