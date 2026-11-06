import type { ComponentChildren } from "preact";
import { num } from "../format";

/** A count with its denominator, never a rate. */
export function Stat({ n, of, rung, children }: { n: number; of: string; rung?: number; children: ComponentChildren }) {
  return (
    <div class={rung ? `stat s${rung}` : "stat"}>
      <div>
        <span class="n">{num(n)}</span>
        <span class="of"> {of}</span>
      </div>
      <p>{children}</p>
    </div>
  );
}
