import { data, liveStatus } from "../data";
import { num } from "../format";
import { cmdK, paletteOpen } from "../keys";
import { href, route } from "../router";
import { setTheme, theme, type Theme } from "../state";
import { IconFleet, IconLadder, IconLive, IconQueue, IconSearch, IconTheme } from "./icons";

export const Brand = ({ label }: { label?: string }) => (
  <a class="brand" href={href([])} aria-label={label}>
    <span class="mark" aria-hidden="true">
      <i />
      <i />
      <i />
      <i />
    </span>
    {label ? null : "Triage"}
  </a>
);

const NEXT: Record<Theme, Theme> = { system: "light", light: "dark", dark: "system" };

/** Sidebar wider than 1100 px; the CSS turns the same element into the top bar below that. */
export function Sidebar() {
  const d = data.value;
  const r = route.value;
  const at = r.path[0] ?? "";
  const cur = (k: string) => (k === at || (k === "fleet" && at === "arm") ? "page" : undefined);
  const docCur = (k: string) => (at === "docs" && r.path[1] === k ? "page" : undefined);
  const ls = liveStatus.value;

  return (
    <aside class="side">
      <Brand />
      <button class="cmdk" type="button" aria-label="Jump to an arm, problem or rule" onClick={() => (paletteOpen.value = true)}>
        <IconSearch />
        <span class="txt" style="flex:1;text-align:left">
          Jump to anything
        </span>
        <span class="kbd">{cmdK}</span>
      </button>
      <div class="nav-group primary">
        <nav class="nav" aria-label="Main">
          <a href={href([])} aria-current={cur("")}>
            <IconLadder />
            Ladder
          </a>
          <a href={href(["queue"])} aria-current={cur("queue")}>
            <IconQueue />
            Queue{d ? <span class="count">{num(d.incidents.length)}</span> : null}
          </a>
          <a href={href(["fleet"])} aria-current={cur("fleet")}>
            <IconFleet />
            Fleet{d ? <span class="count">{num(d.fleet.robots)}</span> : null}
          </a>
          <a href={href(["live"])} aria-current={cur("live")}>
            <IconLive />
            Live
            {ls === "connected" ? (
              <span class="count" style="color:var(--r1-text)">
                connected
              </span>
            ) : ls === "lost" ? (
              <span class="count" style="color:var(--cause-text)">
                lost
              </span>
            ) : (
              <span class="count">no monitor</span>
            )}
          </a>
        </nav>
      </div>
      <div class="nav-group">
        <span class="lbl">Docs</span>
        <nav class="nav" aria-label="Docs">
          <a href={href(["docs", "decides"])} aria-current={docCur("decides")}>
            How it decides
          </a>
          <a href={href(["docs", "trust"])} aria-current={docCur("trust")}>
            How much to trust it
          </a>
          <a href={href(["docs", "about"])} aria-current={docCur("about")}>
            About
          </a>
        </nav>
      </div>
      <button class="theme-toggle" type="button" onClick={() => setTheme(NEXT[theme.value])} aria-label={`Theme: ${theme.value}. Change theme`}>
        <IconTheme />
        Theme: {theme.value}
      </button>
      {d ? (
        <div class="scope">
          <span style="color:var(--text);font-weight:500">{d.fleet.name}</span>
          <span class="mono">
            {num(d.fleet.robots)} arms · {num(d.fleet.runs)} runs
          </span>
          <span class="mono">{d.fleet.hours} h recorded</span>
        </div>
      ) : null}
    </aside>
  );
}
