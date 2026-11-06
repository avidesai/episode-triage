import { useEffect, useState } from "preact/hooks";
import { data, loadBundle } from "../data";
import { problemTitle } from "../derive";
import { partWords, secs } from "../format";
import { href } from "../router";
import type { Bundle, Summary } from "../types";
import { RungTag } from "./RungTag";
import { Skel } from "./States";
import { StatusControl } from "./StatusControl";
import { Trace } from "./Trace";

/** Load a bundle for an incident, with loading and error states. */
export function useBundle(path: string | null) {
  const [st, setSt] = useState<{ path: string | null; b: Bundle | null; err: boolean }>({ path: null, b: null, err: false });
  const [tries, setTries] = useState(0);
  useEffect(() => {
    if (!path) return;
    let live = true;
    setSt({ path, b: null, err: false });
    loadBundle(path).then(
      (b) => live && setSt({ path, b, err: false }),
      () => live && setSt({ path, b: null, err: true }),
    );
    return () => {
      live = false;
    };
  }, [path, tries]);
  const cur = st.path === path ? st : { path, b: null, err: false };
  return { bundle: cur.b, error: cur.err, loading: !cur.b && !cur.err, retry: () => setTries((t) => t + 1) };
}

/** The selected incident beside the list, wider than 1100 px. */
export function QueuePane({ s }: { s: Summary }) {
  const d = data.value!;
  const { bundle, loading } = useBundle(s.bundle);
  const rule = d.rules.find((r) => r.rule === s.rule);
  const comp = s.component && s.component !== "arm" ? partWords(s.component, { fingerprint: s.fingerprint }) + " · " : "";
  return (
    <aside
      aria-label="Selected incident"
      style="flex:1 1 380px;max-width:440px;padding:16px 20px 28px;display:flex;flex-direction:column;gap:18px;background:var(--surface)"
    >
      <div style="display:flex;align-items:center;gap:8px;color:var(--text-3);font-size:12px">
        <span class="kbd">[</span>
        <span class="kbd">]</span> prev, next
        <span class="num" style="margin-left:auto">
          {s.id}
        </span>
      </div>
      <div style="display:flex;flex-direction:column;gap:10px">
        <div class="tagrow">
          <RungTag rung={s.rung} />
          <span class="tag mono">{s.rule}</span>
          <span class="tag">{s.source}</span>
        </div>
        <h2 style="font-size:19px;font-weight:650;letter-spacing:-0.01em;line-height:1.3">{problemTitle(s)}</h2>
        <div class="idline">
          {comp}
          {s.robot_id} · run {s.run} · at {secs(s.t)}
        </div>
      </div>
      <div style="display:flex;flex-direction:column;gap:6px">
        <span class="lbl">Engine verdict</span>
        <p class="mono" style="font-size:12.5px;line-height:1.6;padding:10px 12px;background:var(--surface-2);border:1px solid var(--border);border-radius:8px">
          {s.route}
        </p>
      </div>
      {s.rung === 1 && s.self_recovery ? (
        <div class="try r1">
          <b class="rtext-1">Robot can try</b>
          <span>{s.self_recovery}</span>
        </div>
      ) : null}
      {loading ? (
        <div style="display:flex;flex-direction:column;gap:8px" aria-busy="true">
          <span class="lbl">Why this verdict</span>
          <Skel h={12} w="80%" />
          <Skel h={12} w="60%" />
          <Skel h={12} w="70%" />
        </div>
      ) : bundle?.incident.trace?.length ? (
        <div style="display:flex;flex-direction:column;gap:8px">
          <span class="lbl">Why this verdict</span>
          <Trace lines={bundle.incident.trace} />
        </div>
      ) : null}
      {rule ? (
        <div style="display:flex;flex-direction:column;gap:4px;padding:12px;border:1px solid var(--border);border-radius:8px">
          <span class="lbl">Rule {rule.rule}</span>
          <span>{rule.when}</span>
          <span class="t-3" style="font-size:12px">
            to: {rule.to}
          </span>
        </div>
      ) : null}
      <StatusControl id={s.id} card={false} />
      <a class="btn primary" href={href(["i", s.id])} style="height:40px">
        Open evidence <span class="kbd">↵</span>
      </a>
    </aside>
  );
}
