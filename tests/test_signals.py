import numpy as np

from episode_triage.signals import (follow_lag, image_energy, joint_ranges, rolling_max, runs, shift,
                                    xcorr_lag)


def test_runs_finds_min_length_runs():
    m = np.array([0, 1, 1, 0, 1, 1, 1, 0, 1], bool)
    assert runs(m, 1) == [(1, 3), (4, 7), (8, 9)]
    assert runs(m, 3) == [(4, 7)]


def test_shift_delays_and_pads():
    x = np.arange(5)
    assert shift(x, 2).tolist() == [0, 0, 0, 1, 2]
    assert shift(x, -2).tolist() == [2, 3, 4, 4, 4]
    assert shift(x, 0).tolist() == x.tolist()


def test_rolling_max_is_centered():
    x = np.array([0, 0, 5, 0, 0, 0], float)
    assert rolling_max(x, 3).tolist() == [0, 5, 5, 5, 0, 0]


def test_joint_ranges_floor_protects_idle_joint():
    rng = np.random.default_rng(0)
    a = np.stack([rng.uniform(-50, 50, 1000), rng.uniform(-50, 50, 1000), rng.normal(0, 0.01, 1000)], 1)
    r = joint_ranges(a)
    assert r[0] > 90 and r[1] > 90
    # the idle joint is judged on a tenth of the arm's scale, never on its own noise
    assert r[2] > 5


def test_follow_lag_recovers_known_delay():
    t = np.linspace(0, 20, 600)
    a = np.stack([np.sin(t), np.cos(0.7 * t)], 1)
    s = np.stack([shift(a[:, 0], 4), shift(a[:, 1], 2)], 1)
    assert follow_lag(a, s).tolist() == [4, 2]


def test_image_energy_zero_for_repeated_frame():
    f = np.zeros((3, 60, 80), np.uint8)
    f[1] = 10
    f[2] = 10
    e = image_energy(f)
    assert np.isnan(e[0]) and e[1] == 10 and e[2] == 0


def test_xcorr_lag_finds_camera_delay():
    rng = np.random.default_rng(1)
    m = np.abs(np.convolve(rng.normal(0, 1, 900), np.ones(9) / 9, mode="same")) * 0.05
    e = 20 * shift(m, 3) + rng.normal(0, 0.01, 900).clip(0)
    lag, corr, sharp = xcorr_lag(e, m, np.ones(900, bool))
    assert lag == 3 and corr > 0.9 and sharp > 0.1


def test_xcorr_lag_refuses_edge_peak():
    rng = np.random.default_rng(2)
    m = np.abs(np.convolve(rng.normal(0, 1, 900), np.ones(9) / 9, mode="same")) * 0.05
    e = 20 * shift(m, 12)
    lag, _, _ = xcorr_lag(e, m, np.ones(900, bool), max_lag=8)
    assert lag is None
