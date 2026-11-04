import { Rung } from "../components/bits";
import { data } from "../data";
import { LAYER_LABEL, num, plural } from "../format";
import { href } from "../router";
import type { Layer } from "../types";

const REPO = "https://github.com/avidesai/episode-triage";

// ---------------------------------------------------------------- How it decides

export function How() {
  const d = data.value!;
  const layers: Layer[] = ["sensing", "actuation", "task"];
  const sampleIds = new Set(d.incidents.map((s) => s.rule));
  return (
    <div class="page">
      <h1 class="page-h">How it decides</h1>
      <p class="lede">
        Three layers of checks run on every run, cheapest evidence first: did the cameras deliver fresh pictures, did the joints do what they were told, and only
        then, did the task progress. For each failure, the earliest camera or joint problem that began before it is the cause; anything that began after is context.
        Then ordered rules decide the rung, first match wins. Every threshold is a fraction of a joint's range measured from that arm's own data, so the same rule
        runs on arms recorded in different units.
      </p>
      <nav class="toc small" aria-label="On this page">
        <a href="#/how?s=checks" onClick={jump("checks")}>
          Checks
        </a>
        <a href="#/how?s=ladder" onClick={jump("ladder")}>
          The ladder
        </a>
        <a href="#/how?s=thresholds" onClick={jump("thresholds")}>
          Thresholds
        </a>
      </nav>

      <h2 id="checks" class="sec-h">
        Checks
      </h2>
      {layers.map((l) => {
        const cs = d.checks.filter((c) => c.layer === l);
        return (
          <section key={l} class="ref-sec">
            <h3>
              {LAYER_LABEL[l]} <span class="muted small">{plural(cs.length, "check")}</span>
            </h3>
            <div class="tbl-scroll">
              <table class="ref stack">
                <thead>
                  <tr>
                    <th>Check</th>
                    <th>What it looks at</th>
                    <th>Fires when</th>
                    <th>Why</th>
                  </tr>
                </thead>
                <tbody>
                  {cs.map((c) => (
                    <tr key={c.id}>
                      <td>
                        <b>{c.name}</b>
                        <div class="mono xsmall muted">{c.id}</div>
                      </td>
                      <td data-label="What it looks at">{c.signal}</td>
                      <td data-label="Fires when">{c.threshold}</td>
                      <td data-label="Why" class="muted">{c.why}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}

      <h2 id="ladder" class="sec-h">
        The ladder
      </h2>
      <p class="muted small">
        Rules run in this order; the first that matches wins. Counts are incidents in the sampled runs, where every layer was checked, and in all runs, where only
        joints and data were. A sample count opens those incidents in the inbox. Most incidents in all runs have no clip bundled, so those counts are not links.
      </p>
      <div class="tbl-scroll">
        <table class="ref ladder">
          <thead>
            <tr>
              <th>Rule</th>
              <th>Rung</th>
              <th>When</th>
              <th>Goes to</th>
              <th class="n">Sampled runs</th>
              <th class="n">All runs</th>
            </tr>
          </thead>
          <tbody>
            {d.rules.map((r) => (
              <tr key={r.rule}>
                <td class="mono">{r.rule}</td>
                <td>
                  <Rung rung={r.rung} name={r.rung_name} />
                </td>
                <td>{r.when}</td>
                <td class="muted">{r.to}</td>
                <td class="n tnum">
                  {r.count_sample && sampleIds.has(r.rule) ? <a href={href(["inbox"], { rule: r.rule })}>{num(r.count_sample)}</a> : num(r.count_sample)}
                </td>
                <td class="n tnum">{num(r.count_fleet)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 id="thresholds" class="sec-h">
        Thresholds
      </h2>
      <p class="muted small">
        The values every check uses, as the engine holds them. Fractions are of a joint's range. <a href={"THRESHOLDS.md"}>THRESHOLDS.md</a> gives the physical reason
        for each and says which changed after looking at healthy data.
      </p>
      <div class="tbl-scroll">
        <table class="ref thr">
          <thead>
            <tr>
              <th>Name</th>
              <th class="n">Value</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(d.thresholds).map(([k, v]) => (
              <tr key={k}>
                <td class="mono">{k}</td>
                <td class="n tnum mono">{String(v)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function jump(id: string) {
  return (e: Event) => {
    e.preventDefault();
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
}

// ---------------------------------------------------------------- Trust

const FAULT_NAMES: Record<string, string> = {
  freeze_3: "camera frozen 3 frames",
  freeze_6: "camera frozen 6 frames",
  freeze_10: "camera frozen 10 frames",
  freeze_20: "camera frozen 20 frames",
  stall: "joint stalls for 1.5 s",
  offset: "joint offset 8% of range",
  glitch: "3 bad reads on one motor",
  stale_state: "joint stream repeats 6 frames",
};

const faultOrder = (k: string) => {
  const i = Object.keys(FAULT_NAMES).indexOf(k);
  return i < 0 ? 99 : i;
};

export function Trust() {
  const d = data.value!;
  const v = d.validation;
  return (
    <div class="page">
      <h1 class="page-h">How much to trust it</h1>
      {!v ? (
        <p class="muted">No validation run yet.</p>
      ) : (
        <>
          <p class="lede">
            Known faults were injected into real runs and the tool was scored on whether it caught them and put them on the right rung. Video faults were compressed
            again with the recorder's own settings, so a frozen picture reaches the tool as a real one would. One threshold was tuned on data: how little a picture can
            change and still count as frozen. It was set at {v.calibration.stale_tau_e} gray levels on {plural(v.calibration.robots.length, "arm")}, from{" "}
            {num(v.calibration.n_frozen_frames)} frozen and {num(v.calibration.n_moving_frames)} moving frames, then frozen and scored on different arms. Raw counts,
            misses included.
          </p>
          <div class="tbl-scroll">
            <table class="ref val">
              <thead>
                <tr>
                  <th>Fault injected</th>
                  <th class="n">Tries</th>
                  <th class="n">Caught</th>
                  <th class="n">Caught, low confidence</th>
                  <th class="n">Missed</th>
                  <th class="n">Skipped</th>
                  <th class="n">Right rung</th>
                  <th class="n">False extras</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(v.summary.faults)
                  .sort(([a], [b]) => faultOrder(a) - faultOrder(b))
                  .map(([k, r]) => (
                  <tr key={k}>
                    <td>{FAULT_NAMES[k] ?? k}</td>
                    <td class="n tnum">{num(r.n)}</td>
                    <td class="n tnum">{num(r.caught)}</td>
                    <td class="n tnum">{num(r.caught_low_confidence)}</td>
                    <td class={`n tnum ${r.missed ? "warn" : ""}`}>{num(r.missed)}</td>
                    <td class="n tnum">{num(r.abstained)}</td>
                    <td class="n tnum">{num(r.right_rung)}</td>
                    <td class="n tnum">{num(r.new_other_events)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <dl class="defs small">
            <dt>Caught, low confidence</dt>
            <dd>Found, but that camera barely shows the arm moving, so it is logged and not acted on.</dd>
            <dt>Skipped</dt>
            <dd>The run had fewer than two pauses, so a resting offset couldn't be measured.</dd>
            <dt>Right rung</dt>
            <dd>Caught and put on the rung that fault should get.</dd>
            <dt>False extras</dt>
            <dd>Anything else the injected fault set off.</dd>
          </dl>
          <p>
            A camera delayed by 3 frames was measured within 1 frame of that on {num(v.summary.lag.within_1_of_3)} of {num(v.summary.lag.estimated)} runs where lag
            could be estimated.
          </p>
        </>
      )}

      <h2 class="sec-h">On a physical arm</h2>
      {d.bench ? (
        <>
          <p>
            Recorded with the flight recorder in the repo, which logs the true age of every camera frame and the exact fault schedule. Frozen frames, frame by frame:{" "}
            {num(d.bench.stale_frames?.true_stale ?? 0)} true, {num(d.bench.stale_frames?.caught ?? 0)} caught, {num(d.bench.stale_frames?.missed ?? 0)} missed,{" "}
            {num(d.bench.stale_frames?.false_alarm ?? 0)} false alarms.
          </p>
          <div class="tbl-scroll">
            <table class="ref">
              <thead>
                <tr>
                  <th class="n">Run</th>
                  <th>Fault</th>
                  <th>Target</th>
                  <th>Caught</th>
                  <th class="n">Rung</th>
                  <th class="n">Expected</th>
                </tr>
              </thead>
              <tbody>
                {d.bench.rows.map((r, i) => (
                  <tr key={i}>
                    <td class="n tnum">{r.episode}</td>
                    <td>{r.fault}</td>
                    <td>{r.target}</td>
                    <td>{r.caught ? "yes" : "no"}</td>
                    <td class="n tnum">{r.rung}</td>
                    <td class="n tnum">{r.expect_rung}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <div class="callout">
          <p>
            <b>Not yet validated on a physical arm.</b> Everything above is faults injected in software into recorded runs. The recorder and run sheet are in the repo
            and the live monitor is what runs during a session; a scored set of faults caused on purpose appears here once it is recorded.
          </p>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- About

export function About() {
  const d = data.value!;
  const f = d.fleet;
  return (
    <div class="page">
      <h1 class="page-h">About</h1>
      <p class="lede">
        A triage inbox for a robot fleet. Every failure arrives sorted by who should fix it: the robot itself, a technician with the part named, the training team, or
        a person who has to look. Each one comes with the moment it started, what started it, and the evidence.
      </p>
      <p>
        It reads robot logs in the open LeRobot format. The demo data is the LeRobot community dataset (Apache 2.0): {num(f.robots)} SO 100 and SO 101 arms built and
        calibrated by different people, {num(f.runs)} runs, {f.hours} hours. No model calls anywhere: every decision is signal processing on aligned streams that can be
        read line by line.
      </p>
      <p class="muted small">Independent project, not affiliated with any robot company. Logs never leave your machine: the tool runs locally and this page is static.</p>

      <h2 class="sec-h">What's wrong with it</h2>
      <ul class="prose">
        <li>
          Frozen cameras and camera delay are inferred by comparing pictures with joint motion, because this data has no real capture clock. A camera moving over a
          blank surface can look frozen; those cases get low confidence and never drive a verdict, which costs recall.
        </li>
        <li>
          Almost all of the demo data is people teleoperating, so "send to training" here means a task level stall or miss by the operator, not a learned policy
          failing.
        </li>
        <li>
          Joint positions alone can't always tell a grasp on thin cloth from closing on nothing, and can't tell a joint pushing against the world from a dead one.
          Those go to a person.
        </li>
        <li>Each dataset counts as one arm; some people recorded several datasets on one arm, so arm counts are an upper bound.</li>
        <li>Camera checks ran on a random sample of arms, not every run.</li>
        <li>
          Validation so far is faults injected in software into real runs. The live monitor and the recorder exist so the same checks can be scored against faults
          caused on purpose on a physical arm.
        </li>
      </ul>

      <h2 class="sec-h">What a robot should record so this stops being inference</h2>
      <ul class="prose">
        <li>
          <b>Capture time per frame</b> from the camera or a hardware trigger, next to the loop time. Frozen frames and camera lag then become a subtraction instead of
          a cross check.
        </li>
        <li>
          <b>Real loop period.</b> A slow loop is only a log line today.
        </li>
        <li>
          <b>Per motor load, temperature, voltage and status.</b> These servos report all four over the same bus and none is recorded by default. They turn "not
          following" into "unloaded on overload" or "brownout".
        </li>
        <li>
          <b>The goal actually sent</b> after any clipping, beside the command.
        </li>
        <li>
          <b>Every takeover</b> with the progress score and subsystem health at that moment. Each one is a failure someone has already labeled.
        </li>
      </ul>

      <h2 class="sec-h">Running it on your own logs</h2>
      <p>
        Everything downstream of the reader works on one object, <code>Episode</code>: commanded and measured joint positions, frame rate, which columns are grippers,
        and a way to get each camera's frames. A new log format needs one file that produces that object; the checks, the cause ordering, the ladder, the inbox and
        the live monitor run unchanged. <code>episode_triage/readers_template.py</code> in the repo is a starting point.
      </p>

      <h2 class="sec-h">Where every number comes from</h2>
      <p class="small">
        Built from <code>{f.dataset}</code> pinned at revision <code>{f.revision.slice(0, 8)}</code>. Every number here is computed by{" "}
        <code>episode_triage/ledger.py</code> from the files in <code>results/</code>; <a href="data.json">data.json</a> and <a href="fleet.json">fleet.json</a> hold
        them and <code>incidents/</code> holds every clip. Arms are numbered, not named.
      </p>
      <p class="small">
        Code: <a href={REPO}>github.com/avidesai/episode-triage</a>
      </p>
    </div>
  );
}
