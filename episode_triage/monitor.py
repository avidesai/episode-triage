"""Online triage for a running robot.

A deployed robot doesn't produce episodes; it produces one continuous log, and problems
appear inside it. The monitor keeps the last `window_s` seconds of that log in a ring
buffer, runs the same checks the fleet run uses over that window every `step_s`, and
emits an incident the first time one fires. Each incident carries its evidence window
(a clip of the signals around it), the reasoning trace, and, when the recorder injected
the fault on purpose, the ground truth of what was injected.

The same monitor drives three things: the live arm (recorder/record_labeled.py pushes a
tick per control loop), `triage replay` (a recorded run streamed back tick by tick for
rehearsal), and nothing else. The checks and the ladder are untouched.
"""

from __future__ import annotations

import json
import time
from collections import deque
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

import numpy as np

from .checks import RobotProfile
from .fleet import _json
from .ledger import fingerprint as fp_of
from .pipeline import triage_episode
from .readers import Camera, Episode
from .report import plain

W, H = 80, 60


@dataclass
class Tick:
    action: np.ndarray                 # (J,) command
    state: np.ndarray                  # (J,) measured
    gray: dict[str, np.ndarray | None] # camera key -> (H, W) uint8, or None if no new frame data
    t_wall: float
    truth: dict = field(default_factory=dict)   # {"fault": str, "target": str, "active": bool}


@dataclass
class LiveIncident:
    id: str
    robot_id: str
    t_abs: float            # seconds since the monitor started, at the anchor's onset
    incident: dict
    events: list[dict]
    clip: dict
    truth: list[dict]
    coverage: dict

    def to_dict(self) -> dict:
        return {"id": self.id, "robot_id": self.robot_id, "t": round(self.t_abs, 3),
                "incident": self.incident, "events": self.events, "clip": self.clip, "truth": self.truth,
                "coverage": self.coverage}


class Monitor:
    def __init__(self, robot_id: str, prof: RobotProfile, fps: float, joint_names: list[str],
                 gripper_idx: list[int], cameras: dict[str, list[int]], window_s: float = 20.0,
                 step_s: float = 0.5, on_incident: Callable[[LiveIncident], None] | None = None):
        self.robot_id = robot_id
        self.prof = prof
        self.fps = fps
        self.names = joint_names
        self.gripper_idx = gripper_idx
        self.cameras = cameras        # key -> joint chain
        self.n_window = int(window_s * fps)
        self.n_step = max(1, int(step_s * fps))
        self.on_incident = on_incident or (lambda inc: None)
        self.buf: deque[Tick] = deque(maxlen=self.n_window)
        self.energy: dict[str, deque] = {k: deque(maxlen=self.n_window) for k in cameras}
        self.last_gray: dict[str, np.ndarray | None] = {k: None for k in cameras}
        self.tick_count = 0
        self.reported: dict[str, list[tuple[int, int, str]]] = {}   # fingerprint -> [(onset_half_s, rung, id)]
        self.incidents: list[LiveIncident] = []

    # ------------------------------------------------------------ feeding

    def push(self, tick: Tick) -> list[LiveIncident]:
        """Add one control tick. Returns incidents that fired on this tick, if any."""
        for k in self.cameras:
            g = tick.gray.get(k)
            prev = self.last_gray[k]
            if g is None:
                # No frame data this tick (camera read failed): treat as unchanged picture,
                # which is what a stalled capture thread looks like.
                e = 0.0 if prev is not None else np.nan
            elif prev is None:
                e = np.nan
            else:
                e = float(np.abs(g.astype(np.int16) - prev.astype(np.int16)).mean())
            self.energy[k].append(e)
            if g is not None:
                self.last_gray[k] = g
        self.buf.append(tick)
        self.tick_count += 1
        if self.tick_count % self.n_step == 0 and len(self.buf) >= int(4 * self.fps):
            return self._scan()
        return []

    def flush(self) -> list[LiveIncident]:
        """End of a run: report what is in the buffer even if its window isn't complete."""
        return self._scan(final=True) if len(self.buf) >= int(4 * self.fps) else []

    # ------------------------------------------------------------ scanning

    def _scan(self, final: bool = False) -> list[LiveIncident]:
        n = len(self.buf)
        start_tick = self.tick_count - n           # absolute tick index of buf[0]
        action = np.stack([t.action for t in self.buf]).astype(np.float64)
        state = np.stack([t.state for t in self.buf]).astype(np.float64)
        ep = Episode(
            robot_id=self.robot_id, episode_index=0, fps=self.fps, software_version="live",
            joint_names=self.names, action=action, state=state,
            timestamp=np.arange(n) / self.fps, frame_index=np.arange(n), gripper_idx=self.gripper_idx,
            cameras={k: Camera(key=k, mount="wrist" if "wrist" in k else "fixed", chain=chain, path=None,
                               from_ts=0.0, to_ts=n / self.fps) for k, chain in self.cameras.items()},
        )
        energies = {k: (np.array(self.energy[k], dtype=np.float64), n) for k in self.cameras}
        res = triage_episode(ep, self.prof, video=bool(self.cameras), keep_traces=True,
                             energy_override=energies)
        fired = []
        for inc in res.incidents:
            if inc.rung == 0:
                continue
            # An incident is reported once its evidence window is complete inside the buffer.
            w0, w1 = inc.window
            if not final and w1 > (n - 1) / self.fps - 0.1:
                continue
            onset_h = int(round((start_tick / self.fps + inc.onset) * 2))
            seen = self.reported.setdefault(inc.fingerprint, [])
            same = [x for x in seen if abs(x[0] - onset_h) <= 2]
            supersedes = None
            if same:
                # Already reported. Report again only if it escalated, e.g. a camera that froze
                # once (robot can clear it) has now frozen three times (ticket).
                if inc.rung <= max(x[1] for x in same):
                    continue
                supersedes = same[-1][2]
            live = self._package(res, inc, start_tick, w0, w1)
            if supersedes:
                live.incident["supersedes"] = supersedes
            seen.append((onset_h, inc.rung, live.id))
            self.incidents.append(live)
            self.on_incident(live)
            fired.append(live)
        return fired

    def _package(self, res, inc, start_tick: int, w0: float, w1: float) -> LiveIncident:
        t_abs0 = start_tick / self.fps
        i0, i1 = int(w0 * self.fps), min(int(w1 * self.fps) + 1, len(self.buf))
        truths = [self.buf[i].truth for i in range(i0, i1)]
        return package_incident(res, inc, self.robot_id, "live", t_abs0, truths)


