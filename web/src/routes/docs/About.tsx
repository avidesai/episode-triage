import { CopyBlock } from "../../components/CopyBlock";
import { data } from "../../data";
import { num } from "../../format";
import { href } from "../../router";
import type { Data } from "../../types";
import { DocsLayout } from "./DocsLayout";

const pct = (x: number) => `${Math.round(x * 100)}%`;

export function About() {
  const d = data.value as Data;
  const f = d.fleet;
  const t = d.thresholds;
  return (
    <DocsLayout
      title="About Triage"
      toc={[
        ["what", "What it is"],
        ["limits", "Limits"],
        ["record", "What a robot should record"],
        ["own", "Your own logs"],
        ["data", "Data"],
      ]}
    >
      <div style="display:flex;flex-wrap:wrap;gap:8px">
        <span class="chip" style="height:26px;font-size:12.5px">
          Independent project
        </span>
        <span class="chip" style="height:26px;font-size:12.5px">
          Logs never leave your machine
        </span>
        <span class="chip" style="height:26px;font-size:12.5px">
          Static page, no backend
        </span>
      </div>

      <h2 id="what">What it is</h2>
      <p>
        A triage inbox for a robot fleet. Every failure arrives sorted by who should fix it: the robot itself, a technician with the part named, the training team, or a
        person who has to look. Each comes with the moment it started, what started it, and the evidence.
      </p>
      <p>One engine, three pieces: this viewer, a batch run over a fleet's recorded runs (which produced this data), and a live monitor that runs the same checks on a running robot.</p>
      <p>Status and notes you set here are kept in this browser only. Nobody else sees them.</p>

      <h2 id="limits">Limits</h2>
      <ul>
        <li>
          <strong>Frozen cameras and camera lag are inferences.</strong> With no real capture time in the data, both come from picture content against joint motion. A camera
          moving over a blank surface can look frozen; those get low confidence and never drive a verdict.
        </li>
        <li>
          <strong>"Training" means the operator in this data.</strong> Almost all community data is teleoperation, so rung 3 is task level stalls and misses, and most stalls are
          people pausing.
        </li>
        <li>
          <strong>Thin cloth.</strong> Joint positions alone can't always tell a grasp on one layer of fabric from an empty close. Closes between {pct(t.empty_gap)} and{" "}
          {pct(t.holding_gap)} of range are called ambiguous.
        </li>
        <li>
          <strong>Contact versus a dead joint.</strong> A joint held off its command with nothing moving could be pushing on the table or could be dead. Position can't tell, so
          it goes to a person.
        </li>
        <li>
          <strong>Arms are datasets.</strong> Some people recorded several datasets on one arm, so arm counts are an upper bound.
        </li>
        <li>
          <strong>Injected faults are clean.</strong> They prove the checks fire on a known answer, not that natural faults look the same.
        </li>
        <li>
          <strong>Live adds a few seconds.</strong> An incident appears 2 to 5 s after the fault starts.
        </li>
      </ul>

      <h2 id="record">What a robot should record</h2>
      <p>Most of the inference above goes away if the log carries it directly:</p>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px">
        {(
          [
            ["Real capture time", "the true age of every camera frame, so freezes and lag are exact"],
            ["Servo load, current, temperature", 'so "not following" says whether the motor unloaded, overheated or browned out'],
            ["Real loop timing", "instead of timestamps written at a fixed rate"],
            ["Operator takeovers", "each one is a failure with a human label already attached"],
          ] as [string, string][]
        ).map(([b, s]) => (
          <div key={b} class="card card-pad" style="display:flex;flex-direction:column;gap:4px">
            <b style="font-size:13.5px">{b}</b>
            <span class="t-2" style="font-size:13px">
              {s}
            </span>
          </div>
        ))}
      </div>

      <h2 id="own">Run it on your own logs</h2>
      <p>
        Everything after the reader works on one object,{" "}
        <span class="mono" style="color:var(--text)">
          Episode
        </span>
        : commanded and measured joint positions, frame rate, which columns are grippers, and each camera's frames as small grayscale images. A new log format needs one file
        that produces it. Start from{" "}
        <span class="mono" style="color:var(--text)">
          episode_triage/readers_template.py
        </span>
        .
      </p>
      <CopyBlock text="triage run lerobot/aloha_static_towel --episodes 0,1,2" />
      <p>The tool runs locally and the page is static. Logs never leave your machine.</p>

      <h2 id="data">Data</h2>
      <table class="dtable">
        <tbody>
          <tr>
            <td style="width:200px">Dataset</td>
            <td class="mono">{f.dataset}</td>
          </tr>
          <tr>
            <td>Revision</td>
            <td class="mono" style="word-break:break-all">
              {f.revision}
            </td>
          </tr>
          <tr>
            <td>Arms</td>
            <td>
              <span class="num">{num(f.robots)}</span> SO 100 and SO 101 arms, numbered, not named
            </td>
          </tr>
          <tr>
            <td>Runs</td>
            <td>
              <span class="num">{num(f.runs)}</span> runs, <span class="num">{f.hours}</span> h
            </td>
          </tr>
          <tr>
            <td>Cameras checked</td>
            <td>
              <span class="num">{num(f.sampled_runs)}</span> sampled runs on <span class="num">{num(f.sampled_robots)}</span> arms
            </td>
          </tr>
        </tbody>
      </table>
      <p class="t-3" style="font-size:13px;display:flex;gap:14px;flex-wrap:wrap">
        <a href={href(["docs", "decides"])}>How it decides</a>
        <a href={href(["docs", "trust"])}>How much to trust it</a>
        <a href={href(["live"])}>Live</a>
      </p>
    </DocsLayout>
  );
}
