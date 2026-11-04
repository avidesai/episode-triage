import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { Empty, Rung, SortHead } from "../components/bits";
import { FilterMenu, type Option } from "../components/FilterMenu";
import { IncidentDetail, type Nav } from "../components/IncidentDetail";
import { IncidentHead, IncidentRow, fixOf } from "../components/IncidentTable";
import { byId, bundlePath, data, priorityOf } from "../data";
import { FIX_LABEL, LAYER_LABEL, num, plural } from "../format";
import { useKeys } from "../keys";
import { go, href, route, type Query } from "../router";
import { clearWorkflow, getPref, setPref, statusOf, workflow } from "../state";
import type { FixBy, InboxRow, Layer, Summary } from "../types";

type Key = "rung" | "layer" | "fix" | "arm" | "rule" | "status";
const KEYS: Key[] = ["rung", "layer", "fix", "arm", "rule", "status"];
const STATUS_OPTS = [
  ["open", "Open (new or acknowledged)"],
  ["new", "New"],
  ["ack", "Acknowledged"],
  ["resolved", "Resolved"],
] as const;

const listOf = (q: Query, k: string) => (q[k] ? q[k].split(",").filter(Boolean) : []);

function haystack(s: Summary): string {
  return [s.id, s.robot_id, s.route, s.rule, s.fingerprint, s.component, s.label, s.run != null ? `run ${s.run}` : ""]
    .join(" ")
    .replace(/_/g, " ")
    .toLowerCase();
}

export function matchSearch(text: string, q: string): boolean {
  const toks = q.toLowerCase().replace(/_/g, " ").split(/\s+/).filter(Boolean);
  return toks.every((t) => text.includes(t));
}

function statusMatch(id: string, want: string[], wf: typeof workflow.value): boolean {
  if (!want.length) return true;
  const s = statusOf(id, wf);
  return want.some((w) => (w === "open" ? s !== "resolved" : w === s));
}

export function sortIncidents(rows: Summary[], sort: string, prio: Map<string, number>, wf: typeof workflow.value): Summary[] {
  const desc = sort.startsWith("-");
  const col = desc ? sort.slice(1) : sort;
  const runN = (s: Summary) => (typeof s.run === "number" ? s.run : -1);
  const ST: Record<string, number> = { new: 0, ack: 1, resolved: 2 };
  const base = (a: Summary, b: Summary) =>
    (prio.get(b.fingerprint) ?? 0) - (prio.get(a.fingerprint) ?? 0) || b.rung - a.rung || a.robot_id.localeCompare(b.robot_id) || runN(a) - runN(b) || a.t - b.t;
  const by: Record<string, (a: Summary, b: Summary) => number> = {
    priority: base,
    rung: (a, b) => a.rung - b.rung,
    route: (a, b) => a.route.localeCompare(b.route),
    fix: (a, b) => fixOf(a).localeCompare(fixOf(b)),
    arm: (a, b) => a.robot_id.localeCompare(b.robot_id) || runN(a) - runN(b) || a.t - b.t,
    run: (a, b) => runN(a) - runN(b),
    t: (a, b) => a.t - b.t,
    source: (a, b) => a.source.localeCompare(b.source),
    problem: (a, b) => (a.label ?? "").localeCompare(b.label ?? ""),
    status: (a, b) => ST[statusOf(a.id, wf)] - ST[statusOf(b.id, wf)],
  };
  const f = by[col] ?? base;
  return rows.slice().sort((a, b) => (desc ? -f(a, b) : f(a, b)) || base(a, b));
}

function scrollToRow(id: string) {
  const el = document.querySelector(`[data-id="${CSS.escape(id)}"]`);
  el?.scrollIntoView({ block: "nearest" });
}