def package_incident(res, inc, robot_id: str, run, t_abs0: float = 0.0,
                     truths: list[dict] | None = None, ident: str | None = None) -> LiveIncident:
    """One incident with its evidence clip, used by the live monitor and the fleet site alike."""
    fps = res.fps
    if "_signals" not in res.traces:
        # The run failed an integrity check before any signal was computed: no clip, just the verdict.
        d = inc.to_dict()
        ident = ident or f"{robot_id.replace('/', '__')}-{int(t_abs0 * 1000):09d}-{inc.fingerprint}"
        return LiveIncident(ident, robot_id, t_abs0, d, [e.to_dict() for e in res.events],
                            {"t": [], "joints": {}, "cams": {}}, [],
                            {"cameras_checked": res.coverage.cameras_checked,
                             "cameras_missing": res.coverage.cameras_missing, "run": run})
    sig = res.traces["_signals"]
    names = sig.names
    w0, w1 = inc.window
    n = len(sig.an)
    i0, i1 = int(w0 * fps), min(int(w1 * fps) + 1, n)
    focus = inc.cause or inc.anchor
    joints = {}
    for j in sig.arm_idx:
        if focus is not None and names[j] in focus.component:
            joints[names[j]] = j
    if not joints:
        j = sig.arm_idx[1] if len(sig.arm_idx) > 1 else sig.arm_idx[0]
        joints[names[j]] = j
    for g in sig.gripper_idx:
        joints[names[g]] = g
    clip = {
        "t": (np.arange(i0, i1) / fps + t_abs0).round(3).tolist(),
        "joints": {name: {"cmd": (100 * sig.an[i0:i1, j]).round(2).tolist(),
                          "pos": (100 * sig.sn[i0:i1, j]).round(2).tolist(),
                          "gripper": j in sig.gripper_idx} for name, j in joints.items()},
        "cams": {k: {"change": np.nan_to_num(v["change"][i0:i1]).round(3).tolist(),
                     "motion": (100 * v["motion"][i0:i1]).round(3).tolist()}
                 for k, v in res.traces.items() if not k.startswith("_")},
    }
    truth = _truth_spans(truths[i0:i1] if truths else [], fps, t_abs0 + i0 / fps) if truths else []
    d = inc.to_dict()
    for key in ("cause", "anchor"):
        if d.get(key):
            d[key]["t_abs"] = round(d[key]["t_start"] + t_abs0, 3)
    for lst in ("context", "related"):
        for e in d.get(lst, []):
            e["t_abs"] = round(e["t_start"] + t_abs0, 3)
    d["window_abs"] = [round(w0 + t_abs0, 3), round(w1 + t_abs0, 3)]
    if ident is None:
        ident = f"{robot_id.replace('/', '__')}-{int((t_abs0 + inc.onset) * 1000):09d}-{inc.fingerprint}"
    events = [{**e.to_dict(), "t_abs": round(e.onset + t_abs0, 3)} for e in res.events
              if w0 - 0.5 <= e.onset <= w1 + 0.5 or e.check.startswith("integrity.")]
    return LiveIncident(ident, robot_id, t_abs0 + inc.onset, d, events, clip, truth,
                        {"cameras_checked": res.coverage.cameras_checked,
                         "cameras_missing": res.coverage.cameras_missing, "run": run})


