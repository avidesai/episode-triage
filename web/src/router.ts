import { signal } from "@preact/signals";

// Hash routes: "#/inbox/i/arm%200159-r2-2?rung=2". Hash routing needs no server rules, so the
// same files work on GitHub Pages under a subpath and on `triage serve`.

export type Query = Record<string, string>;
export interface Route {
  path: string[];
  q: Query;
}

const LEGACY_SECTIONS: Record<string, string> = {
  inbox: "/inbox",
  live: "/live",
  how: "/how",
  trust: "/trust",
  found: "/fleet",
  about: "/about",
};

/** Links the old single page used, possibly already sent to people. */
function legacy(h: string): string | null {
  const m = h.match(/^inc=(.+)$/);
  if (m) {
    const ref = decodeURIComponent(m[1]);
    const id = ref.replace(/^.*\//, "").replace(/\.json$/, "");
    return (ref.startsWith("live/") ? "/live/i/" : "/inbox/i/") + encodeURIComponent(id);
  }
  return LEGACY_SECTIONS[h] ?? null;
}

function parse(): Route {
  let h = location.hash.replace(/^#/, "");
  if (!h.startsWith("/")) {
    const to = legacy(h) ?? "/inbox";
    history.replaceState(null, "", "#" + to);
    h = to;
  }
  const qi = h.indexOf("?");
  const p = qi < 0 ? h : h.slice(0, qi);
  const qs = qi < 0 ? "" : h.slice(qi + 1);
  const path = p.split("/").filter(Boolean).map((s) => {
    try {
      return decodeURIComponent(s);
    } catch {
      return s;
    }
  });
  if (!path.length) path.push("inbox");
  return { path, q: Object.fromEntries(new URLSearchParams(qs)) };
}

export const route = signal<Route>(parse());
window.addEventListener("hashchange", () => {
  route.value = parse();
});

export function href(path: string[], q: Record<string, string | undefined | null> = {}): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v != null && v !== "") qs.set(k, v);
  const s = qs.toString();
  return "#/" + path.map(encodeURIComponent).join("/") + (s ? "?" + s : "");
}

export function go(path: string[], q: Record<string, string | undefined | null> = {}, replace = false): void {
  const h = href(path, q);
  if (h === location.hash) return;
  if (replace) {
    history.replaceState(null, "", h);
    route.value = parse();
  } else {
    location.hash = h.slice(1);
  }
}
