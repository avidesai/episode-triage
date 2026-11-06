import { useEffect, useRef } from "preact/hooks";
import { signal } from "@preact/signals";
import { go } from "./router";

// One keydown listener for the app. Screens register the keys they handle while mounted;
// the shell handles the palette, the shortcut sheet, search focus and the "g then x" chords.

type Handlers = Partial<Record<string, (ev: KeyboardEvent) => void>>;
type Ref = { current: Handlers };
const stack: Ref[] = [];

export const helpOpen = signal(false);
export const paletteOpen = signal(false);
/** True while a "g" is waiting for its second key; the shell shows a small hint. */
export const chordPending = signal(false);

/** Register keys while mounted. Handlers are read from the latest render, so fast key repeats
 *  never see stale state. */
export function useKeys(h: Handlers): void {
  const ref = useRef<Handlers>(h);
  ref.current = h;
  useEffect(() => {
    stack.push(ref);
    return () => {
      const i = stack.lastIndexOf(ref);
      if (i >= 0) stack.splice(i, 1);
    };
  }, []);
}

const typing = (el: EventTarget | null) =>
  el instanceof HTMLElement && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));

const CHORDS: Record<string, string[]> = {
  l: [],
  q: ["queue"],
  f: ["fleet"],
  v: ["live"],
  d: ["docs", "decides"],
};

let chordTimer = 0;
function endChord() {
  chordPending.value = false;
  clearTimeout(chordTimer);
}

export function installKeys(): void {
  document.addEventListener("keydown", (ev) => {
    if ((ev.metaKey || ev.ctrlKey) && !ev.altKey && ev.key.toLowerCase() === "k") {
      ev.preventDefault();
      helpOpen.value = false;
      paletteOpen.value = !paletteOpen.value;
      return;
    }
    if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
    if (paletteOpen.value || helpOpen.value) return; // the dialogs handle their own keys
    if (typing(ev.target)) {
      if (ev.key === "Escape") (ev.target as HTMLElement).blur();
      return;
    }
    // A menu or listbox that is open handles its own keys.
    if (ev.target instanceof HTMLElement && ev.target.closest("[data-menu]")) return;
    const k = ev.key;
    if (chordPending.value) {
      endChord();
      const to = CHORDS[k];
      if (to) {
        ev.preventDefault();
        go(to);
        return;
      }
    }
    if (k === "g") {
      chordPending.value = true;
      chordTimer = window.setTimeout(endChord, 1000);
      return;
    }
    if (k === "?") {
      ev.preventDefault();
      helpOpen.value = true;
      return;
    }
    if (k === "/") {
      const s = document.querySelector<HTMLInputElement>("[data-search]");
      if (s) {
        ev.preventDefault();
        s.focus();
        s.select();
      }
      return;
    }
    for (let i = stack.length - 1; i >= 0; i--) {
      const f = stack[i].current[k];
      if (f) {
        // Enter on a focused link or button already does the right thing.
        if (k === "Enter" && ev.target instanceof HTMLElement && /^(A|BUTTON)$/.test(ev.target.tagName)) return;
        ev.preventDefault();
        f(ev);
        return;
      }
    }
  });
}

export const SHORTCUTS: { group: string; keys: [string[], string][] }[] = [
  {
    group: "Anywhere",
    keys: [
      [["⌘K"], "Open the command palette"],
      [["?"], "Show this list"],
      [["g", "l"], "Go to Ladder"],
      [["g", "q"], "Go to Queue"],
      [["g", "f"], "Go to Fleet"],
      [["g", "v"], "Go to Live"],
      [["g", "d"], "Go to How it decides"],
      [["Esc"], "Close a palette, sheet or menu"],
    ],
  },
  {
    group: "Lists",
    keys: [
      [["/"], "Search, on Queue and Fleet"],
      [["j", "k"], "Move down and up"],
      [["↵"], "Open the problem or incident"],
      [["→", "←"], "Expand or collapse a problem"],
      [["[", "]"], "Previous and next incident"],
      [["a"], "Acknowledge, again to set back to New"],
      [["r"], "Resolve, again to set back to New"],
    ],
  },
  {
    group: "Incident",
    keys: [
      [["Esc"], "Back to the queue"],
      [["[", "]"], "Previous and next incident"],
      [["a", "r"], "Acknowledge or resolve"],
      [["w"], "Around the failure or whole clip"],
      [["1", "2", "3"], "Rung 4: the task, the arm, not sure"],
    ],
  },
  {
    group: "Live",
    keys: [
      [["j", "k"], "Next and previous row, pauses following"],
      [["↓", "↑"], "Same as j and k"],
      [["f"], "Follow newest"],
    ],
  },
];

export const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
export const cmdK = isMac ? "⌘K" : "Ctrl K";
