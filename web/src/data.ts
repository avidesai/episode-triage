import { computed, signal } from "@preact/signals";
import type { Bundle, Data, FleetFile, LiveData, Summary } from "./types";

// Everything the app shows comes from these files, relative to the site root:
//   data.json        the fleet, loaded at boot
//   fleet.json       one row per arm, loaded by the Fleet screen
//   incidents/*.json one bundle per incident, loaded on demand
//   live/data.json   written by a running monitor; may not exist, polled every 2 s

export type Load<T> = { state: "loading" } | { state: "ok"; value: T } | { state: "error"; error: string };

async function getJSON<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, init);
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return (await r.json()) as T;
}

// ---------------------------------------------------------------- data.json

export const dataLoad = signal<Load<Data>>({ state: "loading" });
export const data = computed(() => (dataLoad.value.state === "ok" ? dataLoad.value.value : null));

export async function loadData(): Promise<void> {
  dataLoad.value = { state: "loading" };
  try {
    dataLoad.value = { state: "ok", value: await getJSON<Data>("data.json") };
  } catch (e) {
    dataLoad.value = { state: "error", error: e instanceof Error ? e.message : String(e) };
  }
}

export const byId = computed(() => {
  const m = new Map<string, Summary>();
  for (const s of data.value?.incidents ?? []) m.set(s.id, s);
  return m;
});

/** Priority of each problem type in the inbox ranking, for the default queue order. */
export const priorityOf = computed(() => {
  const m = new Map<string, number>();
  for (const r of data.value?.inbox ?? []) m.set(r.fingerprint, r.priority);
  return m;
});

export const labelOf = computed(() => {
  const m = new Map<string, string>();
  for (const r of data.value?.inbox ?? []) m.set(r.fingerprint, r.label);
  return m;
});

// ---------------------------------------------------------------- fleet.json

export const fleetLoad = signal<Load<FleetFile> | null>(null);

export async function loadFleet(): Promise<void> {
  if (fleetLoad.value && fleetLoad.value.state !== "error") return;
  fleetLoad.value = { state: "loading" };
  try {
    fleetLoad.value = { state: "ok", value: await getJSON<FleetFile>("fleet.json") };
  } catch (e) {
    fleetLoad.value = { state: "error", error: e instanceof Error ? e.message : String(e) };
  }
}

// ---------------------------------------------------------------- bundles

const bundles = new Map<string, Promise<Bundle>>();

export function loadBundle(path: string): Promise<Bundle> {
  let p = bundles.get(path);
  if (!p) {
    p = getJSON<Bundle>(path);
    p.catch(() => bundles.delete(path));
    bundles.set(path, p);
  }
  return p;
}

/** Bundle path for an incident id: fleet incidents by summary, anything else by convention. */
export function bundlePath(id: string): string {
  return byId.value.get(id)?.bundle ?? `incidents/${id}.json`;
}

// ---------------------------------------------------------------- live/data.json

export type LiveStatus = "none" | "connected" | "lost";
export const live = signal<LiveData | null>(null);
export const liveStatus = signal<LiveStatus>("none");
/** Arrival time (ms) of incidents that landed while the page was open. */
export const arrivals = signal<Record<string, number>>({});
export const lastPollOK = signal<number>(0);

let fails = 0;
let session: number | string | null = null;
let known = new Set<string>();

async function pollLive(): Promise<void> {
  let d: LiveData | null = null;
  try {
    const r = await fetch("live/data.json", { cache: "no-store" });
    if (r.ok) {
      const v = await r.json();
      if (v && v.mode === "live" && Array.isArray(v.incidents)) d = v as LiveData;
    }
  } catch {
    d = null;
  }
  if (d) {
    fails = 0;
    const sid = d.started_at ?? d.robot_id;
    const fresh = sid !== session;
    if (fresh) {
      session = sid;
      known = new Set();
    }
    const firstLook = live.value === null || fresh;
    const now = Date.now();
    const next = fresh ? {} : { ...arrivals.value };
    let changed = fresh;
    for (const row of d.incidents) {
      if (known.has(row.id)) continue;
      known.add(row.id);
      // Incidents already in the file when the page first sees it are history, not news,
      // unless they landed in the last few seconds by the monitor's own clock.
      const landed = d.started_at != null ? (d.started_at + row.wall) * 1000 : 0;
      if (!firstLook || now - landed < 6000) {
        next[row.id] = now;
        changed = true;
      }
    }
    if (changed) arrivals.value = next;
    live.value = d;
    liveStatus.value = "connected";
    lastPollOK.value = now;
  } else {
    fails += 1;
    if (liveStatus.value === "connected" && fails >= 3) liveStatus.value = "lost";
  }
  const wait = liveStatus.value === "none" ? 4000 : 2000;
  setTimeout(pollLive, wait);
}

/** A monitor only ever runs next to `triage serve` on someone's machine. On GitHub Pages
 *  live/ never exists, so polling there would only log a 404 every few seconds. */
export const livePossible = !location.hostname.endsWith("github.io");

export function startLive(): void {
  if (livePossible) pollLive();
}
