import type { ComponentChildren } from "preact";
import { CopyBlock } from "./CopyBlock";
import { IconError } from "./icons";
import { RungMark } from "./RungMark";

/** Centered empty state: a mark or icon, one bold line, one line why, buttons out. */
export function Empty({
  rung,
  title,
  children,
  hint,
  actions,
  card = true,
}: {
  rung?: number;
  title: string;
  children?: ComponentChildren;
  hint?: ComponentChildren;
  actions?: ComponentChildren;
  card?: boolean;
}) {
  return (
    <div class={card ? "card empty" : "empty"}>
      {rung ? <RungMark rung={rung} lg label={false} /> : null}
      <b style="color:var(--text);font-size:15px">{title}</b>
      {children ? <span>{children}</span> : null}
      {hint ? (
        <span class="t-3" style="font-size:12px">
          {hint}
        </span>
      ) : null}
      {actions ? <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:center">{actions}</div> : null}
    </div>
  );
}

/** Red bordered error card: icon, title, cause, an optional command, Try again. */
export function ErrorCard({ title, cause, command, onRetry }: { title: string; cause: ComponentChildren; command?: string; onRetry?: () => void }) {
  return (
    <div class="card empty" style="border-color:var(--cause)" role="alert">
      <IconError />
      <b style="color:var(--text);font-size:15px">{title}</b>
      <span>{cause}</span>
      {command ? <CopyBlock text={command} style="width:100%;max-width:420px" /> : null}
      {onRetry ? (
        <button type="button" class="btn" onClick={onRetry}>
          Try again
        </button>
      ) : null}
    </div>
  );
}

export const Skel = ({ h, w, style }: { h: number; w?: string; style?: string }) => (
  <div class="skel" style={`height:${h}px;${w ? `width:${w};` : ""}${style ?? ""}`} />
);

/** Data didn't load: shown on any screen when data.json fails. */
export const DataError = ({ onRetry }: { onRetry: () => void }) => (
  <ErrorCard
    title="Couldn't load data.json"
    cause="If you opened the page as a file, serve the folder instead:"
    command="triage serve --site docs"
    onRetry={onRetry}
  />
);
