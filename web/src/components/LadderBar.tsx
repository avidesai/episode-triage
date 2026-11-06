import { RUNG_WHO } from "../format";

/** Four columns, the active rung filled; rung 4 always outlined, dashed when on. */
export function LadderBar({ rung }: { rung: number }) {
  return (
    <div class="ladderbar" role="img" aria-label={`Rung ${rung} of 4: ${RUNG_WHO[rung]}`}>
      {[1, 2, 3, 4].map((r) => (
        <div key={r} class={[r === rung ? `on${r}` : "", r === 4 ? "p4" : ""].filter(Boolean).join(" ") || undefined}>
          <b />
          {RUNG_WHO[r]}
        </div>
      ))}
    </div>
  );
}
