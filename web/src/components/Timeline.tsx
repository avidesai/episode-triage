import { useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import { nice, short } from "../format";
import type { Bundle, TEvent } from "../types";

// The incident timeline: one panel per joint (command dashed, position solid, percent of
// range) and per camera (picture change as a line, arm motion as a soft band behind it),
// with bands for what started it, what a person would see, context, and injected truth.
// Drawn at the container's real pixel width so text stays the same size everywhere.

export type BandKind = "cause" | "anchor" | "context" | "truth";
export interface Band {
  t0: number;
  t1: number;
  kind: BandKind;
  label: string;
  key?: string;
}

export const evKey = (e: TEvent) => `${e.check}|${e.component}|${e.t_start}`;
const tAbs = (e: TEvent) => (e.t_abs != null ? e.t_abs : e.t_start);
const tEnd = (e: TEvent) => tAbs(e) + (e.t_end - e.t_start);

export function clipSpan(b: Bundle): number {
  const t = b.clip.t;
  return t && t.length > 1 ? t[t.length - 1] - t[0] : 0;
}

/** A fault that holds for most of the clip is a standing fault of the run, not a moment. */
export function isStanding(e: TEvent, span: number): boolean {
  return span > 0 && e.t_end - e.t_start > 0.8 * span;
}

export function bandsFor(b: Bundle): Band[] {
  const inc = b.incident;
  const out: Band[] = [];
  const span = clipSpan(b);
  for (const tr of b.truth || [])
    out.push({ t0: tr.t0, t1: tr.t1, kind: "truth", label: "injected: " + nice(tr.fault) + (tr.target ? " on " + nice(tr.target) : "") });
  if (inc.anchor) out.push({ t0: tAbs(inc.anchor), t1: tEnd(inc.anchor), kind: "anchor", label: "what a person would see", key: evKey(inc.anchor) });
  const c = inc.cause;
  if (c && !isStanding(c, span) && (!inc.anchor || c.t_start !== inc.anchor.t_start || c.check !== inc.anchor.check))
    out.push({ t0: tAbs(c), t1: Math.max(tEnd(c), tAbs(c) + 0.15), kind: "cause", label: "what started it", key: evKey(c) });
  for (const e of (inc.related || []).filter((e) => !isStanding(e, span)))
    out.push({ t0: tAbs(e), t1: Math.max(tEnd(e), tAbs(e) + 0.1), kind: "cause", label: "", key: evKey(e) });
  for (const e of inc.context || []) out.push({ t0: tAbs(e), t1: Math.max(tEnd(e), tAbs(e) + 0.1), kind: "context", label: "", key: evKey(e) });
  return out;
}

interface Series {
  y: number[];
  kind: "cmd" | "pos" | "change" | "motion";
}
interface Panel {
  label: string;
  series: Series[];
  ylim?: [number, number];
  readout: (i: number) => string;
}

function panelsFor(clip: Bundle["clip"]): Panel[] {
  const panels: Panel[] = [];
  for (const [name, j] of Object.entries(clip.joints)) {
    panels.push({
      label: j.gripper ? "gripper" : nice(name),
      series: [
        { y: j.cmd, kind: "cmd" },
        { y: j.pos, kind: "pos" },
      ],
      readout: (i) => `command ${fmt(j.cmd[i])}%, position ${fmt(j.pos[i])}%`,
    });
  }
  for (const [k, c] of Object.entries(clip.cams)) {
    panels.push({
      label: short(k) + " camera",
      series: [
        { y: c.motion.map((v) => Math.min(6, v * 0.6)), kind: "motion" },
        { y: c.change.map((v) => Math.min(6, v)), kind: "change" },
      ],
      ylim: [0, 6],
      readout: (i) => `picture change ${fmt(c.change[i], 2)}, arm motion ${fmt(c.motion[i], 2)}%`,
    });
  }
  return panels;
}

const fmt = (v: number | undefined, d = 1) => (v == null || !Number.isFinite(v) ? "n/a" : v.toFixed(d));

function lowerBound(a: number[], x: number): number {
  let lo = 0,
    hi = a.length;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (a[m] < x) lo = m + 1;
    else hi = m;
  }
  return lo;
}

