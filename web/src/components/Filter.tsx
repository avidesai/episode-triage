import { useEffect, useMemo, useRef, useState } from "preact/hooks";

export interface Option {
  value: string;
  label: string;
  count?: number;
}

/** A dashed filter button that opens a listbox; when set it turns solid with the value and an ×.
 *  `typeahead` adds a text box that narrows long lists (arms). */
export function Filter({
  name,
  value,
  options,
  onChange,
  typeahead,
}: {
  name: string;
  value: string | null;
  options: Option[];
  onChange: (v: string | null) => void;
  typeahead?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [active, setActive] = useState(0);
  const wrap = useRef<HTMLSpanElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const id = `menu-${name.toLowerCase()}`;

  const shown = useMemo(() => {
    const t = text.trim().toLowerCase();
    if (!t) return options.slice(0, 200);
    const num = /^\d{1,4}$/.test(t) ? t.padStart(4, "0") : null;
    return options.filter((o) => o.label.toLowerCase().includes(t) || (num && o.label.includes(num))).slice(0, 200);
  }, [options, text]);

  useEffect(() => {
    if (!open) return;
    setActive(Math.max(0, shown.findIndex((o) => o.value === value)));
    (typeahead ? input.current : list.current)?.focus();
    const onDoc = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-i="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  const close = (refocus = true) => {
    setOpen(false);
    setText("");
    if (refocus) btn.current?.focus();
  };
  const pick = (o: Option) => {
    onChange(o.value === value ? null : o.value);
    close();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(shown.length - 1, a + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const o = shown[active];
      if (o) pick(o);
    } else if (e.key === "Tab") {
      close(false);
    }
  };

  const cur = options.find((o) => o.value === value);
  return (
    <span class="fwrap" ref={wrap} data-menu={open ? "" : undefined}>
      <button
        ref={btn}
        type="button"
        class={value ? "filter on" : "filter"}
        aria-haspopup="listbox"
        aria-expanded={open ? "true" : "false"}
        aria-controls={open ? id : undefined}
        aria-label={value ? `${name}: ${cur?.label ?? value}. Choose again to clear it.` : undefined}
        onClick={() => (open ? close() : setOpen(true))}
      >
        {name}
        {value ? (
          <>
            <span class="t-3">:</span> {cur?.label ?? value}
            <span
              class="x"
              role="presentation"
              title={`Clear the ${name.toLowerCase()} filter`}
              onClick={(e) => {
                e.stopPropagation();
                onChange(null);
              }}
            >
              ×
            </span>
          </>
        ) : null}
      </button>
      {open ? (
        <div class="menu" onKeyDown={onKey}>
          {typeahead ? (
            <input
              ref={input}
              class="menu-input"
              placeholder={`Type to narrow ${options.length.toLocaleString("en-US")} ${name.toLowerCase()}s`}
              value={text}
              aria-controls={id}
              aria-activedescendant={shown[active] ? `${id}-${active}` : undefined}
              onInput={(e) => {
                setText((e.target as HTMLInputElement).value);
                setActive(0);
              }}
            />
          ) : null}
          <ul ref={list} id={id} role="listbox" aria-label={name} tabIndex={typeahead ? -1 : 0} aria-activedescendant={shown[active] ? `${id}-${active}` : undefined}>
            {shown.map((o, i) => (
              <li
                key={o.value}
                id={`${id}-${i}`}
                data-i={i}
                role="option"
                aria-selected={o.value === value ? "true" : "false"}
                class={i === active ? "active" : undefined}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(o)}
              >
                <span>{o.label}</span>
                {o.count != null ? <span class="num t-3">{o.count.toLocaleString("en-US")}</span> : null}
              </li>
            ))}
            {!shown.length ? <li class="t-3 none">Nothing matches</li> : null}
          </ul>
        </div>
      ) : null}
    </span>
  );
}
