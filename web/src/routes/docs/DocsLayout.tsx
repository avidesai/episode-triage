import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";

/** Docs page: sticky "On this page" column marking the section in view, prose on the right. */
export function DocsLayout({
  title,
  intro,
  toc,
  children,
  wide,
}: {
  title: string;
  intro?: ComponentChildren;
  toc: [string, string][];
  children: ComponentChildren;
  wide?: boolean;
}) {
  const [cur, setCur] = useState(toc[0]?.[0] ?? "");
  useEffect(() => {
    document.title = `${title.replace(/^About Triage$/, "About")} · Triage`;
    const els = toc.map(([id]) => document.getElementById(id)).filter((e): e is HTMLElement => !!e);
    const seen = new Map<string, boolean>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) seen.set(e.target.id, e.isIntersecting);
        const first = toc.find(([id]) => seen.get(id));
        if (first) setCur(first[0]);
      },
      { rootMargin: "0px 0px -60% 0px" },
    );
    els.forEach((e) => io.observe(e));
    return () => io.disconnect();
  }, [title]);
  const jump = (e: MouseEvent, id: string) => {
    e.preventDefault();
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ block: "start" });
      el.tabIndex = -1;
      el.focus({ preventScroll: true });
      setCur(id);
    }
  };
  return (
    <main class="main" id="main" style="max-width:1240px">
      <div class="docs">
        <nav class="docs-toc" aria-label="On this page">
          <span class="lbl" style="padding:0 10px 6px">
            On this page
          </span>
          {toc.map(([id, label]) => (
            <a key={id} href={`#${id}`} aria-current={cur === id ? "true" : undefined} onClick={(e) => jump(e, id)}>
              {label}
            </a>
          ))}
        </nav>
        <article class="prose" style={wide ? "max-width:880px" : undefined}>
          <div style="display:flex;flex-direction:column;gap:8px">
            <span class="lbl">Docs</span>
            <h1 class="h1" style="font-size:28px">
              {title}
            </h1>
            {intro ? <p>{intro}</p> : null}
          </div>
          {children}
        </article>
      </div>
    </main>
  );
}
