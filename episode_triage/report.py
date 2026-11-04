"""Plain names for checks, shared by the site builder and the README generator."""

from __future__ import annotations

PLAIN = {
    "sensing.stale_camera.wrist camera": "wrist camera froze while the arm moved",
    "sensing.stale_camera.fixed camera": "scene camera froze while the arm moved",
    "sensing.stale_state.joint_stream": "joint stream repeated while commanded to move",
    "actuation.not_following": "joint stopped following its command",
    "actuation.rest_offset": "follower sits offset from its leader at rest",
    "actuation.gain_mismatch": "follower and leader calibrated over different spans",
    "actuation.not_tracking": "follower doesn't track its leader on a joint",
    "actuation.bus_glitch": "impossible one frame jumps on a motor",
    "actuation.pinned": "joint pinned at its limit while pushed further",
    "actuation.command_wrap": "leader reading wrapped past its end",
    "task.stall": "stopped making progress for 2 s or more",
    "task.missed_grasp_sequence": "2 or more missed grasps in a row",
    "task.missed_grasp": "single missed grasp",
    "integrity.short": "episode under 2 s",
    "integrity.frame_index": "frame index has gaps",
    "integrity.frame_count": "video and joint row counts disagree",
    "integrity.decode_error": "video failed to decode",
}


def plain(fp: str) -> str:
    if fp in PLAIN:
        return PLAIN[fp]
    for k, v in PLAIN.items():
        if fp.startswith(k + "."):
            part = fp[len(k) + 1:]
            return f"{v} ({part.replace('_', ' ')})"
    return fp


def _splice(text: str, name: str, body: str) -> str:
    a, b = f"<!-- {name}:start -->", f"<!-- {name}:end -->"
    i, j = text.index(a) + len(a), text.index(b)
    return text[:i] + "\n" + body.strip() + "\n" + text[j:]
