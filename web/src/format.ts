// Words from engine ids, and number and time formats. Pure functions; format.test.ts covers them.

export const num = (x: unknown): string =>
  typeof x === "number" ? x.toLocaleString("en-US") : x == null ? "" : String(x);

export const plural = (n: number, one: string, many = one + "s"): string => `${num(n)} ${n === 1 ? one : many}`;

/** Fixed decimals, with a real minus sign (U+2212) for negatives. */
export function fixed(x: number, digits: number): string {
  const s = Math.abs(x).toFixed(digits);
  return x < 0 && Number(s) !== 0 ? "−" + s : s;
}

/** Seconds: one decimal in prose ("2.4 s"), two in id lines and evidence ("2.43 s"). */
export const secs = (t: number | null | undefined, digits = 1): string =>
  t == null || !Number.isFinite(+t) ? "" : fixed(+t, digits) + " s";

/** "2.43 to 2.60 s" */
export const span = (a: number, b: number, digits = 2): string => `${fixed(a, digits)} to ${fixed(b, digits)} s`;

/** Integer with a real minus sign. */
export const int = (x: number): string => fixed(Math.round(x), 0);

export const sentence = (s: string): string => (s ? s[0].toUpperCase() + s.slice(1) : s);

// ---------------------------------------------------------------- parts

const CAMERA_FALLBACK = new Set(["top", "side", "wrist", "front_side", "left_side", "bottom", "side_1", "wrist_1", "wrist_2"]);

/** True when the component is a camera key. Prefer passing the clip's camera keys or the fingerprint. */
export function isCamera(component: string, opts: { cams?: string[]; fingerprint?: string } = {}): boolean {
  if (component.startsWith("observation.images.")) return true;
  if (opts.cams?.some((k) => k === component || k === "observation.images." + component)) return true;
  if (opts.fingerprint?.startsWith("sensing.stale_camera")) return true;
  return CAMERA_FALLBACK.has(component);
}

/** Component id to words: "observation.images.front_side" → "front side camera",
 *  "wrist_flex" → "wrist flex", "leader.gripper" → "leader gripper", "episode" → "recording". */
export function partWords(component: string, opts: { cams?: string[]; fingerprint?: string } = {}): string {
  const c = String(component ?? "");
  if (c === "joint_stream") return "joint stream";
  if (c === "episode") return "recording";
  if (c === "arm") return "arm";
  if (/ camera$/.test(c)) return c;
  if (isCamera(c, opts)) return c.replace(/^observation\.images\./, "").replace(/_/g, " ") + " camera";
  return c.replace(/^(follower|leader)\./, "$1 ").replace(/_/g, " ");
}

/** Camera key to words without the trailing "camera": "observation.images.front_side" → "front side". */
export const camWords = (key: string): string => key.replace(/^observation\.images\./, "").replace(/_/g, " ");

const FALLBACK_LABEL: Record<string, string> = {
  "sensing.duplicated_rows": "rows repeated in the joint stream",
};

/** A label the engine had no plain words for comes through as the raw fingerprint. */
export function plainLabel(label: string, fingerprint = label): string {
  for (const [k, v] of Object.entries(FALLBACK_LABEL)) if (label.startsWith(k) || (label === fingerprint && fingerprint.startsWith(k))) return v;
  return label;
}

/** "follower sits offset from its leader at rest (wrist flex)" → base and part. */
export function splitLabel(label: string, fingerprint = ""): { base: string; part: string } {
  const l = plainLabel(label, fingerprint);
  const m = l.match(/^(.*) \(([^()]*)\)$/);
  if (m) {
    const part = m[2] === "arm" ? "arm" : partWords(m[2].replace(/ /g, "_"), { fingerprint });
    return { base: m[1], part };
  }
  const last = fingerprint.split(".").slice(2).join(".") || fingerprint.split(".").pop() || "";
  return { base: l, part: last ? partWords(last, { fingerprint }) : "" };
}

/** The base label without its part suffix. */
export const baseLabel = (label: string, fingerprint = ""): string => splitLabel(label, fingerprint).base;

// ---------------------------------------------------------------- titles

export interface Titled {
  label?: string;
  fingerprint: string;
  rule: string;
  route: string;
  source?: string;
  supersedes?: string | null;
}