export function Inbox() {
  const d = data.value!;
  const r = route.value;
  const q = r.q;
  const sel = r.path[1] === "i" && r.path[2] ? r.path[2] : null;
  const wf = workflow.value;
  const f = Object.fromEntries(KEYS.map((k) => [k, listOf(q, k)])) as Record<Key, string[]>;
  const search = q.q ?? "";
  const group = (q.group ?? getPref("triage.inbox.group") ?? "") === "problem";
  const sort = q.sort ?? "priority";
  const [draft, setDraft] = useState(search);
  const [cursor, setCursor] = useState<string | null>(sel);
  const [open, setOpen] = useState<Set<string>>(new Set());

  useEffect(() => setDraft(search), [search]);
  useEffect(() => {
    if (sel) setCursor(sel);
  }, [sel]);

  const setQ = (patch: Record<string, string | null>) => go(r.path, { ...q, ...patch }, true);
  const setList = (k: Key, v: string[]) => setQ({ [k]: v.join(",") || null });
  useEffect(() => {
    if (draft === search) return;
    const id = setTimeout(() => setQ({ q: draft || null }), 150);
    return () => clearTimeout(id);
  }, [draft]);

  const matches = (s: Summary, skip?: Key) =>
    (skip === "rung" || !f.rung.length || f.rung.includes(String(s.rung))) &&
    (skip === "layer" || !f.layer.length || f.layer.includes(s.layer)) &&
    (skip === "fix" || !f.fix.length || f.fix.includes(fixOf(s))) &&
    (skip === "arm" || !f.arm.length || f.arm.includes(s.robot_id)) &&
    (skip === "rule" || !f.rule.length || f.rule.includes(s.rule)) &&
    (skip === "status" || statusMatch(s.id, f.status, wf)) &&
    (!search || matchSearch(haystack(s), search));


  const rows = useMemo(
    () => sortIncidents(d.incidents.filter((s) => matches(s)), sort, priorityOf.value, wf),
    [d, q.rung, q.layer, q.fix, q.arm, q.rule, q.status, search, sort, wf],
  );

  const facet = (k: Key, val: (s: Summary) => string) => {
    const c = new Map<string, number>();
    for (const s of d.incidents) if (matches(s, k)) c.set(val(s), (c.get(val(s)) ?? 0) + 1);
    return c;
  };
  const opts = useMemo(() => {
    const rungC = facet("rung", (s) => String(s.rung));
    const layerC = facet("layer", (s) => s.layer);
    const fixC = facet("fix", (s) => fixOf(s));
    const armC = facet("arm", (s) => s.robot_id);
    const ruleC = facet("rule", (s) => s.rule);
    const rungs = [...new Set(d.incidents.map((s) => s.rung))].sort();
    const rungName = new Map(d.incidents.map((s) => [s.rung, s.rung_name]));
    const layers = [...new Set(d.incidents.map((s) => s.layer))];
    const fixes = [...new Set(d.incidents.map(fixOf))];
    const arms = [...new Set(d.incidents.map((s) => s.robot_id))].sort();
    const rules = d.rules.map((x) => x.rule).filter((x) => d.incidents.some((s) => s.rule === x));
    const stC = new Map<string, number>();
    for (const s of d.incidents)
      if (matches(s, "status")) {
        const st = statusOf(s.id, wf);
        stC.set(st, (stC.get(st) ?? 0) + 1);
        if (st !== "resolved") stC.set("open", (stC.get("open") ?? 0) + 1);
      }
    return {
      rung: rungs.map((g) => ({ value: String(g), label: `${g}: ${rungName.get(g)}`, count: rungC.get(String(g)) ?? 0 })),
      layer: layers.map((l) => ({ value: l, label: LAYER_LABEL[l as Layer] ?? l, count: layerC.get(l) ?? 0 })),
      fix: fixes.map((x) => ({ value: x, label: FIX_LABEL[x as FixBy], count: fixC.get(x) ?? 0 })),
      arm: arms.map((a) => ({ value: a, label: a, count: armC.get(a) ?? 0 })),
      rule: rules.map((x) => ({ value: x, label: x, count: ruleC.get(x) ?? 0 })),
      status: STATUS_OPTS.map(([v, l]) => ({ value: v, label: l, count: stC.get(v) ?? 0 })),
    } as Record<Key, Option[]>;
  }, [d, q.rung, q.layer, q.fix, q.arm, q.rule, q.status, search, wf]);

  // ---- by problem
  const problems = useMemo(() => {
    return d.inbox.filter(
      (p) =>
        (!f.rung.length || f.rung.includes(String(p.rung))) &&
        (!f.layer.length || f.layer.includes(p.layer)) &&
        (!f.fix.length || f.fix.includes(p.fix_by)) &&
        (!f.arm.length || p.examples.some((id) => f.arm.includes(byId.value.get(id)?.robot_id ?? ""))) &&
        (!search || matchSearch([p.label, p.fingerprint, p.example].join(" ").replace(/_/g, " ").toLowerCase(), search)),
    );
  }, [d, q.rung, q.layer, q.fix, q.arm, search]);

  useEffect(() => {
    if (!group || !sel) return;
    const p = d.inbox.find((p) => p.examples.includes(sel));
    if (p && !open.has(p.fingerprint)) setOpen(new Set([...open, p.fingerprint]));
  }, [group, sel]);

  const exampleRows = (p: InboxRow) =>
    p.examples.map((id) => byId.value.get(id)).filter((s): s is Summary => !!s && (!f.arm.length || f.arm.includes(s.robot_id)));

  const order: string[] = group
    ? problems.filter((p) => open.has(p.fingerprint)).flatMap((p) => exampleRows(p).map((s) => s.id))
    : rows.map((s) => s.id);

  const link = (id: string) => href(["inbox", "i", id], q);
  const openId = (id: string, replace = false) => go(["inbox", "i", id], q, replace);
  const close = () => go(["inbox"], q);
  const onArm = (a: string) => setList("arm", f.arm.includes(a) ? f.arm : [...f.arm, a]);
  const onProblem = (fp: string) => {
    setOpen(new Set([...open, fp]));
    setPref("triage.inbox.group", "problem");
    go(r.path, { ...q, group: "problem" }, true);
    setTimeout(() => document.querySelector(`[data-fp="${CSS.escape(fp)}"]`)?.scrollIntoView({ block: "start" }), 50);
  };

  const cursorRef = useRef(cursor);
  cursorRef.current = cursor;
  const move = (delta: number) => {
    if (!order.length) return;
    const c = cursorRef.current;
    const i = c ? order.indexOf(c) : -1;
    const n = order[Math.max(0, Math.min(order.length - 1, i < 0 ? 0 : i + delta))];
    cursorRef.current = n;
    setCursor(n);
    scrollToRow(n);
    if (sel) openId(n, true);
  };
  useKeys(
    {
      j: () => move(1),
      k: () => move(-1),
      ArrowDown: () => move(1),
      ArrowUp: () => move(-1),
      Enter: () => cursor && openId(cursor),
    },
    [order.join("|"), cursor, sel, q],
  );

  const pos = sel ? order.indexOf(sel) : -1;
  const nav: Nav | undefined = sel
    ? {
        prev: pos > 0 ? order[pos - 1] : null,
        next: pos >= 0 && pos < order.length - 1 ? order[pos + 1] : pos < 0 && order.length ? order[0] : null,
        pos: pos + 1,
        total: order.length,
        goTo: (id) => {
          setCursor(id);
          openId(id, true);
          setTimeout(() => scrollToRow(id), 0);
        },
      }
    : undefined;

  const marked = Object.keys(wf).length;
  const active = KEYS.some((k) => f[k].length) || !!search;
  const setGroup = (g: boolean) => {
    setPref("triage.inbox.group", g ? "problem" : "incidents");
    go(r.path, { ...q, group: g ? "problem" : "incidents" }, true);
  };

  const rowFor = (s: Summary, indent = false) => (
    <IncidentRow
      key={s.id}
      s={s}
      link={link(s.id)}
      selected={s.id === sel}
      cursor={s.id === cursor && s.id !== sel}
      onOpen={() => {
        setCursor(s.id);
        openId(s.id, !!sel);
      }}
      onArm={onArm}
      onProblem={group ? undefined : onProblem}
      indent={indent}
    />
  );

  return (
    <div class={`split ${sel ? "has-pane" : ""}`}>
      <section class="list-col" aria-label="Inbox">
        <div class="toolbar">
          <div class="tb-row">
            <input
              data-search
              class="input search"
              type="search"
              placeholder="Search arm, joint, camera, rule"
              aria-label="Search incidents"
              value={draft}
              onInput={(e) => setDraft((e.target as HTMLInputElement).value)}
            />
            <div class="seg" role="group" aria-label="View">
              <button aria-pressed={!group} onClick={() => setGroup(false)}>
                Incidents
              </button>
              <button aria-pressed={group} onClick={() => setGroup(true)}>
                By problem
              </button>
            </div>
          </div>
          <div class="tb-row chips">
            <FilterMenu label="Rung" options={opts.rung} selected={f.rung} onChange={(v) => setList("rung", v)} />
            <FilterMenu label="Layer" options={opts.layer} selected={f.layer} onChange={(v) => setList("layer", v)} />
            <FilterMenu label="Fix by" options={opts.fix} selected={f.fix} onChange={(v) => setList("fix", v)} />
            <FilterMenu label="Arm" options={opts.arm} selected={f.arm} onChange={(v) => setList("arm", v)} searchable />
            {!group ? <FilterMenu label="Rule" options={opts.rule} selected={f.rule} onChange={(v) => setList("rule", v)} /> : null}
            {!group ? <FilterMenu label="Status" options={opts.status} selected={f.status} onChange={(v) => setList("status", v)} /> : null}
            {active ? (
              <button class="btn small ghost" onClick={() => go(r.path, { group: q.group, sort: q.sort }, true)}>
                Clear all
              </button>
            ) : null}
          </div>
          <div class="tb-row count" aria-live="polite">
            {group ? (
              <span>
                {problems.length} of {d.inbox.length} problem types
              </span>
            ) : (
              <span>
                {rows.length === d.incidents.length ? plural(d.incidents.length, "incident") : `${num(rows.length)} of ${plural(d.incidents.length, "incident")}`}
              </span>
            )}
            {marked ? (
              <span class="muted">
                {num(marked)} marked in this browser only{" "}
                <button class="linkish" onClick={() => confirm("Clear every status and note saved in this browser?") && clearWorkflow()}>
                  Clear
                </button>
              </span>
            ) : null}
          </div>
        </div>

        {group ? (
          <ProblemTable
            problems={problems}
            open={open}
            toggle={(fp) => {
              const n = new Set(open);
              n.has(fp) ? n.delete(fp) : n.add(fp);
              setOpen(n);
            }}
            rowsFor={exampleRows}
            rowFor={rowFor}
            empty={active}
            clear={() => go(r.path, { group: q.group }, true)}
          />
        ) : (
          <div class="itable" role="table" aria-label="Incidents" aria-rowcount={rows.length}>
            <IncidentHead sort={sort} onSort={(s) => setQ({ sort: s === "priority" ? null : s })} />
            {rows.length ? (
              rows.map((s) => rowFor(s))
            ) : (
              <Empty title={search ? `No incidents match "${search}" with these filters` : "No incidents match these filters"}>
                <button class="btn" onClick={() => go(r.path, { group: q.group, sort: q.sort }, true)}>
                  Clear filters
                </button>
              </Empty>
            )}
          </div>
        )}
        <p class="list-foot muted small">
          Ranked by how many arms a problem hits, how many runs, and how serious the rung is. Status and notes are saved in this browser only.
        </p>
      </section>
      {sel ? (
        <aside class="pane" aria-label="Incident">
          <IncidentDetail id={sel} path={bundlePath(sel)} nav={nav} onClose={close} />
        </aside>
      ) : null}
    </div>
  );
}

