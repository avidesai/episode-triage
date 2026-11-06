import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { Filter, type Option } from "../components/Filter";
import { IncidentRow } from "../components/IncidentRow";
import { IconSearch } from "../components/icons";
import { ProblemRow } from "../components/ProblemRow";
import { QueuePane } from "../components/QueuePane";
import { RungMark } from "../components/RungMark";
import { changeStatus } from "../components/StatusControl";
import { Empty } from "../components/States";
import { data, loadBundle } from "../data";
import {
  filtersOf,
  hasFilters,
  incidentPasses,
  incidentsByFp,
  lastQueue,
  orderFor,
  problemByFp,
  problems,
  type Filters,
  type Problem,
} from "../derive";
import { num } from "../format";
import { useKeys } from "../keys";
import { wide } from "../media";
import { go, route, setQuery } from "../router";
import { workflow } from "../state";
import type { Summary } from "../types";

const RUNG_FILTERS: [number, string][] = [
  [0, "All rungs"],
  [1, "Robot"],
  [2, "Hardware"],
  [3, "Training"],
  [4, "A person"],
];
const LAYERS = ["sensing", "actuation", "task", "integrity"];
const STATUS: Option[] = [
  { value: "new", label: "New" },
  { value: "ack", label: "Acknowledged" },
  { value: "resolved", label: "Resolved" },
];
const GROUP_PAGE = 50;
const FLAT_PAGE = 100;
const NONE_OPEN = "-";

/** Text a problem itself can be found by. */
const problemText = (p: Problem) => `${p.label} ${p.base} ${p.part} ${p.fingerprint} ${p.example} ${p.layer}`.toLowerCase();

