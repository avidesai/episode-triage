import { useEffect, useState } from "preact/hooks";
import { Copy, Rung, StatusMark } from "../components/bits";
import { IncidentDetail, type Nav } from "../components/IncidentDetail";
import { arrivals, lastPollOK, live, liveStatus } from "../data";
import { ago, nice, num, plural, secs } from "../format";
import { useKeys } from "../keys";
import { go, href, route } from "../router";
import type { LiveRow } from "../types";

const NEW_MS = 8000;

function useNow(ms: number) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

export function Live() {
  const d = live.value;
  const st = liveStatus.value;
  const now = useNow(1000);
  const r = route.value;
  const pinned = r.path[1] === "i" && r.path[2] ? r.path[2] : null;

  const rows: LiveRow[] = d ? d.incidents.slice().reverse() : [];
  const newest = rows[0] ?? null;
  const selId = pinned ?? newest?.id ?? null;
  const sel = rows.find((x) => x.id === selId) ?? null;
  const superseded = new Set(rows.map((x) => x.supersedes).filter((x): x is string => !!x));
  const fresh = arrivals.value;
  const newCount = rows.filter((x) => fresh[x.id] && now - fresh[x.id] < NEW_MS).length;

  useEffect(() => {
    document.title = newCount ? `(${newCount}) Live · Triage` : "Live · Triage";
    return () => {
      document.title = "Triage";
    };
  }, [newCount]);

  const order = rows.map((x) => x.id);
  const pos = selId ? order.indexOf(selId) : -1;
  const open = (id: string) => go(["live", "i", id]);
  const nav: Nav | undefined = sel
    ? {
        prev: pos > 0 ? order[pos - 1] : null,
        next: pos >= 0 && pos < order.length - 1 ? order[pos + 1] : null,
        pos: pos + 1,
        total: order.length,
        goTo: (id) => go(["live", "i", id], {}, true),
      }
    : undefined;
  useKeys(
    {
      j: () => nav?.next && nav.goTo(nav.next),
      k: () => nav?.prev && nav.goTo(nav.prev),
    },
    [nav?.next, nav?.prev],
  );

  const byRung = new Map<number, number>();
  for (const x of rows) byRung.set(x.rung, (byRung.get(x.rung) ?? 0) + 1);

  if (st === "none" || !d) return <NoMonitor />;

  const age = Math.max(0, (now - lastPollOK.value) / 1000);
  const running = d.started_at ? now / 1000 - d.started_at : null;

  return (
    <div class="live">
      <div class={`live-bar ${st}`} role="status">
        <span class={`dot ${st}`} aria-hidden="true" />
        <b>{st === "connected" ? "Connected" : "Connection lost"}</b>
        <span class="mono">{d.robot_id}</span>
        <span class="muted">
          {running != null ? `monitor running ${ago(running).replace(" ago", "")}, ` : ""}
          {st === "connected" ? `checked ${ago(age)}` : `last answer ${ago(age)}`}
        </span>
        <span class="spacer" />
        <span class="live-counts">
          {[...byRung.entries()]
            .sort((a, b) => a[0] - b[0])
            .map(([g, n]) => (
              <span key={g} class="lc">
                <Rung rung={g} /> <span class="tnum">{num(n)}</span>
              </span>
            ))}
          <span class="muted">{plural(rows.length, "incident")}</span>
        </span>
      </div>

      <div class="live-grid">
        <section class="live-detail" aria-label="Incident">
          {pinned && newest && pinned !== newest.id ? (
            <div class="follow">
              <span>Showing an earlier incident. {fresh[newest.id] && now - fresh[newest.id] < NEW_MS ? "A new one just landed." : ""}</span>
              <button class="btn small primary" onClick={() => go(["live"])}>
                Follow newest
              </button>
            </div>
          ) : null}
          {sel ? (
            <IncidentDetail
              key={sel.id}
              id={sel.id}
              path={sel.bundle}
              nav={nav}
              live
              onClose={pinned ? () => go(["live"]) : undefined}
              supersedesHref={(id) => href(["live", "i", id])}
            />
          ) : (
            <div class="empty">
              <p class="empty-title">Monitor running, nothing fired yet.</p>
              <p class="muted small">Incidents appear here within a couple of seconds of the monitor writing them.</p>
            </div>
          )}
        </section>

        <section class="live-stream" aria-label="Incidents, newest first">
          <h3 class="stream-h">
            Stream <span class="muted small">newest first, times are monitor time</span>
          </h3>
          <ol class="stream">
            {rows.map((x) => {
              const isNew = !!fresh[x.id] && now - fresh[x.id] < NEW_MS;
              return (
                <li key={x.id} class={`srow ${x.id === selId ? "sel" : ""} ${isNew ? "new" : ""} ${superseded.has(x.id) ? "superseded" : ""}`}>
                  <a
                    href={href(["live", "i", x.id])}
                    onClick={(e) => {
                      e.preventDefault();
                      open(x.id);
                    }}
                  >
                    <span class="srow-top">
                      <Rung rung={x.rung} name={x.rung_name} />
                      <span class="srow-route">{nice(x.route)}</span>
                    </span>
                    <span class="srow-meta">
                      <StatusMark id={x.id} />
                      <span class="tnum">{secs(x.t)}</span>
                      <span>rule {x.rule}</span>
                      {x.truth?.length ? <span class="tag truth">injected: {x.truth.map((t) => nice(t.fault)).join(", ")}</span> : null}
                      {x.supersedes ? <span class="tag esc">escalated</span> : null}
                      {superseded.has(x.id) ? <span class="tag">superseded</span> : null}
                      {isNew ? <span class="tag new">new</span> : null}
                    </span>
                  </a>
                </li>
              );
            })}
          </ol>
        </section>
      </div>
    </div>
  );
}

function NoMonitor() {
  return (
    <div class="page narrow">
      <h1 class="page-h">Live</h1>
      <div class="live-bar none" role="status">
        <span class="dot none" aria-hidden="true" />
        <b>No monitor connected</b>
        <span class="muted">Checking for live/data.json every few seconds.</span>
      </div>
      <p>
        The live monitor runs the same checks as the fleet pass over a sliding window of a running robot's log, and writes each incident here as it fires. It runs on
        your machine; this page only reads what it writes.
      </p>
      <h3>Start one</h3>
      <p class="muted small">Serve the viewer:</p>
      <Copy text=".venv/bin/triage serve --site docs" />
      <p class="muted small">Then, in another terminal, replay a recorded run through the monitor:</p>
      <Copy text=".venv/bin/triage replay <dataset> --site docs" />
      <p class="muted small">or run it on a live arm with the recorder (ports, cameras and fault schedule as in recorder/PROTOCOL.md):</p>
      <Copy text="python recorder/record_labeled.py --monitor --site docs --follower-port PORT_F --leader-port PORT_L --root ROOT --repo-id REPO --task TASK" />
      <p class="muted small">
        On the published site there is never a monitor, so this screen stays empty there. The <a href={href(["inbox"])}>inbox</a> holds the fleet's incidents.
      </p>
    </div>
  );
}
