import { RUNG_NAME, RUNG_SHORT } from "../format";
import { RungMark } from "./RungMark";

/** "1 · Robot can clear it" (full) or "2 · ticket" (short). */
export function RungTag({ rung, lg, short }: { rung: number; lg?: boolean; short?: boolean }) {
  return (
    <span class={`rung-tag r${rung}${lg ? " lg" : ""}`}>
      <RungMark rung={rung} lg={lg} label={false} />
      {rung} · {short ? RUNG_SHORT[rung] : RUNG_NAME[rung]}
    </span>
  );
}
