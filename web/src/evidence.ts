import { fixed, partWords } from "./format";
import type { TEvent } from "./types";

// Evidence rows for the cause (or anchor) event: what was measured against which threshold.
// Thresholds come from data.thresholds; nothing here is a typed number except unit math and
// the meter scale rules from the design.

export interface EvRow {
  label: string;
  value: string;
  threshold: string;
  ctx?: boolean;
  /** Meter: value and threshold on one scale. */
  meter?: { value: number; thr: number; max: number; fill: string };
}

type T = Record<string, number>;
const pct = (x: number, d = 1) => `${fixed(100 * x, d).replace(/\.0$/, "")}%`;
const n2 = (x: number) => fixed(x, 2);
const s2 = (x: number) => `${fixed(x, 2)} s`;
const s1 = (x: number) => `${fixed(x, 1)} s`;
const twice = (v: number, t: number, fill = "var(--sig-pos)") => ({ value: v, thr: t, max: 2 * t, fill });

/** A co fault cited by rule R5, from the summary's field or parsed from the route. */
export function coFaultOf(route: string, field?: { label: string; component: string }[]): { label: string; component: string } | null {
  if (field?.length) return field[0];
  const m = route.match(/also has an? (.+?) on (\w+)/);
  return m ? { label: m[1], component: m[2] } : null;
}

