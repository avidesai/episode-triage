import { useEffect, useRef } from "preact/hooks";
import { Lane } from "../components/Lane";
import { ProblemRow } from "../components/ProblemRow";
import { RungMark } from "../components/RungMark";
import { Stat } from "../components/Stat";
import { Skel } from "../components/States";
import { data } from "../data";
import { lanes, problemByFp, problemStatus, startHere } from "../derive";
import { num } from "../format";
import { useKeys } from "../keys";
import { href } from "../router";
import { workflow } from "../state";

const N = ({ v }: { v: number }) => (
  <span class="num" style="color:var(--text)">
    {num(v)}
  </span>
);

export function Ladder() {
  const d = data.value;
  useEffect(() => {
    document.title = "Ladder · Triage";
  }, []);
  const rows = useRef<(HTMLAnchorElement | null)[]>([]);
  const move = (dir: number) => {
    const list = rows.current.filter(Boolean) as HTMLAnchorElement[];
    if (!list.length) return;
    const i = list.indexOf(document.activeElement as HTMLAnchorElement);
    const next = i < 0 ? (dir > 0 ? 0 : list.length - 1) : Math.max(0, Math.min(list.length - 1, i + dir));
    list[next].focus();
  };
  useKeys({ j: () => move(1), k: () => move(-1) });

  if (!d) return <LadderSkeleton />;

  const f = d.findings;
  const anchors: Record<string, number> = f.video.anchors ?? {};
  const began = anchors["began with sensing or actuation"] ?? 0;
  const healthy = anchors["training, inputs healthy"] ?? 0;
  const anchorTotal = Object.values(anchors).reduce((a, b) => a + b, 0);
  const wf = workflow.value;

  return (
    <main class="main main-wide" id="main">
      <header class="page-head">
        <div>
          <h1 class="h1">Where every failure goes</h1>
          <p>
            Joint and data checks on all <N v={d.fleet.runs} /> runs from <N v={d.fleet.robots} /> arms. Cameras checked on <N v={d.fleet.sampled_runs} /> sampled
            runs from <N v={d.fleet.sampled_robots} /> arms. The ladder sorts each failure by who should fix it, not by how bad it is.{" "}
            <a href={href(["docs", "decides"])}>How it decides</a>
          </p>
        </div>
        <a class="btn primary" href={href(["queue"])}>
          Open the queue <span class="kbd">G Q</span>
        </a>
      </header>

      <section class="lanes" aria-label="The ladder">
        {lanes.value.map((l) => (
          <Lane key={l.rung} lane={l} d={d} />
        ))}
      </section>

      <section aria-labelledby="found" style="display:flex;flex-direction:column;gap:12px">
        <h2 id="found" class="lbl">
          What it found in this fleet
        </h2>
        <div class="stats">
          <Stat n={f.joints.robots_any_actuation_ticket} of={`of ${num(d.fleet.robots)} arms`} rung={2}>
            have a joint or calibration ticket.
          </Stat>
          <Stat n={f.video.episodes_stale_camera} of={`of ${num(d.fleet.sampled_runs)} sampled runs`} rung={1}>
            had a camera freeze while the arm moved. None of it shows in the timestamps.
          </Stat>
          <Stat n={f.video.robots_lag_ge_3} of={`of ${num(f.video.robots_with_lag)} arms`}>
            have a camera running {d.thresholds.lag_flag_frames} or more frames behind the joints.
          </Stat>
          <Stat n={began} of={`of ${num(anchorTotal)} stalls and missed grasp runs`} rung={3}>
            began with a camera or joint fault. {num(healthy)} went to training with every layer checked.
          </Stat>
        </div>
      </section>

      <section class="card" aria-labelledby="start" style="overflow:hidden">
        <div class="card-head" style="flex-wrap:wrap">
          <div style="display:flex;align-items:baseline;gap:10px;flex-wrap:wrap">
            <h2 id="start" class="h2">
              Start here
            </h2>
            <span class="t-3" style="font-size:12px">
              Top problems by the engine's priority: arms and runs hit, weighted by rung.
            </span>
          </div>
          <span class="t-3" style="font-size:12px;display:inline-flex;gap:6px;align-items:center">
            <span class="kbd">J</span>
            <span class="kbd">K</span> move <span class="kbd">↵</span> open
          </span>
        </div>
        <div class="qhead">
          <span />
          <span>Rung</span>
          <span>Problem</span>
          <span>Example verdict</span>
          <span>Scope</span>
          <span style="text-align:right">Incidents</span>
          <span style="text-align:right">Arms</span>
        </div>
        {startHere.value.map((r, i) => {
          const p = problemByFp.value.get(r.fingerprint)!;
          return (
            <ProblemRow
              key={r.fingerprint}
              p={p}
              status={problemStatus(r.fingerprint, wf)}
              link={href(["queue"], { open: r.fingerprint })}
              focusRef={(el: HTMLAnchorElement | null) => {
                rows.current[i] = el;
              }}
            />
          );
        })}
      </section>
    </main>
  );
}

/** Loading: header lines and four lanes with their rung marks drawn at once. */
function LadderSkeleton() {
  return (
    <main class="main main-wide" id="main" aria-busy="true">
      <header class="page-head">
        <div style="display:flex;flex-direction:column;gap:10px;flex:1">
          <h1 class="h1">Where every failure goes</h1>
          <Skel h={12} w="70%" />
          <Skel h={12} w="45%" />
        </div>
      </header>
      <section class="lanes" aria-label="The ladder, loading">
        {[1, 2, 3, 4].map((r) => (
          <article key={r} class={`lane l${r}`}>
            <div class="lane-top" />
            <div class="lane-body">
              <RungMark rung={r} lg label={false} />
              <Skel h={22} w="60%" />
              <Skel h={30} w="40%" />
              <Skel h={8} />
              <Skel h={8} w="70%" />
            </div>
          </article>
        ))}
      </section>
    </main>
  );
}
