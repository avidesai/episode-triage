import { render } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { ErrorBox, Skeleton } from "./components/bits";
import { data, dataLoad, live, liveStatus, loadData, startLive } from "./data";
import { num } from "./format";
import { SHORTCUTS, helpOpen, installKeys } from "./keys";
import { href, route } from "./router";
import { Fleet } from "./routes/Fleet";
import { Inbox } from "./routes/Inbox";
import { Live } from "./routes/Live";
import { About, How, Trust } from "./routes/Reference";
import { setTheme, theme } from "./state";
import "./styles/tokens.css";
import "./styles/app.css";

const TABS: [string, string, string][] = [
  ["inbox", "Inbox", "Inbox"],
  ["fleet", "Fleet", "Fleet"],
  ["live", "Live", "Live"],
  ["how", "How it decides", "How"],
  ["trust", "Trust", "Trust"],
  ["about", "About", "About"],
];

function LiveDot() {
  const st = liveStatus.value;
  const label = st === "connected" ? `Live: ${live.value?.robot_id ?? ""}` : st === "lost" ? "Live: connection lost" : "No monitor connected";
  return <span class={`dot ${st}`} role="img" aria-label={label} title={label} />;
}

function TopBar() {
  const d = data.value;
  const cur = route.value.path[0];
  const t = theme.value;
  const nextTheme = t === "system" ? "light" : t === "light" ? "dark" : "system";
  return (
    <header class="topbar">
      <a class="brand" href={href(["inbox"])} aria-label="Triage, go to the inbox">
        <span class="logo" aria-hidden="true" />
        Triage
      </a>
      {d ? (
        <span class="fleet-badge" title={`${d.fleet.name}, ${d.fleet.dataset}`}>
          <span class="fb-long">
            {num(d.fleet.robots)} arms · {num(d.fleet.runs)} runs · {d.fleet.hours} h
          </span>
          <span class="fb-short">{num(d.fleet.robots)} arms</span>
        </span>
      ) : null}
      <nav class="tabs" aria-label="Main">
        {TABS.map(([k, l]) => (
          <a key={k} href={href([k])} class={cur === k ? "on" : ""} aria-current={cur === k ? "page" : undefined}>
            {l}
            {k === "live" ? <LiveDot /> : null}
          </a>
        ))}
      </nav>
      <span class="spacer" />
      <span class="phone-live">
        <LiveDot />
      </span>
      <button class="btn icon ghost" onClick={() => setTheme(nextTheme)} aria-label={`Theme: ${t}. Switch to ${nextTheme}`} title={`Theme: ${t}`}>
        {t === "dark" ? "☾" : t === "light" ? "☀" : "◐"}
      </button>
      <button class="btn icon ghost kbd-btn" onClick={() => (helpOpen.value = true)} aria-label="Keyboard shortcuts" title="Keyboard shortcuts (?)">
        ?
      </button>
    </header>
  );
}

function BottomTabs() {
  const cur = route.value.path[0];
  return (
    <nav class="bottom-tabs" aria-label="Main">
      {TABS.map(([k, , s]) => (
        <a key={k} href={href([k])} class={cur === k ? "on" : ""} aria-current={cur === k ? "page" : undefined}>
          <span>{s}</span>
          {k === "live" && liveStatus.value !== "none" ? <LiveDot /> : null}
        </a>
      ))}
    </nav>
  );
}

function Help() {
  const ref = useRef<HTMLDialogElement>(null);
  const open = helpOpen.value;
  useEffect(() => {
    const dlg = ref.current;
    if (!dlg) return;
    if (open && !dlg.open) dlg.showModal?.();
    if (!open && dlg.open) dlg.close();
  }, [open]);
  return (
    <dialog ref={ref} class="help" onClose={() => (helpOpen.value = false)} aria-label="Keyboard shortcuts">
      <div class="help-head">
        <h2>Keyboard shortcuts</h2>
        <button class="btn icon" aria-label="Close" onClick={() => (helpOpen.value = false)}>
          ×
        </button>
      </div>
      <dl>
        {SHORTCUTS.map(([k, v]) => (
          <div key={k}>
            <dt>
              <kbd>{k}</kbd>
            </dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
    </dialog>
  );
}

function Screen() {
  const ld = dataLoad.value;
  const p = route.value.path[0];
  useEffect(() => {
    const names: Record<string, string> = { inbox: "Inbox", fleet: "Fleet", how: "How it decides", trust: "Trust", about: "About" };
    if (p !== "live") document.title = names[p] ? `${names[p]} · Triage` : "Triage";
  }, [p]);
  if (p === "live") return <Live />;
  if (ld.state === "error")
    return (
      <div class="page">
        <ErrorBox title="Could not load data.json" detail={ld.error} retry={loadData} />
      </div>
    );
  if (ld.state === "loading")
    return (
      <div class="page wide">
        <Skeleton rows={14} />
      </div>
    );
  switch (p) {
    case "fleet":
      return <Fleet />;
    case "how":
      return <How />;
    case "trust":
      return <Trust />;
    case "about":
      return <About />;
    default:
      return <Inbox />;
  }
}

function App() {
  return (
    <>
      <a class="skip" href="#main" onClick={(e) => { e.preventDefault(); document.getElementById("main")?.focus(); }}>
        Skip to content
      </a>
      <TopBar />
      <main id="main" tabIndex={-1}>
        <Screen />
      </main>
      <BottomTabs />
      <Help />
    </>
  );
}

installKeys();
loadData();
startLive();
render(<App />, document.getElementById("app")!);
