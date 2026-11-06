import { useEffect, useRef, useState } from "preact/hooks";
import { fpsOf, inRange, t1, type Range } from "../chart";
import { coFaultOf, calloutOf } from "../evidence";
import { camWords, fixed, isCamera, partWords, sentence } from "../format";
import type { Bundle, Summary, TEvent } from "../types";
import { IconCameraOff } from "./icons";
import { TimelinePanel, type BandSpec, type Cursor, type PanelSpec } from "./TimelinePanel";

export type RangeMode = "fail" | "whole";

const MOVED = 2; // a joint moved in range when its position spans more than this many units

interface Ctx {
  b: Bundle;
  s: Summary;
  th: Record<string, number>;
}

const span = (v: number[]) => (v.length ? Math.max(...v) - Math.min(...v) : 0);
const mean = (v: number[]) => (v.length ? v.reduce((a, x) => a + x, 0) / v.length : 0);

/** The event the chart is built around, and what kind it is. */
export function focusOf(b: Bundle) {
  const inc = b.incident;
  const ev: TEvent | null = inc.cause ?? inc.anchor;
  const camKeys = Object.keys(b.clip.cams);
  const camCause = !!inc.cause && isCamera(inc.cause.component, { cams: camKeys, fingerprint: inc.cause.fingerprint });
  return { ev, role: inc.cause ? ("cause" as const) : inc.anchor ? ("anchor" as const) : null, camCause };
}

/** Default range: around the failure for a camera cause or an already short clip. */
export function defaultRange(b: Bundle): RangeMode {
  const t = b.clip.t;
  const { ev, camCause } = focusOf(b);
  if (!ev || !t.length) return "whole";
  if (camCause) return "fail";
  // a cause in a clip that is already a short window opens on it; anchors open on the whole clip
  return b.incident.cause && t[t.length - 1] - t[0] < 6 ? "fail" : "whole";
}

function rangeOf(b: Bundle, mode: RangeMode): Range {
  const t = b.clip.t;
  const whole: Range = [t[0], t[t.length - 1]];
  const { ev, camCause } = focusOf(b);
  if (mode === "whole" || !ev) return whole;
  if (!camCause && whole[1] - whole[0] < 6) return whole;
  const w = Math.max(0.5, ev.t_end - ev.t_start);
  return [Math.max(whole[0], ev.t_start - w), Math.min(whole[1], ev.t_end + w)];
}

const camKeyOf = (cams: string[], comp: string) => cams.find((k) => k === comp || k.endsWith("." + comp)) ?? null;
const jointKeyOf = (joints: string[], comp: string) => joints.find((j) => j === comp || comp.endsWith("." + j) || j.endsWith("." + comp)) ?? null;

function list(words: string[]): string {
  if (words.length <= 1) return words[0] ?? "";
  return words.slice(0, -1).join(", ") + " and " + words[words.length - 1];
}

