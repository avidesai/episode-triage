/** Four cells, one lit: position carries the rung, color confirms it. */
export function RungMark({ rung, lg, label = true }: { rung: number; lg?: boolean; label?: boolean }) {
  return (
    <span
      class={`rm r${rung}${lg ? " lg" : ""}`}
      {...(label ? { "aria-label": `rung ${rung}`, role: "img" } : { "aria-hidden": "true" })}
    >
      <i />
      <i />
      <i />
      <i />
    </span>
  );
}