const NOUN: [RegExp, string][] = [
  [/^task\.stall/, "Stall"],
  [/^task\.missed_grasp_sequence/, "Missed grasps"],
  [/^task\.missed_grasp/, "Missed grasp"],
  [/^actuation\.not_following/, "Joint stopped following"],
];

/** The problem as a noun, for titles built around it: "Stall", "Missed grasps". */
function noun(fp: string, route: string, label?: string): string {
  const head = route.split(",")[0];
  if (/^\d+ missed grasps? in a row/.test(head) || /missed grasps/.test(head)) return "Missed grasps";
  if (/^stall of/.test(head)) return "Stall";
  for (const [re, n] of NOUN) if (re.test(fp)) return n;
  return sentence(baseLabel(label ?? fp, fp));
}

/** Display title for an incident or live row. */
export function displayTitle(s: Titled): string {
  const fp = s.fingerprint;
  const route = s.route ?? "";
  if (s.rule === "R5" && route.includes("also has")) return `${noun(fp, route, s.label)} on an arm with a standing fault`;
  if (s.rule === "R1b" && s.supersedes) {
    const m = route.match(/froze (\d+) times/);
    if (m) return `Same camera froze ${m[1]} times in this recording`;
  }
  const after = route.split("right after this:")[1];
  if (after != null && /camera \S+ froze/.test(after)) {
    const head = route.split("right after this:")[0];
    const n = /^stall of/.test(head) ? "Stall" : /missed grasps? in a row|empty close/.test(head) ? "Missed grasps" : noun(fp, route, s.label);
    return `${n} right after the camera froze`;
  }
  if (s.rule === "R1" && fp.startsWith("sensing.stale_state")) return "Joint stream froze and came back";
  if (fp.startsWith("sensing.stale_camera") && s.label) {
    const b = baseLabel(s.label, fp);
    if (/^scene camera/.test(b)) return "Scene camera froze while the arm moved";
    if (/^wrist camera/.test(b)) return "Wrist camera froze while the arm moved";
  }
  return sentence(baseLabel(s.label ?? fp, fp));
}

// ---------------------------------------------------------------- rungs

export const RUNG_NAME: Record<number, string> = {
  1: "Robot can clear it",
  2: "Ticket for a named part",
  3: "Send to training",
  4: "A person has to look",
};
export const RUNG_SHORT: Record<number, string> = { 1: "robot", 2: "ticket", 3: "training", 4: "a person" };
export const RUNG_WHO: Record<number, string> = { 1: "Robot", 2: "Hardware", 3: "Training", 4: "A person" };
export const FIX_WORD: Record<number, string> = { 1: "robot", 2: "ticket", 3: "training", 4: "person" };

export const fixByOf = (rung: number, fix?: string): string =>
  fix && fix !== "none" ? fix : FIX_WORD[rung] ?? "";

// ---------------------------------------------------------------- scope

export const scopeShort = (scope: string): string => (/sampled/.test(scope) ? "sampled, cameras" : "all runs, joints");
export const scopeLine = (scope: string): string =>
  /sampled/.test(scope) ? "on sampled runs, cameras checked" : "on all runs, joint and data checks";

// ---------------------------------------------------------------- age

/** "updated 0.4 s ago": one decimal under 10 s, whole seconds after, minutes past a minute. */
export function agoShort(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  if (seconds < 10) return `${seconds.toFixed(1)} s ago`;
  if (seconds < 60) return `${Math.floor(seconds)} s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  return `${Math.floor(seconds / 3600)} h ago`;
}

/** Nice round y max: rounded up to one decimal from 1 up (2.5, 8.8, 12.3), two significant
 *  digits below 1 (0.27). */
export function niceMax(v: number): number {
  if (!(v > 0)) return 1;
  if (v >= 1) return Math.ceil(v * 10 - 1e-9) / 10;
  const p = Math.pow(10, Math.floor(Math.log10(v)) - 1);
  return Math.ceil(v / p - 1e-9) * p;
}

/** Format a y axis value to match niceMax's precision. */
export function axisNum(v: number): string {
  if (v === 0) return "0";
  if (Math.abs(v) >= 1) return fixed(v, 1);
  const d = Math.max(0, 1 - Math.floor(Math.log10(Math.abs(v))));
  return fixed(Number(v.toFixed(d)), d);
}
