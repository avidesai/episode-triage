"""Small SVG drawing helpers for the report. Colors are CSS variables set by the page,
so every chart follows the page's light or dark theme."""

from __future__ import annotations

from html import escape

import numpy as np


MAX_POINTS = 360


def _path(xs, ys) -> str:
    step = max(1, len(xs) // MAX_POINTS)
    pts = [(x, y) for x, y in zip(xs[::step], ys[::step]) if np.isfinite(y)]
    if not pts:
        return ""
    return "M" + " L".join(f"{x:.1f},{y:.1f}" for x, y in pts)


def timeline(t: np.ndarray, panels: list[dict], bands: list[dict], width: int = 680,
             panel_h: int = 70, title: str = "") -> str:
    """Stacked panels sharing one time axis.

    panels: [{"label": str, "series": [{"y": array, "cls": "a"|"b"|"c", "name": str}], "ylim": (lo, hi)}]
    bands:  [{"t0": s, "t1": s, "cls": "cause"|"anchor"|"context", "label": str}]
    """
    left, right, top, gap = 8, 8, 30, 22
    plot_w = width - left - right
    h = top + len(panels) * (panel_h + gap) + 16
    t0, t1 = float(t[0]), float(t[-1]) if len(t) > 1 else float(t[0]) + 1

    def X(v):
        return left + (v - t0) / max(t1 - t0, 1e-9) * plot_w

    out = [f'<svg viewBox="0 0 {width} {h}" role="img" aria-label="{escape(title)}" class="tl">']
    labelled = 0
    for b in bands:
        x0, x1 = X(max(b["t0"], t0)), X(min(b["t1"], t1))
        out.append(f'<rect class="band {b["cls"]}" x="{x0:.1f}" y="{top - 4}" width="{max(x1 - x0, 2):.1f}" '
                   f'height="{h - top - 12}"/>')
        if b.get("label"):
            anchor = "end" if x0 > left + 0.6 * plot_w else "start"
            tx = x0 - 3 if anchor == "end" else x0 + 3
            out.append(f'<text class="bandlabel {b["cls"]}" x="{tx:.1f}" y="{10 + 12 * (labelled % 2)}" '
                       f'text-anchor="{anchor}">{escape(b["label"])}</text>')
            labelled += 1
    for i, p in enumerate(panels):
        y0 = top + i * (panel_h + gap) + 12
        lo, hi = p.get("ylim") or _lim([s["y"] for s in p["series"]])

        def Y(v, y0=y0, lo=lo, hi=hi):
            return y0 + panel_h - (np.clip(v, lo, hi) - lo) / max(hi - lo, 1e-9) * panel_h

        out.append(f'<text class="plabel" x="{left}" y="{y0 - 3}">{escape(p["label"])}</text>')
        out.append(f'<line class="axis" x1="{left}" x2="{left + plot_w}" y1="{y0 + panel_h}" y2="{y0 + panel_h}"/>')
        for s in p["series"]:
            d = _path([X(v) for v in t], [Y(v) for v in s["y"]])
            out.append(f'<path class="ln {s.get("cls", "a")}" d="{d}"><title>{escape(s.get("name", ""))}</title></path>')
    step = _tick_step(t1 - t0)
    for v in np.arange(np.ceil(t0 / step) * step, t1 + 1e-9, step):
        out.append(f'<text class="tick" x="{X(v):.1f}" y="{h - 3}" text-anchor="middle">{v:g} s</text>')
    out.append("</svg>")
    return "".join(out)


def bars(rows: list[dict], value: str, label: str, mark: str | None = None, width: int = 680,
         row_h: int = 26, note: str | None = None) -> str:
    """Horizontal bars, one row per item, value printed at the end of each bar."""
    if not rows:
        return ""
    vmax = max(r[value] for r in rows) or 1
    lab_w = 0
    bar_w = width - lab_w - 60
    h = len(rows) * (row_h + 18) + 6
    out = [f'<svg viewBox="0 0 {width} {h}" role="img" aria-label="{escape(note or label)}" class="bars">']
    for i, r in enumerate(rows):
        y = i * (row_h + 18) + 16
        w = max(2.0, r[value] / vmax * bar_w)
        cls = "bar hot" if mark and r.get(mark) else "bar"
        out.append(f'<text class="blabel" x="0" y="{y - 4}">{escape(str(r[label]))}</text>')
        out.append(f'<rect class="{cls}" x="0" y="{y}" width="{w:.1f}" height="{row_h - 10}" rx="2"/>')
        out.append(f'<text class="bval" x="{w + 6:.1f}" y="{y + row_h - 14}">{r[value]:,}</text>')
    out.append("</svg>")
    return "".join(out)


def _lim(ys):
    v = np.concatenate([np.asarray(y, float)[np.isfinite(y)] for y in ys if len(y)])
    if not len(v):
        return 0, 1
    lo, hi = np.percentile(v, [1, 99])
    pad = 0.08 * (hi - lo or 1)
    return lo - pad, hi + pad


def _tick_step(span: float) -> float:
    for s in (1, 2, 5, 10, 20, 30, 60):
        if span / s <= 8:
            return s
    return 120
