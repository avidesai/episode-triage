"""The ladder. Ordered rules, first match wins, rule 0 first so nothing is ever guessed.

Rungs:
  0  clean
  1  the robot could clear it itself (restart a stream, re-home, retry)
  2  ticket for a named part (camera, USB link, joint, bus, calibration, recorder)
  3  training: a task failure with healthy inputs and tracking
  4  a person has to look, and the route says why

Route text is written from event fields by code, never free text, so the same situation
always reads the same way.
"""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass, field

from .checks import THRESHOLDS, Event
from .timeline import INTEGRITY_PREFIX, STANDING, Explained, explain

RUNG_NAMES = {
    0: "clean",
    1: "robot can clear it",
    2: "ticket for a named part",
    3: "send to training",
    4: "a person has to look",
}
RECOVER_S = THRESHOLDS["follow_recover_s"]
STALE_RECUR = 3


@dataclass
class Incident:
    rule: str
    rung: int
    route: str
    cause: Event | None
    anchor: Event | None = None
    context: list[Event] = field(default_factory=list)
    self_recovery: str | None = None
    related: list[Event] = field(default_factory=list)   # other candidates and repeats folded in

    def involves(self, e: Event) -> bool:
        return e is self.cause or e is self.anchor or any(e is x for x in self.context + self.related)

    @property
    def fingerprint(self) -> str:
        e = self.cause or self.anchor
        return e.fingerprint if e else "unknown"

    @property
    def layer(self) -> str:
        e = self.cause or self.anchor
        return e.layer if e else "unknown"

    @property
    def onset(self) -> float:
        e = self.anchor or self.cause
        return e.onset if e else 0.0

    def to_dict(self) -> dict:
        return {
            "rule": self.rule, "rung": self.rung, "rung_name": RUNG_NAMES[self.rung],
            "route": self.route, "self_recovery": self.self_recovery,
            "fingerprint": self.fingerprint, "layer": self.layer, "onset": round(self.onset, 3),
            "cause": self.cause.to_dict() if self.cause else None,
            "anchor": self.anchor.to_dict() if self.anchor else None,
            "context": [c.fingerprint for c in self.context],
        }


@dataclass
class Coverage:
    """Which layers were actually checked for this episode. Rule 0 reads this."""

    joints: bool = True
    cameras_checked: list[str] = field(default_factory=list)
    cameras_missing: list[str] = field(default_factory=list)

    @property
    def sensing_complete(self) -> bool:
        return bool(self.cameras_checked) and not self.cameras_missing


def _t(e: Event) -> str:
    return f"at {e.onset:.1f} s"


def _cause_rule(e: Event, all_events: list[Event]) -> tuple[str, int, str, str | None]:
    """(rule, rung, route, self recovery) for a sensing or actuation event that started something."""
    if e.check in ("sensing.stale_camera", "sensing.stale_state"):
        what = f"camera {short(e.component)}" if e.check == "sensing.stale_camera" else "joint state stream"
        same = [x for x in all_events if x.check == e.check and x.component == e.component]
        if e.duration <= RECOVER_S and len(same) < STALE_RECUR:
            return ("R1", 1, f"{what} froze for {e.duration * 1000:.0f} ms {_t(e)} and came back",
                    "restart the stream, hold, and retry the step")
        why = f"{len(same)} times this episode" if len(same) >= STALE_RECUR else f"for {e.duration:.1f} s"
        return ("R1b", 2, f"camera or USB link: {what} froze {why}", None)
    if e.check == "actuation.not_following":
        mode = e.evidence.get("mode")
        if mode == "held":
            return ("R5", 4, f"{e.component} held {e.evidence['peak_err'] * 100:.0f}% of range off its command "
                             f"{_t(e)} with nothing moving: contact with the world or a dead joint, "
                             f"and position alone can't tell which", None)
        if e.duration < RECOVER_S:
            return ("R2r", 1, f"{e.component} stopped following ({mode}) for {e.duration:.1f} s {_t(e)} "
                              f"and caught up", "reenable torque and rehome the joint")
        return ("R2", 2, f"joint {e.component}: not following its command ({mode}) for {e.duration:.1f} s "
                         f"{_t(e)}, peak gap {e.evidence['peak_err'] * 100:.0f}% of range", None)
    if e.check == "actuation.pinned":
        return ("R2", 2, f"joint {e.component}: pinned at its {e.evidence['limit']} for {e.duration:.1f} s "
                         f"{_t(e)} while commanded further; joint limit or calibration range", None)
    if e.check == "actuation.command_wrap":
        return ("R2", 2, f"recalibrate {e.component}: the leader's reading wrapped past its end {_t(e)} "
                         f"(a jump of {abs(e.evidence['jump']) * 100:.0f}% of range in one frame), so the follower "
                         f"was sent the long way round", None)
    if e.check == "actuation.bus_glitch":
        n = sum(1 for x in all_events if x.check == e.check and x.component == e.component)
        if n >= THRESHOLDS["glitch_ticket_count"]:
            return ("R3", 2, f"bus or harness: {n} impossible one frame jumps on {e.component}", None)
        return ("R6", 1, f"one impossible one frame jump on {e.component} {_t(e)}", "none needed, the next read was fine")
    return ("R5", 4, f"{e.check} on {e.component} {_t(e)}: no rule for this cause", None)


