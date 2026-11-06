import type { Ref } from "preact";
import type { Problem } from "../derive";
import { num, scopeShort } from "../format";
import type { Status } from "../state";
import { IconChevron } from "./icons";
import { RungMark } from "./RungMark";

const DOT: Record<Status, [string, string]> = { new: ["dot-new", "new"], ack: ["dot-ack", "acknowledged"], resolved: ["dot-res", "resolved"] };

/** A problem row: a link on the Ladder (with a status dot), an expanding button in the Queue. */
export function ProblemRow({
  p,
  status,
  link,
  open,
  onToggle,
  focusRef,
  focused,
}: {
  p: Problem;
  status?: Status;
  link?: string;
  open?: boolean;
  onToggle?: () => void;
  focusRef?: Ref<any>;
  focused?: boolean;
}) {
  const cells = (
    <>
      {link ? <span class={DOT[status ?? "new"][0]} aria-label={DOT[status ?? "new"][1]} /> : <IconChevron open={open} />}
      <RungMark rung={p.rung} />
      <span class="title">
        <b>{p.base}</b>
        <span>
          {p.part} · {p.layer}
          {p.recurring ? " · recurring" : ""}
        </span>
      </span>
      <span class="route">{p.example}</span>
      <span class="t-3" style="font-size:12px">
        {scopeShort(p.scope)}
      </span>
      <span class="num r">{num(p.count)}</span>
      <span class="num r t-2">{num(p.robots)}</span>
    </>
  );
  if (link)
    return (
      <a class="qrow" href={link} ref={focusRef}>
        {cells}
      </a>
    );
  return (
    <button
      type="button"
      class={`qrow${open ? " open" : ""}${focused ? " kfocus" : ""}`}
      aria-expanded={open ? "true" : "false"}
      onClick={onToggle}
      ref={focusRef}
      data-row="p"
      data-fp={p.fingerprint}
    >
      {cells}
    </button>
  );
}
