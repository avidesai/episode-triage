"""Software fault injection into real episodes, with a known answer.

This tests the detectors and the ladder against ground truth. It doesn't test whether
injected faults look like natural ones; the bench set recorded on a physical arm
(recorder/) covers that.

Video faults are injected into decoded full resolution frames and then re-encoded with
LeRobot's own default settings (libsvtav1, crf 30, GOP 2, yuv420p), so a frozen frame
reaches the detector through the same lossy compression a real one would. The clean
copy of each episode goes through the identical re-encode, so false alarms are measured
on equal footing.
"""

from __future__ import annotations

import io
import os
from dataclasses import dataclass

import av
import numpy as np

from .video import H, W, _open

os.environ.setdefault("SVT_LOG", "1")   # errors only; the encoder banner is noise here
LEROBOT_ENCODER = {"codec": "libsvtav1", "pix_fmt": "yuv420p", "options": {"crf": "30", "g": "2"}}


def decode_rgb(path: str, from_ts: float, to_ts: float, fps: float, max_side: int = 640) -> np.ndarray:
    half = 0.5 / fps
    out = []
    with _open(path) as c:
        s = c.streams.video[0]
        s.thread_type = "AUTO"
        tb = s.time_base
        if from_ts > 0:
            c.seek(int(max(from_ts - 1.0, 0) / tb), stream=s, backward=True)
        for fr in c.decode(s):
            t = float(fr.pts * tb)
            if t < from_ts - half:
                continue
            if t >= to_ts - half:
                break
            w, h = fr.width, fr.height
            if max(w, h) > max_side:
                k = max_side / max(w, h)
                w, h = int(w * k) // 2 * 2, int(h * k) // 2 * 2
            out.append(fr.to_ndarray(format="rgb24", width=w, height=h))
    return np.stack(out)


def reencode_gray(frames: np.ndarray, fps: float) -> np.ndarray:
    """Encode RGB frames exactly as LeRobot would, decode back to 80x60 gray."""
    buf = io.BytesIO()
    with av.open(buf, mode="w", format="mp4") as out:
        st = out.add_stream(LEROBOT_ENCODER["codec"], rate=int(round(fps)),
                            options=LEROBOT_ENCODER["options"])
        st.width, st.height = frames.shape[2], frames.shape[1]
        st.pix_fmt = LEROBOT_ENCODER["pix_fmt"]
        for f in frames:
            for pkt in st.encode(av.VideoFrame.from_ndarray(f, format="rgb24")):
                out.mux(pkt)
        for pkt in st.encode():
            out.mux(pkt)
    buf.seek(0)
    gray = []
    with av.open(buf) as c:
        for fr in c.decode(c.streams.video[0]):
            gray.append(fr.reformat(width=W, height=H, format="gray", interpolation="AREA").to_ndarray())
    return np.stack(gray)


def freeze_frames(frames: np.ndarray, start: int, n: int) -> np.ndarray:
    """What read_latest returns when the capture thread stalls: the last frame, repeated."""
    out = frames.copy()
    out[start:start + n] = frames[start - 1]
    return out


def delay_frames(frames: np.ndarray, d: int) -> np.ndarray:
    """Serve the frame from d ticks ago for the whole episode."""
    return np.concatenate([np.repeat(frames[:1], d, axis=0), frames[:-d]], axis=0)


# ---------------------------------------------------------------- joint faults

@dataclass
class JointFault:
    kind: str           # stall | offset | glitch | stale_state
    joint: int
    start: int
    end: int
    expect_check: str
    expect_rung: int


def inject_stall(state: np.ndarray, j: int, start: int, n: int, catch_up: int = 5) -> np.ndarray:
    """The follower joint stops where it is for n frames, then catches back up to where
    it would have been, the way an overloaded servo resumes after unloading."""
    s = state.copy()
    s[start:start + n, j] = state[start, j]
    end = min(start + n + catch_up, len(s))
    if end > start + n:
        w = np.linspace(0, 1, end - (start + n) + 1)[1:]
        s[start + n:end, j] = (1 - w) * state[start, j] + w * state[start + n:end, j]
    return s


def inject_offset(state: np.ndarray, j: int, amount: float) -> np.ndarray:
    """A reseated horn: the follower sits a fixed amount away from its leader everywhere."""
    s = state.copy()
    s[:, j] += amount
    return s


def inject_glitches(state: np.ndarray, j: int, at: list[int], amount: float) -> np.ndarray:
    """Single frame corrupt reads, each one followed by a good read."""
    s = state.copy()
    for t in at:
        s[t, j] += amount
    return s


def inject_stale_state(state: np.ndarray, start: int, n: int) -> np.ndarray:
    """Every joint reads the same cached value for n frames."""
    s = state.copy()
    s[start:start + n] = state[start - 1]
    return s