export function evidenceRows(e: TEvent, t: T, opts: { rung: number; route: string; coFaults?: { label: string; component: string }[]; firstBefore?: string | null }): EvRow[] {
  const v = e.evidence ?? {};
  const k = e.check;
  if (k.startsWith("sensing.stale_camera")) {
    const rows: EvRow[] = [
      { label: "Picture change", value: n2(v.mean_change), threshold: `under ${t.stale_tau_e}`, meter: v.typical_change ? { value: v.mean_change, thr: t.stale_tau_e, max: v.typical_change, fill: "var(--sig-chg)" } : undefined },
      { label: "Arm motion while frozen", value: pct(v.motion), threshold: `over ${pct(t.stale_tau_m, 0)}`, meter: { value: v.motion, thr: t.stale_tau_m, max: 5 * t.stale_tau_m, fill: "var(--sig-pos)" } },
      { label: "Frames frozen", value: String(v.frames), threshold: `${t.stale_min_frames} or more` },
    ];
    if (v.typical_change != null) rows.push({ label: "Typical change on this camera", value: n2(v.typical_change), threshold: "context", ctx: true });
    if (v.other_camera_live != null) rows.push({ label: "Other camera live meanwhile", value: v.other_camera_live ? "yes" : "no", threshold: "context", ctx: true });
    return rows;
  }
  if (k.startsWith("sensing.stale_state")) {
    return [
      { label: "Identical frames", value: String(v.frames), threshold: `${t.stale_state_min_frames} or more` },
      { label: "Command moving", value: v.command_speed != null ? (v.command_speed > 0 ? "yes" : "no") : "yes", threshold: "context", ctx: true },
    ];
  }
  if (k.startsWith("actuation.not_following")) {
    const held = e.t_end - e.t_start;
    const rows: EvRow[] = [];
    if (v.peak_err != null) rows.push({ label: "Gap from command", value: n2(v.peak_err), threshold: `over ${t.follow_err} of range`, meter: twice(v.peak_err, t.follow_err) });
    rows.push({ label: "Held for", value: s2(held), threshold: `${t.follow_min_s} s or more`, meter: twice(held, t.follow_min_s) });
    if (v.mode) rows.push({ label: "Mode", value: String(v.mode), threshold: "context", ctx: true });
    return rows;
  }
  if (k.startsWith("actuation.pinned")) {
    const held = e.t_end - e.t_start;
    return [
      { label: "Limit it sat at", value: String(v.limit), threshold: "min or max" },
      { label: "Pushed past the limit", value: n2(v.push), threshold: `over ${t.pin_push} of range`, meter: { value: v.push, thr: t.pin_push, max: 4 * t.pin_push, fill: "var(--sig-pos)" } },
      { label: "Time held there", value: s2(held), threshold: `${t.pin_min_s} s or more`, meter: twice(held, t.pin_min_s) },
    ];
  }
  if (k.startsWith("actuation.rest_offset")) {
    const rows: EvRow[] = [{ label: "Offset at rest", value: n2(Math.abs(v.offset)), threshold: `over ${t.offset_err} of range`, meter: twice(Math.abs(v.offset), t.offset_err) }];
    if (v.agree != null) rows.push({ label: "Pauses that agree", value: `${n2(v.agree)}${v.rest_segments != null ? ` of ${v.rest_segments}` : ""}`, threshold: `${t.offset_agree} of pauses` });
    return rows;
  }
  if (k.startsWith("actuation.gain_mismatch")) {
    return [{ label: "Follower moves this much per leader unit", value: n2(v.gain), threshold: `off by more than ${t.gain_err}` }];
  }
  if (k.startsWith("actuation.not_tracking")) {
    return [{ label: "Follower and leader correlation", value: n2(v.corr), threshold: `under ${t.track_min_r}` }];
  }
  if (k.startsWith("actuation.bus_glitch")) {
    return [
      { label: "One frame jump", value: n2(Math.abs(v.jump)), threshold: `over ${t.glitch_jump} of range`, meter: twice(Math.abs(v.jump), t.glitch_jump) },
      { label: "Jumps that make a ticket", value: String(t.glitch_ticket_count), threshold: "on one motor", ctx: true },
    ];
  }
  if (k.startsWith("actuation.command_wrap")) {
    return [{ label: "One frame command jump", value: n2(Math.abs(v.jump)), threshold: `over ${t.wrap_jump} of range` }];
  }
  if (k.startsWith("sensing.duplicated_rows")) {
    return [
      { label: "Moving rows that repeat", value: n2(v.share), threshold: "of the moving rows" },
      { label: "Repeated rows", value: String(v.repeated_rows), threshold: "context", ctx: true },
    ];
  }
  if (k.startsWith("task.stall")) {
    const rows: EvRow[] = [{ label: "Time with every joint still", value: s2(v.seconds), threshold: `${s1(t.stall_min_s)} or more`, meter: twice(v.seconds, t.stall_min_s, "var(--anchor)") }];
    if (opts.rung === 4) {
      const co = coFaultOf(opts.route, opts.coFaults);
      if (co) rows.push({ label: "Standing fault on this recording", value: co.label, threshold: partWords(co.component), ctx: true });
      return rows;
    }
    rows.push({ label: "Ignored at each end of a run", value: `${t.stall_edge_s} s`, threshold: "context", ctx: true });
    rows.push({ label: "Camera or joint fault before it", value: opts.firstBefore ?? "none", threshold: "checked", ctx: true });
    return rows;
  }
  if (k.startsWith("task.missed_grasp")) {
    const rows: EvRow[] = [];
    if (v.empty_closes != null) rows.push({ label: "Empty closes in a row", value: String(v.empty_closes), threshold: "2 or more" });
    if (Array.isArray(v.gaps) && v.gaps.length) {
      const g = Math.max(...v.gaps.map((x: number) => Math.abs(x)));
      rows.push({ label: "Gap at close", value: n2(g), threshold: `under ${t.empty_gap} is empty` });
    }
    if (v.recovered != null) rows.push({ label: "Good grasp after", value: v.recovered ? "yes" : "no", threshold: "context", ctx: true });
    return rows;
  }
  // Anything else: every numeric field, as the engine wrote it.
  return Object.entries(v)
    .filter(([, x]) => typeof x === "number" || typeof x === "string")
    .map(([key, x]) => ({ label: key.replace(/_/g, " "), value: typeof x === "number" ? n2(x) : String(x), threshold: "measured", ctx: true }));
}

/** The one line callout for the focus panel. */
export function calloutOf(e: TEvent, t: T, rung: number): [string, string] | null {
  const v = e.evidence ?? {};
  if (e.check.startsWith("sensing.stale_camera"))
    return [`Frozen ${v.frames} frames, ${Math.round(v.ms ?? (v.frames * 1000) / 30)} ms`, `mean change ${n2(v.mean_change)}, needs ${t.stale_tau_e}`];
  if (e.check.startsWith("actuation.pinned"))
    return [`Pinned ${n2(e.t_end - e.t_start)} s, pushed ${pct(v.push, 0)} of range past it`, `ticket at ${t.pin_min_s} s and ${pct(t.pin_push, 0)}`];
  if (e.check.startsWith("task.stall")) {
    if (rung === 4) return [`Still from ${fixed(e.t_start, 1)} to ${fixed(e.t_end, 1)} s`, `a stall starts at ${s1(t.stall_min_s)}`];
    return [`Every joint still for ${s1(v.seconds)}`, `a stall starts at ${s1(t.stall_min_s)}`];
  }
  const rows = evidenceRows(e, t, { rung, route: "" }).filter((r) => !r.ctx);
  if (!rows.length) return null;
  return [`${rows[0].label} ${rows[0].value}`, rows[0].threshold];
}