/** Build every panel, the legend and the footer notes for one incident. */
function build({ b, s, th }: Ctx, mode: RangeMode) {
  const t = b.clip.t;
  const r = rangeOf(b, mode);
  const inc = b.incident;
  const { ev, role, camCause } = focusOf(b);
  const camKeys = Object.keys(b.clip.cams);
  const jointKeys = Object.keys(b.clip.joints);
  const jointOrder = [...jointKeys.filter((j) => !b.clip.joints[j].gripper), ...jointKeys.filter((j) => b.clip.joints[j].gripper)];
  const isStall = !!ev && ev.check.startsWith("task.stall");
  const zoomedCam = camCause && mode === "fail";

  // ----- bands, shared by every panel
  const bands: BandSpec[] = [];
  for (const tr of b.truth ?? []) bands.push({ kind: "truth", t0: tr.t0, t1: tr.t1, tag: "injected" });
  if (isStall && r[0] < th.stall_edge_s) bands.push({ kind: "ignored", t0: Math.max(0, r[0]), t1: th.stall_edge_s, tag: `first ${th.stall_edge_s} s not counted` });
  for (const c of inc.context ?? []) bands.push({ kind: "ctx", t0: c.t_start, t1: c.t_end });
  if (inc.cause) bands.push({ kind: "cause", t0: inc.cause.t_start, t1: inc.cause.t_end, tag: "cause" });
  if (inc.anchor && (!inc.cause || inc.anchor.t_start !== inc.cause.t_start || inc.anchor.component !== inc.cause.component)) {
    const tag = s.rung === 4 && isStall ? `failure seen · stall ${fixed(inc.anchor.evidence?.seconds ?? inc.anchor.t_end - inc.anchor.t_start, 1)} s` : "failure seen";
    bands.push({ kind: "anchor", t0: inc.anchor.t_start, t1: inc.anchor.t_end, tag });
  }
  const untagged = bands.map((x) => ({ ...x, tag: undefined }));
  const mainBand = bands.find((x) => x.kind === "cause") ?? bands.find((x) => x.kind === "anchor");

  // ----- which component is the focus
  let focusCam: string | null = null;
  let focusJoint: string | null = null;
  if (ev) {
    if (camCause) focusCam = camKeyOf(camKeys, ev.component);
    else if (ev.component === "arm") {
      // whole arm: the joint that moved most in the clip
      let best = -1;
      for (const j of jointOrder.filter((j) => !b.clip.joints[j].gripper)) {
        const sp = span(b.clip.joints[j].pos);
        if (sp > best) {
          best = sp;
          focusJoint = j;
        }
      }
    } else focusJoint = jointKeyOf(jointKeys, ev.component);
  }

  const movedIn = (j: string) => span(inRange(t, b.clip.joints[j].pos, r)) > MOVED;
  const camChange = (k: string) => Math.max(0, ...inRange(t, b.clip.cams[k].change, r));

  // ----- order: focus, same kind, other kind
  const panels: PanelSpec[] = [];
  const notDrawnCams: string[] = [];
  const notMoved: string[] = [];
  const pickCams = (exclude: string | null) => {
    const others = camKeys.filter((k) => k !== exclude);
    const chosen = others
      .slice()
      .sort((a, c) => camChange(c) - camChange(a))
      .slice(0, 2);
    for (const k of others) if (!chosen.includes(k)) notDrawnCams.push(k);
    return others.filter((k) => chosen.includes(k));
  };
  const joints = (exclude: string | null) =>
    jointOrder.filter((j) => {
      if (j === exclude) return false;
      if (movedIn(j)) return true;
      notMoved.push(j);
      return false;
    });

  const thr = th.stale_tau_e;
  const bandIn = (series: (number | null)[], a: number, z: number) => inRange(t, series, [a, z]);

  // camera caption during a stall (or any non camera focus)
  let quietSeen = 0;
  const camCaption = (k: string): string => {
    if (camCause) return "Kept changing through the same moment, so the scene really was moving.";
    if (!mainBand) return "Fresh frames throughout.";
    const ch = b.clip.cams[k].change;
    const during = mean(bandIn(ch, mainBand.t0, mainBand.t1));
    const before = mean(bandIn(ch, r[0], mainBand.t0));
    if (during > thr) return isStall ? "Kept delivering fresh frames through the stall." : "Kept delivering fresh frames through it.";
    if (before > 2 * thr) return "Live while the arm moved, quiet once it stopped. No freeze.";
    quietSeen++;
    return quietSeen === 1
      ? "Picture barely changed, but nothing was moving either, so a quiet picture is expected. Not a freeze."
      : "Same story: still scene, still arm. Fresh frames kept arriving.";
  };

  const jointCaption = (j: string, focus: boolean): string => {
    const J = b.clip.joints[j];
    if (focus && ev?.check.startsWith("actuation.pinned")) {
      const lim = ev.evidence?.limit === "max" ? "max" : "min";
      return `The command kept going ${lim === "min" ? "down" : "up"}. The joint stopped at its ${lim} and stayed there until the command came back.`;
    }
    if (focus && isStall && mainBand) {
      const before = inRange(t, J.pos, [r[0], mainBand.t0]);
      if (span(before) > MOVED) {
        const dir = before[before.length - 1] < before[0] ? "Lowered" : "Raised";
        return `${dir}, then held. Command and position agree, so the joint isn't the stall.`;
      }
      return "Command and position both sat still. The joint did what it was told; it was told nothing.";
    }
    if (J.gripper) {
      const p = inRange(t, J.pos, r);
      const lo = Math.min(...p);
      const sp = span(p);
      const hi = Math.max(...p);
      if (sp > MOVED && lo < p[0] - 0.3 * sp && p[p.length - 1] > lo + 0.3 * sp) return "Closed, reopened, then held open. Tracking its command.";
      if (sp > MOVED && hi > p[0] + 0.3 * sp && p[p.length - 1] < hi - 0.3 * sp) return "Opened, then closed again. Tracking its command.";
      if (camCause && mainBand && sp > MOVED) {
        const after = inRange(t, J.pos, [mainBand.t1, r[1]]);
        if (span(after) > 0.6 * sp && after[after.length - 1] > after[0]) return "Opened after the freeze, tracking its command.";
      }
      return "Tracked its command throughout.";
    }
    return "Follower tracked its command. The joints were fine.";
  };

  const camPanel = (k: string, focus: boolean): PanelSpec => {
    const c = b.clip.cams[k];
    const words = camWords(k) + " camera";
    if (focus) {
      const ev2 = inc.cause!;
      return {
        key: k,
        kind: "cam",
        words,
        role: "cause",
        caption: zoomedCam
          ? `${t1(r[0])} to ${t1(r[1])} s. The picture stopped changing while the arm kept moving. A live camera would have changed.`
          : "The freeze in context: short, then live again.",
        height: zoomedCam ? 240 : 96,
        focus: zoomedCam,
        change: c.change,
        motion: c.motion,
        thr: zoomedCam ? thr : undefined,
        thrLabel: zoomedCam,
        thrNote: zoomedCam ? `under ${thr} counts as frozen` : undefined,
        typical: zoomedCam ? ev2.evidence?.typical_change : undefined,
        callout: zoomedCam ? calloutOf(ev2, th, s.rung) ?? undefined : undefined,
        pointer:
          zoomedCam && ev2.evidence?.motion != null && mainBand
            ? (() => {
                const x = (100 * (Math.min(mainBand.t1, r[1]) - r[0])) / (r[1] - r[0]) + 0.6;
                return x < 80
                  ? { text: `arm moving ${fixed(100 * ev2.evidence.motion, 1)}% of range per frame`, side: "left" as const, x, top: "10%", color: "var(--anchor-text)" }
                  : undefined;
              })()
            : undefined,
      };
    }
    return { key: k, kind: "cam", words, caption: camCaption(k), height: 76, change: c.change, motion: c.motion, thr };
  };

  const jointPanel = (j: string, focus: boolean): PanelSpec => {
    const J = b.clip.joints[j];
    const words = partWords(j);
    if (!focus) return { key: j, kind: "joint", words, caption: jointCaption(j, false), height: 76, cmd: J.cmd, pos: J.pos };
    const spec: PanelSpec = {
      key: j,
      kind: "joint",
      words,
      role: role ?? undefined,
      caption: jointCaption(j, true),
      height: ev?.check.startsWith("actuation") ? 260 : isStall ? (s.rung === 4 ? 180 : 200) : 200,
      focus: true,
      cmd: J.cmd,
      pos: J.pos,
      callout: ev ? calloutOf(ev, th, s.rung) ?? undefined : undefined,
    };
    if (ev?.check.startsWith("actuation.pinned")) {
      const held = inRange(t, J.pos, [ev.t_start, ev.t_end]);
      const lim = ev.evidence?.limit === "max" ? "max" : "min";
      const level = lim === "min" ? Math.min(...held) : Math.max(...held);
      spec.held = { level, note: lim === "min" ? "lowest position this joint reached" : "highest position this joint reached", t0: ev.t_start, t1: ev.t_end };
      const after = inRange(t, J.cmd, [ev.t_end, r[1]]);
      const x = (100 * (ev.t_end - r[0])) / (r[1] - r[0]);
      if (span(after) > MOVED && x < 75)
        spec.pointer = {
          text: `command comes back ${lim === "min" ? "up" : "down"}, follower follows`,
          side: "left",
          x: Math.min(80, x + (100 - x) * 0.45),
          top: "50%",
          color: "var(--text-2)",
          maxWidth: 130,
        };
    }
    if (isStall && s.rung !== 4 && mainBand) {
      const after = inRange(t, J.pos, [mainBand.t1, r[1]]);
      if (span(after) > MOVED) spec.pointer = { text: "moves again, follower right behind", side: "right", x: 87, top: "34%", color: "var(--text-2)", maxWidth: 150 };
    }
    return spec;
  };

  if (focusCam) {
    panels.push(camPanel(focusCam, true));
    for (const k of pickCams(focusCam)) panels.push(camPanel(k, false));
    for (const j of joints(null)) panels.push(jointPanel(j, false));
  } else {
    if (focusJoint) panels.push(jointPanel(focusJoint, true));
    for (const j of joints(focusJoint)) panels.push(jointPanel(j, false));
    for (const k of pickCams(null)) panels.push(camPanel(k, false));
  }
  // in whole clip mode for a camera cause, the other cameras come first, as in the design
  if (camCause && mode === "whole" && panels.length > 1) {
    const f = panels.shift()!;
    const firstJoint = panels.findIndex((p) => p.kind === "joint");
    panels.splice(firstJoint < 0 ? panels.length : firstJoint, 0, f);
  }
  if (panels.length) {
    const first = panels[0];
    first.ticks = true;
    const last = panels[panels.length - 1];
    last.last = true;
    last.ticks = true;
    if (last === first && !first.focus) first.last = true;
  }

  // ----- legend, only what's drawn
  const legend: [string, string][] = [];
  if (inc.cause) legend.push(["sw cause", "cause: what started it"]);
  else if (inc.anchor) legend.push(["sw anchor", s.rung === 4 ? "failure seen" : "failure seen: what a person would notice"]);
  if (b.truth?.length) legend.push(["sw truth", "injected truth"]);
  const hasCam = panels.some((p) => p.kind === "cam");
  const hasJoint = panels.some((p) => p.kind === "joint");
  const jointPass = s.source === "joint pass";
  const camLegend: [string, string][] = hasCam ? [["ln chg", "picture change"], ["sw motion", "arm motion"], ...(camCause ? ([["ln thr", "frozen below this"]] as [string, string][]) : [])] : [];
  const jointLegend: [string, string][] = hasJoint
    ? [
        ["ln cmd", jointPass ? "command, what the leader asked for" : "command, leader"],
        ["ln pos", jointPass ? "position, what the follower did" : "position, follower"],
      ]
    : [];
  legend.push(...(panels[0]?.kind === "cam" ? [...camLegend, ...jointLegend] : [...jointLegend, ...camLegend]));

  // ----- footer notes
  const notes: string[] = [];
  const parts: string[] = [];
  if (notDrawnCams.length) parts.push(`${sentence(list(notDrawnCams.map(camWords)))} camera${notDrawnCams.length > 1 ? "s" : ""} checked, not drawn.`);
  if (s.rung === 4) {
    const co = coFaultOf(s.route, (s as any).co_faults);
    if (co && !jointKeyOf(jointKeys, co.component)) parts.push(`${sentence(partWords(co.component))}, where the standing fault is, is not in this clip.`);
  }
  if (parts.length) notes.push(parts.join(" "));
  const whole0 = r[0] <= t[0] + 1e-6 && r[1] >= t[t.length - 1] - 1e-6;
  for (const j of notMoved) notes.push(`${partWords(j)}: did not move in this ${whole0 ? "clip" : "window"}, not drawn.`);
  const missing = b.coverage?.cameras_missing ?? [];
  const noCamBox = !camKeys.length && missing.length ? `No camera panels. This run was checked on the joint pass only; ${list(missing.map(camWords))} video ${missing.length > 1 ? "were" : "was"} not available.` : null;

  return { r, bands, untagged, panels, legend, notes, noCamBox, zoomedCam, mainBand };
}

