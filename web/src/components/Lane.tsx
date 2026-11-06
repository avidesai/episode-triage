import type { LaneData } from "../derive";
import { num, RUNG_NAME, RUNG_WHO, scopeLine, splitLabel } from "../format";
import { href } from "../router";
import type { Data } from "../types";
import { RungMark } from "./RungMark";

const LINE: Record<number, string> = {
  1: "Restart, hold, retry. Logged, nobody paged.",
  2: "Goes to hardware with the joint or camera named.",
  3: "Hardware and sensors were fine. The clip goes to the ML team.",
  4: "The engine abstained and says why, instead of guessing.",
};

function foot(n: number, rung: number): string {
  if (n === 1) return `The one problem on rung ${rung} →`;
  if (n === 2) return `Both problems on rung ${rung} →`;
  return `All ${num(n)} problems on rung ${rung} →`;
}

/** One rung of the ladder: count, scope, top problems by count. */
export function Lane({ lane, d }: { lane: LaneData; d: Data }) {
  const { rung } = lane;
  const rung4Contact = rung === 4 && lane.top.length > 0 && d.inbox.filter((r) => r.rung === 4).every((r) => r.fingerprint.startsWith("actuation.not_following"));
  return (
    <article class={`lane l${rung}`}>
      <div class="lane-top" />
      <div class="lane-body">
        <div class={`lane-kicker rtext-${rung}`}>
          <RungMark rung={rung} lg label={false} />
          <span>
            RUNG {rung} · {RUNG_WHO[rung].toUpperCase()}
          </span>
        </div>
        <div>
          <h2 class="lane-name">{RUNG_NAME[rung]}</h2>
          <p class="t-2">{LINE[rung]}</p>
        </div>
        <div class="lane-big">
          <span class="num">{num(lane.total)}</span>
          <span class="t-2">incidents in {lane.problems === 1 ? "1 problem" : `${num(lane.problems)} problems`}</span>
        </div>
        <div class="lane-scope">
          {lane.scopes.map((s) => (
            <span key={s.scope}>
              <span class="num" style="color:var(--text)">
                {num(s.sum)}
              </span>{" "}
              {scopeLine(s.scope)}
            </span>
          ))}
          {rung === 2 ? (
            <span>
              <span class="num" style="color:var(--text)">
                {num(d.findings.joints.robots_any_actuation_ticket)}
              </span>{" "}
              of {num(d.fleet.robots)} arms have a joint ticket
            </span>
          ) : rung === 3 ? (
            <span>Needs the cameras, so never from the joint pass</span>
          ) : rung4Contact ? (
            <span>Mostly contact with the world or a dead joint</span>
          ) : null}
        </div>
      </div>
      <div class="lane-list">
        {lane.top.map((p) => {
          const { base, part } = splitLabel(p.label, p.fingerprint);
          return (
            <a key={p.fingerprint} class="lane-row" href={href(["queue"], { rung: String(rung), open: p.fingerprint })}>
              <span class="lane-row-label">{base}</span>
              <span class="num t-2">{num(p.count)}</span>
              <span class="meta">
                {part} · {p.layer} · {num(p.robots)} arms{p.recurring ? " · recurring" : ""}
              </span>
            </a>
          );
        })}
      </div>
      <a class="lane-foot" href={href(["queue"], { rung: String(rung) })}>
        {foot(lane.problems, rung)}
      </a>
    </article>
  );
}
