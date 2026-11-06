import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { CopyBlock } from "../components/CopyBlock";
import { RungTag } from "../components/RungTag";
import { Brand } from "../components/Sidebar";
import { TimelinePanel, type BandSpec, type Cursor, type PanelSpec } from "../components/TimelinePanel";
import { Trace } from "../components/Trace";
import { fpsOf } from "../chart";
import { arrivals, data, lastPollOK, live, livePossible, liveStatus, loadBundle } from "../data";
import { agoShort, camWords, displayTitle, fixed, partWords } from "../format";
import { useKeys } from "../keys";
import { go, href, route } from "../router";
import type { Bundle, LiveData, LiveRow } from "../types";

const FRESH_MS = 6000;

/** A client side replay: rows of a feed arrive at half their wall spacing. Writes nothing. */
interface Demo {
  data: LiveData;
  bundles: Record<string, Bundle> | null;
  start: number;
  base: number;
}

function useNow(ms: number) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

const demoAt = (d: Demo, r: LiveRow) => d.start + ((r.wall - d.base) / 2) * 1000;

function startDemo(feed: LiveData, bundles: Record<string, Bundle> | null): Demo {
  const walls = feed.incidents.map((r) => r.wall);
  return { data: feed, bundles, start: Date.now() + 600, base: Math.max(0, Math.min(...walls) - 1) };
}

type Sample = { data: LiveData; bundles: Record<string, Bundle> };
let sampleCache: Promise<Sample> | null = null;
const loadSample = () => (sampleCache ??= import("../sample/live-sample.json").then((m) => ((m as any).default ?? m) as Sample));

const ORD = (n: number) => (n % 10 === 1 && n % 100 !== 11 ? `${n}st` : n % 10 === 2 && n % 100 !== 12 ? `${n}nd` : n % 10 === 3 && n % 100 !== 13 ? `${n}rd` : `${n}th`);

const ShortTag = ({ rung }: { rung: number }) => <RungTag rung={rung} short style="height:24px" />;

