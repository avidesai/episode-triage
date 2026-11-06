import type { ComponentChildren } from "preact";
import { at, inRange, points, ptsAttr, ticks, type Range } from "../chart";
import { axisNum, fixed, int, niceMax } from "../format";
import { IconArrowLeft, IconArrowRight } from "./icons";

export interface BandSpec {
  kind: "cause" | "anchor" | "ctx" | "truth" | "ignored";
  t0: number;
  t1: number;
  tag?: string;
}

export interface PanelSpec {
  key: string;
  kind: "cam" | "joint";
  words: string;
  role?: "cause" | "anchor";
  caption: string;
  height: number;
  focus?: boolean;
  last?: boolean;
  ticks?: boolean;
  /** cameras */
  change?: (number | null)[];
  motion?: (number | null)[];
  thr?: number;
  thrLabel?: boolean;
  thrNote?: string;
  typical?: number;
  /** joints */
  cmd?: number[];
  pos?: number[];
  held?: { level: number; note: string; t0: number; t1: number };
  callout?: [string, string];
  pointer?: { text: string; side: "left" | "right"; x: number; top: string; color: string; maxWidth?: number };
}

export interface Cursor {
  t: number;
  panel: string;
}

const pctX = (t: number, r: Range) => (100 * (t - r[0])) / (r[1] - r[0]);

