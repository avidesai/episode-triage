import { RungMark } from "../../components/RungMark";
import { data } from "../../data";
import { num, plural } from "../../format";
import { href } from "../../router";
import type { Data } from "../../types";
import { DocsLayout } from "./DocsLayout";

const WHO = ["", "Robot", "Hardware", "Training", "A person"];
const pct = (x: number) => `${Math.round(x * 100)}%`;

/** Values from data.thresholds with what each one means. */
function thresholdList(t: Record<string, number>): [string, string, string][] {
  return [
    [`${t.stale_tau_e} gray levels`, "picture change below this counts as frozen", "stale_tau_e"],
    [plural(t.stale_min_frames, "frame"), "frozen frames needed", "stale_min_frames"],
    [`${pct(t.stale_tau_m)} of range`, "arm motion needed to call a still picture frozen", "stale_tau_m"],
    [plural(t.lag_flag_frames, "frame"), "camera lag that gets flagged", "lag_flag_frames"],
    [`${pct(t.follow_err)} for ${t.follow_min_s} s`, "gap that counts as not following", "follow_err, follow_min_s"],
    [`${t.follow_recover_s.toFixed(1)} s`, "caught up within this, the robot cleared it", "follow_recover_s"],
    [`${pct(t.offset_err)}, ${pct(t.offset_agree)} of pauses`, "offset at rest", "offset_err, offset_agree"],
    [pct(t.gain_err), "calibration slope off by", "gain_err"],
    [`${pct(t.glitch_jump)}, back in ${t.glitch_return_frames} frames`, "impossible one frame jump", "glitch_jump"],
    [`${t.glitch_ticket_count} per motor`, "bad reads that make a ticket", "glitch_ticket_count"],
    [pct(t.wrap_jump), "leader angle wrap", "wrap_jump"],
    [`${pct(t.pin_margin)}, ${pct(t.pin_push)}, ${t.pin_min_s} s`, "pinned: margin, push, hold", "pin_margin, pin_push, pin_min_s"],
    [`${t.stall_min_s.toFixed(1)} s`, "stall length", "stall_min_s"],
    [`${t.stall_edge_s} s`, "ignored at each end of a run", "stall_edge_s"],
    [`${t.min_episode_s.toFixed(1)} s`, "shortest usable run", "min_episode_s"],
  ];
}

