"""Decode one episode's slice of a LeRobot MP4 to small grayscale frames.

Frames come back as 80x60 grayscale with area averaging. Averaging 8x8 blocks of a
640x480 frame cuts most AV1 compression noise and keeps everything needed to tell
whether the picture changed.
"""

from __future__ import annotations

import time

import av
import numpy as np

W, H = 80, 60
USER_AGENT = "episode_triage/0.1 (+https://github.com/avidesai/episode_triage)"


class VideoError(RuntimeError):
    pass


def _open(path: str, retries: int = 4):
    opts = {"user_agent": USER_AGENT} if path.startswith("http") else {}
    for attempt in range(retries + 1):
        try:
            return av.open(path, options=opts, timeout=60)
        except av.error.HTTPTooManyRequestsError:
            if attempt == retries:
                raise
            time.sleep(30 * (attempt + 1))
    raise AssertionError("unreachable")


def decode_gray(path: str | None, from_ts: float, to_ts: float, fps: float,
                with_pts: bool = False):
    """Frames whose presentation time falls in [from_ts, to_ts).

    v3.0 datasets pack many episodes into one MP4, so this seeks to the episode start.
    LeRobot encodes with a GOP of 2, so the seek lands at most one frame early.
    """
    if path is None:
        raise VideoError("no video file for this episode")
    half = 0.5 / fps
    out, pts = [], []
    try:
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
                out.append(fr.reformat(width=W, height=H, format="gray",
                                       interpolation="AREA").to_ndarray())
                pts.append(t)
    except av.error.FFmpegError as e:
        raise VideoError(str(e)) from e
    frames = np.stack(out) if out else np.zeros((0, H, W), np.uint8)
    if with_pts:
        return frames, np.asarray(pts)
    return frames
