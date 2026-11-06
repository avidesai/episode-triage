import { useState } from "preact/hooks";

/** A command on the inverse surface with a Copy button that says "Copied" for 2 s. */
export function CopyBlock({ text, style }: { text: string; style?: string }) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const r = document.createRange();
      const code = document.querySelector(`[data-copy="${CSS.escape(text)}"]`);
      if (code) {
        r.selectNodeContents(code);
        const sel = getSelection();
        sel?.removeAllRanges();
        sel?.addRange(r);
      }
    }
    setDone(true);
    setTimeout(() => setDone(false), 2000);
  };
  return (
    <div class="copy" style={style}>
      <code data-copy={text}>{text}</code>
      <button type="button" onClick={copy}>
        {done ? "Copied" : "Copy"}
      </button>
      <span class="sr" aria-live="polite">
        {done ? "Copied to the clipboard" : ""}
      </span>
    </div>
  );
}