export function Live() {
  const st = liveStatus.value;
  const feed = live.value;
  const now = useNow(250);
  const r = route.value;
  const pinned = r.q.sel ?? null;
  const [demo, setDemo] = useState<Demo | null>(null);
  const [hiddenArrival, setHiddenArrival] = useState(false);

  // rows, newest first, from the in page demo or the polled feed
  const src: LiveData | null = demo ? demo.data : st !== "none" ? feed : null;
  const all = src ? src.incidents.slice().sort((a, b) => b.wall - a.wall) : [];
  const rows = demo ? all.filter((x) => demoAt(demo, x) <= now) : all;
  const arrivedAt = (x: LiveRow) => (demo ? demoAt(demo, x) : arrivals.value[x.id]);
  const fresh = (x: LiveRow) => {
    const a = arrivedAt(x);
    return a != null && now - a < FRESH_MS;
  };
  const superseded = new Set(rows.map((x) => x.supersedes).filter((x): x is string => !!x));
  const newest = rows[0] ?? null;
  const selId = pinned && rows.some((x) => x.id === pinned) ? pinned : newest?.id ?? null;
  const sel = rows.find((x) => x.id === selId) ?? null;
  const following = !pinned;
  const anyFresh = rows.some(fresh);

  // "● " in the title while an arrival waits in a hidden tab
  useEffect(() => {
    if (anyFresh && document.hidden) setHiddenArrival(true);
  }, [anyFresh, rows.length]);
  useEffect(() => {
    const onVis = () => !document.hidden && setHiddenArrival(false);
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);
  useEffect(() => {
    document.title = `${hiddenArrival ? "● " : ""}Live · Triage`;
  }, [hiddenArrival]);

  const pick = (id: string) => go(["live"], { sel: id }, true);
  const follow = () => go(["live"], {}, true);
  const step = (dir: number) => {
    if (!rows.length) return;
    const i = Math.max(0, rows.findIndex((x) => x.id === selId));
    const n = rows[Math.max(0, Math.min(rows.length - 1, i + dir))];
    pick(n.id);
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-live="${CSS.escape(n.id)}"]`)?.scrollIntoView({ block: "nearest" }));
  };
  useKeys({ j: () => step(1), k: () => step(-1), ArrowDown: () => step(1), ArrowUp: () => step(-1), f: follow });

  const replay = () => {
    if (!src) return;
    setDemo(startDemo(src, demo?.bundles ?? null));
    follow();
  };
  const playSample = () =>
    loadSample().then((s) => {
      setDemo(startDemo(s.data, s.bundles));
      follow();
    });

  if (!demo && st === "none") return <LiveEmpty onPlay={playSample} />;

  const age = Math.max(0, (now - lastPollOK.value) / 1000);
  const robot = src?.robot_id ?? "";
  const isReplay = src?.fleet === "replay";
  const conn = demo ? "demo" : st;

  return (
    <div style="display:flex;flex-direction:column;min-height:100vh;font-size:14px">
      <header class="live-bar">
        <Brand />
        <span style="width:1px;height:24px;background:var(--border)" aria-hidden="true" />
        <span class="conn" role="status">
          <span class={`pulse${conn === "lost" ? " lost" : ""}`} />
          {conn === "demo" ? "Playing a recorded rehearsal" : conn === "lost" ? "Connection lost" : "Connected to the monitor"}
        </span>
        <span class="t-2">
          {conn === "demo"
            ? `${robot} · replayed in this page at double speed, nothing is connected`
            : conn === "lost"
              ? `Last update ${agoShort(age)}. Retrying every 2 s; incidents so far stay on screen.`
              : `${robot} · ${isReplay ? "replaying a recorded run" : "watching a running robot"} · updated ${agoShort(age)}`}
        </span>
        <div style="margin-left:auto;display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          <button type="button" class="btn" aria-pressed={following ? "true" : "false"} onClick={follow}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
              <path d="M8 3v10M4 9l4 4 4-4" />
            </svg>
            {following ? "Following newest" : "Follow newest"}
          </button>
          {isReplay || demo ? (
            <button type="button" class="btn" onClick={replay}>
              Replay the demo
            </button>
          ) : null}
          {demo && st === "none" ? (
            <button type="button" class="btn" onClick={() => setDemo(null)}>
              Stop
            </button>
          ) : null}
          <a class="btn" href={href(["queue"])}>
            Queue
          </a>
        </div>
      </header>
      <main class="live-grid" id="main">
        <h1 class="sr">Live</h1>
        <section class="stream" aria-label="Incidents, newest first" aria-live="polite">
          <div style="display:flex;justify-content:space-between;align-items:baseline;padding:14px 16px;border-bottom:1px solid var(--border)">
            <span class="lbl">Incidents, newest first</span>
            <span class="num t-3" style="font-size:12px">
              {rows.length} so far
            </span>
          </div>
          {conn === "lost" ? (
            <div style="padding:12px 16px;font-size:13px;border-bottom:1px solid var(--border-soft)" class="t-2">
              Incidents already on screen stay put and keep their evidence. New ones resume when the monitor is back.
            </div>
          ) : null}
          {!rows.length ? (
            <div class="empty" style="padding:40px 20px">
              <span class="pulse" />
              <b style="color:var(--text)">Watching {robot}</b>
              <span>Nothing has fired yet. A fault shows up here 2 to 5 s after it starts.</span>
            </div>
          ) : null}
          {rows.map((x) => (
            <button
              key={x.id + (demo ? demo.start : "")}
              type="button"
              data-live={x.id}
              class={["lrow", fresh(x) ? "fresh" : "", superseded.has(x.id) ? "super" : "", x.id === selId ? "sel" : ""].filter(Boolean).join(" ")}
              aria-current={x.id === selId ? "true" : undefined}
              onClick={() => pick(x.id)}
            >
              <span class="lt">{fixed(x.wall, 1)} s</span>
              <span class="lmain">
                <span style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
                  <ShortTag rung={x.rung} />
                  {x.supersedes ? <span class="esc">↑ escalated</span> : null}
                  {superseded.has(x.id) ? <span class="chip">superseded</span> : null}
                </span>
                <span class="ltitle">{displayTitle(x)}</span>
                <span class="lroute">{x.route}</span>
              </span>
            </button>
          ))}
        </section>
        <section class="live-detail big" aria-label="Selected incident">
          {sel ? <LiveDetail key={sel.id} x={sel} bundles={demo?.bundles ?? null} /> : null}
        </section>
      </main>
    </div>
  );
}

/** The selected live incident at large type. */
function LiveDetail({ x, bundles }: { x: LiveRow; bundles: Record<string, Bundle> | null }) {
  const d = data.value;
  const [b, setB] = useState<Bundle | null>(bundles?.[x.bundle] ?? null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (bundles) {
      setB(bundles[x.bundle] ?? null);
      setFailed(!bundles[x.bundle]);
      return;
    }
    let ok = true;
    loadBundle(x.bundle).then(
      (v) => ok && setB(v),
      () => ok && setFailed(true),
    );
    return () => {
      ok = false;
    };
  }, [x.bundle]);
  const rule = d?.rules.find((r) => r.rule === x.rule);
  const comp = x.component === "arm" ? "whole arm" : x.component ? partWords(x.component, { fingerprint: x.fingerprint }) : "";
  const times = x.route.match(/froze (\d+) times/);
  const trace = b?.incident.trace ?? [];
  return (
    <>
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
        <RungTag rung={x.rung} lg />
        <span class="tag mono">Rule {x.rule}</span>
        {rule ? (
          <span class="t-3" style="font-size:13px">
            {rule.when}
          </span>
        ) : null}
      </div>
      <h2 class="h-incident">{displayTitle(x)}</h2>
      <div class="idline" style="font-size:14px">
        {comp ? `${comp} · ` : ""}
        {x.robot_id} · at {fixed(x.t, 1)} s in the run · arrived {fixed(x.wall, 1)} s after start
      </div>
      <div class="engine">
        <span class="lbl">Engine verdict</span>
        <span class="mono">{x.route}</span>
      </div>
      {x.supersedes ? (
        <div class="try r2">
          <b class="rtext-2">Escalated from rung 1</b>
          <span>
            The robot cleared the first freeze on its own.{" "}
            {times
              ? `The ${ORD(+times[1])} freeze of the same camera in one recording turns it into a ticket for the camera or its USB link.`
              : "A later event on the same part turned it into a ticket."}
          </span>
        </div>
      ) : x.rung === 1 && x.self_recovery ? (
        <div class="try r1">
          <b class="rtext-1">Robot can try</b>
          <span>{x.self_recovery}</span>
        </div>
      ) : null}
      {x.truth?.length ? (
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <span class="chip" style="background:var(--truth-bg);color:var(--truth);height:24px;font-size:12.5px;font-weight:600">
            <span class="sw truth" /> injected: {x.truth.map((t) => `${t.fault.replace(/_/g, " ")} on ${partWords(t.target)}`).join(", ")}
          </span>
          <span class="t-3" style="font-size:12px">
            from the monitor's fault log
          </span>
        </div>
      ) : (
        <div style="display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px dashed var(--border-strong);border-radius:8px;color:var(--text-2);font-size:13px">
          <span class="sw truth" />
          No fault injected on this run. When one is, it shows here and as a green band, so the verdict can be checked against what really happened.
        </div>
      )}
      {b ? <LiveChart b={b} /> : null}
      {trace.length ? (
        <div style="display:flex;flex-direction:column;gap:10px">
          <span class="lbl">Why this verdict</span>
          <div style="font-size:15px">
            <Trace lines={trace} />
          </div>
        </div>
      ) : b || failed ? (
        <p class="t-3" style="font-size:13px">
          Evidence bundle for this one isn't in the files.
        </p>
      ) : null}
    </>
  );
}

/** One camera's picture change against arm motion over the whole clip, shown for a camera cause
 *  that has more freezes of the same camera (the escalation), or when a fault was injected. */
function LiveChart({ b }: { b: Bundle }) {
  const [cursor, setCursor] = useState<Cursor | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(600);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.getBoundingClientRect().width || 600));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const spec = useMemo(() => {
    const c = b.incident.cause;
    if (!c || !c.check.startsWith("sensing.stale_camera")) return null;
    const key = Object.keys(b.clip.cams).find((k) => k === c.component || k.endsWith("." + c.component));
    if (!key || !b.clip.t.length) return null;
    const same = (b.events ?? []).filter((e) => e.check === c.check && e.component === c.component && e.t_start !== c.t_start);
    if (!same.length && !b.truth?.length) return null;
    const bands: BandSpec[] = [];
    for (const tr of b.truth ?? []) bands.push({ kind: "truth", t0: tr.t0, t1: tr.t1, tag: "injected" });
    for (const e of same) bands.push({ kind: "ctx", t0: e.t_start, t1: e.t_end });
    bands.push({ kind: "cause", t0: c.t_start, t1: c.t_end, tag: `cause, ${fixed(c.t_start, 1)} s` });
    const cam = b.clip.cams[key];
    const p: PanelSpec = {
      key,
      kind: "cam",
      words: camWords(key) + " camera",
      caption: "picture change against arm motion",
      height: 120,
      last: true,
      ticks: true,
      change: cam.change,
      motion: cam.motion,
      thr: data.value?.thresholds.stale_tau_e ?? 0.51,
      topNote: same.length ? { text: `${same.length} more freeze${same.length > 1 ? "s" : ""}, dashed`, t: same[0].t_start } : undefined,
    };
    return { p, bands, key };
  }, [b]);
  if (!spec) return null;
  const t = b.clip.t;
  return (
    <div class="card" style="overflow:hidden">
      <div class="card-head">
        <span class="h2">{camWords(spec.key)} camera</span>
        <span class="t-3" style="font-size:12px">
          picture change against arm motion, {fixed(t[0], 1)} to {fixed(t[t.length - 1], 1)} s
        </span>
      </div>
      <div ref={ref}>
        <TimelinePanel p={spec.p} t={t} r={[t[0], t[t.length - 1]]} bands={spec.bands} minBandPct={(100 * 3) / Math.max(100, w)} cursor={cursor} setCursor={setCursor} fps={fpsOf(t)} single />
      </div>
    </div>
  );
}

/** No monitor: what Live is, how to start one, and a rehearsal to play in the page. */
function LiveEmpty({ onPlay }: { onPlay: () => void }) {
  const [sample, setSample] = useState<Sample | null>(null);
  useEffect(() => {
    document.title = "Live · Triage";
    loadSample().then(setSample, () => setSample(null));
  }, []);
  const rows = sample?.data.incidents ?? [];
  const esc = rows.find((r) => r.supersedes);
  const sup = esc ? rows.find((r) => r.id === esc.supersedes) : null;
  const n = esc?.route.match(/froze (\d+) times/)?.[1];
  return (
    <div style="display:flex;flex-direction:column;min-height:100vh;font-size:14px">
      <header class="live-bar">
        <Brand />
        <span style="width:1px;height:24px;background:var(--border)" aria-hidden="true" />
        <span class="conn" role="status">
          <span class="pulse off" />
          No monitor running
        </span>
        <span class="t-2">{livePossible ? "Checking for one every 2 s" : "This public copy never has a monitor"}</span>
        <div style="margin-left:auto;display:flex;gap:8px">
          <a class="btn" href={href(["queue"])}>
            Queue
          </a>
        </div>
      </header>
      <main id="main" class="live-empty" style="flex:1;display:flex;flex-wrap:wrap;gap:48px;max-width:1200px;width:100%;margin:0 auto;padding:56px 32px;align-items:flex-start">
        <section style="flex:1 1 440px;display:flex;flex-direction:column;gap:20px;min-width:0">
          <span class="lbl">Live</span>
          <h1 style="font-size:32px;font-weight:650;letter-spacing:-0.02em;line-height:1.15">Incidents from a running robot, a few seconds after they happen</h1>
          <p class="t-2" style="font-size:15px;line-height:1.6;max-width:560px">
            A monitor runs beside the robot and checks a sliding window of its log on every tick. When a camera freezes, a joint stops following, or the task stalls, it
            cuts the evidence, routes it on the ladder and posts it here, newest first, while the robot keeps running.
          </p>
          <p class="t-2" style="font-size:15px;line-height:1.6;max-width:560px">
            A stall needs 2 s to exist and the evidence window has to close, so an incident lands 2 to 5 s after the fault starts.
          </p>
          <div style="display:flex;flex-direction:column;gap:12px;margin-top:8px">
            <div style="display:flex;flex-direction:column;gap:6px">
              <span style="font-weight:600">1. Serve the viewer</span>
              <CopyBlock text="triage serve --site docs" />
            </div>
            <div style="display:flex;flex-direction:column;gap:6px">
              <span style="font-weight:600">2. Start a monitor</span>
              <CopyBlock text="triage replay path/to/dataset --site docs --speed 1" />
              <span class="t-3" style="font-size:13px">
                That rehearses with a recorded run. On a physical SO 101 arm, <span class="mono">recorder/record_labeled.py --monitor</span> runs the same checks live.
              </span>
            </div>
          </div>
          <p class="t-3" style="font-size:13px">
            Then open http://127.0.0.1:8080/ and come back to this page.{livePossible ? "" : " This public copy never has a monitor."}
          </p>
        </section>
        {esc && sup && sample ? (
          <section aria-label="What it looks like" style="flex:1 1 420px;display:flex;flex-direction:column;gap:12px;min-width:0">
            <div style="display:flex;justify-content:space-between;align-items:baseline">
              <span class="lbl">From a rehearsal on {sample.data.robot_id}</span>
              <a
                href={href(["live"])}
                style="font-size:13px"
                onClick={(e) => {
                  e.preventDefault();
                  onPlay();
                }}
              >
                Play it →
              </a>
            </div>
            <div class="card" style="overflow:hidden">
              {[esc, sup].map((x) => (
                <div key={x.id} class={x === sup ? "lrow super" : "lrow"} style="cursor:default">
                  <span class="lt">{fixed(x.wall, 1)} s</span>
                  <span class="lmain">
                    <span style="display:flex;gap:8px;align-items:center">
                      <ShortTag rung={x.rung} />
                      {x === esc ? <span class="esc">↑ escalated</span> : <span class="chip">superseded</span>}
                    </span>
                    <span class="ltitle">{displayTitle(x)}</span>
                    <span class="lroute">{x.route}</span>
                  </span>
                </div>
              ))}
            </div>
            <p class="t-3" style="font-size:13px">
              The first freeze is something the robot clears itself. The {n ? ORD(+n) : "next"} freeze of the same camera turns it into a ticket for the camera or its USB
              link, and the earlier verdict is marked superseded.
            </p>
          </section>
        ) : null}
      </main>
    </div>
  );
}
