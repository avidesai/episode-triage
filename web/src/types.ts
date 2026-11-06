// Shapes of the JSON the engine writes. See episode_triage/site.py and monitor.py.

export type FixBy = "robot" | "ticket" | "training" | "person" | "none";
export type Layer = "sensing" | "actuation" | "task" | "integrity";

export interface Fleet {
  name: string;
  robots: number;
  runs: number;
  hours: number;
  sampled_robots: number;
  sampled_runs: number;
  dataset: string;
  revision: string;
}

export interface InboxRow {
  fingerprint: string;
  label: string;
  rung: number;
  rung_name: string;
  fix_by: FixBy;
  layer: Layer;
  robots: number;
  episodes: number;
  count: number;
  recurring: boolean;
  priority: number;
  example: string;
  scope: string;
  examples: string[];
}

export interface Summary {
  id: string;
  robot_id: string;
  run: number | string | null;
  t: number;
  rung: number;
  rung_name: string;
  rule: string;
  route: string;
  fingerprint: string;
  layer: Layer;
  self_recovery: string | null;
  source: string;
  bundle: string;
  fix_by?: FixBy;
  label?: string;
  component?: string;
  /** Rung 4 (R5): the standing faults on the same recording the rule cited. */
  co_faults?: { label: string; component: string }[];
}

export interface Rule {
  rule: string;
  rung: number;
  rung_name: string;
  when: string;
  to: string;
  count_sample: number;
  count_fleet: number;
}

export interface Check {
  layer: Layer;
  id: string;
  name: string;
  signal: string;
  threshold: string;
  why: string;
}

export interface FaultScore {
  n: number;
  caught: number;
  caught_low_confidence: number;
  missed: number;
  abstained: number;
  right_rung: number;
  other_rungs: Record<string, number>;
  new_other_events: number;
}

export interface Validation {
  summary: {
    faults: Record<string, FaultScore>;
    lag: { n: number; estimated: number; within_1_of_3: number; shift_counts?: Record<string, number> };
  };
  calibration: {
    stale_tau_e: number;
    n_frozen_frames: number;
    n_moving_frames: number;
    robots: string[];
    note?: string;
  };
}

export interface Bench {
  rows: { episode: number; fault: string; target: string; caught: boolean | number; rung: number; expect_rung: number; onset_err_s?: number }[];
  stale_frames?: { true_stale: number; caught: number; missed: number; false_alarm: number };
}

export interface Data {
  mode: "fleet";
  generated_at: number;
  fleet: Fleet;
  inbox: InboxRow[];
  incidents: Summary[];
  rules: Rule[];
  checks: Check[];
  thresholds: Record<string, number>;
  plain: Record<string, string>;
  findings: { joints: Record<string, any>; video: Record<string, any> };
  validation: Validation | null;
  bench: Bench | null;
}

export interface TEvent {
  check: string;
  layer: Layer;
  component: string;
  t_start: number;
  t_end: number;
  t_abs?: number;
  confidence: "high" | "medium" | "low";
  fingerprint?: string;
  evidence: Record<string, any>;
}

export interface Bundle {
  id: string;
  robot_id: string;
  t: number;
  source?: string;
  incident: {
    rule: string;
    rung: number;
    rung_name: string;
    route: string;
    self_recovery: string | null;
    fingerprint: string;
    layer: Layer;
    onset: number;
    window: [number, number];
    window_abs?: [number, number];
    cause: TEvent | null;
    anchor: TEvent | null;
    context: TEvent[];
    related: TEvent[];
    trace: string[];
    supersedes?: string;
  };
  events: TEvent[];
  clip: {
    t: number[];
    joints: Record<string, { cmd: number[]; pos: number[]; gripper: boolean }>;
    cams: Record<string, { change: number[]; motion: number[] }>;
  };
  truth: { fault: string; target: string; t0: number; t1: number }[];
  coverage: { cameras_checked: string[]; cameras_missing: string[]; run: number | string | null };
}

export interface LiveRow {
  id: string;
  robot_id: string;
  t: number;
  rung: number;
  rung_name: string;
  rule: string;
  route: string;
  fingerprint: string;
  layer: Layer;
  self_recovery: string | null;
  truth: Bundle["truth"];
  supersedes?: string | null;
  bundle: string;
  wall: number;
  fix_by?: FixBy;
  label?: string;
  component?: string;
}

export interface LiveData {
  mode: "live";
  fleet: string;
  robot_id: string;
  started_at?: number;
  generated_at: number;
  incidents: LiveRow[];
}

export interface Arm {
  id: string;
  runs: number;
  sampled: boolean;
  sampled_runs: number;
  hw: Record<string, number>;
  act_tickets: number;
  task: Record<string, number> | null;
  data: number;
  recurring: string[];
  lag: number | null;
  latest_run: number | null;
  marks: [number, number][];
  bundled: string[];
}

export interface FleetFile {
  lag_flag: number;
  recur_on_one: number;
  arms: Arm[];
}
