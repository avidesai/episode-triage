import { num } from "../format";
import type { Arm } from "../types";

/** Stacked 8 px bar: robot cleared, ticket, a person, as shares of their sum. */
export function SplitBar({ hw }: { hw: Record<string, number> }) {
  const a = hw["1"] ?? 0,
    b = hw["2"] ?? 0,
    c = hw["4"] ?? 0;
  const tot = a + b + c;
  const w = (x: number) => (tot ? `${(100 * x) / tot}%` : "0%");
  return (
    <span class="split" style="width:110px;min-width:110px" aria-hidden="true">
      <i class="s1" style={`width:${w(a)}`} />
      <i class="s2" style={`width:${w(b)}`} />
      <i class="s4" style={`width:${w(c)}`} />
    </span>
  );
}

const n = (x: number, one: string, many: string) => `${num(x)} ${x === 1 ? one : many}`;

/** "83 tickets, 2 cleared, 9 to a person", "1 ticket", "2 data problems", "none". */
export function hwText(a: Arm): string {
  const parts: string[] = [];
  if (a.hw["2"]) parts.push(n(a.hw["2"], "ticket", "tickets"));
  if (a.hw["1"]) parts.push(`${num(a.hw["1"])} cleared`);
  if (a.hw["4"]) parts.push(`${num(a.hw["4"])} to a person`);
  if (parts.length) return parts.join(", ");
  return a.data ? n(a.data, "data problem", "data problems") : "none";
}

/** "5 to training", "1 to training, 1 cleared", "clean", "not sampled". */
export function taskText(a: Arm): string {
  if (!a.sampled || !a.task) return "not sampled";
  const parts: string[] = [];
  if (a.task["3"]) parts.push(`${num(a.task["3"])} to training`);
  if (a.task["1"]) parts.push(`${num(a.task["1"])} cleared`);
  if (a.task["4"]) parts.push(`${num(a.task["4"])} to a person`);
  return parts.length ? parts.join(", ") : "clean";
}

/** One column per run, incidents stacked from the bottom as 7 px blocks by rung. */
export function RunsStrip({ a }: { a: Arm }) {
  const runs = Math.max(a.runs, 1);
  const by: number[][] = Array.from({ length: runs }, () => []);
  for (const [run, rung] of a.marks) if (run >= 0 && run < runs) by[run].push(rung);
  const withTickets = by.filter((m) => m.includes(2)).length;
  return (
    <div
      class="runs"
      role="img"
      aria-label={`Incidents per run across ${num(runs)} runs; tickets in ${num(withTickets)} of them`}
      style={`grid-template-columns:repeat(${runs},minmax(0,1fr))`}
    >
      {by.map((m, i) => (
        <span key={i} title={`run ${i}`}>
          {m.map((r, j) => (
            <i key={j} class={`s${r}`} />
          ))}
        </span>
      ))}
    </div>
  );
}

/** Streams by frames of lag behind the joints; flagged frames in rung 2 amber. */
export function LagHistogram({ lag, flag }: { lag: Record<string, number>; flag: number }) {
  const rows = Object.entries(lag)
    .map(([k, v]) => [Number(k), v] as [number, number])
    .sort((a, b) => a[0] - b[0]);
  const max = Math.max(1, ...rows.map((r) => r[1]));
  const cols = `grid-template-columns:repeat(${rows.length},minmax(0,1fr))`;
  return (
    <>
      <div style={`display:grid;${cols};gap:4px;align-items:end;height:64px`} role="img" aria-label={rows.map(([k, v]) => `${v} streams at ${k} frames`).join(", ")}>
        {rows.map(([k, v]) => (
          <div key={k} style="display:flex;flex-direction:column;align-items:center;gap:2px;justify-content:flex-end;height:100%">
            <span class="num t-3" style="font-size:10px">
              {num(v)}
            </span>
            <span style={`width:100%;height:${Math.max(2, Math.round((v / max) * 48))}px;background:${k >= flag ? "var(--r2)" : "var(--border-strong)"};border-radius:2px 2px 0 0`} />
          </div>
        ))}
      </div>
      <div style={`display:grid;${cols};gap:4px`} aria-hidden="true">
        {rows.map(([k]) => (
          <span key={k} class="num t-3" style="font-size:10.5px;text-align:center">
            {k < 0 ? "−" + Math.abs(k) : k}
          </span>
        ))}
      </div>
    </>
  );
}