function ProblemTable({
  problems,
  open,
  toggle,
  rowsFor,
  rowFor,
  empty,
  clear,
}: {
  problems: InboxRow[];
  open: Set<string>;
  toggle: (fp: string) => void;
  rowsFor: (p: InboxRow) => Summary[];
  rowFor: (s: Summary, indent?: boolean) => preact.JSX.Element;
  empty: boolean;
  clear: () => void;
}) {
  const r = route.value;
  const sort = r.q.psort ?? "";
  const desc = sort.startsWith("-");
  const col = desc ? sort.slice(1) : sort;
  const by: Record<string, (a: InboxRow, b: InboxRow) => number> = {
    rung: (a, b) => a.rung - b.rung,
    label: (a, b) => a.label.localeCompare(b.label),
    fix: (a, b) => a.fix_by.localeCompare(b.fix_by),
    robots: (a, b) => a.robots - b.robots,
    episodes: (a, b) => a.episodes - b.episodes,
    count: (a, b) => a.count - b.count,
  };
  const list = by[col] ? problems.slice().sort((a, b) => (desc ? -1 : 1) * by[col](a, b) || b.priority - a.priority) : problems;
  const onSort = (s: string) => go(r.path, { ...r.q, psort: s }, true);
  if (!list.length)
    return (
      <Empty title="No problem types match these filters">
        {empty ? (
          <button class="btn" onClick={clear}>
            Clear filters
          </button>
        ) : null}
      </Empty>
    );
  return (
    <div class="ptable" role="table" aria-label="Problem types">
      <div role="row" class="prow head">
        <span role="columnheader" class="th c-exp" />
        <SortHead cls="c-rung" label="Rung" col="rung" sort={sort} onSort={onSort} />
        <SortHead cls="c-label" label="Problem" col="label" sort={sort} onSort={onSort} />
        <SortHead cls="c-fix" label="Fix by" col="fix" sort={sort} onSort={onSort} />
        <SortHead cls="c-n" label="Arms" col="robots" sort={sort} onSort={onSort} />
        <SortHead cls="c-n" label="Runs" col="episodes" sort={sort} onSort={onSort} />
        <SortHead cls="c-n c-count" label="Count" col="count" sort={sort} onSort={onSort} />
        <span role="columnheader" class="th c-scope">
          Counted in
        </span>
      </div>
      {list.map((p) => {
        const isOpen = open.has(p.fingerprint);
        const ex = isOpen ? rowsFor(p) : [];
        return (
          <div key={p.fingerprint} role="rowgroup" class={`pgroup ${isOpen ? "open" : ""}`} data-fp={p.fingerprint}>
            <div role="row" class="prow" onClick={(e) => !(e.target as HTMLElement).closest("button") && toggle(p.fingerprint)}>
              <span role="cell" class="c-exp">
                <button class="btn icon tiny" aria-expanded={isOpen} aria-label={`${isOpen ? "Collapse" : "Expand"} ${p.label}`} onClick={() => toggle(p.fingerprint)}>
                  {isOpen ? "▾" : "▸"}
                </button>
              </span>
              <span role="cell" class="c-rung">
                <Rung rung={p.rung} name={p.rung_name} />
              </span>
              <span role="cell" class="c-label">
                <span class="plabel">{p.label}</span>
                {p.recurring ? (
                  <span class="tag recur" title="Recurring: on 2 or more arms, or 3 or more times on one">
                    recurring
                  </span>
                ) : null}
                <span class="meta">
                  {plural(p.robots, "arm")}, {plural(p.episodes, "run")}, {FIX_LABEL[p.fix_by].toLowerCase()}
                </span>
              </span>
              <span role="cell" class="c-fix">
                {FIX_LABEL[p.fix_by]}
              </span>
              <span role="cell" class="c-n tnum">
                {num(p.robots)}
              </span>
              <span role="cell" class="c-n tnum">
                {num(p.episodes)}
              </span>
              <span role="cell" class="c-n c-count tnum">
                {num(p.count)}
              </span>
              <span role="cell" class="c-scope muted">
                {p.scope}
              </span>
            </div>
            {isOpen ? (
              <div class="pexp">
                <p class="pex muted small">Example: {p.example}</p>
                {ex.length ? ex.map((s) => rowFor(s, true)) : <p class="pex muted small">No clip bundled for this one{p.examples.length ? " on the selected arms" : ""}.</p>}
                {ex.length && p.examples.length < p.count ? (
                  <p class="pex muted xsmall">
                    {num(ex.length)} bundled {ex.length === 1 ? "example" : "examples"} of {num(p.count)}.
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
