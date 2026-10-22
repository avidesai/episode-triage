"""Signal helpers shared by the checks.

Units differ across robots: SO arms record normalized ranges or degrees, ALOHA records
radians. Every positional threshold in this package is therefore a fraction of a
joint's range, where the range comes from the whole robot's data.
"""

from __future__ import annotations

import numpy as np

# A joint that barely moves in a robot's data is judged on the scale of the arm,
# so encoder noise on an idle joint (often wrist_roll) can never fire a check.
RANGE_FLOOR_FRAC = 0.10


def joint_ranges(action: np.ndarray, gripper_idx: list[int] | None = None) -> np.ndarray:
    """1st to 99th percentile of each joint's command over all of a robot's frames."""
    lo, hi = np.nanpercentile(action, [1, 99], axis=0)
    r = hi - lo
    arm = [i for i in range(action.shape[1]) if i not in (gripper_idx or [])]
    scale = np.nanmedian(r[arm]) if arm else np.nanmedian(r)
    floor = RANGE_FLOOR_FRAC * scale if np.isfinite(scale) and scale > 0 else 1.0
    return np.maximum(r, floor)


def speed(x: np.ndarray) -> np.ndarray:
    """Absolute per frame change, same length as x (first row repeats the second)."""
    d = np.abs(np.diff(x, axis=0))
    return np.concatenate([d[:1], d], axis=0) if len(d) else np.zeros_like(x)


def rolling_max(x: np.ndarray, w: int) -> np.ndarray:
    """Centered rolling max along axis 0. Used to say "still" only when a whole
    neighbourhood is still, so one noisy encoder tick doesn't break a rest segment."""
    if w <= 1 or len(x) == 0:
        return x
    pad = w // 2
    xp = np.pad(x, [(pad, w - 1 - pad)] + [(0, 0)] * (x.ndim - 1), mode="edge")
    win = np.lib.stride_tricks.sliding_window_view(xp, w, axis=0)
    return win.max(axis=-1)


def runs(mask: np.ndarray, min_len: int = 1) -> list[tuple[int, int]]:
    """[start, end) index pairs of True runs at least min_len long."""
    m = np.concatenate([[False], np.asarray(mask, bool), [False]])
    edges = np.flatnonzero(m[1:] != m[:-1])
    return [(int(a), int(b)) for a, b in zip(edges[::2], edges[1::2]) if b - a >= min_len]


def shift(x: np.ndarray, d: int) -> np.ndarray:
    """x delayed by d frames (x[t - d]), edge padded."""
    if d == 0:
        return x
    if d > 0:
        return np.concatenate([np.repeat(x[:1], d, axis=0), x[:-d]], axis=0)
    return np.concatenate([x[-d:], np.repeat(x[-1:], -d, axis=0)], axis=0)


def follow_lag(action_n: np.ndarray, state_n: np.ndarray, max_lag: int = 10) -> np.ndarray:
    """Per joint delay (frames) between command and measured position.

    The follower always trails the leader by a few frames of servo response. Comparing
    action[t] to state[t] directly would read that normal lag as tracking error, so each
    joint's error is measured against the command from d frames earlier, where d is the
    delay that minimizes median error on moving frames.
    """
    J = action_n.shape[1]
    out = np.zeros(J, dtype=int)
    moving = speed(action_n) > 0.01
    for j in range(J):
        m = moving[:, j]
        if m.sum() < 30:
            continue
        errs = [np.median(np.abs(shift(action_n[:, j], d) - state_n[:, j])[m]) for d in range(max_lag + 1)]
        out[j] = int(np.argmin(errs))
    return out


def image_energy(frames: np.ndarray) -> np.ndarray:
    """Mean absolute gray level change between consecutive frames. E[0] is NaN."""
    if len(frames) < 2:
        return np.full(len(frames), np.nan)
    f = frames.astype(np.int16)
    e = np.abs(f[1:] - f[:-1]).mean(axis=(1, 2))
    return np.concatenate([[np.nan], e])


def xcorr_lag(e: np.ndarray, m: np.ndarray, valid: np.ndarray, max_lag: int = 8):
    """Delay k (frames) maximizing corr(log E[t], log M[t - k]) over valid frames.

    If the camera shows the world k frames late, image change follows joint motion by k.
    Both series are log compressed first: image change grows faster than linearly with
    speed and has long tails, and the log keeps a few large frames from deciding the peak.

    Returns (lag, peak correlation, sharpness), where sharpness is the peak minus the mean
    correlation at lags 3 or more away from it. Returns (None, nan, nan) when there is
    too little motion, or when the peak sits on the edge of the search window, which
    means the true answer is outside it or there isn't one.
    """
    le = np.log1p(np.nan_to_num(e))
    lm = np.log1p(100 * m)
    corr = {}
    for k in range(-max_lag, max_lag + 1):
        v = valid & shift(valid, k) & np.isfinite(e)
        if v.sum() < 60:
            continue
        a, b = le[v], shift(lm, k)[v]
        if a.std() < 1e-9 or b.std() < 1e-9:
            continue
        corr[k] = float(np.corrcoef(a, b)[0, 1])
    if len(corr) < 2 * max_lag + 1:
        return None, float("nan"), float("nan")
    best = max(corr, key=corr.get)
    if abs(best) == max_lag:
        return None, corr[best], float("nan")
    far = [c for k, c in corr.items() if abs(k - best) >= 3]
    return best, corr[best], corr[best] - float(np.mean(far))
