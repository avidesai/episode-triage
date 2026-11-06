import { signal } from "@preact/signals";

// Hash routes, so the same files work on GitHub Pages under a subpath and on `triage serve`.
//   #/                 Ladder
//   #/queue            Queue (view, rung, layer, arm, rule, status, q, open, sel)
//   #/i/<id>           Incident
//   #/fleet            Fleet (show, q)
//   #/arm/<id>         Arm
//   #/live             Live (sel)
//   #/docs/<page>      decides, trust, about
// Links already sent to people keep working through the redirects in `redirect()`.

export type Query = Record<string, string>;
export interface Route {
  path: string[];
  q: Query;
}

const DOCS = new Set(["decides", "trust", "about"]);
const QUEUE_KEEP = ["rung", "layer", "arm", "rule", "status", "q"];

function split(h: string): Route {
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
  return { path, q: Object.fromEntries(new URLSearchParams(qs)) };
}

function build(path: string[], q: Record<string, string | undefined | null> = {}): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v != null && v !== "") qs.set(k, v);
  const s = qs.toString();
  return "/" + path.map(encodeURIComponent).join("/") + (s ? "?" + s : "");
}

/** Old single page links: "#inc=incidents/<id>.json", "#inbox", "#how" and so on. */
function legacy(h: string): string {
  const m = h.match(/^inc=(.+)$/);
  if (m) {
    let ref = m[1];
    try {
      ref = decodeURIComponent(ref);
    } catch {
      /* keep as is */
    }
    const id = ref.replace(/^.*\//, "").replace(/\.json$/, "");
    return ref.startsWith("live/") ? build(["live"], { sel: id }) : build(["i", id]);
  }
  const sections: Record<string, string> = {
    inbox: "/queue",
    live: "/live",
    how: "/docs/decides",
    trust: "/docs/trust",
    found: "/fleet",
    about: "/docs/about",
  };
  return sections[h] ?? "/";
}

/** The route a path should land on, or null when it is already current. */
function redirect(r: Route): string | null {
  const [a, b, c, d] = r.path;
  const q = r.q;
  switch (a) {
    case undefined:
      return null;
    case "queue":
      return b ? build(["queue"], q) : null;
    case "i":
      return b ? (c ? build(["i", b]) : null) : "/queue";
    case "fleet": {
      if (b) return c === "i" && d ? build(["i", d]) : build(["arm", b]);
      const keep: Query = {};
      if (q.q) keep.q = q.q;
      if (q.show) keep.show = q.show;
      else if (q.f === "ticket") keep.show = "hw";
      const changed = Object.keys(q).some((k) => !(k in keep)) || keep.show !== q.show;
      return changed ? build(["fleet"], keep) : null;
    }
    case "arm":
      return b ? (c ? build(["arm", b]) : null) : "/fleet";
    case "live":
      if (b === "i" && c) return build(["live"], { sel: c });
      return b ? build(["live"]) : null;
    case "docs":
      return b && DOCS.has(b) && !c ? null : "/docs/decides";
    case "inbox": {
      if (b === "i" && c) return build(["i", c]);
      const keep: Query = {};
      for (const k of QUEUE_KEEP) if (q[k]) keep[k] = q[k];
      if (q.group === "problem") keep.view = "problems";
      else if (q.group === "none") keep.view = "incidents";
      return build(["queue"], keep);
    }
    case "how":
      return "/docs/decides";
    case "trust":
      return "/docs/trust";
    case "about":
      return "/docs/about";
    default:
      return "/";
  }
}

export function parse(hash = location.hash): Route {
  let h = hash.replace(/^#/, "");
  let to: string | null = null;
  if (!h.startsWith("/")) to = h ? legacy(h) : "/";
  else to = redirect(split(h));
  if (to != null && to !== h) {
    if (typeof history !== "undefined" && typeof location !== "undefined" && hash === location.hash) {
      history.replaceState(null, "", "#" + to);
    }
    h = to;
  }
  return split(h);
}

export const route = signal<Route>(parse());
window.addEventListener("hashchange", () => {
  route.value = parse();
});

export function href(path: string[], q: Record<string, string | undefined | null> = {}): string {
  return "#" + build(path, q);
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

/** Update the current route's query in place, keeping history clean. */
export function setQuery(patch: Record<string, string | undefined | null>, replace = true): void {
  const r = route.value;
  const q: Record<string, string | undefined | null> = { ...r.q, ...patch };
  go(r.path, q, replace);
}

/** Path key used to tell a real navigation from a query change. */
export const pathKey = (r: Route): string => r.path.join("/");
