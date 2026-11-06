import { useEffect } from "preact/hooks";
import { RunsStrip } from "../components/FleetBits";
import { RungMark } from "../components/RungMark";
import { DataError, Empty, Skel } from "../components/States";
import { byId, data, fleetLoad, loadFleet } from "../data";
import { armById, armHeadline, verdictOf, type Verdict } from "../derive";
import { num, partWords, sentence, splitLabel } from "../format";
import { href } from "../router";
import { pushRecent } from "../state";

const TAG: Record<Verdict, [number, string]> = {
  "hardware and behavior": [2, "Hardware and behavior"],
  hardware: [2, "Hardware"],
  behavior: [3, "Behavior"],
  "robot cleared": [1, "Robot cleared"],
  "data only": [4, "Data only"],
  clean: [1, "Clean"],
};

const list = (w: string[]) => (w.length <= 1 ? w[0] ?? "" : w.slice(0, -1).join(", ") + " and " + w[w.length - 1]);

export function Arm({ id }: { id: string }) {
  const d = data.value;
  const fl = fleetLoad.value;
  const a = armById.value.get(id) ?? null;
  useEffect(() => {
    document.title = `${id} · Triage`;
    loadFleet();
  }, [id]);
  useEffect(() => {
    if (a) pushRecent({ kind: "Arm", text: a.id, meta: armHeadline(a).title, to: href(["arm", a.id]) });
  }, [a?.id]);

  const crumbs = (
    <nav aria-label="Breadcrumb" class="t-3" style="display:flex;gap:8px;align-items:center">
      <a href={href(["fleet"])}>Fleet</a>
      <span>/</span>
      <span class="num" style="color:var(--text)">
        {id}
      </span>
    </nav>
  );

  if (fl?.state === "error")
    return (
      <main class="main main-wide" id="main">
        {crumbs}
        <h1 class="sr">{id}</h1>
        <DataError onRetry={loadFleet} />
      </main>
    );
  if (!d || fl?.state !== "ok")
    return (
      <main class="main main-wide" id="main" aria-busy="true">
        {crumbs}
        <h1 class="h-incident">
          <span class="num">{id}</span>
        </h1>
        <Skel h={120} style="border-radius:12px" />
        <Skel h={90} style="border-radius:12px" />
      </main>
    );
  if (!a) {
    const m = id.match(/(\d+)/);
    return (
      <main class="main main-wide" id="main">
        {crumbs}
        <h1 class="sr">No such arm</h1>
        <Empty title={`No arm ${m ? m[1] : id}`} actions={<a class="btn" href={href(["fleet"])}>Back to the fleet</a>}>
          Arms are numbered 0001 to {String(d.fleet.robots).padStart(4, "0")}.
        </Empty>
      </main>
    );
  }

  const v = verdictOf(a);
  const [tagRung, tagText] = TAG[v];
  const head = armHeadline(a);
  const runs = Math.max(a.runs, 1);
  const runsWith = new Set(a.marks.filter(([, r]) => r === 2).map(([run]) => run));
  const ticketRuns = [...runsWith].sort((x, y) => x - y);
  const standing = ticketRuns.length >= 0.8 * runs;
  const fromTo = ticketRuns.length && ticketRuns[0] === 0 && ticketRuns[ticketRuns.length - 1] >= runs - 1 ? ", from the first run to the last" : "";
  const bundled = a.bundled.map((x) => byId.value.get(x)).filter((x): x is NonNullable<typeof x> => !!x);
  const mid = Math.floor((runs - 1) / 2);

  return (
    <main class="main main-wide" id="main">
      {crumbs}
      <header style="display:flex;flex-wrap:wrap;gap:24px;align-items:flex-start;justify-content:space-between">
        <div style="display:flex;flex-direction:column;gap:10px;flex:1 1 520px">
          <div class="tagrow">
            <span class={`rung-tag r${tagRung}`}>
              <RungMark rung={tagRung} label={false} />
              {tagText}
            </span>
            <span class="tag">{a.sampled ? `sampled for cameras on ${num(a.sampled_runs)} run${a.sampled_runs === 1 ? "" : "s"}` : "joint pass only, not sampled for cameras"}</span>
          </div>
          <h1 class="h-incident">
            <span class="num">{a.id}</span>
            {head.title ? `: ${head.title}` : ""}
          </h1>
          {head.one ? (
            <p class="t-2" style="max-width:680px">
              All {num(a.recurring.length)} problems that recur on this arm are on {head.one}. Check that joint and its calibration before anything else on this arm.
            </p>
          ) : head.parts.length ? (
            <p class="t-2" style="max-width:680px">
              The recurring problems on this arm are on {list(head.parts)}.
            </p>
          ) : null}
        </div>
        <div class="card card-pad" style="flex:0 1 420px;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px 20px">
          {(
            [
              [a.hw["2"] ?? 0, "tickets for a named part"],
              [a.hw["4"] ?? 0, "sent to a person"],
              [a.hw["1"] ?? 0, "cleared by the robot"],
              [a.data, "data problems"],
            ] as [number, string][]
          ).map(([n, l]) => (
            <div key={l}>
              <div class="num" style="font-size:22px;font-weight:600">
                {num(n)}
              </div>
              <div class="t-2" style="font-size:12px">
                {l}
              </div>
            </div>
          ))}
          <div style="grid-column:1/-1;padding-top:10px;border-top:1px solid var(--border-soft);font-size:12px" class="t-2">
            Over{" "}
            <span class="num" style="color:var(--text)">
              {num(a.runs)}
            </span>{" "}
            runs, all checked for joints and data.{a.latest_run != null ? ` Latest run ${a.latest_run}.` : ""}
          </div>
        </div>
      </header>

      <section class="card card-pad" aria-labelledby="runs" style="display:flex;flex-direction:column;gap:12px">
        <div style="display:flex;justify-content:space-between;align-items:baseline;flex-wrap:wrap;gap:8px">
          <h2 id="runs" class="h2">
            Runs, oldest to newest
          </h2>
          <span class="t-3" style="font-size:12px;display:inline-flex;gap:10px;align-items:center">
            each block is one incident <span class="sw" style="background:var(--r1)" />
            robot <span class="sw" style="background:var(--r2)" />
            ticket <span class="sw" style="background:var(--r4)" />a person
          </span>
        </div>
        <RunsStrip a={a} />
        <div style="display:flex;justify-content:space-between" class="num t-3">
          <span style="font-size:11px">run 0</span>
          {runs > 2 ? <span style="font-size:11px">run {mid}</span> : null}
          <span style="font-size:11px">run {runs - 1}</span>
        </div>
        <p class="t-2" style="font-size:12px">
          {ticketRuns.length
            ? `Tickets in ${num(ticketRuns.length)} of ${num(runs)} runs${fromTo}.${standing ? " A standing fault, not a one off." : ""}`
            : a.marks.length
              ? `${num(a.marks.length)} incident${a.marks.length === 1 ? "" : "s"} across ${num(runs)} runs, no tickets.`
              : `Nothing fired in ${num(runs)} runs.`}
        </p>
      </section>

      <div style="display:flex;flex-wrap:wrap;gap:20px;align-items:flex-start">
        {a.recurring.length ? (
          <section class="card" aria-labelledby="rec" style="flex:1 1 420px;overflow:hidden">
            <div class="card-head">
              <h2 id="rec" class="h2">
                Recurring on this arm
              </h2>
              <span class="t-3" style="font-size:12px">
                {fl.value.recur_on_one} or more times
              </span>
            </div>
            <div class="divide">
              {a.recurring.map((r) => {
                const { base, part } = splitLabel(r);
                const fp = d.inbox.find((x) => x.label === r)?.fingerprint;
                return (
                  <a key={r} class="lane-row" href={href(["queue"], fp ? { open: fp, arm: a.id } : { arm: a.id })} style="padding:12px 16px">
                    <span>{base}</span>
                    <span class="chip">{part}</span>
                  </a>
                );
              })}
            </div>
          </section>
        ) : null}
        <section class="card" aria-labelledby="inc" style="flex:1.4 1 520px;overflow:hidden">
          <div class="card-head">
            <h2 id="inc" class="h2">
              Incidents with evidence
            </h2>
            <span class="t-3" style="font-size:12px">
              {num(bundled.length)} bundled from this arm
            </span>
          </div>
          <div class="divide">
            {bundled.map((s) => {
              const { base, part } = splitLabel(s.label ?? s.fingerprint, s.fingerprint);
              return (
                <a key={s.id} href={href(["i", s.id])} style="display:grid;grid-template-columns:44px minmax(0,1fr);gap:4px 12px;padding:12px 16px;color:var(--text)">
                  <RungMark rung={s.rung} />
                  <b style="font-weight:550">
                    {base}{" "}
                    <span class="t-3" style="font-weight:400">
                      {part || partWords(s.component ?? "")}
                    </span>
                  </b>
                  <span />
                  <span class="mono t-2" style="font-size:12px">
                    run {s.run} · {s.route}
                  </span>
                </a>
              );
            })}
          </div>
          <div style="padding:10px 16px;border-top:1px solid var(--border-soft);font-size:12px" class="t-3">
            {bundled.length ? "The other incidents on this arm are counted, not bundled with evidence." : `${sentence("none of this arm's incidents were bundled with evidence")}.`}
          </div>
        </section>
      </div>
    </main>
  );
}
