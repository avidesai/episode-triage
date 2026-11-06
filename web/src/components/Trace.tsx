/** The engine's trace lines, numbered; the number's style ties a step to its band on the chart. */
export function traceKind(line: string): "cause" | "anchor" | "rule" | "gap" | "" {
  if (/^Earliest:/.test(line)) return "cause";
  if (/^Failure seen/.test(line)) return "anchor";
  if (/^Rule /.test(line)) return "rule";
  if (/^Not checked:/.test(line)) return "gap";
  return "";
}

const SUB: Record<string, string> = {
  cause: "The red band on the signals",
  anchor: "The blue band on the signals",
  gap: "So a camera cause could not be ruled in or out",
};

export function Trace({ lines, subs = false }: { lines: string[]; subs?: boolean }) {
  return (
    <ol class="trace">
      {lines.map((t, i) => {
        const k = traceKind(t);
        return (
          <li key={i}>
            <span class={`n${k ? " " + k : ""}`}>{i + 1}</span>
            <span>
              {t}
              {subs && SUB[k] ? <span class="sub">{SUB[k]}</span> : null}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
