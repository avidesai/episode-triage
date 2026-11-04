import { useEffect, useRef } from "preact/hooks";
import { signal } from "@preact/signals";
import { go } from "./router";

// One keydown listener for the app. Screens register the keys they handle while mounted;
// the shell handles navigation, search focus and the shortcuts sheet.

type Handlers = Partial<Record<string, () => void>>;
type Ref = { current: Handlers };
const stack: Ref[] = [];
export const helpOpen = signal(false);

/** Register keys while mounted. Handlers are read from the latest render, so fast key
 *  repeats never see stale state; `deps` is accepted for readability only. */
export function useKeys(h: Handlers, _deps?: unknown[]): void {
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

let gPending = 0;
const G: Record<string, string> = { i: "inbox", f: "fleet", l: "live", h: "how", t: "trust", a: "about" };

export function installKeys(): void {
  document.addEventListener("keydown", (ev) => {
    if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
    if (typing(ev.target)) {
      if (ev.key === "Escape") (ev.target as HTMLElement).blur();
      return;
    }
    if (helpOpen.value) {
      if (ev.key === "Escape" || ev.key === "?") {
        helpOpen.value = false;
        ev.preventDefault();
      }
      return;
    }
    const k = ev.key;
    if (gPending && Date.now() - gPending < 1200 && G[k]) {
      gPending = 0;
      ev.preventDefault();
      go([G[k]]);
      return;
    }
    gPending = 0;
    if (k === "g") {
      gPending = Date.now();
      return;
    }
    if (k === "?") {
      helpOpen.value = true;
      ev.preventDefault();
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
        f();
        return;
      }
    }
  });
}

export const SHORTCUTS: [string, string][] = [
  ["j / k", "Next and previous incident"],
  ["Enter", "Open the selected incident"],
  ["Esc", "Close the incident, or leave the search box"],
  ["[ / ]", "Previous and next incident while one is open"],
  ["a", "Mark acknowledged"],
  ["r", "Mark resolved"],
  ["u", "Mark new again"],
  ["n", "Edit the note"],
  ["/", "Search"],
  ["g then i, f, l, h, t, a", "Go to Inbox, Fleet, Live, How it decides, Trust, About"],
  ["?", "Show this list"],
];
