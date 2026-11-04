import { useEffect, useRef, useState } from "preact/hooks";
import { num } from "../format";

export interface Option {
  value: string;
  label: string;
  count?: number;
}

/** A filter chip: shows the active values, opens a menu of options with counts. */
export function FilterMenu({
  label,
  options,
  selected,
  onChange,
  searchable,
}: {
  label: string;
  options: Option[];
  selected: string[];
  onChange: (values: string[]) => void;
  searchable?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        e.stopPropagation();
      }
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", esc, true);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", esc, true);
    };
  }, [open]);

  const active = selected.length > 0;
  const names = selected.map((v) => options.find((o) => o.value === v)?.label ?? v);
  const shown = q ? options.filter((o) => o.label.toLowerCase().includes(q.toLowerCase())) : options;
  const toggle = (v: string) =>
    onChange(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v]);

  return (
    <div class="fmenu" ref={root}>
      <button
        class={`chip ${active ? "on" : ""}`}
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <span class="chip-k">{label}</span>
        {active ? <span class="chip-v">{names.length > 2 ? `${names.length} selected` : names.join(", ")}</span> : null}
        <span class="chev" aria-hidden="true">▾</span>
      </button>
      {active ? (
        <button class="chip-x" aria-label={`Clear ${label} filter`} onClick={() => onChange([])}>
          ×
        </button>
      ) : null}
      {open ? (
        <div class="popover" role="group" aria-label={`${label} filter`}>
          {searchable ? (
            <input
              class="input small"
              type="search"
              placeholder={`Find ${label.toLowerCase()}`}
              aria-label={`Find ${label.toLowerCase()}`}
              value={q}
              autoFocus
              onInput={(e) => setQ((e.target as HTMLInputElement).value)}
            />
          ) : null}
          <div class="popover-list">
            {shown.slice(0, 80).map((o) => (
              <label key={o.value} class="opt">
                <input type="checkbox" checked={selected.includes(o.value)} onChange={() => toggle(o.value)} />
                <span class="opt-l">{o.label}</span>
                {o.count != null ? <span class="opt-n">{num(o.count)}</span> : null}
              </label>
            ))}
            {shown.length > 80 ? <p class="muted small pad">Type to narrow {num(shown.length)} options</p> : null}
            {!shown.length ? <p class="muted small pad">No match</p> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
