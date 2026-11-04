import { signal } from "@preact/signals";

// Per viewer state, kept in this browser only. Every read and write is guarded: private
// windows and blocked site data make localStorage throw, and the app must still work.

export function getPref(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function setPref(key: string, value: string | null): boolean {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function storageWorks(): boolean {
  try {
    localStorage.setItem("triage.probe", "1");
    localStorage.removeItem("triage.probe");
    return true;
  } catch {
    return false;
  }
}

export const storageOK = storageWorks();

// ---------------------------------------------------------------- workflow status and notes

export type Status = "new" | "ack" | "resolved";
export interface Mark {
  s?: "ack" | "resolved";
  note?: string;
  at: number;
}

const WF_KEY = "triage.workflow.v1";

function readWorkflow(): Record<string, Mark> {
  try {
    const v = JSON.parse(getPref(WF_KEY) || "{}");
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

export const workflow = signal<Record<string, Mark>>(readWorkflow());

function writeWorkflow(next: Record<string, Mark>) {
  workflow.value = next;
  setPref(WF_KEY, JSON.stringify(next));
}

export const statusOf = (id: string, wf = workflow.value): Status => wf[id]?.s ?? "new";

export function setStatus(id: string, s: Status): void {
  const next = { ...workflow.value };
  const cur = next[id] ?? { at: 0 };
  const mark: Mark = { ...cur, at: Date.now() };
  if (s === "new") delete mark.s;
  else mark.s = s;
  if (!mark.s && !mark.note) delete next[id];
  else next[id] = mark;
  writeWorkflow(next);
}

export function setNote(id: string, note: string): void {
  const next = { ...workflow.value };
  const mark: Mark = { ...(next[id] ?? {}), at: Date.now() };
  if (note.trim()) mark.note = note.trim().slice(0, 280);
  else delete mark.note;
  if (!mark.s && !mark.note) delete next[id];
  else next[id] = mark;
  writeWorkflow(next);
}

export function clearWorkflow(): void {
  writeWorkflow({});
}

// ---------------------------------------------------------------- theme

export type Theme = "system" | "light" | "dark";
const saved = getPref("triage.theme");
export const theme = signal<Theme>(saved === "light" || saved === "dark" ? saved : "system");

export function setTheme(t: Theme): void {
  theme.value = t;
  if (t === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
  setPref("triage.theme", t === "system" ? null : t);
}
