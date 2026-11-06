# web: the triage viewer

Source for the viewer in `../docs`. Preact and TypeScript, built with Vite into static files that
GitHub Pages and `triage serve` both serve as they are. The screens, tokens, components and the
decisions behind them are in [DESIGN.md](DESIGN.md).

## Commands

```bash
cd web
npm install          # once
npm run dev          # http://localhost:5173, reads data from ../docs
npm run check        # type check only
npm test             # unit tests for the words and number formats
npm run build        # type check, test, then write ../docs/index.html and ../docs/assets/
```

`npm run dev` serves `../docs` as its public folder, so `data.json`, `fleet.json`, `incidents/`
and `live/` load exactly as in production. Run `triage replay` in another terminal and the Live
screen picks it up.

To refresh the rehearsal the no monitor page plays, run a replay into `../docs` and then
`node scripts/live-sample.mjs`.

## Publish

From the repo root:

```bash
.venv/bin/triage report          # rebuild docs/data.json, docs/fleet.json, docs/incidents/
(cd web && npm run build)        # rebuild docs/index.html and docs/assets/
git add docs && git commit && git push
```

Pages serves `/docs` on `main`; the built files are committed, so there is no Actions step. The
build deletes only `docs/assets/` (and the old `docs/app.js`) before writing; it never touches
the engine's files.

## Rules the code keeps

- Every number on screen comes from `data.json`, `fleet.json`, a bundle or the live feed. None is
  typed into the markup.
- Counts with their N, never rates.
- Arms are numbers. Dataset ids never reach the page.
- Engine text (routes, trace lines, rules, checks) is shown verbatim.
- Status, notes and "your call" live in this browser's localStorage and say so wherever they
  appear.
- No requests leave the site: fonts are self hosted, no scripts or analytics from anywhere else.
