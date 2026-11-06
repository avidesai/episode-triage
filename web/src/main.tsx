import { render } from "preact";
import "./styles/fonts.css";
import "./styles/tokens.css";
import "./styles/components.css";
import "./styles/app.css";

function App() {
  return (
    <div class="app">
      <main class="main main-wide">
        <a class="brand" href="#/">
          <span class="mark" aria-hidden="true"><i /><i /><i /><i /></span>Triage
        </a>
      </main>
    </div>
  );
}

render(<App />, document.getElementById("app")!);
