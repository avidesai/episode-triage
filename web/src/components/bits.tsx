import type { ComponentChildren } from "preact";
import { statusOf, workflow, type Status } from "../state";

export function Rung({ rung, name, long }: { rung: number; name?: string; long?: boolean }) {
  return (
    <span class={`rung r${rung}`} title={name ? `Rung ${rung}: ${name}` : `Rung ${rung}`}>
      <b>{rung}</b>
      {long && name ? <span class="rung-name">{name}</span> : null}
    </span>
  );
}

const STATUS_LABEL: Record<Status, string> = { new: "New", ack: "Acknowledged", resolved: "Resolved" };

export function StatusMark({ id }: { id: string }) {
  const s = statusOf(id, workflow.value);
  return <span class={`smark s-${s}`} role="img" aria-label={STATUS_LABEL[s]} title={STATUS_LABEL[s]} />;
}

export { STATUS_LABEL };

export function Empty({ title, children }: { title: string; children?: ComponentChildren }) {
  return (
    <div class="empty">
      <p class="empty-title">{title}</p>
      {children}
    </div>
  );
}

export function ErrorBox({ title, detail, retry }: { title: string; detail?: string; retry?: () => void }) {
  return (
    <div class="empty error" role="alert">
      <p class="empty-title">{title}</p>
      {detail ? <p class="muted mono small">{detail}</p> : null}
      {retry ? (
        <button class="btn" onClick={retry}>
          Try again
        </button>
      ) : null}
    </div>
  );
}

export function Skeleton({ rows = 10 }: { rows?: number }) {
  return (
    <div class="skeleton" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} class="sk-row" style={{ width: `${70 + ((i * 37) % 30)}%` }} />
      ))}
    </div>
  );
}

export function Copy({ text }: { text: string }) {
  return (
    <div class="copy">
      <code>{text}</code>
      <button
        class="btn small"
        onClick={(e) => {
          const b = e.currentTarget as HTMLButtonElement;
          navigator.clipboard?.writeText(text).then(
            () => {
              b.textContent = "Copied";
              setTimeout(() => (b.textContent = "Copy"), 1200);
            },
            () => undefined,
          );
        }}
      >
        Copy
      </button>
    </div>
  );
}

export function SortHead({
  label,
  col,
  sort,
  onSort,
  cls,
  title,
}: {
  label: ComponentChildren;
  col: string;
  sort: string;
  onSort: (s: string) => void;
  cls?: string;
  title?: string;
}) {
  const active = sort === col || sort === "-" + col;
  const desc = sort === "-" + col;
  return (
    <span role="columnheader" class={`th ${cls ?? ""}`} aria-sort={active ? (desc ? "descending" : "ascending") : "none"}>
      <button class="th-btn" title={title} onClick={() => onSort(nextSort(sort, col))}>
        {label}
        <span class="sort-ind" aria-hidden="true">
          {active ? (desc ? "↓" : "↑") : ""}
        </span>
      </button>
    </span>
  );
}

/** Toggle sort: first click ascending, second descending. */
export function nextSort(cur: string, col: string): string {
  if (cur === col) return "-" + col;
  return col;
}