/** The Signals card on the Incident page. */
export function Signals({ b, s, th, mode, setMode }: { b: Bundle; s: Summary; th: Record<string, number>; mode: RangeMode; setMode: (m: RangeMode) => void }) {
  const [cursor, setCursor] = useState<Cursor | null>(null);
  const [plotW, setPlotW] = useState(800);
  const card = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = card.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const p = el.querySelector(".plot");
      if (p) setPlotW(p.getBoundingClientRect().width || 800);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => setCursor(null), [mode, b]);

  const t = b.clip.t;
  if (!t.length)
    return (
      <section class="card inc-signals" aria-label="Signals">
        <div class="card-head">
          <h2 class="h2">Signals</h2>
        </div>
        <p class="t-3" style="padding:0 16px 16px;font-size:12px">
          This bundle holds no signal clip.
        </p>
      </section>
    );

  const fps = fpsOf(t);
  const { r, bands, untagged, panels, legend, notes, noCamBox, mainBand } = build({ b, s, th }, mode);
  const { camCause, ev } = focusOf(b);
  const whole: Range = [t[0], t[t.length - 1]];
  const caption = camCause ? "One clock for every camera and joint. Hover a panel to read values." : `${t1(r[0])} to ${t1(r[1])} s at ${fps} fps`;
  const minBandPct = (100 * 3) / Math.max(100, plotW);
  void mainBand;

  return (
    <section class="card inc-signals" aria-label="Signals" ref={card}>
      <div class="card-head" style="flex-wrap:wrap">
        <h2 class="h2">Signals</h2>
        <span class="t-3" style="font-size:12px">
          {caption}
        </span>
        {ev ? (
          <div class="seg" role="group" aria-label="Time range" style="margin-left:auto">
            <button type="button" aria-pressed={mode === "fail" ? "true" : "false"} onClick={() => setMode("fail")}>
              Around the failure
            </button>
            <button type="button" aria-pressed={mode === "whole" ? "true" : "false"} onClick={() => setMode("whole")}>
              {camCause ? `Whole clip, ${t1(whole[0])} to ${t1(whole[1])} s` : "Whole clip"}
            </button>
          </div>
        ) : null}
      </div>
      <div class="legend">
        {legend.map(([cls, text]) => (
          <span key={text}>
            <span class={cls} />
            {text}
          </span>
        ))}
      </div>
      {panels.map((p, i) => (
        <>
          <TimelinePanel key={p.key} p={p} t={t} r={r} bands={p.role || (!panels.some((x) => x.role) && i === 0) ? bands : untagged.filter((x) => x.kind !== "ignored")} minBandPct={minBandPct} cursor={cursor} setCursor={setCursor} fps={fps} />
          {i === 0 && p.focus && camCause && panels.length > 1 ? (
            <div style="padding:10px 16px;border-top:1px solid var(--border-soft);font-size:12px;color:var(--text-2);display:flex;gap:8px;align-items:center">
              <span class="lbl">Same moment, everything else</span>
            </div>
          ) : null}
        </>
      ))}
      {noCamBox ? (
        <div style="display:flex;align-items:center;gap:12px;margin:0 16px 16px;padding:12px 14px;border:1px dashed var(--border-strong);border-radius:8px;color:var(--text-2)">
          <IconCameraOff />
          <span>{noCamBox}</span>
        </div>
      ) : null}
      {notes.map((n) => (
        <p key={n} class="t-3" style="font-size:12px;padding:0 16px 16px">
          {n}
        </p>
      ))}
    </section>
  );
}
