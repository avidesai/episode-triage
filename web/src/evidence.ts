import type { TEvent } from "./types";

// Measured value against threshold for each check, ported from the old viewer's EVID map.
// Thresholds come from data.thresholds; nothing here is a typed number except unit math.

type Row = [what: string, measured: string, threshold: string];
type T = Record<string, number>;

const pct = (x: number) => (100 * x).toFixed(1) + "% of range";
const p0 = (x: number) => (100 * x).toFixed(0) + "%";

const EVID: Record<string, (e: Record<string, any>, t: T) => Row[]> = {
  "sensing.stale_camera": (e, t) => [
    ["picture change", e.mean_change.toFixed(2) + " gray levels", "under " + t.stale_tau_e],
    ["arm motion while frozen", pct(e.motion) + " per frame", "over " + 100 * t.stale_tau_m + "%"],
    ["frames", String(e.frames), t.stale_min_frames + " or more"],
    ["typical change on this camera", e.typical_change == null ? "unknown" : e.typical_change.toFixed(2), "context"],
  ],
  "sensing.stale_state": (e, t) => [
    ["identical frames", String(e.frames), t.stale_state_min_frames + " or more"],
    ["command speed meanwhile", pct(e.command_speed) + " per frame", "over " + 100 * t.stale_tau_m + "%"],
  ],
  "sensing.duplicated_rows": (e) => [["moving rows that repeat", p0(e.share), "25% or more"]],
  "actuation.not_following": (e, t) => [
    ["largest gap from command", pct(e.peak_err), "over " + 100 * t.follow_err + "%"],
    ["mode", String(e.mode), "stalled, sagging, lagging, or held"],
    ["other joints still tracking", p0(e.others_tracking), "context"],
  ],
  "actuation.rest_offset": (e, t) => [
    ["offset at rest", pct(Math.abs(e.offset)), "over " + 100 * t.offset_err + "%"],
    ["pauses that agree", p0(e.agree) + " of " + e.rest_segments, 100 * t.offset_agree + "% or more"],
  ],
  "actuation.gain_mismatch": (e, t) => [["follower gain vs leader", e.gain.toFixed(2), "outside 1 ± " + t.gain_err]],
  "actuation.not_tracking": (e, t) => [["follower vs leader correlation", e.corr.toFixed(2), "under " + t.track_min_r]],
  "actuation.bus_glitch": (e, t) => [
    ["one frame jump", pct(e.jump), "over " + 100 * t.glitch_jump + "%, back within " + t.glitch_return_frames + " frames"],
  ],
  "actuation.command_wrap": (e, t) => [["one frame command jump", pct(Math.abs(e.jump)), "over " + 100 * t.wrap_jump + "%, not returning"]],
  "actuation.pinned": (e, t) => [
    ["at its " + e.limit + ", command pushing", pct(e.push), "over " + 100 * t.pin_push + "% for " + t.pin_min_s + " s"],
  ],
  "task.stall": (e, t) => [["nothing moving for", e.seconds.toFixed(1) + " s", t.stall_min_s + " s or more"]],
  "task.missed_grasp_sequence": (e, t) => [
    ["empty closes in a row", String(e.empty_closes), "2 or more"],
    ["gripper gaps after each close", e.gaps.map((g: number) => (100 * g).toFixed(1) + "%").join(", "), "under " + 100 * t.empty_gap + "% is empty"],
  ],
  "task.missed_grasp": (e) => [
    ["empty closes", String(e.empty_closes), "1"],
    ["then a good grasp", e.recovered ? "yes" : "no", ""],
  ],
  "sensing.camera_lag": (e) => [["camera behind the joints", e.lag_frames + " frames", "3 or more"]],
};

const raw = (ev: TEvent): Row[] =>
  Object.entries(ev.evidence || {}).map(([k, v]) => [k.replace(/_/g, " "), typeof v === "number" ? String(+v.toFixed(3)) : String(v), ""]);

export function evidenceRows(ev: TEvent, thresholds: T): Row[] {
  const f = EVID[ev.check];
  if (!f) return raw(ev);
  try {
    return f(ev.evidence, thresholds);
  } catch {
    return raw(ev);
  }
}
