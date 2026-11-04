import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import { Empty, ErrorBox, Rung, Skeleton, SortHead } from "../components/bits";
import { IncidentDetail, type Nav } from "../components/IncidentDetail";
import { IncidentHead, IncidentRow } from "../components/IncidentTable";
import { bundlePath, data, fleetLoad, loadFleet, priorityOf } from "../data";
import { num, plural } from "../format";
import { go, href, route } from "../router";
import { workflow } from "../state";
import type { Arm, Data, Summary } from "../types";
import { sortIncidents } from "./Inbox";

function Tile({ value, of, label, link, detail }: { value: number | string; of?: string; label: string; link?: string; detail?: string }) {
  const body = (
    <>
      <span class="tile-v tnum">
        {typeof value === "number" ? num(value) : value}
        {of ? <span class="tile-of"> of {of}</span> : null}
      </span>
      <span class="tile-l">{label}</span>
      {detail ? <span class="tile-d">{detail}</span> : null}
    </>
  );
  return link ? (
    <a class="tile link" href={link}>
      {body}
    </a>
  ) : (
    <div class="tile">{body}</div>
  );
}

function Tiles({ d }: { d: Data }) {
  const J = d.findings.joints,
    V = d.findings.video,
    F = d.fleet;
  const A = (V.anchors ?? {}) as Record<string, number>;
  const nA = Object.values(A).reduce((a, b) => a + b, 0);
  const began = A["began with sensing or actuation"] ?? 0;
  return (
    <div class="tiles">
      <Tile value={F.robots} label="arms" detail={`${num(F.runs)} runs, ${F.hours} h of recordings`} />
      <Tile
        value={J.robots_any_actuation_ticket}
        of={num(J.robots)}
        label="arms with a joint or calibration ticket"
        detail={`offset at rest ${num(J.robots_rest_offset)}, calibrated over different spans ${num(J.robots_gain_mismatch)}, not tracking ${num(J.robots_not_tracking)}, bad bus reads ${num(J.robots_bus_glitch)}`}
        link={href(["fleet"], { f: "ticket", sort: "-act" })}
      />
      <Tile
        value={V.episodes_stale_camera}
        of={num(V.episodes_all_cameras)}
        label="sampled runs where a camera froze while the arm moved"
        detail={`on ${plural(V.robots_stale_camera, "arm")}; none of it visible in the timestamps`}
        link={href(["inbox"], { layer: "sensing" })}
      />
      <Tile
        value={V.robots_lag_ge_3}
        of={num(V.robots_with_lag)}
        label="arms with a camera 3 or more frames behind the joints"
        detail={`${num(V.camera_streams_lag_ge_3)} of ${num(V.lag_streams)} camera streams; the most was ${V.lag_max_frames} frames`}
        link={href(["fleet"], { f: "lag", sort: "-lag" })}
      />
      <Tile
        value={began}
        of={num(nA)}
        label="stalls and missed grasp sequences that began with a camera or joint fault"
        detail={`${num(A["training, inputs healthy"] ?? 0)} went to training with every layer checked`}
        link={href(["inbox"], { layer: "task" })}
      />
    </div>
  );
}

const FILTERS: [string, string, (a: Arm) => boolean][] = [
  ["ticket", "Has a joint or calibration ticket", (a) => a.act_tickets > 0],
  ["lag", "Camera 3 or more frames late", (a) => a.lag != null && a.lag >= 3],
  ["sampled", "Cameras sampled", (a) => a.sampled],
  ["recurring", "Has a recurring problem", (a) => a.recurring.length > 0],
  ["bundled", "Has clips to open", (a) => a.bundled.length > 0],
];

export function Fleet() {
  const d = data.value!;
  const r = route.value;
  useEffect(() => {
    loadFleet();
  }, []);
  const arm = r.path[1] ?? null;
  const fl = fleetLoad.value;

  if (arm) return <ArmView d={d} armId={arm} arms={fl?.state === "ok" ? fl.value.arms : null} />;

  return (
    <div class="page wide">
      <div class="page-head">
        <h1 class="page-h">Fleet</h1>
        <p class="muted small">
          {d.fleet.name}: {num(d.fleet.robots)} arms, {num(d.fleet.runs)} runs. Joint and data checks ran on every run; camera checks on a random sample of{" "}
          {num(d.fleet.sampled_runs)} runs from {num(d.fleet.sampled_robots)} arms. Counts, never rates.
        </p>
      </div>
      <Tiles d={d} />
      {fl == null || fl.state === "loading" ? (
        <Skeleton rows={12} />
      ) : fl.state === "error" ? (
        <ErrorBox title="Arm table not built" detail={`${fl.error}. Run .venv/bin/triage report to write docs/fleet.json.`} retry={() => loadFleet()} />
      ) : (
        <ArmsTable arms={fl.value.arms} />
      )}
    </div>
  );
}

