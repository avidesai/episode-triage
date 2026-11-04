import { FIX_LABEL, SOURCE_LABEL, nice, secs } from "../format";
import type { FixBy, Summary } from "../types";
import { Rung, SortHead, StatusMark } from "./bits";

const FIX_OF: Record<number, FixBy> = { 1: "robot", 2: "ticket", 3: "training", 4: "person" };
export const fixOf = (s: Summary): FixBy => s.fix_by ?? FIX_OF[s.rung] ?? "none";

export function IncidentRow({
  s,
  link,
  selected,
  cursor,
  onOpen,
  onArm,
  onProblem,
  indent,
}: {
  s: Summary;
  link: string;
  selected: boolean;
  cursor: boolean;
  onOpen: () => void;
  onArm?: (arm: string) => void;
  onProblem?: (fp: string) => void;
  indent?: boolean;
}) {
  const fix = fixOf(s);
  return (
    <div
      role="row"
      class={`irow ${selected ? "sel" : ""} ${cursor ? "cur" : ""} ${indent ? "indent" : ""}`}
      data-id={s.id}
      aria-selected={selected}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("a,button")) return;
        onOpen();
      }}
    >
      <span role="cell" class="c-st">
        <StatusMark id={s.id} />
      </span>
      <span role="cell" class="c-rung">
        <Rung rung={s.rung} name={s.rung_name} />
      </span>
      <span role="cell" class="c-route">
        <a href={link} title={nice(s.route)} onClick={(e) => { e.preventDefault(); onOpen(); }}>
          {nice(s.route)}
        </a>
        <span class="meta">
          {s.robot_id}
          {s.run != null ? `, run ${s.run}` : ""}, {secs(s.t)}, {FIX_LABEL[fix].toLowerCase()}
        </span>
      </span>
      <span role="cell" class="c-fix">
        {FIX_LABEL[fix]}
      </span>
      <span role="cell" class="c-arm mono">
        {onArm ? (
          <button class="linkish" title={`Only ${s.robot_id}`} onClick={() => onArm(s.robot_id)}>
            {s.robot_id.replace(/^arm /, "")}
          </button>
        ) : (
          s.robot_id.replace(/^arm /, "")
        )}
      </span>
      <span role="cell" class="c-run tnum">
        {s.run ?? ""}
      </span>
      <span role="cell" class="c-t tnum">
        {secs(s.t)}
      </span>
      <span role="cell" class="c-src">
        {SOURCE_LABEL[s.source] ?? s.source}
      </span>
      <span role="cell" class="c-prob">
        {onProblem && s.label ? (
          <button class="linkish" title="Show this problem type" onClick={() => onProblem(s.fingerprint)}>
            {s.label}
          </button>
        ) : (
          s.label ?? ""
        )}
      </span>
    </div>
  );
}

export function IncidentHead({ sort, onSort }: { sort: string; onSort: (s: string) => void }) {
  return (
    <div role="row" class="irow head">
      <span role="columnheader" class="th c-st">
        <SortButton col="status" sort={sort} onSort={onSort} label="" aria="Status" />
      </span>
      <SortHead cls="c-rung" label="Rung" col="rung" sort={sort} onSort={onSort} />
      <SortHead cls="c-route" label="What happened" col="route" sort={sort} onSort={onSort} />
      <SortHead cls="c-fix" label="Fix by" col="fix" sort={sort} onSort={onSort} />
      <SortHead cls="c-arm" label="Arm" col="arm" sort={sort} onSort={onSort} />
      <SortHead cls="c-run" label="Run" col="run" sort={sort} onSort={onSort} />
      <SortHead cls="c-t" label="At" col="t" sort={sort} onSort={onSort} title="Seconds into the run" />
      <SortHead cls="c-src" label="Source" col="source" sort={sort} onSort={onSort} />
      <SortHead cls="c-prob" label="Problem" col="problem" sort={sort} onSort={onSort} />
    </div>
  );
}

function SortButton({ col, sort, onSort, aria }: { col: string; sort: string; onSort: (s: string) => void; label: string; aria: string }) {
  const active = sort === col || sort === "-" + col;
  return (
    <button class="th-btn" aria-label={`Sort by ${aria.toLowerCase()}`} onClick={() => onSort(sort === col ? "-" + col : col)}>
      <span class="smark s-new" aria-hidden="true" />
      <span class="sort-ind" aria-hidden="true">
        {active ? (sort.startsWith("-") ? "↓" : "↑") : ""}
      </span>
    </button>
  );
}
