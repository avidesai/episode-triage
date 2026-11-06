import { computed, signal } from "@preact/signals";
import { data, fleetLoad } from "./data";
import { baseLabel, displayTitle, partWords, splitLabel } from "./format";
import type { Query } from "./router";
import { statusOf, workflow, type Status } from "./state";
import type { Arm, InboxRow, Summary } from "./types";

// Values the screens compute from data.json and fleet.json. Nothing here is a typed number;
// every count is counted from the files.

// ---------------------------------------------------------------- problems

/** A problem as the Queue lists it: an inbox row, or a group built from incidents whose
 *  fingerprint has no inbox row. */
export interface Problem {
  fingerprint: string;
  label: string;
  rung: number;
  layer: string;
  part: string;
  base: string;
  example: string;
  scope: string;
  count: number;
  robots: number;
  recurring: boolean;
  priority: number;
  extra: boolean;
}

export const incidentsByFp = computed(() => {
  const m = new Map<string, Summary[]>();
  for (const s of data.value?.incidents ?? []) {
    const a = m.get(s.fingerprint);
    if (a) a.push(s);
    else m.set(s.fingerprint, [s]);
  }
  return m;
});

const fromInbox = (r: InboxRow): Problem => {
  const { base, part } = splitLabel(r.label, r.fingerprint);
  return {
    fingerprint: r.fingerprint,
    label: r.label,
    rung: r.rung,
    layer: r.layer,
    part,
    base,
    example: r.example,
    scope: r.scope,
    count: r.count,
    robots: r.robots,
    recurring: r.recurring,
    priority: r.priority,
    extra: false,
  };
};

/** Every problem in priority order, then the problemless groups by bundled count. */
export const problems = computed<Problem[]>(() => {
  const d = data.value;
  if (!d) return [];
  const inbox = d.inbox.slice().sort((a, b) => b.priority - a.priority).map(fromInbox);
  const known = new Set(d.inbox.map((r) => r.fingerprint));
  const extra: Problem[] = [];
  for (const [fp, list] of incidentsByFp.value) {
    if (known.has(fp)) continue;
    const rungs = new Map<number, number>();
    for (const s of list) rungs.set(s.rung, (rungs.get(s.rung) ?? 0) + 1);
    const rung = [...rungs.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
    const label = list[0].label ?? fp;
    const { base, part } = splitLabel(label, fp);
    extra.push({
      fingerprint: fp,
      label,
      rung,
      layer: list[0].layer,
      part,
      base,
      example: list[0].route,
      scope: fp.startsWith("sensing.stale_camera") || /camera/.test(fp) ? "sampled arms with cameras checked" : "all arms, joint and data checks",
      count: list.length,
      robots: new Set(list.map((s) => s.robot_id)).size,
      recurring: false,
      priority: -Infinity,
      extra: true,
    });
  }
  extra.sort((a, b) => b.count - a.count || a.fingerprint.localeCompare(b.fingerprint));
  return [...inbox, ...extra];
});

export const problemByFp = computed(() => new Map(problems.value.map((p) => [p.fingerprint, p])));

/** Problem status: new unless every bundled incident is acknowledged or resolved. */
export function problemStatus(fp: string, wf = workflow.value): Status {
  const list = incidentsByFp.value.get(fp) ?? [];
  if (!list.length) return "new";
  let allRes = true;
  for (const s of list) {
    const st = statusOf(s.id, wf);
    if (st === "new") return "new";
    if (st !== "resolved") allRes = false;
  }
  return allRes ? "resolved" : "ack";
}

// ---------------------------------------------------------------- ladder

export interface LaneData {
  rung: number;
  total: number;
  problems: number;
  scopes: { scope: string; sum: number }[];
  top: InboxRow[];
}

export const lanes = computed<LaneData[]>(() => {
  const d = data.value;
  if (!d) return [];
  return [1, 2, 3, 4].map((rung) => {
    const rows = d.inbox.filter((r) => r.rung === rung);
    const scopes = new Map<string, number>();
    for (const r of rows) scopes.set(r.scope, (scopes.get(r.scope) ?? 0) + r.count);
    const order = ["all arms, joint and data checks", "sampled arms with cameras checked"];
    return {
      rung,
      total: rows.reduce((a, r) => a + r.count, 0),
      problems: rows.length,
      scopes: [...scopes.entries()]
        .sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]))
        .map(([scope, sum]) => ({ scope, sum })),
      top: rows.slice().sort((a, b) => b.count - a.count).slice(0, 3),
    };
  });
});

