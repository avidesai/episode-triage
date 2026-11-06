import { RUNG_NAME, RUNG_SHORT } from "../format";
import { RungMark } from "./RungMark";

/** "1 · Robot can clear it" (full) or "2 · ticket" (short). */
export function RungTag({ rung, lg, short, style }: { rung: number; lg?: boolean; short?: boolean; style?: string }) {
  return (
    <span class={`rung-tag r${rung}${lg ? " lg" : ""}`} style={style}>
      <RungMark rung={rung} label={false} />
      {`${rung} · ${short ? RUNG_SHORT[rung] : RUNG_NAME[rung]}`}
    </span>
  );
}
