import { data } from "../../data";
import { num } from "../../format";
import type { Data, FaultScore } from "../../types";
import { DocsLayout } from "./DocsLayout";

const ORDER = ["freeze_3", "freeze_6", "freeze_10", "freeze_20", "glitch", "offset", "stale_state", "stall"];
function faultWords(k: string): string {
  const m = k.match(/^freeze_(\d+)$/);
  if (m) return `camera frozen ${m[1]} frames`;
  return (
    {
      glitch: "3 bad reads on one motor",
      offset: "joint offset 8% of range",
      stale_state: "joint stream repeats 6 frames",
      stall: "joint stalls for 1.5 s",
    } as Record<string, string>
  )[k] ?? k;
}

const w = (a: number, n: number) => `${n ? (100 * a) / n : 0}%`;

export function Trust() {
  const d = data.value as Data;
  const v = d.validation;
  const faults = v ? Object.entries(v.summary.faults).sort((a, b) => (ORDER.indexOf(a[0]) + 1 || 99) - (ORDER.indexOf(b[0]) + 1 || 99)) : [];
  const cal = v?.calibration as (Data["validation"] & {})["calibration"] & { tpr_at_tau?: number; fpr_at_tau?: number };
  const lag = v?.summary.lag;
  const shifts = Object.entries(lag?.shift_counts ?? {})
    .map(([k, n]) => [Number(k), n] as [number, number])
    .sort((a, b) => a[0] - b[0]);
  const smax = Math.max(1, ...shifts.map((s) => s[1]));
  const bench = d.bench;
  return (
    <DocsLayout
      title="How much to trust it"
      wide
      intro="Faults were injected into real community runs where the answer is known, and scored on robots the thresholds never saw. Every number here is a count."
      toc={[
        ["bench", "Physical arm"],
        ["inject", "Injected faults"],
        ["cal", "The one tuned threshold"],
        ["lag", "Camera lag"],
      ]}
    >
      {bench ? (
        <section id="bench" style="display:flex;flex-direction:column;gap:12px">
          <h2>Physical arm</h2>
          <p>Faults caused on purpose on one SO 101 arm, scored against the recorder's own log.</p>
          <div class="card" style="overflow:hidden">
            <div class="tscroll">
              <table class="dtable" style="min-width:560px">
                <thead>
                  <tr>
                    <th>Fault</th>
                    <th>Target</th>
                    <th>Caught</th>
                    <th class="r">Rung</th>
                    <th class="r">Expected rung</th>
                  </tr>
                </thead>
                <tbody>
                  {bench.rows.map((r, i) => (
                    <tr key={i}>
                      <td>{r.fault.replace(/_/g, " ")}</td>
                      <td class="mono">{r.target}</td>
                      <td>{r.caught ? "yes" : "no"}</td>
                      <td class="num">{r.rung}</td>
                      <td class="num">{r.expect_rung}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          {bench.stale_frames ? (
            <p>
              Frame by frame, stale camera: {num(bench.stale_frames.true_stale)} truly stale, {num(bench.stale_frames.caught)} caught, {num(bench.stale_frames.missed)} missed,{" "}
              {num(bench.stale_frames.false_alarm)} false alarms.
            </p>
          ) : null}
        </section>
      ) : (
        <div id="bench" class="callout-box" style="border-color:var(--r2-line);background:var(--r2-bg)">
          <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="var(--r2-text)" stroke-width="1.5" aria-hidden="true" style="flex:none;margin-top:2px">
            <circle cx="8" cy="8" r="6.5" />
            <path d="M8 4.5v4M8 11v.5" />
          </svg>
          <div style="display:flex;flex-direction:column;gap:4px">
            <b style="color:var(--text)">Not validated on a physical arm yet.</b>
            <span style="color:var(--text-2)">The recorder and run sheet exist but haven't been run on hardware. When they are, the scored set of faults caused on purpose goes here.</span>
          </div>
        </div>
      )}

      <h2 id="inject">Injected faults</h2>
      <p>Video faults were reencoded with LeRobot's default encoder settings so they reach the detector through real compression.</p>
      <div class="card" style="overflow:hidden">
        <div class="tscroll">
          <table class="dtable" style="min-width:760px">
            <thead>
              <tr>
                <th>Fault injected</th>
                <th style="width:220px">Outcome of each try</th>
                <th class="r">Tries</th>
                <th class="r">Caught</th>
                <th class="r">Low conf.</th>
                <th class="r">Missed</th>
                <th class="r">Skipped</th>
                <th class="r">Right rung</th>
                <th class="r">False extras</th>
              </tr>
            </thead>
            <tbody>
              {faults.map(([k, f]: [string, FaultScore]) => (
                <tr key={k}>
                  <td style="font-weight:550">{faultWords(k)}</td>
                  <td>
                    <span
                      class="split"
                      style="height:10px"
                      role="img"
                      aria-label={`${f.caught} caught, ${f.caught_low_confidence} low confidence, ${f.missed} missed, ${f.abstained} skipped, of ${f.n}`}
                    >
                      <i style={`width:${w(f.caught, f.n)};background:var(--r1)`} />
                      <i style={`width:${w(f.caught_low_confidence, f.n)};background:var(--r1-line)`} />
                      <i style={`width:${w(f.missed, f.n)};background:var(--cause)`} />
                      <i style={`width:${w(f.abstained, f.n)};background:repeating-linear-gradient(90deg,var(--r4) 0 3px,transparent 3px 5px)`} />
                    </span>
                  </td>
                  <td class="num">{num(f.n)}</td>
                  <td class="num" style="color:var(--text)">
                    {num(f.caught)}
                  </td>
                  <td class="num">{num(f.caught_low_confidence)}</td>
                  <td class="num">{num(f.missed)}</td>
                  <td class="num">{num(f.abstained)}</td>
                  <td class="num" style="color:var(--text)">
                    {num(f.right_rung)} of {num(f.n)}
                  </td>
                  <td class="num">{num(f.new_other_events)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:14px;padding:12px 16px;border-top:1px solid var(--border-soft);font-size:12px;color:var(--text-2)">
          <span style="display:inline-flex;gap:6px;align-items:center">
            <span class="sw" style="background:var(--r1)" />
            caught
          </span>
          <span style="display:inline-flex;gap:6px;align-items:center">
            <span class="sw" style="background:var(--r1-line)" />
            caught, low confidence
          </span>
          <span style="display:inline-flex;gap:6px;align-items:center">
            <span class="sw" style="background:var(--cause)" />
            missed
          </span>
          <span style="display:inline-flex;gap:6px;align-items:center">
            <span class="sw" style="background:repeating-linear-gradient(90deg,var(--r4) 0 3px,transparent 3px 5px)" />
            skipped
          </span>
        </div>
      </div>
      <ul>
        <li>
          <strong>Caught, low confidence</strong> means the frozen picture was found, but that camera barely shows the arm moving, so it's logged and the ladder doesn't act on
          it. That guard is what stopped cameras that can't see the arm from being blamed for stalls in the fleet run. On these runs it costs more than half the camera catches.
        </li>
        <li>
          <strong>Skipped</strong> means the recording had fewer than two pauses, so a resting offset can't be measured.
        </li>
        <li>
          <strong>False extras</strong> counts anything else the injected fault set off.
        </li>
      </ul>

      <h2 id="cal">The one tuned threshold</h2>
      {cal ? (
        <>
          <p>
            The camera freeze level was set to {cal.stale_tau_e} gray levels on {num(cal.robots.length)} calibration robots. Then every threshold was frozen and the faults
            above were scored on different robots.
          </p>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px">
            <div class="card card-pad" style="display:flex;flex-direction:column;gap:4px">
              <div>
                <span class="num" style="font-size:22px;font-weight:600;color:var(--text)">
                  {num(Math.round((cal.tpr_at_tau ?? 0) * cal.n_frozen_frames))}
                </span>
                <span class="num t-3"> of {num(cal.n_frozen_frames)}</span>
              </div>
              <span>injected frozen frames fall under {cal.stale_tau_e}</span>
            </div>
            <div class="card card-pad" style="display:flex;flex-direction:column;gap:4px">
              <div>
                <span class="num" style="font-size:22px;font-weight:600;color:var(--text)">
                  {num(Math.round((cal.fpr_at_tau ?? 0) * cal.n_moving_frames))}
                </span>
                <span class="num t-3"> of {num(cal.n_moving_frames)}</span>
              </div>
              <span>moving frames from clean runs fall under it too. Clean runs hold natural freezes, so this is an upper bound.</span>
            </div>
          </div>
        </>
      ) : (
        <p>No calibration data in this file.</p>
      )}

      <h2 id="lag">Camera lag</h2>
      {lag ? (
        <>
          <p>
            With a camera delayed by 3 frames, the lag estimate moved by 3 give or take 1 on{" "}
            <span class="num" style="color:var(--text)">
              {num(lag.within_1_of_3)}
            </span>{" "}
            of{" "}
            <span class="num" style="color:var(--text)">
              {num(lag.estimated)}
            </span>{" "}
            runs where both estimates existed ({num(lag.n)} tried).
          </p>
          <div
            style="display:flex;gap:8px;align-items:flex-end;height:90px;max-width:360px"
            role="img"
            aria-label={`Shifts seen: ${shifts.map(([k, n]) => `${k} frames ${n} run${n === 1 ? "" : "s"}`).join(", ")}`}
          >
            {shifts.map(([k, n]) => (
              <div key={k} style="flex:1;display:flex;flex-direction:column;align-items:center;gap:4px;justify-content:flex-end;height:100%">
                <span class="num t-3" style="font-size:11px">
                  {num(n)}
                </span>
                <span
                  style={`width:100%;height:${Math.max(3, Math.round((n / smax) * 60))}px;background:${Math.abs(k - 3) <= 1 ? "var(--r1)" : "var(--border-strong)"};border-radius:3px 3px 0 0`}
                />
                <span class="num t-3" style="font-size:11px">
                  {k} {k === 1 ? "frame" : "frames"}
                </span>
              </div>
            ))}
          </div>
        </>
      ) : null}
      <p class="t-3" style="font-size:13px">
        Raw rows: results/inject_eval.json
      </p>
    </DocsLayout>
  );
}
