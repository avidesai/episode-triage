import { signal } from "@preact/signals";

interface ToastMsg {
  id: number;
  text: string;
  sub: string;
  undo?: () => void;
}

const current = signal<ToastMsg | null>(null);
let timer = 0;
let seq = 0;

/** Show a toast for 6 s; a new one replaces the old. */
export function toast(text: string, sub: string, undo?: () => void): void {
  clearTimeout(timer);
  current.value = { id: ++seq, text, sub, undo };
  timer = window.setTimeout(() => (current.value = null), 6000);
}

export function ToastHost() {
  const t = current.value;
  return (
    <div class="toast-host" role="status" aria-live="polite">
      {t ? (
        <div class="toast" key={t.id}>
          {t.text} <span style="opacity:.7">· {t.sub}</span>
          {t.undo ? (
            <button
              type="button"
              onClick={() => {
                t.undo!();
                clearTimeout(timer);
                current.value = null;
              }}
            >
              Undo
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