export function Decides() {
  const d = data.value as Data;
  const calN = d.validation?.calibration.robots.length;
  const integrity = Object.entries(d.plain)
    .filter(([k]) => k.startsWith("integrity."))
    .map(([, v]) => v);
  return (
    <DocsLayout
      title="How it decides"
      intro="Every failure lands on one rung by who should fix it. Four destinations, not a severity scale: rung 4 is not the worst, it is where the engine says it can't decide. The rules are fixed and readable, and every verdict names the rule that fired."
      toc={[
        ["ladder", "The ladder"],
        ["order", "Cheap layers first"],
        ["checks", "What it checks"],
        ["thresholds", "Thresholds"],
      ]}
    >
      <h2 id="ladder">The ladder</h2>
      <p>
        Each rule, in the order the engine numbers them, and where it sends the failure. Counts are incidents on all {num(d.fleet.runs)} runs and on the{" "}
        {num(d.fleet.sampled_runs)} sampled runs where cameras were checked.
      </p>
      <div class="card" style="overflow:hidden">
        <div class="tscroll">
          <div style="min-width:760px;display:grid;grid-template-columns:minmax(220px,1.5fr) repeat(4,minmax(120px,1fr))" role="table" aria-label="Rules and where they send a failure">
            <div style="padding:12px 14px;border-bottom:1px solid var(--border)" class="lbl" role="columnheader">
              Rule, when
            </div>
            {[1, 2, 3, 4].map((k) => (
              <div key={k} role="columnheader" style={`padding:12px 14px;border-bottom:1px solid var(--border);background:var(--r${k}-bg);display:flex;flex-direction:column;gap:4px`}>
                <RungMark rung={k} lg label={false} />
                <b class={`rtext-${k}`} style="font-size:13px">
                  {k} · {WHO[k]}
                </b>
              </div>
            ))}
            {d.rules.map((r) => (
              <>
                <div key={r.rule} role="rowheader" style="padding:12px 14px;border-bottom:1px solid var(--border-soft);display:flex;flex-direction:column;gap:2px;font-size:13px">
                  <span class="mono" style="font-weight:600;color:var(--text)">
                    {r.rule}
                  </span>
                  <span style="color:var(--text-2);line-height:1.45">{r.when}</span>
                </div>
                {[1, 2, 3, 4].map((k) => (
                  <div
                    key={r.rule + k}
                    role="cell"
                    style={`padding:10px;border-bottom:1px solid var(--border-soft);background:${k === r.rung ? `var(--r${k}-bg)` : "transparent"};display:flex;align-items:center`}
                  >
                    {k === r.rung ? (
                      <a
                        href={href(["queue"], { rule: r.rule })}
                        style={`display:flex;flex-direction:column;gap:3px;padding:8px 10px;border-radius:8px;background:var(--surface);box-shadow:inset 0 0 0 1px var(--r${k}-line);color:var(--text);font-size:12px;line-height:1.4;width:100%`}
                      >
                        <span>{r.to}</span>
                        <span class="num t-3" style="font-size:11px">
                          {num(r.count_fleet)} all runs · {num(r.count_sample)} sampled
                        </span>
                      </a>
                    ) : null}
                  </div>
                ))}
              </>
            ))}
          </div>
        </div>
      </div>

      <h2 id="order">Cheap layers first</h2>
      <p>
        The costly mistake is retraining a policy on a failure that was really a frozen camera or a joint that didn't do what it was told. So the engine checks the layers
        in order and lets a cause flow only one way: a frozen camera can cause a stall, a stall can't cause a frozen camera. A failure only counts as the task's when
        every layer under it was checked and healthy.
      </p>
      <div class="ldiag" role="img" aria-label="Layers in order: integrity, sensing, actuation, task. A cause in an earlier layer can explain a failure in a later one, never the reverse.">
        <div class="q" style="display:flex;flex-direction:column;gap:4px">
          <span class="lbl">1 Integrity</span>
          <b>Is the data usable?</b>
          <span class="t-2" style="font-size:12px">
            short runs, frame gaps, row counts, decode errors. If not, rung 4 with what's missing.
          </span>
        </div>
        <div class="q" style="display:flex;flex-direction:column;gap:4px">
          <span class="lbl">2 Sensing</span>
          <b>Did the robot see and feel?</b>
          <span class="t-2" style="font-size:12px">
            cameras froze or ran late, joint stream repeated
          </span>
        </div>
        <div class="q" style="display:flex;flex-direction:column;gap:4px">
          <span class="lbl">3 Actuation</span>
          <b>Did the joints do what they were told?</b>
          <span class="t-2" style="font-size:12px">
            not following, offset, calibration, bus reads, wraps, pinned
          </span>
        </div>
        <div class="q" style="display:flex;flex-direction:column;gap:4px;border-color:var(--r3-line)">
          <span class="lbl">4 Task</span>
          <b>Then it's the behavior</b>
          <span class="t-2" style="font-size:12px">
            stalls and missed grasps, only with layers 1 to 3 healthy
          </span>
        </div>
      </div>
      <p style="font-size:13px" class="t-3">
        Earlier layers can explain a failure in a later one. Never the reverse.
      </p>

      <h2 id="checks">What it checks</h2>
      {(["sensing", "actuation", "task"] as const).map((layer) => (
        <div key={layer} style="display:flex;flex-direction:column;gap:8px">
          <h3 style="font-size:14px;font-weight:650;text-transform:capitalize">{layer}</h3>
          <div class="tscroll">
            <table class="dtable" style="min-width:720px">
              <thead>
                <tr>
                  <th style="width:150px">Check</th>
                  <th>Signal</th>
                  <th>Fires when</th>
                  <th>Why</th>
                </tr>
              </thead>
              <tbody>
                {d.checks
                  .filter((c) => c.layer === layer)
                  .map((c) => (
                    <tr key={c.id}>
                      <td style="font-weight:600">{c.name}</td>
                      <td>{c.signal}</td>
                      <td>{c.threshold}</td>
                      <td>{c.why}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
      <div style="display:flex;flex-direction:column;gap:8px">
        <h3 style="font-size:14px;font-weight:650">Integrity</h3>
        <p>{integrity.join(" · ")}. Any of these sends the run to a person under rule R0.</p>
      </div>

      <h2 id="thresholds">Thresholds</h2>
      <p>
        Fixed before the evaluation and the same for every arm. One was tuned on data: the camera freeze level{calN ? `, on ${num(calN)} calibration robots` : ""}.{" "}
        <a href={href(["docs", "trust"])}>How much to trust it</a>
      </p>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:8px">
        {thresholdList(d.thresholds).map(([v, what, key]) => (
          <div key={key} style="padding:10px 12px;border:1px solid var(--border);border-radius:8px;background:var(--surface);display:flex;flex-direction:column;gap:2px">
            <span class="num" style="font-weight:600;color:var(--text)">
              {v}
            </span>
            <span style="font-size:12.5px">{what}</span>
            <span class="mono t-3" style="font-size:11px">
              {key}
            </span>
          </div>
        ))}
      </div>
    </DocsLayout>
  );
}