def _truth_spans(truths: list[dict], fps: float, t0: float) -> list[dict]:
    out, cur = [], None
    for i, tr in enumerate(truths):
        active = bool(tr.get("active")) and tr.get("fault") not in (None, "", "none")
        if active and cur is None:
            cur = {"fault": tr["fault"], "target": tr.get("target", ""), "t0": round(t0 + i / fps, 3)}
        if not active and cur is not None:
            cur["t1"] = round(t0 + i / fps, 3)
            out.append(cur)
            cur = None
    if cur is not None:
        cur["t1"] = round(t0 + len(truths) / fps, 3)
        out.append(cur)
    return out


# ---------------------------------------------------------------- writing a live site

FIX_BY = {1: "robot", 2: "ticket", 3: "training", 4: "person"}


def incident_component(inc: dict) -> str:
    """The joint or camera an incident names: the cause if there is one, else the anchor."""
    ev = inc.get("cause") or inc.get("anchor") or {}
    comp = ev.get("component", "")
    return comp.split(".")[-1] if comp.startswith("observation.images.") else comp


class LiveSite:
    """Writes incidents where the viewer reads them: <site>/live/data.json and
    <site>/live/incidents/<id>.json. The page polls data.json and pulls new incidents."""

    def __init__(self, site: Path, robot_id: str, fleet_name: str = "live",
                 robot_index: Path = Path("results/robot_index.json")):
        self.site = Path(site)
        self.dir = self.site / "live"
        (self.dir / "incidents").mkdir(parents=True, exist_ok=True)
        # A replayed community dataset is named after its contributor. The page never shows
        # that: when the id is in the fleet's index, the page gets the arm number instead.
        self.raw_id = robot_id
        index = json.loads(robot_index.read_text()) if robot_index.exists() else {}
        self.robot_id = index.get(robot_id, robot_id)
        self.fleet_name = fleet_name
        self.rows: list[dict] = []
        self.started = time.time()
        self.write()

    def _scrub(self, s: str) -> str:
        if self.robot_id == self.raw_id:
            return s
        return s.replace(self.raw_id.replace("/", "__"), self.robot_id.replace(" ", "_")).replace(self.raw_id, self.robot_id)

    def add(self, live: LiveIncident) -> None:
        d = live.to_dict()
        d["id"], d["robot_id"] = self._scrub(live.id), self.robot_id
        if d["incident"].get("supersedes"):
            d["incident"]["supersedes"] = self._scrub(d["incident"]["supersedes"])
        (self.dir / "incidents" / f"{d['id']}.json").write_text(json.dumps(d, default=_json))
        inc = live.incident
        self.rows.append({"id": d["id"], "robot_id": self.robot_id, "t": live.t_abs, "rung": inc["rung"],
                          "rung_name": inc["rung_name"], "rule": inc["rule"], "route": inc["route"],
                          "fingerprint": inc["fingerprint"], "layer": inc["layer"],
                          "self_recovery": inc["self_recovery"], "truth": live.truth,
                          "supersedes": d["incident"].get("supersedes"),
                          "fix_by": FIX_BY.get(inc["rung"], "none"), "label": plain(fp_of(inc)),
                          "component": incident_component(inc),
                          "bundle": f"live/incidents/{d['id']}.json", "wall": time.time() - self.started})
        self.write()

    def write(self) -> None:
        (self.dir / "data.json").write_text(json.dumps({
            "mode": "live", "fleet": self.fleet_name, "robot_id": self.robot_id,
            "started_at": self.started, "generated_at": time.time(), "incidents": self.rows}, default=_json))


def gray_small(rgb: np.ndarray) -> np.ndarray:
    """RGB (h, w, 3) -> (60, 80) gray by area averaging, matching the fleet decoder."""
    h, w = rgb.shape[:2]
    g = (0.299 * rgb[..., 0] + 0.587 * rgb[..., 1] + 0.114 * rgb[..., 2])
    bh, bw = h // H, w // W
    g = g[: bh * H, : bw * W].reshape(H, bh, W, bw).mean(axis=(1, 3))
    return g.astype(np.uint8)
