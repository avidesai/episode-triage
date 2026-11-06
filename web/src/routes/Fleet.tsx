import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { hwText, LagHistogram, SplitBar, taskText } from "../components/FleetBits";
import { DataError, Empty, Skel } from "../components/States";
import { byId, data, fleetLoad, loadFleet } from "../data";
import { fleetArms, mostlyOf, tickets, VERDICT_ORDER, verdictOf, type Verdict } from "../derive";
import { num } from "../format";
import { href, route, setQuery } from "../router";

const SHOW: [string, string][] = [
  ["all", "Everything"],
  ["hw", "Hardware"],
  ["task", "Behavior"],
  ["clear", "Robot cleared"],
  ["data", "Data only"],
];
const PILL: Record<Verdict, string> = {
  "hardware and behavior": "rtext-2",
  hardware: "rtext-2",
  behavior: "rtext-3",
  "robot cleared": "rtext-1",
  "data only": "t-3",
  clean: "t-3",
};
const PAGE = 100;

const showMatch = (show: string, v: Verdict) =>
  show === "all" ||
  (show === "hw" && (v === "hardware" || v === "hardware and behavior")) ||
  (show === "task" && (v === "behavior" || v === "hardware and behavior")) ||
  (show === "clear" && v === "robot cleared") ||
  (show === "data" && v === "data only");

const recurText = (r: string[]) => (r.length ? r[0] + (r.length > 1 ? `, and ${r.length - 1} more` : "") : "");

