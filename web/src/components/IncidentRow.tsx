import { fixByOf, secs } from "../format";
import { statusOf, workflow, type Status } from "../state";
import type { Summary } from "../types";
import { RungMark } from "./RungMark";

const DOT: Record<Status, [string, string]> = { new: ["dot-new", "new"], ack: ["dot-ack", "acknowledged"], resolved: ["dot-res", "resolved"] };

/** An incident row in the Queue: nested under a problem, or flat with its problem label. */
export function IncidentRow({
  s,
  sel,
  flat,
  label,
  onPick,
  onOpen,
}: {
  s: Summary;
  sel: boolean;
  flat?: boolean;
  label?: string;
  onPick: () => void;
  onOpen: () => void;
}) {
  const st = statusOf(s.id, workflow.value);
  const route = flat ? (
    <span style="display:flex;flex-direction:column;min-width:0">
      <b style="font-weight:550;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">{label}</b>
      <span style="font-size:11.5px;font-family:'JetBrains Mono',monospace;color:var(--text-3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
        {s.route}
      </span>
    </span>
  ) : (
    <span
      class="route"
      style="font-size:12px;font-family:'JetBrains Mono',monospace;color:var(--text-2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis"
    >
      {s.route}
    </span>
  );
  return (
    <button
      type="button"
      class={`irow${sel ? " sel" : ""}`}
      style={flat ? "padding-left:16px;background:transparent;min-height:56px" : undefined}
      data-row="i"
      data-id={s.id}
      aria-current={sel ? "true" : undefined}
      aria-label={`${s.robot_id}, run ${s.run}, at ${secs(s.t)}, rung ${s.rung}, ${DOT[st][1]}: ${s.route}`}
      onClick={onPick}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          onOpen();
        }
      }}
    >
      <span class={DOT[st][0]} aria-hidden="true" />
      <RungMark rung={s.rung} label={false} />
      <span class="num">{s.robot_id}</span>
      <span class="num t-2">run {s.run}</span>
      <span class="num t-2">at {secs(s.t)}</span>
      {route}
      <span class="t-3" style="font-size:12px;text-align:right">
        {fixByOf(s.rung, s.fix_by)}
      </span>
    </button>
  );
}