/** Top 7 by priority, with every rung present: a missing rung replaces the lowest priority row
 *  of the most represented rung with its own top problem. */
export const startHere = computed<InboxRow[]>(() => {
  const d = data.value;
  if (!d) return [];
  const byP = d.inbox.slice().sort((a, b) => b.priority - a.priority);
  const pick = byP.slice(0, 7);
  for (const rung of [1, 2, 3, 4]) {
    if (pick.some((r) => r.rung === rung)) continue;
    const best = byP.find((r) => r.rung === rung);
    if (!best) continue;
    const counts = new Map<number, number>();
    for (const r of pick) counts.set(r.rung, (counts.get(r.rung) ?? 0) + 1);
    const most = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const lowest = pick.filter((r) => r.rung === most).sort((a, b) => a.priority - b.priority)[0];
    pick.splice(pick.indexOf(lowest), 1, best);
  }
  return pick.sort((a, b) => b.priority - a.priority);
});

// ---------------------------------------------------------------- queue filters and order

export interface Filters {
  rung?: number;
  layer?: string;
  arm?: string;
  rule?: string;
  status?: Status;
  q?: string;
}

export function filtersOf(q: Query): Filters {
  const f: Filters = {};
  if (q.rung && /^[1-4]$/.test(q.rung)) f.rung = +q.rung;
  if (q.layer) f.layer = q.layer;
  if (q.arm) f.arm = q.arm;
  if (q.rule) f.rule = q.rule;
  if (q.status === "new" || q.status === "ack" || q.status === "resolved") f.status = q.status;
  if (q.q?.trim()) f.q = q.q.trim().toLowerCase();
  return f;
}

export const hasFilters = (f: Filters): boolean => Object.keys(f).length > 0;

/** Text an incident can be searched by. */
function haystack(s: Summary): string {
  const p = problemByFp.value.get(s.fingerprint);
  return [s.robot_id, s.id, partWords(s.component ?? ""), s.component ?? "", s.label ?? "", p?.label ?? "", s.route, s.rule, s.fingerprint]
    .join(" ")
    .toLowerCase();
}

/** Search accepts "21" or "0021" as an arm number. */
function searchMatch(text: string, q: string): boolean {
  if (text.includes(q)) return true;
  if (/^\d{1,4}$/.test(q)) return text.includes("arm " + q.padStart(4, "0"));
  return false;
}

export function incidentPasses(s: Summary, f: Filters, wf = workflow.value): boolean {
  if (f.rung != null) {
    const pr = problemByFp.value.get(s.fingerprint)?.rung;
    if (s.rung !== f.rung && pr !== f.rung) return false;
  }
  if (f.layer && s.layer !== f.layer) return false;
  if (f.arm && s.robot_id !== f.arm) return false;
  if (f.rule && s.rule !== f.rule) return false;
  if (f.status && statusOf(s.id, wf) !== f.status) return false;
  if (f.q && !searchMatch(haystack(s), f.q)) return false;
  return true;
}

/** The incidents view order: problem priority (no problem last), rung descending, arm, time. */
export const baseOrder = computed<Summary[]>(() => {
  const d = data.value;
  if (!d) return [];
  const pri = new Map(d.inbox.map((r) => [r.fingerprint, r.priority]));
  return d.incidents.slice().sort((a, b) => {
    const pa = pri.get(a.fingerprint) ?? -Infinity;
    const pb = pri.get(b.fingerprint) ?? -Infinity;
    if (pa !== pb) return pb - pa;
    if (a.rung !== b.rung) return b.rung - a.rung;
    if (a.robot_id !== b.robot_id) return a.robot_id < b.robot_id ? -1 : 1;
    return a.t - b.t;
  });
});

export function orderFor(f: Filters, wf = workflow.value): Summary[] {
  if (!hasFilters(f)) return baseOrder.value;
  return baseOrder.value.filter((s) => incidentPasses(s, f, wf));
}

/** The list the viewer last came from, so the Incident pager walks it. */
export const lastQueue = signal<{ ids: string[]; q: Query } | null>(null);

export function pagerOrder(id: string): { ids: string[]; q: Query } {
  const lq = lastQueue.value;
  if (lq && lq.ids.includes(id)) return lq;
  return { ids: baseOrder.value.map((s) => s.id), q: {} };
}

// ---------------------------------------------------------------- short names

