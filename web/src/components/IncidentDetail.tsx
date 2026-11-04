import { useEffect, useRef, useState } from "preact/hooks";
import { data, loadBundle } from "../data";
import { evidenceRows } from "../evidence";
import { FIX_LABEL, SOURCE_LABEL, componentName, nice, secs, short } from "../format";
import { useKeys } from "../keys";
import { href } from "../router";
import { setNote, setStatus, statusOf, storageOK, workflow, type Status } from "../state";
import type { Bundle, FixBy, TEvent } from "../types";
import { ErrorBox, Rung, Skeleton } from "./bits";
import { Timeline, clipSpan, evKey, isStanding } from "./Timeline";

export interface Nav {
  prev: string | null;
  next: string | null;
  pos: number;
  total: number;
  goTo: (id: string) => void;
}

const FIX_OF: Record<number, FixBy> = { 1: "robot", 2: "ticket", 3: "training", 4: "person" };

function coverageLine(b: Bundle): string {
  const c = b.coverage || { cameras_checked: [], cameras_missing: [] };
  const checked = c.cameras_checked || [];
  const missing = c.cameras_missing || [];
  let s = checked.length
    ? "Checked joints and " + checked.map(short).join(", ") + (checked.length > 1 ? " cameras" : " camera")
    : "Checked joints only";
  if (missing.length) s += "; not checked: " + missing.map(short).join(", ");
  return s + ".";
}

const evTime = (e: TEvent) => (e.t_abs != null ? e.t_abs : e.t_start);

