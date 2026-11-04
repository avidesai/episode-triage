import type { FixBy, Layer } from "./types";

export const num = (x: unknown): string =>
  typeof x === "number" ? x.toLocaleString("en-US") : x == null ? "" : String(x);

/** Engine identifiers to words: "follower.wrist_flex" becomes "follower wrist flex". */
export const nice = (s: string): string =>
  String(s).replace(/follower\./g, "follower ").replace(/leader\./g, "leader ").replace(/_/g, " ");

/** "observation.images.top" becomes "top". */
export const short = (cam: string): string => String(cam).split(".").pop()!.replace(/_/g, " ");

export const secs = (t: number | null | undefined, digits = 1): string =>
  t == null || !Number.isFinite(+t) ? "" : (+t).toFixed(digits) + " s";

export const componentName = (comp: string): string =>
  comp.startsWith("observation.images.") ? short(comp) + " camera" : nice(comp);

export const plural = (n: number, one: string, many = one + "s"): string => `${num(n)} ${n === 1 ? one : many}`;

export const FIX_LABEL: Record<FixBy, string> = {
  robot: "Robot",
  ticket: "Ticket",
  training: "Training",
  person: "Person",
  none: "None",
};

export const FIX_LONG: Record<FixBy, string> = {
  robot: "The robot can clear it",
  ticket: "Ticket for a named part",
  training: "Send to training",
  person: "A person has to look",
  none: "Nothing to do",
};

export const LAYER_LABEL: Record<Layer, string> = {
  sensing: "Camera and timing",
  actuation: "Joints",
  task: "Task",
  integrity: "Data",
};

export const SOURCE_LABEL: Record<string, string> = {
  "video sample": "Video sample",
  "joint pass": "Joint pass",
};

/** "3 min ago" style age from seconds. */
export function ago(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "";
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${Math.floor(seconds)} s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  return `${Math.floor(seconds / 3600)} h ago`;
}
