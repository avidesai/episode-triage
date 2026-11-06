import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { data, fleetLoad, loadFleet } from "../data";
import { armHeadline, fleetArms, problems, shortProblem, verdictOf } from "../derive";
import { displayTitle, num } from "../format";
import { paletteOpen } from "../keys";
import { href } from "../router";
import { pushRecent, recent, setTheme, type Recent } from "../state";
import { IconSearch } from "./icons";

interface Item extends Recent {
  group: string;
  action?: () => void;
}

const GOTO: [string, string][] = [
  ["Ladder", href([])],
  ["Queue", href(["queue"])],
  ["Fleet", href(["fleet"])],
  ["Live", href(["live"])],
  ["How it decides", href(["docs", "decides"])],
  ["How much to trust it", href(["docs", "trust"])],
  ["About", href(["docs", "about"])],
];

/** Every word of the query must prefix some word of the text; a number also matches an arm. */
function matches(text: string, q: string): boolean {
  const words = text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((t) => {
      const parts = t.split(/[^a-z0-9]+/).filter(Boolean);
      if (!parts.length) return true;
      return parts.every((p) => words.some((w) => w.startsWith(p) || (/^\d+$/.test(p) && /^\d+$/.test(w) && +w === +p)));
    });
}

export function Palette() {
  const open = paletteOpen.value;
  const dlg = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const opener = useRef<Element | null>(null);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);

  useEffect(() => {
    const d = dlg.current;
    if (!d) return;
    if (open && !d.open) {
      opener.current = document.activeElement;
      setQ("");
      setActive(0);
      d.showModal();
      input.current?.focus();
      if (!fleetLoad.value) loadFleet();
    } else if (!open && d.open) {
      d.close();
    }
  }, [open]);

  const items = useMemo<Item[]>(() => {
    const d = data.value;
    const out: Item[] = [];
    const query = q.trim();
    const goto: Item[] = GOTO.map(([t, to]) => ({ group: "Go to", kind: "Problem", text: t, meta: "", to }));
    const themes: Item[] = (["system", "light", "dark"] as const).map((t) => ({
      group: "Theme",
      kind: "Problem",
      text: `Theme: ${t}`,
      meta: "",
      to: "",
      action: () => setTheme(t),
    }));
    if (!query) {
      for (const r of recent.value) out.push({ ...r, group: "Recent" });
      return [...out, ...goto];
    }
    if (!d) return [...goto, ...themes].filter((i) => matches(i.text, query));
    const take = (group: string, list: Omit<Item, "group">[]) => out.push(...list.slice(0, 8).map((i) => ({ ...i, group })));

    take(
      "Problem",
      problems.value
        .filter((p) => !p.extra && matches(`${shortProblem(p)} ${p.base} ${p.part} ${p.fingerprint}`, query))
        .map((p) => ({ kind: "Problem" as const, text: shortProblem(p), meta: "", to: href(["queue"], { open: p.fingerprint }) })),
    );

    const arms = fleetArms.value.length
      ? fleetArms.value
          .map((a) => ({ a, v: verdictOf(a) }))
          .filter(({ a }) => matches(a.id, query))
          .sort((x, y) => Number(x.v === "clean") - Number(y.v === "clean"))
          .map(({ a }) => ({ kind: "Arm" as const, text: a.id, meta: armHeadline(a).title, to: href(["arm", a.id]) }))
      : [...new Set(d.incidents.map((s) => s.robot_id))]
          .filter((id) => matches(id, query))
          .map((id) => ({ kind: "Arm" as const, text: id, meta: "", to: href(["arm", id]) }));
    take("Arm", arms);

    take(
      "Incident",
      d.incidents
        .filter((s) => matches(`${s.id} ${displayTitle(s)}`, query))
        .map((s) => ({ kind: "Incident" as const, text: s.id, meta: s.route, to: href(["i", s.id]) })),
    );

    take(
      "Rule",
      d.rules
        .filter((r) => matches(`${r.rule} rule ${r.when}`, query))
        .map((r) => ({ kind: "Rule" as const, text: r.rule, meta: r.when, to: href(["queue"], { rule: r.rule }) })),
    );
    take("Go to", goto.filter((i) => matches(i.text, query)));
    take("Theme", themes.filter((i) => matches(i.text, query)));
    return out.slice(0, 30);
  }, [q, data.value, fleetArms.value, recent.value]);

  useEffect(() => {
    dlg.current?.querySelector(`[data-i="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const close = () => {
    paletteOpen.value = false;
    const o = opener.current;
    if (o instanceof HTMLElement) o.focus();
  };

  const choose = (i: Item) => {
    if (i.action) i.action();
    else {
      if (i.group !== "Go to" && i.group !== "Recent") pushRecent({ kind: i.kind, text: i.text, meta: i.meta, to: i.to });
      location.hash = i.to.slice(1);
    }
    paletteOpen.value = false;
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(items.length - 1, a + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (items[active]) choose(items[active]);
    }
  };

  const query = q.trim();
  const armQ = query.match(/^(?:arm\s*)?(\d{1,5})$/i);
  const maxArm = data.value?.fleet.robots ?? 0;
  let none = `Nothing matches "${query}".`;
  let noneHint = "";
  if (armQ && maxArm && +armQ[1] > maxArm) {
    none = `No arm ${armQ[1]}`;
    noneHint = `Arms are numbered 0001 to ${String(maxArm).padStart(4, "0")}.`;
  }

  let lastGroup = "";
  return (
    <dialog
      ref={dlg}
      class="palette"
      aria-label="Command palette"
      onClose={() => paletteOpen.value && close()}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onClick={(e) => {
        if (e.target === dlg.current) close();
      }}
    >
      {open ? (
        <div class="palette-box" onKeyDown={onKey}>
          <label class="palette-field">
            <IconSearch size={16} />
            <span class="sr">Search</span>
            <input
              ref={input}
              role="combobox"
              aria-expanded="true"
              aria-controls="palette-list"
              aria-activedescendant={items[active] ? `pal-${active}` : undefined}
              placeholder="Jump to an arm, problem, rule or incident"
              value={q}
              onInput={(e) => {
                setQ((e.target as HTMLInputElement).value);
                setActive(0);
              }}
            />
            <span class="kbd">Esc</span>
          </label>
          <ul class="palette-list" id="palette-list" role="listbox" aria-label="Results">
            {items.map((it, i) => {
              const head = it.group !== lastGroup ? it.group : null;
              lastGroup = it.group;
              return (
                <>
                  {head ? (
                    <li class="palette-group" role="presentation">
                      {head}
                    </li>
                  ) : null}
                  <li
                    id={`pal-${i}`}
                    data-i={i}
                    role="option"
                    aria-selected={i === active ? "true" : "false"}
                    class={i === active ? "palette-item active" : "palette-item"}
                    onMouseMove={() => i !== active && setActive(i)}
                    onClick={() => choose(it)}
                  >
                    {it.group === "Go to" || it.group === "Theme" ? (
                      <span>{it.text}</span>
                    ) : (
                      <>
                        <span class="palette-kind">{it.kind}</span>
                        <span class={it.kind === "Incident" || it.kind === "Rule" ? "mono" : undefined}>{it.text}</span>
                        {it.meta ? <span class="palette-meta">{it.kind === "Incident" ? <span class="mono">{it.meta}</span> : it.meta}</span> : null}
                      </>
                    )}
                  </li>
                </>
              );
            })}
            {query && !items.length ? (
              <li class="palette-none" role="presentation">
                <b>{none}</b>
                {noneHint ? <span>{noneHint}</span> : null}
                <span class="t-3" style="font-size:12px">
                  Try a joint (wrist flex), a camera (front side), a rule (R5) or an arm number ({num(21)}).
                </span>
              </li>
            ) : null}
          </ul>
        </div>
      ) : null}
    </dialog>
  );
}