const SHORT: [RegExp, string][] = [
  [/^actuation\.rest_offset/, "offset at rest"],
  [/^actuation\.gain_mismatch/, "calibrated over different spans"],
  [/^actuation\.not_following/, "not following"],
  [/^actuation\.not_tracking/, "not tracking"],
  [/^actuation\.bus_glitch/, "bad bus reads"],
  [/^actuation\.pinned/, "pinned at its limit"],
  [/^actuation\.command_wrap/, "leader angle wrap"],
  [/^sensing\.stale_state/, "joint stream repeated"],
  [/^sensing\.duplicated_rows/, "rows repeated"],
  [/^sensing\.stale_camera/, "camera froze"],
  [/^task\.stall/, "stall"],
  [/^task\.missed_grasp_sequence/, "missed grasps in a row"],
  [/^task\.missed_grasp/, "single missed grasp"],
  [/^integrity\.short/, "run under 2 s"],
  [/^integrity\.frame_index/, "frame index gaps"],
  [/^integrity\.frame_count/, "row counts disagree"],
];

/** "offset at rest, wrist flex" for the palette. */
export function shortProblem(p: { fingerprint: string; part: string; base: string }): string {
  const hit = SHORT.find(([re]) => re.test(p.fingerprint));
  const name = hit ? hit[1] : p.base;
  return p.part && p.part !== "arm" ? `${name}, ${p.part}` : name;
}

export const titleOf = (s: Summary): string => displayTitle(s);
export const problemTitle = (s: Summary): string => sentenceBase(s);
function sentenceBase(s: Summary): string {
  const b = baseLabel(s.label ?? s.fingerprint, s.fingerprint);
  return b ? b[0].toUpperCase() + b.slice(1) : b;
}

// ---------------------------------------------------------------- fleet and arms

export const fleetArms = computed<Arm[]>(() => (fleetLoad.value?.state === "ok" ? fleetLoad.value.value.arms : []));
export const armById = computed(() => new Map(fleetArms.value.map((a) => [a.id, a])));

export type Verdict = "hardware and behavior" | "hardware" | "behavior" | "robot cleared" | "data only" | "clean";
export const VERDICT_ORDER: Verdict[] = ["hardware and behavior", "hardware", "behavior", "robot cleared", "data only", "clean"];

export function verdictOf(a: Arm): Verdict {
  const hw = (a.hw["2"] ?? 0) + (a.hw["4"] ?? 0) > 0;
  const beh = !!a.task && (a.task["3"] ?? 0) + (a.task["4"] ?? 0) > 0;
  if (hw && beh) return "hardware and behavior";
  if (hw) return "hardware";
  if (beh) return "behavior";
  if ((a.hw["1"] ?? 0) > 0 || (a.task?.["1"] ?? 0) > 0) return "robot cleared";
  if (a.data > 0) return "data only";
  return "clean";
}

export const tickets = (a: Arm): number => a.hw["2"] ?? 0;

/** Parts named by an arm's recurring problems, most frequent first. */
export function recurringParts(a: Arm): string[] {
  const n = new Map<string, number>();
  for (const r of a.recurring) {
    const p = splitLabel(r).part;
    if (p) n.set(p, (n.get(p) ?? 0) + 1);
  }
  return [...n.entries()].sort((x, y) => y[1] - x[1]).map(([p]) => p);
}

/** "Mostly": the most frequent recurring part, else from the arm's bundled incidents. */
export function mostlyOf(a: Arm, byId: Map<string, Summary>): string {
  const parts = recurringParts(a);
  if (parts.length) return parts[0];
  const n = new Map<string, number>();
  for (const id of a.bundled) {
    const s = byId.get(id);
    if (!s) continue;
    const w = s.fingerprint.startsWith("task.stall")
      ? "stalls"
      : s.fingerprint.startsWith("task.missed_grasp")
        ? "missed grasps"
        : partWords(s.component ?? "", { fingerprint: s.fingerprint });
    n.set(w, (n.get(w) ?? 0) + 1);
  }
  return [...n.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] ?? "";
}

/** "wrist flex keeps coming up" when every recurring problem is on one part. */
export function armHeadline(a: Arm): { title: string; one: string | null; parts: string[] } {
  const parts = recurringParts(a);
  if (parts.length === 1) return { title: `${parts[0]} keeps coming up`, one: parts[0], parts };
  if (parts.length > 1) return { title: `${a.recurring.length} problems recur on this arm`, one: null, parts };
  return { title: "", one: null, parts };
}