function ArmsTable({ arms }: { arms: Arm[] }) {
  const r = route.value;
  const q = r.q;
  const sort = q.sort ?? "-act";
  const f = q.f ? q.f.split(",") : [];
  const [draft, setDraft] = useState(q.q ?? "");
  useEffect(() => {
    const id = setTimeout(() => (draft !== (q.q ?? "") ? go(["fleet"], { ...q, q: draft || null }, true) : null), 150);
    return () => clearTimeout(id);
  }, [draft]);

  const hwKeys = useMemo(() => [...new Set(arms.flatMap((a) => Object.keys(a.hw)))].sort(), [arms]);
  const taskKeys = useMemo(() => [...new Set(arms.flatMap((a) => Object.keys(a.task ?? {})))].sort(), [arms]);

  const list = useMemo(() => {
    const s = (q.q ?? "").trim().toLowerCase();
    let out = arms.filter((a) => f.every((k) => FILTERS.find((x) => x[0] === k)?.[2](a) ?? true) && (!s || a.id.includes(s) || a.id.replace("arm ", "").includes(s)));
    const desc = sort.startsWith("-");
    const col = desc ? sort.slice(1) : sort;
    const v = (a: Arm): number | string => {
      if (col === "arm") return a.id;
      if (col === "runs") return a.runs;
      if (col === "act") return a.act_tickets * 1e6 + (a.hw["4"] ?? 0) * 1e3 + (a.hw["2"] ?? 0);
      if (col.startsWith("hw")) return a.hw[col.slice(2)] ?? 0;
      if (col.startsWith("task")) return a.task ? a.task[col.slice(4)] ?? 0 : -1;
      if (col === "data") return a.data;
      if (col === "recurring") return a.recurring.length;
      if (col === "lag") return a.lag ?? -99;
      if (col === "latest") return a.latest_run ?? -1;
      if (col === "clips") return a.bundled.length;
      return a.id;
    };
    out = out.slice().sort((a, b) => {
      const x = v(a),
        y = v(b);
      const c = typeof x === "string" ? x.localeCompare(y as string) : (x as number) - (y as number);
      return (desc ? -c : c) || a.id.localeCompare(b.id);
    });
    return out;
  }, [arms, q.q, q.f, sort]);

  const onSort = (s: string) => go(["fleet"], { ...q, sort: s }, true);
  const toggleF = (k: string) => go(["fleet"], { ...q, f: (f.includes(k) ? f.filter((x) => x !== k) : [...f, k]).join(",") || null }, true);
  const cols = 2 + hwKeys.length + taskKeys.length + 5;

  return (
    <section aria-label="Arms">
      <div class="toolbar">
        <div class="tb-row">
          <input
            data-search
            class="input search"
            type="search"
            placeholder="Find an arm by number"
            aria-label="Find an arm"
            value={draft}
            onInput={(e) => setDraft((e.target as HTMLInputElement).value)}
          />
        </div>
        <div class="tb-row chips">
          {FILTERS.map(([k, l, fn]) => (
            <button key={k} class={`chip ${f.includes(k) ? "on" : ""}`} aria-pressed={f.includes(k)} onClick={() => toggleF(k)}>
              {l}
              <span class="chip-n tnum">{num(arms.filter(fn).length)}</span>
            </button>
          ))}
        </div>
        <div class="tb-row count">
          <span>
            {list.length === arms.length ? plural(arms.length, "arm") : `${num(list.length)} of ${plural(arms.length, "arm")}`}
          </span>
        </div>
      </div>
      <div class="atable-scroll">
        <div class="atable" role="table" aria-label="Arms" style={{ "--agrid": `minmax(92px, 1.2fr) 52px repeat(${cols - 2}, minmax(44px, 1fr))` } as any}>
          <div role="row" class="arow group-head" aria-hidden="true">
            <span class="g-blank" />
            <span class="g-span" style={{ gridColumn: `span ${hwKeys.length}` }}>
              Cameras and joints, all runs
            </span>
            <span class="g-span" style={{ gridColumn: `span ${taskKeys.length}` }}>
              Task, sampled runs
            </span>
            <span class="g-rest" />
          </div>
          <div role="row" class="arow head">
            <SortHead cls="a-arm" label="Arm" col="arm" sort={sort} onSort={onSort} />
            <SortHead cls="a-n" label="Runs" col="runs" sort={sort} onSort={onSort} />
            {hwKeys.map((k) => (
              <SortHead key={k} cls="a-n a-rung" label={<Rung rung={+k} />} col={"hw" + k} sort={sort} onSort={onSort} title={`Camera and joint incidents on rung ${k}, all runs`} />
            ))}
            {taskKeys.map((k) => (
              <SortHead key={k} cls="a-n a-rung" label={<Rung rung={+k} />} col={"task" + k} sort={sort} onSort={onSort} title={`Task incidents on rung ${k}, sampled runs`} />
            ))}
            <SortHead cls="a-n" label="Data" col="data" sort={sort} onSort={onSort} title="Runs that failed an integrity check" />
            <SortHead cls="a-n" label="Recurring" col="recurring" sort={sort} onSort={onSort} title="Problems seen 3 or more times on this arm" />
            <SortHead cls="a-n" label="Lag" col="lag" sort={sort} onSort={onSort} title="Median frames the slowest camera runs behind the joints" />
            <SortHead cls="a-n" label="Latest" col="latest" sort={sort} onSort={onSort} title="Latest run with an incident" />
            <SortHead cls="a-n" label="Clips" col="clips" sort={sort} onSort={onSort} title="Bundled incidents you can open" />
          </div>
          {list.length ? (
            list.map((a) => (
              <a key={a.id} role="row" class="arow" href={href(["fleet", a.id])}>
                <span role="cell" class="a-arm mono">
                  {a.id}
                </span>
                <span role="cell" class="a-n tnum">
                  {num(a.runs)}
                </span>
                {hwKeys.map((k) => (
                  <span key={k} role="cell" class={`a-n tnum ${a.hw[k] ? `cnt r${k}` : "zero"}`}>
                    {a.hw[k] ? num(a.hw[k]) : ""}
                  </span>
                ))}
                {taskKeys.map((k) => (
                  <span key={k} role="cell" class={`a-n tnum ${a.task?.[k] ? `cnt r${k}` : "zero"}`}>
                    {a.task ? (a.task[k] ? num(a.task[k]) : "") : <span class="na" title="Cameras not sampled on this arm" aria-label="not sampled">·</span>}
                  </span>
                ))}
                <span role="cell" class="a-n tnum">
                  {a.data || ""}
                </span>
                <span role="cell" class="a-n tnum" title={a.recurring.join("; ")}>
                  {a.recurring.length || ""}
                </span>
                <span role="cell" class={`a-n tnum ${a.lag != null && a.lag >= 3 ? "warn" : ""}`}>
                  {a.lag != null ? `${+a.lag.toFixed(1)} fr` : ""}
                </span>
                <span role="cell" class="a-n tnum">
                  {a.latest_run ?? ""}
                </span>
                <span role="cell" class="a-n tnum">
                  {a.bundled.length || ""}
                </span>
              </a>
            ))
          ) : (
            <Empty title="No arms match">
              <button class="btn" onClick={() => go(["fleet"], {}, true)}>
                Clear filters
              </button>
            </Empty>
          )}
        </div>
      </div>
      <p class="muted small list-foot">
        Rung columns count incidents. Camera and joint incidents come from the joint pass over every run; task incidents only from the sampled runs, where every layer
        was checked first. Lag is the median over that arm's sampled runs for its slowest camera, in frames. Each dataset counts as one arm, so arm counts are an upper
        bound.
      </p>
    </section>
  );
}