export function Fleet() {
  const d = data.value;
  const fl = fleetLoad.value;
  const q = route.value.q;
  const show = SHOW.some(([k]) => k === q.show) ? q.show : "all";
  const [text, setText] = useState(q.q ?? "");
  const [shown, setShown] = useState(PAGE);
  const timer = useRef(0);
  useEffect(() => {
    document.title = "Fleet · Triage";
    loadFleet();
  }, []);
  useEffect(() => setShown(PAGE), [show, q.q]);

  const rows = useMemo(() => {
    const out = fleetArms.value
      .map((a) => ({ a, v: verdictOf(a) }))
      .filter((x) => x.v !== "clean")
      .sort((x, y) => VERDICT_ORDER.indexOf(x.v) - VERDICT_ORDER.indexOf(y.v) || tickets(y.a) - tickets(x.a) || (x.a.id < y.a.id ? -1 : 1));
    return out;
  }, [fleetArms.value]);
  const needle = (q.q ?? "").trim().toLowerCase();
  const armNum = /^(?:arm\s*)?\d{1,4}$/.test(needle) ? "arm " + needle.replace(/\D/g, "").padStart(4, "0") : null;
  const visible = rows.filter(({ a, v }) => showMatch(show, v) && (!needle || (armNum ? a.id === armNum : a.id.includes(needle))));

  if (!d) return <FleetSkeleton />;
  const j = d.findings.joints;
  const vid = d.findings.video;
  const bars: [string, number][] = [
    ["Follower doesn't follow its command", j.robots_not_following],
    ["Joint stream repeats", j.robots_stale_state],
    ["Offset at rest", j.robots_rest_offset],
    ["Calibration mismatch", j.robots_gain_mismatch],
    ["Bad bus reads", j.robots_bus_glitch],
    ["Doesn't track its leader", j.robots_not_tracking],
  ];
  const bmax = Math.max(...bars.map((b) => b[1]), 1);
  const lagFlag = fl?.state === "ok" ? fl.value.lag_flag : d.thresholds.lag_flag_frames;

  const onText = (v: string) => {
    setText(v);
    clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setQuery({ q: v.trim() || null }), 150);
  };

  const Of = ({ n, of }: { n: number; of: number }) => (
    <span>
      <span class="num" style="font-weight:600">
        {num(n)}
      </span>
      <span class="num t-3"> of {num(of)}</span>
    </span>
  );

  const total = fleetArms.value.length || d.fleet.robots;
  const some = rows.length;

  return (
    <main class="main main-wide" id="main">
      <header class="page-head">
        <div>
          <h1 class="h1">Fleet</h1>
          <p>
            Which arms are sick, with what, and whether it's the hardware or the behavior. Joints checked on all {num(d.fleet.robots)} arms; cameras on{" "}
            {num(d.fleet.sampled_robots)} sampled arms.
          </p>
        </div>
      </header>

      <section style="display:flex;flex-wrap:wrap;gap:12px" aria-label="Arms by what's wrong">
        <div class="card card-pad" style="flex:1 1 420px;display:flex;flex-direction:column;gap:12px">
          <div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px;flex-wrap:wrap">
            <h2 class="h2">Joints, arms affected</h2>
            <span class="t-3" style="font-size:12px">
              of {num(d.fleet.robots)} arms, all runs
            </span>
          </div>
          {bars.map(([label, n]) => (
            <div key={label} style="display:grid;grid-template-columns:minmax(0,1.6fr) minmax(0,1fr) 44px;gap:12px;align-items:center">
              <span>{label}</span>
              <span style="height:8px;border-radius:3px;background:var(--border-soft);position:relative;overflow:hidden" aria-hidden="true">
                <i style={`position:absolute;left:0;top:0;bottom:0;width:${(100 * n) / bmax}%;background:var(--r2);border-radius:3px`} />
              </span>
              <span class="num" style="text-align:right">
                {num(n)}
              </span>
            </div>
          ))}
          <div style="padding-top:10px;border-top:1px solid var(--border-soft);display:flex;justify-content:space-between">
            <span style="font-weight:600">Any joint or calibration ticket</span>
            <Of n={j.robots_any_actuation_ticket} of={d.fleet.robots} />
          </div>
        </div>
        <div class="card card-pad" style="flex:1 1 420px;display:flex;flex-direction:column;gap:12px">
          <div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px;flex-wrap:wrap">
            <h2 class="h2">Cameras and behavior</h2>
            <span class="t-3" style="font-size:12px">
              each line says what it's counted over
            </span>
          </div>
          <div style="display:grid;grid-template-columns:minmax(0,1.6fr) auto;gap:10px 12px">
            <span>Arms with a camera freeze while moving</span>
            <Of n={vid.robots_stale_camera} of={d.fleet.sampled_robots} />
            <span>Arms with a camera {d.thresholds.lag_flag_frames} or more frames behind</span>
            <Of n={vid.robots_lag_ge_3} of={vid.robots_with_lag} />
            <span>Runs with a stall</span>
            <Of n={j.episodes_stall} of={d.fleet.runs} />
            <span>Runs with 2 or more missed grasps in a row</span>
            <Of n={j.episodes_missed_grasp_sequence} of={d.fleet.runs} />
          </div>
          <div style="padding-top:10px;border-top:1px solid var(--border-soft);display:flex;flex-direction:column;gap:6px">
            <span class="lbl">Camera lag per stream, frames behind the joints</span>
            <LagHistogram lag={vid.lag_by_frame} flag={lagFlag} />
            <span class="t-3" style="font-size:12px">
              {num(vid.lag_streams)} streams on {num(vid.robots_with_lag)} arms. {lagFlag} or more frames is flagged.
            </span>
          </div>
        </div>
      </section>

      <section class="card" aria-labelledby="arms" style="overflow:hidden">
        <div class="card-head" style="flex-wrap:wrap">
          <h2 id="arms" class="h2">
            Arms
          </h2>
          <div role="group" aria-label="Show" style="display:flex;flex-wrap:wrap;gap:6px">
            {SHOW.map(([k, name]) => (
              <button key={k} type="button" class={show === k ? "filter on" : "filter"} aria-pressed={show === k ? "true" : "false"} onClick={() => setQuery({ show: k === "all" ? null : k })}>
                {name}
              </button>
            ))}
          </div>
          <label class="field" style="flex:0 1 220px;margin-left:auto">
            <span class="sr">Find an arm</span>
            <input data-search placeholder="arm 0021" value={text} onInput={(e) => onText((e.target as HTMLInputElement).value)} />
          </label>
        </div>
        {fl?.state === "error" ? (
          <div style="padding:16px">
            <DataError onRetry={loadFleet} />
          </div>
        ) : fl?.state !== "ok" ? (
          <div style="padding:16px;display:flex;flex-direction:column;gap:10px" aria-busy="true">
            {[1, 2, 3, 4, 5].map((i) => (
              <Skel key={i} h={14} />
            ))}
          </div>
        ) : !visible.length ? (
          <div style="padding:16px">
            {armNum && +armNum.slice(4) > d.fleet.robots ? (
              <Empty title={`No ${armNum.replace(/arm 0*/, "arm ")}`} hint="Search also takes part of an arm number, like 21.">
                Arms are numbered 0001 to {String(d.fleet.robots).padStart(4, "0")}.
              </Empty>
            ) : (
              <Empty
                title={needle ? `Nothing here for "${q.q}"` : "No arms in this group"}
                actions={
                  <button type="button" class="btn" onClick={() => setQuery({ show: null, q: null })}>
                    Show every arm
                  </button>
                }
              >
                {armNum && fleetArms.value.some((a) => a.id === armNum) ? `${armNum} is clean: nothing on it in any run.` : undefined}
              </Empty>
            )}
          </div>
        ) : (
          <div class="tscroll">
            <table class="ftable">
              <thead>
                <tr>
                  <th>Arm</th>
                  <th>What's wrong</th>
                  <th>Mostly</th>
                  <th class="r">Runs</th>
                  <th>Hardware, all runs</th>
                  <th>Sampled runs</th>
                  <th>Recurring problem</th>
                  <th class="r">Camera lag</th>
                </tr>
              </thead>
              <tbody>
                {visible.slice(0, shown).map(({ a, v }) => (
                  <tr key={a.id}>
                    <td>
                      <a class="num" href={href(["arm", a.id])} style="font-weight:600">
                        {a.id}
                      </a>
                    </td>
                    <td>
                      <span class={`verdict-pill ${PILL[v]}`}>{v}</span>
                    </td>
                    <td class="t-2" style="white-space:nowrap">{mostlyOf(a, byId.value)}</td>
                    <td class="num r">{num(a.runs)}</td>
                    <td>
                      <div style="display:flex;align-items:center;gap:8px">
                        <SplitBar hw={a.hw} />
                        <span class="num t-2" style="font-size:12px;min-width:130px">
                          {hwText(a)}
                        </span>
                      </div>
                    </td>
                    <td class="t-2" style="font-size:12px;min-width:120px">
                      <span class="num">{taskText(a)}</span>
                    </td>
                    <td class="t-2" style="font-size:12px;min-width:200px;max-width:260px">
                      {recurText(a.recurring)}
                    </td>
                    <td class="num r t-2">{a.lag == null ? "" : `${a.lag} ${a.lag === 1 ? "frame" : "frames"}`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div style="padding:12px 16px;border-top:1px solid var(--border-soft);font-size:12px;color:var(--text-3);display:flex;flex-wrap:wrap;gap:16px;align-items:center">
          <span>
            {num(total)} arms. {num(some)} have something on them; the other {num(total - some)} are clean.
          </span>
          {visible.length > shown ? (
            <button type="button" class="qmore" onClick={() => setShown(shown + PAGE)}>
              Show {num(Math.min(PAGE, visible.length - shown))} more of {num(visible.length)}
            </button>
          ) : null}
          <span style="display:inline-flex;gap:10px;align-items:center">
            <span class="sw" style="background:var(--r1)" />
            robot cleared <span class="sw" style="background:var(--r2)" />
            ticket <span class="sw" style="background:repeating-linear-gradient(90deg,var(--r4) 0 3px,transparent 3px 5px)" />a person
          </span>
        </div>
      </section>
    </main>
  );
}

function FleetSkeleton() {
  return (
    <main class="main main-wide" id="main" aria-busy="true">
      <h1 class="h1">Fleet</h1>
      <Skel h={180} style="border-radius:12px" />
      <Skel h={320} style="border-radius:12px" />
    </main>
  );
}
