"""What started it: order events on one clock and separate cause from context.

Anchors are the events that would have called a person on a deployed robot: a stall,
a missed grasp sequence, or a joint that stopped following its command. For each
anchor we look back a few seconds. Sensing or actuation events that began before the
anchor are candidate causes, and the earliest one is the primary cause. Anything that
began after the anchor is context: it was active, but it can't explain what happened.

Causes also have to be physically able to cause the anchor. A frozen camera can make a
policy stall or miss a grasp, but it can't make a follower joint stop tracking its
command, since that loop never looks at the camera. So a joint that stopped following
can only be explained by another actuation event.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from .checks import Event

LOOKBACK_S = 3.0
# A stale run needs 3 frames to exist and a stall needs 2 s, so a stall's detected onset
# can trail the camera fault that caused it. Without slack, true causes become context.
ONSET_SLACK_S = 0.2
TIE_S = 0.2

ANCHORS = {"task.stall", "task.missed_grasp_sequence", "actuation.not_following"}
# Conditions that hold for a whole episode. They're reported on their own and never
# picked as the thing that started one particular failure.
STANDING = {"sensing.camera_lag", "actuation.rest_offset", "sensing.duplicated_rows"}
INTEGRITY_PREFIX = "integrity."


@dataclass
class Explained:
    anchor: Event
    primary: Event | None
    candidates: list[Event] = field(default_factory=list)
    context: list[Event] = field(default_factory=list)
    tie: bool = False


def explain(events: list[Event]) -> tuple[list[Explained], list[Event]]:
    """Returns (anchors with their causes, events not used by any anchor)."""
    anchors = sorted((e for e in events if e.check in ANCHORS), key=lambda e: e.onset)
    causal = [e for e in events if e.layer in ("sensing", "actuation")
              and e.check not in STANDING and not e.check.startswith(INTEGRITY_PREFIX)]
    used: set[int] = set()
    owner: dict[int, Explained] = {}   # event id -> the incident it already belongs to
    out = []
    for a in anchors:
        if id(a) in used:
            continue    # already picked as an earlier anchor's cause
        cands = [e for e in causal if e is not a and _can_cause(e, a)
                 and a.onset - LOOKBACK_S <= e.onset <= a.onset + ONSET_SLACK_S
                 and e.t_end >= a.onset - LOOKBACK_S]
        cands.sort(key=lambda e: e.onset)
        primary = cands[0] if cands else None
        if primary is not None and id(primary) in owner:
            # A stall that began with a joint already flagged as not following, or with the
            # same camera fault, is the same incident. It joins that one as context instead
            # of being counted twice.
            owner[id(primary)].context.append(a)
            used.add(id(a))
            continue
        ctx = [e for e in causal if e is not a and id(e) not in used
               and a.onset + ONSET_SLACK_S < e.onset <= a.t_end]
        tie = bool(primary and any(c.layer != primary.layer and c.onset - primary.onset <= TIE_S
                                   for c in cands[1:]))
        x = Explained(a, primary, cands, ctx, tie)
        out.append(x)
        for e in [a, *cands]:
            owner[id(e)] = x
        used.add(id(a))
        used.update(id(c) for c in cands)
        used.update(id(c) for c in ctx)
    rest = [e for e in events if id(e) not in used]
    return out, rest


def _can_cause(e: Event, anchor: Event) -> bool:
    if anchor.layer == "actuation":
        return e.layer == "actuation"
    return True