export function TimelinePanel({
  p,
  t,
  r,
  bands,
  minBandPct,
  cursor,
  setCursor,
  fps,
  single,
}: {
  p: PanelSpec;
  t: number[];
  r: Range;
  bands: BandSpec[];
  minBandPct: number;
  cursor: Cursor | null;
  setCursor: (c: Cursor | null) => void;
  fps: number;
  single?: boolean;
}) {
  const svg: ComponentChildren[] = [];
  const labels: ComponentChildren[] = [];
  const notes: ComponentChildren[] = [];
  let readout: string[] = [];

  if (p.kind === "cam") {
    const ch = inRange(t, p.change ?? [], r);
    const ymax = niceMax(Math.max(...ch, p.focus && p.typical ? p.typical : 0, 0.0001));
    const y = (v: number) => 94 - (88 * Math.min(v, ymax * 1.05)) / ymax;
    const mo = inRange(t, p.motion ?? [], r);
    const mmax = Math.max(...mo, 1e-9);
    if (p.motion?.length && mmax > 1e-6) {
      const mp = points(t, p.motion, r, (v) => 94 - (88 * v) / mmax);
      if (mp.length) svg.push(<polygon class="mot" points={`${mp[0][0].toFixed(1)},100 ${ptsAttr(mp)} ${mp[mp.length - 1][0].toFixed(1)},100`} />);
    }
    if (p.focus) svg.push(<line class="grid-l" x1="0" y1="94" x2="1000" y2="94" vector-effect="non-scaling-stroke" />);
    if (p.typical != null && p.focus) {
      const ty = y(p.typical);
      svg.push(<line class="typ" x1="0" y1={ty} x2="1000" y2={ty} vector-effect="non-scaling-stroke" />);
      labels.push(<span class="yl" style={`top:${ty}%`}>{fixed(p.typical, 2)}</span>);
      notes.push(
        <span class="note-in t-2" style={`right:4px;top:calc(${ty}% - 18px)`}>
          typical change on this camera
        </span>,
      );
    }
    if (p.thr != null) {
      const yy = y(p.thr);
      svg.push(<line class="thr" x1="0" y1={yy} x2="1000" y2={yy} vector-effect="non-scaling-stroke" />);
      if (p.thrLabel)
        labels.push(
          <span class="yl" style={`top:${yy}%;color:var(--cause-text)`}>
            {p.thr}
          </span>,
        );
      if (p.thrNote)
        notes.push(
          <span class="note-in" style={`right:4px;top:calc(${yy}% + 4px);color:var(--cause-text)`}>
            {p.thrNote}
          </span>,
        );
    }
    svg.push(<polyline class="chg" points={ptsAttr(points(t, p.change ?? [], r, y))} style={p.focus ? "stroke-width:2.25" : undefined} vector-effect="non-scaling-stroke" />);
    labels.unshift(<span class="yl" style="top:6%">{axisNum(ymax)}</span>);
    labels.push(<span class="yl" style="top:94%">0</span>);
    if (cursor) {
      const c = at(t, p.change ?? [], cursor.t);
      const m = at(t, p.motion ?? [], cursor.t);
      readout = [`change ${c == null ? "none" : fixed(c, 2)}`, `motion ${m == null || m < 0.2 ? "none" : m < 2 ? "low" : "high"}`];
    }
  } else {
    const all = [...inRange(t, p.cmd ?? [], r), ...inRange(t, p.pos ?? [], r)];
    let lo = Math.min(...all),
      hi = Math.max(...all);
    if (!(hi - lo > 1e-6)) {
      lo -= 1;
      hi += 1;
    }
    const y = (v: number) => 90 - (80 * (v - lo)) / (hi - lo);
    if (p.held) {
      // the area between the command and where the joint held, during the cause
      const r2: Range = [Math.max(r[0], p.held.t0), Math.min(r[1], p.held.t1)];
      if (r2[1] > r2[0]) {
        const sub = (v: number[]) => points(t, v, r2, y).map(([x, yy]) => [r2[0] + ((r2[1] - r2[0]) * x) / 1000, yy] as [number, number]);
        const toX = (tt: number) => (1000 * (tt - r[0])) / (r[1] - r[0]);
        const a = sub(p.pos!).map(([tt, yy]) => `${toX(tt).toFixed(1)},${yy.toFixed(1)}`);
        const b = sub(p.cmd!)
          .reverse()
          .map(([tt, yy]) => `${toX(tt).toFixed(1)},${yy.toFixed(1)}`);
        svg.push(<polygon class="gap" points={[...a, ...b].join(" ")} />);
      }
    }
    svg.push(<polyline class="cmd" points={ptsAttr(points(t, p.cmd ?? [], r, y))} vector-effect="non-scaling-stroke" />);
    svg.push(<polyline class="pos" points={ptsAttr(points(t, p.pos ?? [], r, y))} vector-effect="non-scaling-stroke" />);
    labels.push(<span class="yl" style="top:10%">{int(hi)}</span>);
    if (p.held) {
      const hy = y(p.held.level);
      if (hy > 16 && hy < 84)
        labels.push(
          <span class="yl" style={`top:${hy}%;color:var(--cause-text)`}>
            {fixed(p.held.level, 1)}
          </span>,
        );
      notes.push(
        <span class="note-in" style={`left:8px;top:calc(${hy}% - 20px);color:var(--cause-text)`}>
          {p.held.note}
        </span>,
      );
    }
    labels.push(<span class="yl" style="top:90%">{int(lo)}</span>);
    if (cursor) {
      const c = at(t, p.cmd ?? [], cursor.t);
      const q = at(t, p.pos ?? [], cursor.t);
      readout = [`command ${c == null ? "none" : fixed(c, 1)}`, `position ${q == null ? "none" : fixed(q, 1)}`];
    }
  }

  const bandEls = bands
    .filter((b) => b.t1 >= r[0] && b.t0 <= r[1])
    .map((b, i) => {
      let left = pctX(Math.max(b.t0, r[0]), r);
      let w = pctX(Math.min(b.t1, r[1]), r) - left;
      if (w < minBandPct) {
        left -= (minBandPct - w) / 2;
        w = minBandPct;
      }
      if (b.kind === "ignored")
        return (
          <div key={i} class="band" style={`left:${left}%;width:${w}%;background:repeating-linear-gradient(135deg,var(--sunken) 0 4px,transparent 4px 9px)`}>
            {b.tag ? <span class="band-tag t-3">{b.tag}</span> : null}
          </div>
        );
      return (
        <div key={i} class={`band ${b.kind}`} style={`left:${left}%;width:${w}%`}>
          {b.tag ? <span class="band-tag">{b.tag}</span> : null}
        </div>
      );
    });

  const main = bands.find((b) => b.kind === "cause") ?? bands.find((b) => b.kind === "anchor");
  let callout = null;
  if (p.callout && main) {
    const bl = pctX(Math.max(main.t0, r[0]), r);
    const br = pctX(Math.min(main.t1, r[1]), r);
    callout =
      br - bl < 25 && bl >= 100 - br - 5 ? (
        <div class="callout" style={`left:calc(${bl}% - 8px);top:4px;transform:translateX(-100%)`}>
          <b>{p.callout[0]}</b>
          <span class="mono">{p.callout[1]}</span>
        </div>
      ) : (
        <div class="callout" style={`left:calc(${bl}% + 8px);top:24px`}>
          <b>{p.callout[0]}</b>
          <span class="mono">{p.callout[1]}</span>
        </div>
      );
  }

  const ptr = p.pointer;
  const pointer = ptr ? (
    <div
      class="pointer"
      style={`${ptr.side === "left" ? `left:${ptr.x}%` : `right:${100 - ptr.x}%;text-align:right`};top:${ptr.top};color:${ptr.color}${ptr.maxWidth ? `;max-width:${ptr.maxWidth}px` : ""}`}
    >
      {ptr.side === "left" ? <IconArrowLeft /> : null}
      {ptr.text}
      {ptr.side === "right" ? <IconArrowRight /> : null}
    </div>
  ) : null;

  const tk = p.ticks ? ticks(r) : [];
  const hover = cursor && cursor.t >= r[0] && cursor.t <= r[1];
  const cx = hover ? pctX(cursor!.t, r) : 0;

  const fromEvent = (e: MouseEvent) => {
    const el = e.currentTarget as HTMLElement;
    const box = el.getBoundingClientRect();
    const f = Math.max(0, Math.min(1, (e.clientX - box.left) / box.width));
    setCursor({ t: r[0] + f * (r[1] - r[0]), panel: p.key });
  };
  const onKey = (e: KeyboardEvent) => {
    const step = 1 / fps;
    const cur = cursor?.t ?? (r[0] + r[1]) / 2;
    let next: number | null = null;
    if (e.key === "ArrowLeft") next = Math.max(r[0], cur - step);
    else if (e.key === "ArrowRight") next = Math.min(r[1], cur + step);
    else if (e.key === "Home") next = r[0];
    else if (e.key === "End") next = r[1];
    else if (e.key === "Escape" && cursor) {
      e.preventDefault();
      e.stopPropagation();
      setCursor(null);
      return;
    }
    if (next != null) {
      e.preventDefault();
      e.stopPropagation();
      setCursor({ t: next, panel: p.key });
    }
  };

  const cls = ["panel", p.focus ? "focus" : "", p.last ? "last" : ""].filter(Boolean).join(" ");
  return (
    <div class={cls} style={single ? "grid-template-columns:minmax(0,1fr);border-top:0;padding-top:4px" : undefined}>
      {single ? null : (
        <div class="panel-cap">
          <b>{p.words}</b>
          {p.role === "cause" ? (
            <span class="role" style="color:var(--cause-text)">
              CAUSE
            </span>
          ) : p.role === "anchor" ? (
            <span class="role" style="color:var(--anchor-text)">
              FAILURE SEEN
            </span>
          ) : null}
          <span>{p.caption}</span>
        </div>
      )}
      <div
        class="plot"
        style={`height:${p.height}px`}
        tabIndex={0}
        role="img"
        aria-label={`${p.words}: ${p.caption}`}
        onMouseMove={fromEvent}
        onMouseLeave={() => setCursor(null)}
        onKeyDown={onKey}
        onBlur={() => cursor?.panel === p.key && setCursor(null)}
      >
        {bandEls}
        <svg viewBox="0 0 1000 100" preserveAspectRatio="none" aria-hidden="true">
          {svg}
        </svg>
        {labels}
        {notes}
        {callout}
        {pointer}
        {hover ? <div class="cursor" style={`left:${cx}%`} /> : null}
        {hover && cursor!.panel === p.key ? (
          <div class="readout" style={cx > 70 ? `right:calc(${100 - cx}% + 6px);top:8px` : `left:calc(${cx}% + 6px);top:8px`}>
            {fixed(cursor!.t, 2)} s
            {readout.map((l) => (
              <>
                <br />
                {l}
              </>
            ))}
          </div>
        ) : null}
        {tk.map((x) => (
          <span key={x.t} class="xt" style={`left:${pctX(x.t, r)}%`}>
            {x.label}
          </span>
        ))}
      </div>
    </div>
  );
}
