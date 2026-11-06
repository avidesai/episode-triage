// Math for the signal timeline: ranges, scales, downsampling and ticks. No drawing here.

export type Range = [number, number];

/** Frame rate from the clip's timestamps. */
export function fpsOf(t: number[]): number {
  if (t.length < 2) return 30;
  const d = t.slice(1).map((x, i) => x - t[i]).sort((a, b) => a - b);
  const med = d[Math.floor(d.length / 2)];
  return med > 0 ? Math.round(1 / med) : 30;
}

/** Index range [i0, i1] covering [r0, r1] plus one sample each side, for continuous lines. */
export function window(t: number[], r: Range): [number, number] {
  let i0 = 0;
  while (i0 < t.length - 1 && t[i0 + 1] < r[0]) i0++;
  let i1 = t.length - 1;
  while (i1 > 0 && t[i1 - 1] > r[1]) i1--;
  return [i0, i1];
}

/** Values strictly inside the range, for scales. */
export function inRange(t: number[], v: (number | null)[], r: Range): number[] {
  const out: number[] = [];
  for (let i = 0; i < t.length; i++) if (t[i] >= r[0] - 1e-9 && t[i] <= r[1] + 1e-9 && v[i] != null && Number.isFinite(v[i]!)) out.push(v[i]!);
  return out;
}

/** Points for a polyline in the 1000 by 100 box, min/max per bucket so spikes survive. */
export function points(t: number[], v: (number | null)[], r: Range, y: (x: number) => number, max = 600): [number, number][] {
  const [i0, i1] = window(t, r);
  const n = i1 - i0 + 1;
  const xs = (tt: number) => (1000 * (tt - r[0])) / (r[1] - r[0]);
  const pts: [number, number][] = [];
  if (n <= max) {
    for (let i = i0; i <= i1; i++) if (v[i] != null) pts.push([xs(t[i]), y(v[i]!)]);
    return pts;
  }
  const per = Math.ceil(n / (max / 2));
  for (let s = i0; s <= i1; s += per) {
    let lo = s,
      hi = s;
    for (let i = s; i < Math.min(i1 + 1, s + per); i++) {
      if (v[i] == null) continue;
      if (v[lo] == null || v[i]! < v[lo]!) lo = i;
      if (v[hi] == null || v[i]! > v[hi]!) hi = i;
    }
    for (const i of lo < hi ? [lo, hi] : [hi, lo]) if (v[i] != null) pts.push([xs(t[i]), y(v[i]!)]);
  }
  return pts;
}

export const ptsAttr = (p: [number, number][]) => p.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");

/** Tick times: 0.2 s steps around a failure, 1 s on a whole clip, wider for long clips. */
export function ticks(r: Range): { t: number; label: string }[] {
  const span = r[1] - r[0];
  const step = span <= 2 ? 0.2 : span <= 4 ? 0.5 : span <= 15 ? 1 : span <= 30 ? 2 : span <= 80 ? 5 : 10;
  const out: { t: number; label: string }[] = [];
  const first = Math.ceil(r[0] / step - 1e-9) * step;
  for (let x = first; x <= r[1] + 1e-9; x += step) {
    const v = Math.round(x * 1000) / 1000;
    out.push({ t: v, label: step < 1 ? `${v.toFixed(1)} s` : `${Math.round(v)} s` });
  }
  return out;
}

/** Value at time t, nearest sample. */
export function at(t: number[], v: (number | null)[], x: number): number | null {
  let best = 0;
  for (let i = 1; i < t.length; i++) if (Math.abs(t[i] - x) < Math.abs(t[best] - x)) best = i;
  return v[best] ?? null;
}

/** "0" stays "0"; otherwise one decimal. */
export const t1 = (x: number) => (Math.abs(x) < 0.05 ? "0" : x.toFixed(1));