def short(cam: str) -> str:
    return cam.split(".")[-1]


def triage(events: list[Event], cov: Coverage) -> list[Incident]:
    # A low confidence frozen camera (one that barely sees the arm move) stays in the events
    # as evidence but never starts an incident, causes a stall, or counts toward a ticket.
    events = [e for e in events if not (e.check == "sensing.stale_camera" and e.confidence == "low")]
    integrity = [e for e in events if e.check.startswith(INTEGRITY_PREFIX)]
    # R0: the episode itself can't be trusted. One line saying what's missing, no category.
    fatal = [e for e in integrity if e.component in ("joint_stream", "episode")]
    if fatal:
        e = fatal[0]
        return [Incident("R0", 4, f"data unavailable: {e.check.split('.')[-1]} ({_ev(e)})", e)]
    incidents = []
    for e in integrity:
        incidents.append(Incident("R0", 4, f"data unavailable: camera {short(e.component)} "
                                          f"{e.check.split('.')[-1]} ({_ev(e)})", e))

    explained, rest = explain([e for e in events if e not in integrity])
    by_cause: dict[tuple[str, str], Incident] = {}
    for x in explained:
        inc = _anchor_incident(x, events, cov)
        incidents.append(inc)
        if inc.cause is not None:
            by_cause.setdefault((inc.cause.check, inc.cause.component), inc)
    # Repeats of a fault that already explains an anchor belong to that incident; they are
    # the same camera or the same motor, and counting them again would double the ticket.
    keep = []
    for e in rest:
        owner = by_cause.get((e.check, e.component))
        if owner is not None and e.check in ("sensing.stale_camera", "sensing.stale_state", "actuation.bus_glitch"):
            owner.related.append(e)
        else:
            keep.append(e)
    rest = keep

    stale_done: set[tuple[str, str]] = set()
    glitch_done: set[str] = set()
    for e in rest:
        if e.check in ("sensing.stale_camera", "sensing.stale_state"):
            key = (e.check, e.component)
            same = [x for x in rest if (x.check, x.component) == key]
            if len(same) >= STALE_RECUR:
                if key in stale_done:
                    continue
                stale_done.add(key)
            rule, rung, route, fix = _cause_rule(e, events)
            incidents.append(Incident(rule, rung, route, e, self_recovery=fix,
                                      related=[x for x in same if x is not e] if len(same) >= STALE_RECUR else []))
        elif e.check == "actuation.bus_glitch":
            if e.component in glitch_done:
                continue
            n = sum(1 for x in rest if x.check == e.check and x.component == e.component)
            same = [x for x in rest if x.check == e.check and x.component == e.component]
            if n >= THRESHOLDS["glitch_ticket_count"]:
                glitch_done.add(e.component)
            rule, rung, route, fix = _cause_rule(e, events)
            incidents.append(Incident(rule, rung, route, e, self_recovery=fix,
                                      related=[x for x in same if x is not e] if n >= THRESHOLDS["glitch_ticket_count"] else []))
        elif e.check in ("actuation.pinned", "actuation.command_wrap"):
            rule, rung, route, fix = _cause_rule(e, events)
            incidents.append(Incident(rule, rung, route, e))
        elif e.check == "actuation.rest_offset":
            incidents.append(Incident("R2", 2, f"recalibrate {e.component}: follower sits "
                                               f"{e.evidence['offset'] * 100:+.0f}% of range from its leader in "
                                               f"{e.evidence['rest_segments']} rest periods", e))
        elif e.check == "actuation.gain_mismatch":
            incidents.append(Incident("R2", 2, f"recalibrate {e.component}: follower moves "
                                               f"{e.evidence['gain']:.2f} times as far as its leader across "
                                               f"the range", e))
        elif e.check == "actuation.not_tracking":
            incidents.append(Incident("R2", 2, f"joint {e.component}: follower doesn't track its leader "
                                               f"anywhere in this robot's data (correlation "
                                               f"{e.evidence['corr']:.2f})", e))
        elif e.check == "sensing.camera_lag":
            incidents.append(Incident("R1b", 2, f"camera {short(e.component)} runs {e.evidence['lag_frames']} frames "
                                                f"({e.evidence['lag_ms']:.0f} ms) behind the joints", e))
        elif e.check == "sensing.duplicated_rows":
            incidents.append(Incident("R1b", 2, f"recorder: {e.evidence['share'] * 100:.0f}% of joint rows repeat "
                                                f"exactly; the stream was resampled or duplicated", e))
        elif e.check == "task.missed_grasp":
            ok = e.evidence.get("recovered")
            incidents.append(Incident("R6", 1, f"one empty close on {e.component} {_t(e)}"
                                               + (", then a good grasp" if ok else ""), None, anchor=e,
                                      self_recovery="retry already worked" if ok else "retry the grasp"))
    return sorted(incidents, key=lambda i: i.onset)