function Strip({ arm }: { arm: Arm }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(600);
  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    setW(el.clientWidth);
    const ro = new ResizeObserver(([e]) => setW(Math.floor(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const lanes = [...new Set(arm.marks.map((m) => m[1]))].sort((a, b) => b - a);
  if (!arm.marks.length) return <p class="muted small">No camera, joint or task incidents on this arm.</p>;
  const maxRun = Math.max(arm.runs - 1, ...arm.marks.map((m) => m[0]), 1);
  const left = 30,
    right = 10,
    lh = 22,
    top = 6,
    axis = 20;
  const h = top + lanes.length * lh + axis;
  const X = (v: number) => left + (v / maxRun) * (w - left - right);
  const step = [1, 2, 5, 10, 20, 50, 100, 200, 500].find((s) => maxRun / s <= Math.max(4, (w - left) / 70)) ?? 1000;
  const ticks: number[] = [];
  for (let v = 0; v <= maxRun; v += step) ticks.push(v);
  const counts = new Map<string, number>();
  for (const [run, g] of arm.marks) counts.set(`${run}|${g}`, (counts.get(`${run}|${g}`) ?? 0) + 1);
  return (
    <div class="strip" ref={wrap}>
      <svg width={w} height={h} role="img" aria-label={`${plural(arm.marks.length, "incident")} across ${plural(arm.runs, "run")}, by rung`}>
        {lanes.map((g, i) => (
          <g key={g}>
            <line class="axis faint" x1={left} x2={w - right} y1={top + i * lh + lh / 2} y2={top + i * lh + lh / 2} />
            <text class="tick" x={left - 8} y={top + i * lh + lh / 2 + 4} text-anchor="end">
              {g}
            </text>
          </g>
        ))}
        {[...counts.entries()].map(([k, n]) => {
          const [run, g] = k.split("|").map(Number);
          const i = lanes.indexOf(g);
          return (
            <circle key={k} class={`mark r${g}`} cx={X(run)} cy={top + i * lh + lh / 2} r={Math.min(8, 3.5 + n)}>
              <title>
                run {run}: {plural(n, "incident")} on rung {g}
              </title>
            </circle>
          );
        })}
        {ticks.map((v) => (
          <text key={v} class="tick" x={X(v)} y={h - 4} text-anchor="middle">
            {v}
          </text>
        ))}
      </svg>
      <p class="muted xsmall">Runs across, one dot per run and rung, larger when several incidents share a run.</p>
    </div>
  );
}

function ArmView({ d, armId, arms }: { d: Data; armId: string; arms: Arm[] | null }) {
  const r = route.value;
  const sel = r.path[2] === "i" && r.path[3] ? r.path[3] : null;
  const arm = arms?.find((a) => a.id === armId) ?? null;
  const sort = r.q.sort ?? "run";
  const rows: Summary[] = useMemo(
    () => sortIncidents(d.incidents.filter((s) => s.robot_id === armId), sort, priorityOf.value, workflow.value),
    [d, armId, sort, workflow.value],
  );
  const order = rows.map((s) => s.id);
  const pos = sel ? order.indexOf(sel) : -1;
  const openId = (id: string, replace = false) => go(["fleet", armId, "i", id], r.q, replace);
  const nav: Nav | undefined = sel
    ? { prev: pos > 0 ? order[pos - 1] : null, next: pos >= 0 && pos < order.length - 1 ? order[pos + 1] : null, pos: pos + 1, total: order.length, goTo: (id) => openId(id, true) }
    : undefined;

  return (
    <div class={`split ${sel ? "has-pane" : ""}`}>
      <section class="list-col page-pad" aria-label={armId}>
        <p class="crumbs small">
          <a href={href(["fleet"])}>Fleet</a> <span aria-hidden="true">›</span> <span class="mono">{armId}</span>
        </p>
        <h1 class="page-h mono">{armId}</h1>
        {arms == null ? (
          <Skeleton rows={3} />
        ) : !arm ? (
          <Empty title={`No arm called ${armId} in this fleet`}>
            <a class="btn" href={href(["fleet"])}>
              Back to the fleet
            </a>
          </Empty>
        ) : (
          <>
            <div class="arm-facts">
              <span>
                <b class="tnum">{num(arm.runs)}</b> runs
              </span>
              <span>
                <b class="tnum">{num(Object.values(arm.hw).reduce((a, b) => a + b, 0))}</b> camera and joint incidents
              </span>
              <span>
                {arm.task ? (
                  <>
                    <b class="tnum">{num(Object.values(arm.task).reduce((a, b) => a + b, 0))}</b> task incidents in {plural(arm.sampled_runs, "sampled run")}
                  </>
                ) : (
                  "cameras not sampled"
                )}
              </span>
              {arm.data ? (
                <span>
                  <b class="tnum">{num(arm.data)}</b> data problems
                </span>
              ) : null}
              {arm.lag != null ? (
                <span>
                  slowest camera <b class="tnum">{+arm.lag.toFixed(1)}</b> frames behind
                </span>
              ) : null}
            </div>
            {arm.recurring.length ? (
              <p class="small">
                <span class="tag recur">recurring</span> {arm.recurring.join("; ")}
              </p>
            ) : null}
            <Strip arm={arm} />
          </>
        )}
        <h3 class="sec-h">Incidents with clips</h3>
        {rows.length ? (
          <div class="itable" role="table" aria-label={`Incidents on ${armId}`}>
            <IncidentHead sort={sort} onSort={(s) => go(r.path, { ...r.q, sort: s }, true)} />
            {rows.map((s) => (
              <IncidentRow key={s.id} s={s} link={href(["fleet", armId, "i", s.id])} selected={s.id === sel} cursor={false} onOpen={() => openId(s.id, !!sel)} />
            ))}
          </div>
        ) : (
          <p class="muted small">Counted in the joint pass, no clip bundled for this arm.</p>
        )}
      </section>
      {sel ? (
        <aside class="pane" aria-label="Incident">
          <IncidentDetail id={sel} path={bundlePath(sel)} nav={nav} onClose={() => go(["fleet", armId], r.q)} />
        </aside>
      ) : null}
    </div>
  );
}
