import { render, type ComponentType } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import "./styles/fonts.css";
import "./styles/tokens.css";
import "./styles/components.css";
import "./styles/app.css";
import { dataLoad, loadData, startLive } from "./data";
import { chordPending, installKeys } from "./keys";
import { pathKey, route } from "./router";
import { Palette } from "./components/Palette";
import { ShortcutSheet } from "./components/ShortcutSheet";
import { Sidebar } from "./components/Sidebar";
import { DataError, Skel } from "./components/States";
import { ToastHost } from "./components/Toast";
import { Ladder } from "./routes/Ladder";
import { Queue } from "./routes/Queue";
import { Incident } from "./routes/Incident";

// The shell: sidebar (top bar below 1100 px) for Ladder, Queue, Fleet, Arm and Docs; Incident and
// Live carry their own top bar. Fleet, Arm, Live and Docs load as separate chunks.

type Mod = Record<string, ComponentType<any>>;
function lazy(load: () => Promise<Mod>, name: string): ComponentType<any> {
  let cached: ComponentType<any> | null = null;
  return function Lazy(props: any) {
    const [C, setC] = useState<ComponentType<any> | null>(() => cached);
    const [err, setErr] = useState(false);
    useEffect(() => {
      if (cached) return;
      load()
        .then((m) => {
          cached = m[name];
          setC(() => cached);
        })
        .catch(() => setErr(true));
    }, []);
    if (err)
      return (
        <main class="main main-wide" id="main">
          <DataError onRetry={() => location.reload()} />
        </main>
      );
    return C ? <C {...props} /> : <PageSkeleton />;
  };
}

const Fleet = lazy(() => import("./routes/Fleet"), "Fleet");
const Arm = lazy(() => import("./routes/Arm"), "Arm");
const Live = lazy(() => import("./routes/Live"), "Live");
const Docs = lazy(() => import("./routes/docs/Docs"), "Docs");

function PageSkeleton() {
  return (
    <main class="main main-wide" id="main" aria-busy="true">
      <div style="display:flex;flex-direction:column;gap:10px">
        <Skel h={24} w="40%" />
        <Skel h={12} w="70%" />
      </div>
      <Skel h={240} style="border-radius:12px" />
    </main>
  );
}

function Screen() {
  const r = route.value;
  const [a, b] = r.path;
  const dl = dataLoad.value;
  const needsData = a !== "live";
  if (needsData && dl.state === "error") {
    const err = (
      <main class="main main-wide" id="main">
        <DataError onRetry={loadData} />
      </main>
    );
    return a === "i" ? err : <Sidebared>{err}</Sidebared>;
  }
  switch (a) {
    case undefined:
      return (
        <Sidebared>
          <Ladder />
        </Sidebared>
      );
    case "queue":
      return (
        <Sidebared>
          <Queue />
        </Sidebared>
      );
    case "i":
      return <Incident id={b} />;
    case "fleet":
      return (
        <Sidebared>
          <Fleet />
        </Sidebared>
      );
    case "arm":
      return (
        <Sidebared>
          <Arm id={b} />
        </Sidebared>
      );
    case "live":
      return <Live />;
    case "docs":
      return (
        <Sidebared>
          <Docs page={b} />
        </Sidebared>
      );
    default:
      return null;
  }
}

const Sidebared = ({ children }: { children: any }) => (
  <div class="app">
    <Sidebar />
    {children}
  </div>
);

function App() {
  const key = pathKey(route.value);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    window.scrollTo(0, 0);
    // Move focus to the page title so screen readers announce the new page.
    requestAnimationFrame(() => {
      const h = document.querySelector<HTMLElement>("#main h1, main h1, h1");
      if (h) {
        h.tabIndex = -1;
        h.focus({ preventScroll: true });
      }
    });
  }, [key]);

  return (
    <>
      <a class="skip" href="#main" onClick={(e) => {
        e.preventDefault();
        const m = document.getElementById("main");
        if (m) {
          m.tabIndex = -1;
          m.focus();
        }
      }}>
        Skip to content
      </a>
      <Screen />
      <Palette />
      <ShortcutSheet />
      <ToastHost />
      {chordPending.value ? (
        <div class="chord" aria-hidden="true">
          g…
        </div>
      ) : null}
    </>
  );
}

installKeys();
loadData();
startLive();
render(<App />, document.getElementById("app")!);