def _anchor_incident(x: Explained, events: list[Event], cov: Coverage) -> Incident:
    inc = _anchor_rule(x, events, cov)
    inc.related = [c for c in x.candidates if c is not inc.cause]
    return inc


def _anchor_rule(x: Explained, events: list[Event], cov: Coverage) -> Incident:
    a = x.anchor
    if x.tie:
        names = " and ".join(sorted({c.fingerprint for c in x.candidates[:2]}))
        return Incident("R5", 4, f"{_what(a)} {_t(a)}: {names} began within {0.2:.1f} s of each other, "
                                 f"so a person should pick", x.primary, a, x.context)
    cause = x.primary
    if cause is None and a.layer == "actuation":
        cause = a        # a joint that stopped following is its own cause when nothing came first
    if cause is not None:
        rule, rung, route, fix = _cause_rule(cause, events)
        if cause is not a:
            route = f"{_what(a)} {_t(a)} began with: {route}"
        return Incident(rule, rung, route, cause, a, x.context, fix)
    # Only a task failure with every layer checked and clean goes to training.
    if not cov.sensing_complete:
        missing = ", ".join(short(c) for c in cov.cameras_missing) or "video not checked"
        return Incident("R0", 4, f"{_what(a)} {_t(a)}: sensing unavailable ({missing}), so this can't be "
                                 f"called a policy failure", None, a, x.context)
    standing = [e for e in events if e.check in STANDING]
    if standing:
        names = ", ".join(sorted({e.fingerprint for e in standing}))
        return Incident("R5", 4, f"{_what(a)} {_t(a)} on an episode with a standing fault ({names}); "
                                 f"a person should decide if it's the policy", None, a, x.context)
    return Incident("R4", 3, f"training: {_what(a)} from {a.onset:.1f} to {a.t_end:.1f} s with healthy "
                             f"inputs and tracking", None, a, x.context)


def _what(a: Event) -> str:
    if a.check == "task.stall":
        return f"stall of {a.duration:.1f} s"
    if a.check == "task.missed_grasp_sequence":
        return f"{a.evidence['empty_closes']} missed grasps in a row on {a.component}"
    return f"{a.component} not following"


def _ev(e: Event) -> str:
    return ", ".join(f"{k} {v}" for k, v in e.evidence.items())


def episode_rung(incidents: list[Incident]) -> int:
    return max((i.rung for i in incidents), default=0)


def rung_counts(incidents: list[Incident]) -> Counter:
    return Counter(i.rung for i in incidents)
