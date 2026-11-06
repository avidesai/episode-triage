import { useEffect, useRef } from "preact/hooks";
import { cmdK, helpOpen, SHORTCUTS } from "../keys";

/** The "?" sheet: every key, grouped as in the behavior spec. */
export function ShortcutSheet() {
  const open = helpOpen.value;
  const dlg = useRef<HTMLDialogElement>(null);
  const opener = useRef<Element | null>(null);

  useEffect(() => {
    const d = dlg.current;
    if (!d) return;
    if (open && !d.open) {
      opener.current = document.activeElement;
      d.showModal();
    } else if (!open && d.open) {
      d.close();
      const o = opener.current;
      if (o instanceof HTMLElement) o.focus();
    }
  }, [open]);

  return (
    <dialog
      ref={dlg}
      class="sheet"
      aria-labelledby="sheet-h"
      onClose={() => (helpOpen.value = false)}
      onKeyDown={(e) => {
        if (e.key === "?") {
          e.preventDefault();
          helpOpen.value = false;
        }
      }}
      onClick={(e) => {
        if (e.target === dlg.current) helpOpen.value = false;
      }}
    >
      <div class="sheet-box">
        <div class="sheet-head">
          <h2 id="sheet-h" class="h2">
            Keyboard
          </h2>
          <button type="button" class="btn" style="height:28px" onClick={() => (helpOpen.value = false)}>
            Close <span class="kbd">Esc</span>
          </button>
        </div>
        <div class="sheet-cols">
          {SHORTCUTS.map((g) => (
            <section key={g.group}>
              <h3 class="lbl">{g.group}</h3>
              <dl>
                {g.keys.map(([keys, what]) => (
                  <div key={what}>
                    <dt>
                      {keys.map((k, i) => (
                        <>
                          {i ? <span class="t-3"> {keys[0] === "g" ? "then" : ""} </span> : null}
                          <span class="kbd">{k === "⌘K" ? cmdK : k}</span>
                        </>
                      ))}
                    </dt>
                    <dd>{what}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </div>
    </dialog>
  );
}