const STEPS = [0.5, 1, 2, 5, 10, 20, 30, 60, 120];
const BAND_LABEL: Record<BandKind, string> = {
  cause: "what started it",
  anchor: "what a person would see",
  context: "after it (context)",
  truth: "injected on purpose (ground truth)",
};

export function Timeline({ bundle, highlight }: { bundle: Bundle; highlight?: string | null }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(640);
  const [zoom, setZoom] = useState<"all" | "focus">("all");
  const [hover, setHover] = useState<number | null>(null);

  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    setW(Math.max(260, Math.floor(el.clientWidth)));
    const ro = new ResizeObserver(([e]) => setW(Math.max(260, Math.floor(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const clip = bundle.clip;
  const t = clip.t;
  const bands = useMemo(() => bandsFor(bundle), [bundle]);
  const panels = useMemo(() => panelsFor(clip), [clip]);

  if (!t || t.length < 2)
    return <p class="muted">No signal clip for this incident (the run failed an integrity check).</p>;

  const full: [number, number] = [t[0], t[t.length - 1]];
  const key = bands.filter((b) => b.kind !== "context");
  let focus: [number, number] | null = null;
  if (key.length) {
    const a = Math.max(full[0], Math.min(...key.map((b) => b.t0)) - 1.5);
    const z = Math.min(full[1], Math.max(...key.map((b) => b.t1)) + 1.5);
    if (z - a < 0.8 * (full[1] - full[0]) && z - a > 0.5) focus = [a, z];
  }
  const [d0, d1] = zoom === "focus" && focus ? focus : full;

  const kinds = new Set(bands.map((b) => b.kind));
  const left = 4,
    right = 4,
    labelRows = bands.some((b) => b.label) ? 2 : 0,
    top = 6 + labelRows * 15,
    ph = 52,
    gap = 26,
    axis = 20;
  const plotW = w - left - right;
  const h = top + panels.length * (ph + gap) + axis;
  const X = (v: number) => left + ((v - d0) / Math.max(d1 - d0, 1e-9)) * plotW;
  const i0 = Math.max(0, lowerBound(t, d0) - 1);
  const i1 = Math.min(t.length - 1, lowerBound(t, d1) + 1);
  const step = Math.max(1, Math.floor((i1 - i0) / (plotW / 1.5)));

  const span = d1 - d0;
  const stepT = STEPS.find((s) => span / s <= Math.max(3, Math.floor(plotW / 80))) ?? 300;
  const ticks: number[] = [];
  for (let v = Math.ceil(d0 / stepT) * stepT; v <= d1 + 1e-9; v += stepT) ticks.push(+v.toFixed(3));

  const onMove = (ev: PointerEvent) => {
    const r = (ev.currentTarget as SVGElement).getBoundingClientRect();
    const tv = d0 + ((ev.clientX - r.left - left) / plotW) * (d1 - d0);
    let i = lowerBound(t, tv);
    if (i > 0 && (i >= t.length || Math.abs(t[i - 1] - tv) < Math.abs(t[i] - tv))) i -= 1;
    setHover(Math.max(i0, Math.min(i1, i)));
  };

  let labelled = 0;
  return (
    <div class="tl-wrap">
      <div class="tl-bar">
        <div class="legend" aria-label="Legend">
          {(["cause", "anchor", "context", "truth"] as BandKind[])
            .filter((k) => kinds.has(k))
            .map((k) => (
              <span key={k}>
                <i class={`sw ${k}`} />
                {BAND_LABEL[k]}
              </span>
            ))}
          <span class="legend-lines">
            <i class="ln-cmd" />
            command <i class="ln-pos" />
            position or picture change <i class="sw motion" />
            arm motion
          </span>
        </div>
        {focus ? (
          <div class="seg" role="group" aria-label="Zoom">
            <button aria-pressed={zoom === "all"} onClick={() => setZoom("all")}>
              Whole clip
            </button>
            <button aria-pressed={zoom === "focus"} onClick={() => setZoom("focus")}>
              Around the failure
            </button>
          </div>
        ) : null}
      </div>
      <div class="tl" ref={wrap}>
        <svg
          width={w}
          height={h}
          viewBox={`0 0 ${w} ${h}`}
          role="img"
          aria-label={`Timeline of ${panels.map((p) => p.label).join(", ")} from ${d0.toFixed(1)} to ${d1.toFixed(1)} s`}
          onPointerMove={onMove}
          onPointerLeave={() => setHover(null)}
        >
          <defs>
            <clipPath id={`clip-${bundle.id.replace(/\W/g, "")}`}>
              <rect x={left} y={0} width={plotW} height={h} />
            </clipPath>
          </defs>
          <g clip-path={`url(#clip-${bundle.id.replace(/\W/g, "")})`}>
            {bands.map((b, k) => {
              const x0 = X(Math.max(b.t0, d0)),
                x1 = X(Math.min(b.t1, d1));
              if (x1 < left || x0 > left + plotW) return null;
              const hl = highlight && b.key === highlight;
              let lab = null;
              if (b.label) {
                const anchorEnd = x0 > left + 0.6 * plotW;
                lab = (
                  <text class={`bl ${b.kind}`} x={anchorEnd ? x1 - 3 : x0 + 3} y={13 + 15 * (labelled++ % 2)} text-anchor={anchorEnd ? "end" : "start"}>
                    {b.label}
                  </text>
                );
              }
              return (
                <g key={k}>
                  <rect class={`band ${b.kind} ${hl ? "hl" : ""}`} x={x0} y={top - 2} width={Math.max(x1 - x0, 2)} height={h - top - axis + 2} />
                  {lab}
                </g>
              );
            })}
            {panels.map((p, pi) => {
              const y0 = top + pi * (ph + gap) + 16;
              let lo: number, hi: number;
              if (p.ylim) [lo, hi] = p.ylim;
              else {
                const all: number[] = [];
                for (const s of p.series) for (let i = i0; i <= i1; i++) if (Number.isFinite(s.y[i])) all.push(s.y[i]);
                all.sort((a, b) => a - b);
                lo = all[Math.floor(all.length * 0.01)] ?? 0;
                hi = all[Math.floor(all.length * 0.99)] ?? 1;
                const pad = 0.1 * (hi - lo || 1);
                lo -= pad;
                hi += pad;
              }
              const Y = (v: number) => y0 + ph - ((Math.min(hi, Math.max(lo, v)) - lo) / Math.max(hi - lo, 1e-9)) * ph;
              return (
                <g key={pi}>
                  <text class="pl" x={left} y={y0 - 5}>
                    {p.label}
                  </text>
                  {hover != null ? (
                    <text class="pv" x={left + plotW} y={y0 - 5} text-anchor="end">
                      {p.readout(hover)}
                    </text>
                  ) : null}
                  <line class="axis" x1={left} x2={left + plotW} y1={y0 + ph} y2={y0 + ph} />
                  {p.series.map((s, si) => {
                    const pts: string[] = [];
                    for (let i = i0; i <= i1; i += step) if (Number.isFinite(s.y[i])) pts.push(`${X(t[i]).toFixed(1)},${Y(s.y[i]).toFixed(1)}`);
                    if (!pts.length) return null;
                    if (s.kind === "motion") {
                      const base = (y0 + ph).toFixed(1);
                      const first = pts[0].split(",")[0],
                        last = pts[pts.length - 1].split(",")[0];
                      return <path key={si} class="s-motion" d={`M${first},${base} L${pts.join(" L")} L${last},${base} Z`} />;
                    }
                    return <path key={si} class={`s-${s.kind}`} d={`M${pts.join(" L")}`} />;
                  })}
                </g>
              );
            })}
          </g>
          {ticks.map((v) => (
            <text key={v} class="tick" x={X(v)} y={h - 5} text-anchor="middle">
              {+v.toFixed(1)} s
            </text>
          ))}
          {hover != null ? (
            <g class="cursor">
              <line x1={X(t[hover])} x2={X(t[hover])} y1={top - 2} y2={h - axis} />
              <text x={Math.min(X(t[hover]) + 4, w - 40)} y={h - axis - 4}>
                {t[hover].toFixed(2)} s
              </text>
            </g>
          ) : null}
        </svg>
      </div>
    </div>
  );
}