function EventList({ title, events, onPick, picked }: { title: string; events: TEvent[]; onPick: (k: string | null) => void; picked: string | null }) {
  const plain = data.value?.plain ?? {};
  if (!events.length) return null;
  return (
    <div class="evlist">
      <h4>{title}</h4>
      <ul>
        {events.map((e) => {
          const k = evKey(e);
          return (
            <li key={k}>
              <button class={`linkish ${picked === k ? "on" : ""}`} aria-pressed={picked === k} onClick={() => onPick(picked === k ? null : k)}>
                {plain[e.check] ?? nice(e.check)}
              </button>{" "}
              <span class="muted">
                {componentName(e.component)}, {secs(evTime(e))}
                {e.t_end > e.t_start + 0.05 ? ` for ${secs(e.t_end - e.t_start)}` : ""}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function IncidentDetail({
  id,
  path,
  nav,
  onClose,
  live,
  supersedesHref,
}: {
  id: string;
  path: string;
  nav?: Nav;
  onClose?: () => void;
  live?: boolean;
  supersedesHref?: (id: string) => string;
}) {
  const [b, setB] = useState<Bundle | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [showLow, setShowLow] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const noteRef = useRef<HTMLInputElement>(null);
  const top = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    setB(null);
    setErr(null);
    setPicked(null);
    setShowLow(false);
    loadBundle(path).then(
      (v) => alive && setB(v),
      (e) => alive && setErr(e instanceof Error ? e.message : String(e)),
    );
    top.current?.scrollTo?.({ top: 0 });
    return () => {
      alive = false;
    };
  }, [path, attempt]);

  const mark = (s: Status) => setStatus(id, s);
  useKeys(
    {
      a: () => mark("ack"),
      r: () => mark("resolved"),
      u: () => mark("new"),
      n: () => noteRef.current?.focus(),
      "[": () => nav?.prev && nav.goTo(nav.prev),
      "]": () => nav?.next && nav.goTo(nav.next),
      Escape: () => onClose?.(),
    },
    [id, nav?.prev, nav?.next, onClose],
  );

  const T = data.value?.thresholds ?? {};
  const plain = data.value?.plain ?? {};
  const status = statusOf(id, workflow.value);
  const note = workflow.value[id]?.note ?? "";

  const header = (
    <div class="pane-top">
      <div class="pane-nav">
        {nav ? (
          <>
            <button class="btn icon" aria-label="Previous incident" title="Previous ([)" disabled={!nav.prev} onClick={() => nav.prev && nav.goTo(nav.prev)}>
              ‹
            </button>
            <button class="btn icon" aria-label="Next incident" title="Next (])" disabled={!nav.next} onClick={() => nav.next && nav.goTo(nav.next)}>
              ›
            </button>
            <span class="muted small tnum">
              {nav.pos > 0 ? `${nav.pos} of ${nav.total}` : `not in this view`}
            </span>
          </>
        ) : null}
        <span class="spacer" />
        <a class="btn small ghost" href={path} target="_blank" rel="noopener">
          Raw bundle
        </a>
        {onClose ? (
          <button class="btn icon" aria-label="Close incident" title="Close (Esc)" onClick={onClose}>
            ×
          </button>
        ) : null}
      </div>
    </div>
  );

  if (err)
    return (
      <div class="detail" ref={top}>
        {header}
        <ErrorBox title="Could not load this incident" detail={err} retry={() => setAttempt(attempt + 1)} />
      </div>
    );
  if (!b)
    return (
      <div class="detail" ref={top}>
        {header}
        <div class="pad">
          <Skeleton rows={8} />
        </div>
      </div>
    );

  const inc = b.incident;
  const fix = FIX_OF[inc.rung] ?? "none";
  const span = clipSpan(b);
  const standing = inc.cause && isStanding(inc.cause, span);
  const lowStale = (e: TEvent) => e.confidence === "low" && e.check === "sensing.stale_camera";
  const lowN = (b.events || []).filter(lowStale).length;
  const evs = (b.events || []).filter((e) => showLow || !lowStale(e));
  const run = b.coverage?.run;
  const where = [b.robot_id, run != null && run !== "live" ? `run ${run}` : null, `at ${secs(b.t)}${live ? " monitor time" : ""}`].filter(Boolean);

  return (
    <div class="detail" ref={top}>
      {header}
      <div class="detail-body">
        <div class="d-head">
          <Rung rung={inc.rung} name={inc.rung_name} long />
          <h2 class="d-title">{nice(inc.route)}</h2>
          <p class="d-meta">
            <span>Rule {inc.rule}</span>
            <span>Fix by {FIX_LABEL[fix].toLowerCase()}</span>
            {live ? <span>{where.join(", ")}</span> : (
              <span>
                <a href={href(["fleet", b.robot_id])}>{b.robot_id}</a>
                {where.slice(1).map((w) => ", " + w)}
              </span>
            )}
            {b.source ? <span>{SOURCE_LABEL[b.source] ?? b.source}</span> : null}
          </p>
          {inc.self_recovery ? (
            <p class="d-recover">
              <b>Robot can try:</b> {inc.self_recovery}
            </p>
          ) : null}
          <p class="muted small">{coverageLine(b)}</p>
          {inc.supersedes ? (
            <p class="d-esc small">
              Escalated from an earlier verdict
              {supersedesHref ? (
                <>
                  {": "}
                  <a href={supersedesHref(inc.supersedes)}>see the earlier one</a>
                </>
              ) : null}
              .
            </p>
          ) : null}
        </div>

        <div class="d-work" aria-label="Status, saved in this browser only">
          <div class="seg" role="group" aria-label="Status">
            {(["new", "ack", "resolved"] as Status[]).map((s) => (
              <button key={s} aria-pressed={status === s} onClick={() => mark(s)}>
                {s === "new" ? "New" : s === "ack" ? "Acknowledged" : "Resolved"}
              </button>
            ))}
          </div>
          <input
            ref={noteRef}
            class="input small note"
            type="text"
            maxLength={280}
            placeholder="Note"
            aria-label="Note"
            value={note}
            onChange={(e) => setNote(id, (e.target as HTMLInputElement).value)}
            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          />
          <span class="muted xsmall">{storageOK ? "Saved in this browser only" : "This browser blocks storage, so status is not saved"}</span>
        </div>

        <section class="d-sec">
          <h3>Timeline</h3>
          {standing ? (
            <p class="muted small">
              This fault holds for the whole run, so there is no single moment to mark. Compare the dashed command with the solid position.
            </p>
          ) : null}
          <Timeline bundle={b} highlight={picked} />
        </section>

        <section class="d-sec">
          <h3>Why this verdict</h3>
          <ol class="trace">
            {(inc.trace || []).map((l, i) => (
              <li key={i}>{nice(l)}</li>
            ))}
          </ol>
        </section>

        <section class="d-sec">
          <h3>Evidence in this window</h3>
          {evs.length ? (
            <div class="tbl-scroll">
              <table class="ev">
                <thead>
                  <tr>
                    <th>What fired</th>
                    <th>When</th>
                    <th>Measured</th>
                    <th>Threshold</th>
                  </tr>
                </thead>
                <tbody>
                  {evs.map((e, k) => {
                    const rows = evidenceRows(e, T);
                    const n = Math.max(rows.length, 1);
                    const when = secs(evTime(e)) + (e.t_end > e.t_start + 0.05 ? ` for ${secs(e.t_end - e.t_start)}` : "");
                    const kk = evKey(e);
                    return rows.map((r, i) => (
                      <tr key={`${k}-${i}`} class={`${i === 0 ? "first" : ""} ${picked === kk ? "picked" : ""}`}>
                        {i === 0 ? (
                          <td rowSpan={n} class="ev-what">
                            <b>{plain[e.check] ?? nice(e.check)}</b>
                            <span class="muted">
                              {componentName(e.component)}
                              {e.confidence !== "high" ? `, ${e.confidence} confidence` : ""}
                            </span>
                          </td>
                        ) : null}
                        {i === 0 ? (
                          <td rowSpan={n} class="tnum nowrap">
                            {when}
                          </td>
                        ) : null}
                        <td>
                          {r[0]}: <b class="tnum">{r[1]}</b>
                        </td>
                        <td class="muted">{r[2]}</td>
                      </tr>
                    ));
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p class="muted small">No check fired inside this window beyond the verdict itself.</p>
          )}
          {lowN ? (
            <p class="muted small">
              {showLow ? "Showing" : "Not shown:"} {lowN} low confidence frozen camera {lowN > 1 ? "runs" : "run"} in this window. That camera barely sees the arm
              move, so a still picture proves little and never drives a verdict.{" "}
              <button class="linkish" onClick={() => setShowLow(!showLow)}>
                {showLow ? "Hide them" : "Show them"}
              </button>
            </p>
          ) : null}
        </section>

        {inc.cause || inc.related?.length || inc.context?.length ? (
          <section class="d-sec d-events">
            <EventList title="What started it" events={inc.cause ? [inc.cause] : []} onPick={setPicked} picked={picked} />
            <EventList title="Related, same start" events={inc.related || []} onPick={setPicked} picked={picked} />
            <EventList title="After it (context)" events={inc.context || []} onPick={setPicked} picked={picked} />
            <p class="muted xsmall">Pick an event to mark its band on the timeline.</p>
          </section>
        ) : null}
      </div>
    </div>
  );
}
