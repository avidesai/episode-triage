"""Checks on small hand built trajectories with a known answer."""

import numpy as np
import pytest

from episode_triage.checks import (THRESHOLDS, build_profile, check_bus_glitch, check_command_wrap, check_missed_grasp,
                                   check_not_following, check_rest_offset, check_stale_camera,
                                   check_stale_state, check_stall, episode_signals)
from episode_triage.inject import inject_glitches, inject_offset, inject_stale_state, inject_stall
from episode_triage.signals import shift

FPS = 30.0
NAMES = ["shoulder_pan", "shoulder_lift", "elbow_flex", "wrist_flex", "wrist_roll", "gripper"]
GRIP = [5]


def trajectory(seconds=20, seed=0, pause=None):
    """Smooth leader motion with rest periods, a follower trailing it by 3 frames, and the
    gripper parked open. Rest periods stop the motion's clock, so nothing ever jumps."""
    n = int(seconds * FPS)
    rng = np.random.default_rng(seed)
    moving = np.ones(n, bool)
    for k in range(1, int(seconds // 5)):           # every 5 s the leader holds still for 1.5 s
        moving[int(5 * k * FPS):int((5 * k + 1.5) * FPS)] = False
    if pause:
        moving[int(pause[0] * FPS):int(pause[1] * FPS)] = False
    phase = np.cumsum(moving) / FPS
    a = np.zeros((n, 6))
    for j in range(5):
        a[:, j] = 40 * np.sin(1.2 * phase + j) + 5 * rng.normal(0, 0.01, n)
    a[:, 5] = 40
    s = np.stack([shift(a[:, j], 3) for j in range(6)], 1)
    return a, s


def add_closes(a, s, kinds, every_s=3.0, start_s=2.0):
    for i, kind in enumerate(kinds):
        lo = int((start_s + i * every_s) * FPS)
        hi = lo + int(1.0 * FPS)
        a[lo:hi, 5] = 0
        s[lo + 3:hi + 3, 5] = 0.5 if kind == "empty" else 12
    return a, s


def run(check, a, s, *extra):
    prof = build_profile(a, s, GRIP)
    sig = episode_signals(a, s, FPS, NAMES, GRIP, prof)
    return check(sig, *extra) if not extra else check(sig, prof)


def sig_prof(a, s, prof_from=None):
    pa, ps = prof_from if prof_from else (a, s)
    prof = build_profile(pa, ps, GRIP)
    return episode_signals(a, s, FPS, NAMES, GRIP, prof), prof


def test_clean_trajectory_has_no_actuation_events():
    a, s = trajectory()
    sig, prof = sig_prof(a, s)
    assert check_not_following(sig) == []
    assert check_rest_offset(sig) == []
    assert check_bus_glitch(sig) == []


def test_profile_learns_follower_lag():
    a, s = trajectory()
    prof = build_profile(a, s, GRIP)
    assert prof.lag[:5].tolist() == [3, 3, 3, 3, 3]


def test_injected_stall_is_found_with_onset():
    a, s = trajectory()
    s2 = inject_stall(s, 2, start=int(8.0 * FPS), n=int(1.5 * FPS))
    sig, _ = sig_prof(a, s2, prof_from=(a, s))
    ev = check_not_following(sig)
    assert len(ev) == 1 and ev[0].component == "elbow_flex"
    assert ev[0].evidence["mode"] in ("stalled", "lagging")
    assert abs(ev[0].onset - 8.0) < 0.5


def test_injected_offset_is_rest_offset_not_tracking_loss():
    a, s = trajectory()
    rng = build_profile(a, s, GRIP).ranges
    s2 = inject_offset(s, 1, 0.08 * rng[1])
    sig, _ = sig_prof(a, s2, prof_from=(a, s))
    off = check_rest_offset(sig)
    assert [e.component for e in off] == ["shoulder_lift"]
    assert off[0].evidence["offset"] == pytest.approx(-0.08, abs=0.01)
    assert check_not_following(sig) == []   # the resting offset is removed before A1 looks


def test_glitches_on_one_motor():
    a, s = trajectory()
    rng = build_profile(a, s, GRIP).ranges
    s2 = inject_glitches(s, 3, [100, 250, 400], 0.4 * rng[3])
    sig, _ = sig_prof(a, s2, prof_from=(a, s))
    ev = check_bus_glitch(sig)
    assert len(ev) == 3 and {e.component for e in ev} == {"follower.wrist_flex"}


def test_stale_state_needs_command_motion():
    a, s = trajectory()
    s2 = inject_stale_state(s, int(3.0 * FPS), 6)
    sig, prof = sig_prof(a, s2, prof_from=(a, s))
    ev = [e for e in check_stale_state(sig, prof) if e.check == "sensing.stale_state"]
    assert len(ev) == 1 and abs(ev[0].onset - 3.0) < 0.1
    # rest periods repeat rows exactly too, and that must never fire
    sig0, prof0 = sig_prof(a, s)
    assert check_stale_state(sig0, prof0) == []


def test_stall_found_and_edges_ignored():
    a, s = trajectory(seconds=20, pause=(9.0, 12.0))
    sig, _ = sig_prof(a, s)
    ev = check_stall(sig)
    assert len(ev) == 1 and 8.9 < ev[0].onset < 9.4 and ev[0].duration >= 2.0


def test_missed_grasp_sequence_and_recovered_miss():
    a, s = trajectory()
    a, s = add_closes(a, s, ["empty", "empty", "holding", "empty", "holding"])
    sig, prof = sig_prof(a, s)
    ev = check_missed_grasp(sig, prof)
    kinds = [(e.check, e.evidence["empty_closes"], e.evidence["recovered"]) for e in ev]
    assert kinds == [("task.missed_grasp_sequence", 2, True), ("task.missed_grasp", 1, True)]


def test_stale_camera_needs_motion_and_low_change():
    n = 300
    rng = np.random.default_rng(0)
    m = np.full(n, 0.05)
    m[:50] = 0.0
    e = rng.uniform(1.0, 3.0, n)
    e[0] = np.nan
    e[10:20] = 0.0          # still picture while still arm: fine
    e[100:106] = 0.0        # still picture while the arm moves: stale
    other = rng.uniform(1.0, 3.0, n)
    ev = check_stale_camera("observation.images.wrist", e, m, FPS, [other])
    assert [(x.start, x.end) for x in ev] == [(100, 106)]
    assert ev[0].confidence == "high"


def test_thresholds_are_fractions():
    for k in ("follow_err", "offset_err", "glitch_jump", "empty_gap", "holding_gap"):
        assert 0 < THRESHOLDS[k] < 1


def test_command_wrap_is_not_a_glitch_and_explains_the_tracking_loss():
    from episode_triage.ladder import Coverage, triage
    a, s = trajectory()
    rng = build_profile(a, s, GRIP).ranges
    t = int(8.0 * FPS)
    a2 = a.copy()
    a2[t:, 4] -= 0.9 * rng[4]                       # leader wraps and stays wrapped
    s2 = np.stack([shift(a2[:, j], 3) for j in range(6)], 1)
    s2[t + 3:t + 33, 4] = np.linspace(s[t + 3, 4], s2[t + 33, 4], 30)   # follower travels the long way
    sig, prof = sig_prof(a2, s2, prof_from=(a, s))
    assert check_bus_glitch(sig) == []
    wraps = check_command_wrap(sig)
    assert [(w.component, w.start) for w in wraps] == [("wrist_roll", t)]
    events = wraps + check_not_following(sig)
    inc = triage(events, Coverage(cameras_checked=["x"]))
    assert inc and inc[0].cause.check == "actuation.command_wrap" and inc[0].rung == 2