export function Queue() {
  const d = data.value;
  const r = route.value;
  const q = r.q;
  const view = q.view === "incidents" ? "incidents" : "problems";
  const f = useMemo(() => filtersOf(q), [q.rung, q.layer, q.arm, q.rule, q.status, q.q]);
  const wf = workflow.value;
  const isWide = wide.value;
  const [search, setSearch] = useState(q.q ?? "");
  const [flatShown, setFlatShown] = useState(FLAT_PAGE);
  const [groupAll, setGroupAll] = useState<Record<string, boolean>>({});
  const listRef = useRef<HTMLElement>(null);
  const searchTimer = useRef(0);

  useEffect(() => {
    document.title = "Queue · Triage";
  }, []);
  useEffect(() => setSearch(q.q ?? ""), [q.q]);
  useEffect(() => setFlatShown(FLAT_PAGE), [view, f]);

  // ------------------------------------------------------------ problems view
  const incFilters: Filters = { arm: f.arm, rule: f.rule, status: f.status, q: f.q };
  const incFilterOn = !!(f.arm || f.rule || f.status || f.q);
  const groups = useMemo(() => {
    if (!d) return [];
    const out: { p: Problem; kids: Summary[] }[] = [];
    for (const p of problems.value) {
      if (f.rung != null && p.rung !== f.rung) continue;
      if (f.layer && p.layer !== f.layer) continue;
      const all = incidentsByFp.value.get(p.fingerprint) ?? [];
      const sorted = all.slice().sort((a, b) => b.rung - a.rung || (a.robot_id < b.robot_id ? -1 : a.robot_id > b.robot_id ? 1 : a.t - b.t));
      if (!incFilterOn) {
        out.push({ p, kids: sorted });
        continue;
      }
      const textHit = !!f.q && !f.arm && !f.rule && !f.status && problemText(p).includes(f.q);
      const kids = textHit ? sorted : sorted.filter((s) => incidentPasses(s, incFilters, wf));
      if (kids.length || textHit) out.push({ p, kids });
    }
    return out;
  }, [d, f, wf, problems.value]);

  // ------------------------------------------------------------ incidents view and order
  const order = useMemo(() => (d ? orderFor(f, wf) : []), [d, f, wf]);
  useEffect(() => {
    lastQueue.value = { ids: order.map((s) => s.id), q };
  }, [order]);

  // open problems: from the URL, default the first in the current sort
  const openSet = useMemo(() => {
    if (q.open === NONE_OPEN) return new Set<string>();
    if (q.open) return new Set(q.open.split(","));
    return new Set(groups.length ? [groups[0].p.fingerprint] : []);
  }, [q.open, groups]);
  const toggle = (fp: string, to?: boolean) => {
    const next = new Set(openSet);
    const want = to ?? !next.has(fp);
    if (want) next.add(fp);
    else next.delete(fp);
    setQuery({ open: next.size ? [...next].join(",") : NONE_OPEN });
  };

  // visible incidents in screen order (for selection and [ ])
  const visible: Summary[] = useMemo(() => {
    if (view === "incidents") return order.slice(0, flatShown);
    const out: Summary[] = [];
    for (const g of groups) if (openSet.has(g.p.fingerprint)) out.push(...(groupAll[g.p.fingerprint] ? g.kids : g.kids.slice(0, GROUP_PAGE)));
    return out;
  }, [view, order, flatShown, groups, openSet, groupAll]);

  const sel = (q.sel && d?.incidents.find((s) => s.id === q.sel)) || visible[0] || null;
  const select = (s: Summary) => {
    if (!isWide) {
      go(["i", s.id]);
      return;
    }
    setQuery({ sel: s.id });
  };
  const open = (s: Summary) => go(["i", s.id]);

  // prefetch the next bundle
  useEffect(() => {
    if (!sel) return;
    const i = visible.findIndex((s) => s.id === sel.id);
    const nx = visible[i + 1];
    if (nx) loadBundle(nx.bundle).catch(() => {});
  }, [sel?.id]);

  // keep the selected row in view when arriving back from an incident
  useEffect(() => {
    if (!sel) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-id="${CSS.escape(sel.id)}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, []);

  // ------------------------------------------------------------ keys
  const rows = () => [...(listRef.current?.querySelectorAll<HTMLElement>("[data-row]") ?? [])];
  const move = (dir: number) => {
    const list = rows();
    if (!list.length) return;
    let i = list.indexOf(document.activeElement as HTMLElement);
    if (i < 0 && sel) i = list.findIndex((el) => el.dataset.id === sel.id) - (dir > 0 ? 0 : 0);
    const next = list[i < 0 ? 0 : Math.max(0, Math.min(list.length - 1, i + dir))];
    next.focus();
    next.scrollIntoView({ block: "nearest" });
    if (next.dataset.row === "i" && isWide) {
      const s = d?.incidents.find((x) => x.id === next.dataset.id);
      if (s) setQuery({ sel: s.id });
    }
  };
  const step = (dir: number) => {
    if (!visible.length) return;
    const i = sel ? visible.findIndex((s) => s.id === sel.id) : -1;
    const n = visible[Math.max(0, Math.min(visible.length - 1, i + dir))];
    if (!n) return;
    setQuery({ sel: n.id });
    requestAnimationFrame(() => listRef.current?.querySelector<HTMLElement>(`[data-id="${CSS.escape(n.id)}"]`)?.scrollIntoView({ block: "nearest" }));
  };
  const focusedProblem = () => {
    const el = document.activeElement as HTMLElement | null;
    return el?.dataset.row === "p" ? el.dataset.fp ?? null : null;
  };
  useKeys({
    j: () => move(1),
    k: () => move(-1),
    ArrowRight: () => {
      const fp = focusedProblem();
      if (fp) toggle(fp, true);
    },
    ArrowLeft: () => {
      const fp = focusedProblem();
      if (fp) toggle(fp, false);
    },
    Enter: () => {
      if (sel) open(sel);
    },
    "[": () => step(-1),
    "]": () => step(1),
    a: () => sel && changeStatus(sel.id, "ack"),
    r: () => sel && changeStatus(sel.id, "resolved"),
  });

  if (!d) return <QueueSkeleton />;

  // ------------------------------------------------------------ filter options
  const rungCount = (k: number) => (k ? d.inbox.filter((x) => x.rung === k).length : d.inbox.length);
  const arms = [...new Set(d.incidents.map((s) => s.robot_id))].sort().map((a) => ({ value: a, label: a }));
  const rules: Option[] = d.rules.map((x) => ({ value: x.rule, label: x.rule, count: d.incidents.filter((s) => s.rule === x.rule).length }));
  const layers: Option[] = LAYERS.map((l) => ({ value: l, label: l, count: d.inbox.filter((x) => x.layer === l).length }));

  const onSearch = (v: string) => {
    setSearch(v);
    clearTimeout(searchTimer.current);
    searchTimer.current = window.setTimeout(() => setQuery({ q: v.trim() || null, sel: null }), 150);
  };

  const nothing = view === "problems" ? groups.length === 0 : order.length === 0;

  return (
    <div style="flex:1 1 auto;min-width:0;display:flex;flex-wrap:wrap;align-items:stretch">
      <main
        id="main"
        ref={listRef}
        style={`flex:999 1 620px;min-width:0;display:flex;flex-direction:column;${isWide ? "border-right:1px solid var(--border)" : ""}`}
      >
        <div style="display:flex;flex-direction:column;gap:12px;padding:20px 20px 14px;border-bottom:1px solid var(--border);background:var(--surface)">
          <div style="display:flex;flex-wrap:wrap;align-items:center;gap:12px">
            <h1 class="h1" style="font-size:20px">
              Queue
            </h1>
            <div class="seg" role="group" aria-label="Show">
              <button type="button" aria-pressed={view === "problems" ? "true" : "false"} onClick={() => setQuery({ view: null, sel: null })}>
                Problems <span class="num t-3">{num(d.inbox.length)}</span>
              </button>
              <button type="button" aria-pressed={view === "incidents" ? "true" : "false"} onClick={() => setQuery({ view: "incidents", sel: null })}>
                Incidents <span class="num t-3">{num(d.incidents.length)}</span>
              </button>
            </div>
            <label class="field" style="flex:1 1 240px;max-width:360px;margin-left:auto">
              <IconSearch />
              <span class="sr">Search</span>
              <input data-search placeholder="Search arm, joint, camera, rule" value={search} onInput={(e) => onSearch((e.target as HTMLInputElement).value)} />
              <span class="kbd">/</span>
            </label>
          </div>
          <div role="group" aria-label="Filters" style="display:flex;flex-wrap:wrap;gap:6px;align-items:center">
            {RUNG_FILTERS.map(([k, name]) => {
              const on = (f.rung ?? 0) === k;
              return (
                <button
                  key={k}
                  type="button"
                  class={on ? "filter on" : "filter"}
                  aria-pressed={on ? "true" : "false"}
                  onClick={() => setQuery({ rung: k && !(on && k) ? String(k) : null, sel: null })}
                >
                  <span class={`rm r${k}`} aria-hidden="true">
                    <i />
                    <i />
                    <i />
                    <i />
                  </span>
                  {name} <span class="num t-3">{num(rungCount(k))}</span>
                </button>
              );
            })}
            <span style="width:1px;height:20px;background:var(--border);margin:0 4px" aria-hidden="true" />
            <Filter name="Layer" value={f.layer ?? null} options={layers} onChange={(v) => setQuery({ layer: v, sel: null })} />
            <Filter name="Arm" value={f.arm ?? null} options={arms} typeahead onChange={(v) => setQuery({ arm: v, sel: null })} />
            <Filter name="Rule" value={f.rule ?? null} options={rules} onChange={(v) => setQuery({ rule: v, sel: null })} />
            <Filter name="Status" value={f.status ?? null} options={STATUS} onChange={(v) => setQuery({ status: v, sel: null })} />
            <span class="t-3" style="margin-left:auto;font-size:12px">
              Sort: priority
            </span>
          </div>
        </div>

        {nothing ? (
          <div style="padding:20px">
            <QueueEmpty f={f} />
          </div>
        ) : view === "problems" ? (
          <>
            <div class="qhead">
              <span />
              <span>Rung</span>
              <span>Problem</span>
              <span>Example verdict</span>
              <span>Scope</span>
              <span style="text-align:right">Incidents</span>
              <span style="text-align:right">Arms</span>
            </div>
            {groups.map(({ p, kids }) => {
              const isOpen = openSet.has(p.fingerprint);
              const all = groupAll[p.fingerprint];
              const shown = all ? kids : kids.slice(0, GROUP_PAGE);
              const bundled = (incidentsByFp.value.get(p.fingerprint) ?? []).length;
              return (
                <div key={p.fingerprint} role="presentation" style="display:contents">
                  <ProblemRowWrap p={p} open={isOpen} onToggle={() => toggle(p.fingerprint)} />
                  {isOpen ? (
                    <>
                      {shown.map((s) => (
                        <IncidentRow key={s.id} s={s} sel={isWide && sel?.id === s.id} onPick={() => select(s)} onOpen={() => open(s)} />
                      ))}
                      <div class="qnote">
                        <span>{groupNote(p, bundled, kids.length, incFilterOn)}</span>
                        {kids.length > shown.length ? (
                          <button type="button" class="qmore" onClick={() => setGroupAll({ ...groupAll, [p.fingerprint]: true })}>
                            Show all {num(kids.length)}
                          </button>
                        ) : null}
                      </div>
                    </>
                  ) : null}
                </div>
              );
            })}
          </>
        ) : (
          <>
            <div class="qhead" style="grid-template-columns:20px 44px 92px 60px 72px minmax(0,1fr) 80px;padding-left:16px">
              <span />
              <span>Rung</span>
              <span>Arm</span>
              <span>Run</span>
              <span>At</span>
              <span>Problem and verdict</span>
              <span style="text-align:right">Fix by</span>
            </div>
            {order.slice(0, flatShown).map((s) => (
              <IncidentRow
                key={s.id}
                s={s}
                flat
                label={problemByFp.value.get(s.fingerprint)?.base ?? s.label ?? s.fingerprint}
                sel={isWide && sel?.id === s.id}
                onPick={() => select(s)}
                onOpen={() => open(s)}
              />
            ))}
            <div style="padding:12px 16px;border-top:1px solid var(--border-soft);font-size:12px;color:var(--text-3);display:flex;align-items:center;gap:12px;flex-wrap:wrap">
              <span>
                Showing {num(Math.min(flatShown, order.length))} of {num(d.incidents.length)} bundled incidents in this sample.
              </span>
              {order.length > flatShown ? (
                <button type="button" class="qmore" onClick={() => setFlatShown(flatShown + FLAT_PAGE)}>
                  Show {num(Math.min(FLAT_PAGE, order.length - flatShown))} more
                </button>
              ) : null}
            </div>
          </>
        )}
      </main>
      {isWide && sel && !nothing ? <QueuePane key={sel.id} s={sel} /> : null}
    </div>
  );
}

const ProblemRowWrap = ({ p, open, onToggle }: { p: Problem; open: boolean; onToggle: () => void }) => (
  <ProblemRow p={p} open={open} onToggle={onToggle} />
);

function groupNote(p: Problem, bundled: number, shownKids: number, filtered: boolean): string {
  const c = p.count;
  if (filtered && shownKids < bundled) return `Showing ${num(shownKids)} of ${num(bundled)} bundled here that match the filters.`;
  if (bundled === 0) return `None of this problem's ${num(c)} incidents were bundled with evidence. Example verdict: ${p.example}`;
  if (bundled >= c) return `All ${num(c)} are bundled with evidence.`;
  return `Showing ${num(bundled)} of ${num(c)} here. The rest are counted, not bundled with evidence.`;
}

/** Filters or search that match nothing, with a way out. */
function QueueEmpty({ f }: { f: Filters }) {
  const d = data.value!;
  const maxArm = d.fleet.robots;
  const clearAll = () => setQuery({ rung: null, layer: null, arm: null, rule: null, status: null, q: null, sel: null });
  const armQ = f.q?.match(/^(?:arm\s*)?(\d{1,5})$/);
  if (f.q && !f.arm && !f.rule && !f.status && f.rung == null && !f.layer) {
    const title = armQ && +armQ[1] > maxArm ? `No arm ${armQ[1]}` : `Nothing matches "${f.q}"`;
    return (
      <Empty
        title={title}
        hint="Search also takes a joint (wrist flex), a camera (front side) or a rule (R5)."
        actions={
          <button type="button" class="btn" onClick={clearAll}>
            Clear the search
          </button>
        }
      >
        Arms are numbered 0001 to {String(maxArm).padStart(4, "0")}.
      </Empty>
    );
  }
  const bits: string[] = [];
  if (f.rung != null) bits.push(`on rung ${f.rung}`);
  if (f.arm) bits.push(`for ${f.arm}`);
  if (f.rule) bits.push(`under rule ${f.rule}`);
  if (f.layer) bits.push(`in the ${f.layer} layer`);
  if (f.status) bits.push(`marked ${f.status === "ack" ? "acknowledged" : f.status}`);
  if (f.q) bits.push(`matching "${f.q}"`);
  let why = "";
  if (f.arm) {
    const sampled = d.incidents.some((s) => s.robot_id === f.arm && s.source === "video sample");
    if (!sampled && f.rung === 3) why = "This arm was checked on joints only, and rung 3 needs the cameras.";
    else if (!sampled && f.layer === "task") why = "This arm was checked on joints only, and the task checks need the cameras.";
  }
  if (!why && f.status) why = "Status is kept in this browser, so only what you marked here counts.";
  return (
    <Empty
      rung={f.rung}
      title={`No incidents ${bits.join(" ")}`}
      actions={
        <>
          {f.arm && hasFilters({ ...f, arm: undefined }) ? (
            <button type="button" class="btn" onClick={() => setQuery({ arm: null, sel: null })}>
              Clear the arm filter
            </button>
          ) : null}
          <button type="button" class="btn" onClick={clearAll}>
            Clear all filters
          </button>
        </>
      }
    >
      {why || undefined}
    </Empty>
  );
}

function QueueSkeleton() {
  return (
    <main id="main" class="main main-wide" aria-busy="true">
      <h1 class="h1" style="font-size:20px">
        Queue
      </h1>
      <div class="card" style="overflow:hidden">
        {[1, 2, 3, 4, 2, 2].map((r, i) => (
          <div key={i} class="qrow" style="cursor:default">
            <span />
            <RungMark rung={r} label={false} />
            <div class="skel" style="height:12px;width:70%" />
            <div class="skel" style="height:10px;width:80%" />
            <span />
            <span />
            <span />
          </div>
        ))}
      </div>
    </main>
  );
}
