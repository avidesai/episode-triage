# Triage viewer: design notes

The viewer in `../docs`, built from this folder. Every failure in a robot fleet lands on one of
four rungs by who should fix it; the app is built around that ladder.

## Point of view

- **The ladder is the product.** Rung 1 the robot can clear it, 2 ticket for a named part, 3 send
  to training, 4 a person has to look. It is a set of destinations, not a severity scale.
- **Rung is shown by position**: a four cell mark with one cell lit. Color only confirms it, so the
  mark reads in grayscale. Rung 4 is outlined and dashed, never red, never filled solid.
- **Red means one thing**: the cause band on a timeline and the threshold it crossed (plus the
  cause trace number, the evidence threshold tick and the error card border).
- **Problem first, engine sentence second.** Titles are the problem in plain words; the engine's
  own sentence (`route`) is always shown verbatim in mono.
- **Every count carries its denominator.** No rates anywhere.

## Screens and routes

Hash routes, so the same files work on GitHub Pages under a subpath and on `triage serve`.

| Route | Screen | Shell |
|---|---|---|
| `#/` | Ladder: four lanes, what it found, start here | sidebar |
| `#/queue` | Queue: problems (default) or incidents, filters, selected incident pane wider than 1100 px. Query: `view`, `rung`, `layer`, `arm`, `rule`, `status`, `q`, `open`, `sel` | sidebar |
| `#/i/<id>` | Incident: verdict, who fixes it, signals, trace, evidence, coverage, status | crumbs bar |
| `#/fleet` | Fleet: joint and camera findings, arm table. Query: `show`, `q` | sidebar |
| `#/arm/<id>` | Arm: counts, runs strip, recurring problems, bundled incidents | sidebar |
| `#/live` | Live: connection bar, arrival stream, large detail; no monitor page. Query: `sel` | connection bar |
| `#/docs/decides`, `trust`, `about` | Docs with an "On this page" column | sidebar |

Old links redirect in `router.ts` (`#/inbox`, `#/inbox/i/<id>`, `#/fleet/<arm>`, `#/live/i/<id>`,
`#/how`, the old single page `#inc=` links and section anchors). Unknown routes go to `#/`.

The sidebar becomes a top bar below 1100 px and a sideways scrolling nav row on phones (600 px and
below). Live and Incident carry their own top bar and no sidebar.

## Tokens, type, components

- `src/styles/tokens.css` and `src/styles/components.css` are the design's `triage.css` ported
  as it is: the two theme blocks (plus the dark values applied under `prefers-color-scheme` when no
  theme is chosen), then every component class and both media queries unchanged. Do not edit them;
  shell only rules go in `src/styles/app.css` (palette, shortcut sheet, toast, skip link, filter
  menus, a few layout fixes).
- Fonts are self hosted in `src/assets/fonts/`: Inter 400 to 700 and JetBrains Mono 400 to 600,
  static weights subset to the Latin glyphs the app uses (77 KB for all seven). Each face covers
  its hundred, so the CSS's 550 and 650 use the 500 and 600 files, as in the design. OFL licenses
  sit beside them.
- Components in `src/components/` emit the design's markup and class names: `RungMark`, `RungTag`,
  `LadderBar`, `Seg`, `Filter`, `Kbd`, `StatusControl`, `Toast`, `CopyBlock`, `States` (empty,
  error, skeleton), `Sidebar`, `Palette`, `ShortcutSheet`, `Lane`, `Stat`, `ProblemRow`,
  `IncidentRow`, `QueuePane`, `Signals` and `TimelinePanel` (the chart), `Trace`, `FleetBits`
  (split bar, runs strip, lag histogram). Buttons, cards and chips are plain classes.

## Data

Everything on screen comes from the engine's files: `data.json` at boot, `fleet.json` on Fleet and
Arm, `incidents/<id>.json` per incident, `live/data.json` polled every 2 s (never on github.io).
Client side derived values live in `src/derive.ts` (lanes, start here, problem groups, queue
order, arm verdicts) and the words from ids in `src/format.ts` (`partWords`, `splitLabel`,
`displayTitle`), unit tested in `src/format.test.ts`.

Two fields were added to the engine's output, both restating what it already computed:
`incidents[].co_faults` in `data.json` (the standing faults rule R5 cited) and `label`,
`component`, `fix_by` on live rows. If `co_faults` is missing the client parses the route.

The no monitor page plays a rehearsal from `src/sample/live-sample.json`, a copy of a real replay
of arm 1174 made by `node scripts/live-sample.mjs` after `triage replay ... --site docs`. It ships
as its own chunk and loads only on that page, so "Play it" works on the published copy too, where
`live/` never exists.

## Local state

Status, notes, the rung 4 "your call", theme and recently opened items live in this browser's
`localStorage` (`triage.workflow.v1`, `triage.call.v1`, `triage.theme`, `triage.recent.v1`),
every access guarded. Every place they appear says "Saved in this browser only", or "Not saved:
this browser blocks site storage" when storage is blocked.

## Decisions made while building

- **Queue opens one problem by default** (the first in the current sort), not every problem as the
  design tool drew. Open problems live in the `open` query value.
- **Incidents with no inbox problem** (82 today) appear as extra groups after the inbox problems,
  so every incident is reachable from the Problems view; they don't change the problem counts.
- **Charts share one clock**: every panel uses the visible range, including the lower panels on a
  zoomed camera cause. A joint that did not move in the window is named in a footer note.
- **Camera panels**: at most two besides a camera focus panel, chosen by the most picture change in
  range. On `arm 0159-r2-2` that picks the side camera where the design drew the top camera.
- **A short clip** opens "Around the failure" only for a cause; stalls open on the whole clip, as
  the design shows.
- **Rung 4 column tint** in the ladder matrix only where a rule lands, as the screenshot shows.
- **Fleet table** lists every arm with something on it, 100 at a time with "Show 100 more".
- **Live demo**: "Replay the demo" and "Play it" replay rows in the page at half their wall
  spacing; nothing is written. Real feeds show real `wall` times.
- **Filters on phones** keep the 30 px look; their touch target grows to 44 px invisibly.
- **Gripper captions** describe what the series does ("Opened, then closed again") where the
  design's sample text did not match the data.

## Build

`npm run build` type checks, runs the format tests, removes only `../docs/assets/` (and the old
`../docs/app.js`), and writes `../docs/index.html` and `../docs/assets/`. Fleet, Arm, Live and Docs
are separate chunks.
