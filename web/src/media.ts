import { signal } from "@preact/signals";

// Width breakpoints the CSS uses, as signals for layout decisions the CSS can't make
// (the Queue opens incidents in a side pane only wider than 1100 px).

function watch(q: string) {
  const m = window.matchMedia(q);
  const s = signal(m.matches);
  m.addEventListener("change", () => (s.value = m.matches));
  return s;
}

export const wide = watch("(min-width: 1101px)");
export const phone = watch("(max-width: 600px)");
export const reducedMotion = watch("(prefers-reduced-motion: reduce)");
