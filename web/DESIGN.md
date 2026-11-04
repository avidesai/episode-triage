# Triage: front end design

This is the design for the viewer under `docs/`: a static web app for triaging failures from a
robot fleet. It replaces the single long page (`docs/index.html` and `docs/app.js`) with an
internal tool made of a queue, an incident view, a fleet view, a live monitor and reference
pages. The engine, the results and every number stay as they are. The app reads the same JSON
the old page read, plus a few derived fields listed in section 6.

## 1. What I looked at first

- The current page at 1280 and 390 wide, with an incident open, and the live section while
  `triage replay` streamed runs 58 and 57 of the rehearsal dataset. The replay produced 5
  incidents in about 35 s: a camera freeze the robot can clear, the same camera escalated to a
  ticket after 4 freezes (it carries `supersedes`), a stall caused by that camera, a stall sent
  to training, and one empty close.
- What carries over: the content, the evidence map (`EVID` in `app.js`), the band rules in
  `bandsFor()`, the timeline layout in `timeline()`, the 2 s live poll.
- What doesn't: one scrolling document, the problem list as paragraphs, the incident opening
  far below the row that was clicked, and a timeline drawn in a fixed viewBox, so its text is
  19 px on a laptop and 10 px on a phone.

## 2. Information architecture

Six destinations. Hash routes, so the same files work on GitHub Pages under
`/episode-triage/` and on `triage serve` with no server rules. Every view state that someone
might want to share or come back to lives in the URL; per viewer workflow state lives in
`localStorage`.

| Route | Screen |
|---|---|
| `#/inbox` | Inbox, incidents table (home; empty hash redirects here) |
| `#/inbox?group=problem` | Inbox grouped by problem type |
| `#/inbox?rung=2&layer=actuation&fix=ticket&arm=arm%200159&rule=R5&q=wrist&status=open&sort=arm` | any filter, search and sort combination |
| `#/inbox/i/<incident id>` | Inbox with that incident open in the detail pane (query kept) |
| `#/fleet` | Fleet: summary tiles and the arms table |
| `#/fleet/<arm id>` | One arm: its incidents and their spread across runs |
| `#/live` | Live monitor; `#/live/i/<id>` with an incident pinned open |
| `#/how` | How it decides: checks, ladder, thresholds |
| `#/trust` | How much to trust it: injected fault validation, physical arm table |
| `#/about` | What it is, its limits, what to record, running it on your own logs |

Old links of the form `#inc=incidents/<id>.json` (the current page's format, possibly already
sent) redirect to `#/inbox/i/<id>`. Old section anchors (`#how`, `#trust`, `#about`, `#live`,
`#inbox`) redirect to their new routes.

### Shell

- **Desktop and tablet (720 px and up):** a 44 px top bar. Left: product name "Triage" and the
  fleet badge (`1,427 arms · 48,208 runs · 241.4 h`, from `data.fleet`). Center: tabs Inbox,
  Fleet, Live, How it decides, Trust, About. Right: live status dot (gray when no monitor, green
  when `live/data.json` answers) and a shortcuts button (`?`).
- **Phone (under 720 px):** a 44 px top bar with the product name and fleet badge, and a bottom
  tab bar with Inbox, Fleet, Live, How, and More (Trust and About). Tabs are 44 px touch
  targets. Safe area insets respected.
- No left sidebar: at the widths this will be shared at (a browser beside two terminals, so
  roughly 700 to 900 px) a sidebar costs a column the queue needs.

## 3. Screens

### 3.1 Inbox (home)

**What it shows.** A toolbar, then the queue.

- Toolbar row 1: search box (placeholder "Search arm, joint, camera, rule"), view toggle
  `Incidents | By problem`, count line ("312 of 753 incidents" with the active filters).
- Toolbar row 2, filter chips, each a menu of options with counts from the current data:
  Rung (1 to 4, named), Layer (camera and timing, joints, task), Fix by (robot, ticket,
  training, person), Arm (typeahead over arm ids), Rule (R0 to R6), Status (open, which is new
  plus acknowledged; new; acknowledged; resolved). Active chips show their value and an x to
  clear. "Clear all" when any is set.
- **Incidents view** (default): one row per incident in `data.incidents`. Columns:
  status mark, Rung (badge), What happened (`route`, one line, ellipsis, full text on hover and
  in the pane), Fix by, Arm, Run, At (seconds into the run, tabular), Source (video sample or
  joint pass), Problem (the plain label of its fingerprint). Every header sorts; second click
  reverses; sort lives in the URL. Default sort: problem priority (the inbox ranking), then rung
  descending, then arm, so the top of the queue is the most widespread problem.
- **By problem view**: the 38 rows of `data.inbox` in priority order. Columns: Rung, Problem
  (`label`), Fix by, Arms, Runs, Count, recurring marker, Scope. Clicking a row expands it in
  place to its bundled incidents (same row format as the incidents view, indented). A problem
  with no bundled clip says so in its expanded row.
- Status marks per incident, stored only in this browser: new (filled dot), acknowledged
  (ring), resolved (check, row dimmed). A banner above the table the first time any mark is
  set: "Status and notes are saved in this browser only." Default is everything new; nothing
  is pre marked.

**What each click does.**

- Row click or Enter: opens the incident in the detail pane and puts its id in the URL. On
  desktop the table narrows and stays scrollable, with the selected row highlighted. On phone
  the pane is a full screen sheet with a back button; the browser back button closes it.
- Arm cell: adds the arm filter. Rung badge: adds the rung filter. Problem cell: switches to
  the problem view with that row expanded.
- Rule counts linked from How it decides land here with `rule=` set.

**Keyboard.** `j` / `k` move the selection, `Enter` opens, `Esc` closes the pane (or clears the
search when it has focus), `/` focuses search, `a` acknowledge, `r` resolve, `u` back to new,
`n` edit note, `[` and `]` previous and next incident while the pane is open, `g` then `i`,
`f`, `l`, `h` jump to Inbox, Fleet, Live, How. `?` shows the list. Shortcuts are ignored while
typing in a field.

**States.** Loading: the shell and the toolbar render at once, with 12 skeleton rows.
Error: "Could not load data.json" with the HTTP status and a retry button. Empty filter
result: "No incidents match these filters" with a Clear filters button. Empty search: same,
naming the search text.

**Phone layout.** Rows become two line cards: rung badge and route (two lines, clamped) on
top; arm, run, time and fix by below in the muted color. The filter chips wrap onto a second
line instead of moving into a sheet: six chips fit in two rows at 390 px, and a sheet would hide
which filters are on. No table scrolls sideways. The switch to cards is a container query on the
table, so the same thing happens on desktop when the detail pane leaves the list narrow.

### 3.2 Incident detail

Same component in the Inbox pane, the Fleet arm view and Live.

- **Header:** rung badge with rung name, route as the title (wraps), then a meta line:
  rule, fix by, arm (link to Fleet), run, at N s, source. "Robot can try: ..." in its own
  line when `self_recovery` is set. Coverage line built from `coverage`: "Checked joints and
  wrist, side, top cameras" or "Checked joints only; not checked: top camera". "Escalated from
  an earlier verdict" with a link when `supersedes` is set. Status control (new, acknowledged,
  resolved) and a one line note field, both labeled "this browser only". Previous and next
  buttons (follow the current filtered sort order). Close button.
- **Timeline:** one panel per joint in the clip (command dashed, position solid, percent of
  range) and per camera (picture change as a line, arm motion as a soft band behind it). Bands:
  red what started it (`cause` plus `related`), blue what a person would have been called for
  (`anchor`), gray context, green injected truth. A cause longer than 80% of the clip gets no
  band and a note instead, exactly as now. Legend above, showing only the band kinds present.
  Zoom toggle `Whole clip | Around the failure`. The bundled clip already is the evidence
  window (`window_abs`), so the useful zoom is tighter: 1.5 s either side of the cause, anchor
  and truth bands. The toggle only appears when that is meaningfully narrower than the clip. Drawn as SVG at the container's real pixel width (ResizeObserver), so labels stay
  11 px at every width. Hover or touch shows a vertical cursor with the time and each series
  value at that moment.
- **Why this verdict:** `incident.trace` as a numbered list.
- **Evidence:** table of every event in the window: what fired (plain name, component,
  confidence when not high), when (start, duration), measured, threshold. Ported from `EVID`,
  one row per measured quantity. Low confidence frozen camera events stay hidden behind a count
  line, as now, with a "show" toggle.
- **Cause, context and related:** short lists under the evidence when present, each event with
  its time; clicking one highlights its band.
- **Raw bundle:** link to the JSON file.
- **States:** loading skeleton in the pane; "Could not load this incident" with retry; "No
  signal clip for this incident (the run failed an integrity check)" when `clip.t` is empty.

### 3.3 Fleet

- **Summary tiles** (counts with their N, never rates), all from `data.findings` and
  `data.fleet`: arms, runs, hours; arms with a joint or calibration ticket (197 of 1,427);
  runs where a camera froze while the arm moved (58 of 809 sampled); arms with a camera
  running 3 or more frames late (40 of the 274 where lag was measured); stalls that began with a
  camera or joint fault (4 of 355). Each tile links to the filtered inbox or arms table it
  summarizes, when one exists.
- **Arms table** (1,427 rows, from the new `fleet.json`, section 6): Arm, Runs, then incident
  counts by rung in two groups, "Cameras and joints, all runs" (rungs 1, 2, 4 as they occur) and
  "Task, sampled runs" (rungs 1, 3, 4; a quiet dot where cameras weren't sampled), then Data
  (integrity problems), Recurring (problems seen 3 or more times on the arm, hover lists them),
  Lag (median frames for the arm's slowest camera), Latest run with an incident, Clips (bundled
  incidents). The columns come from the data, not a fixed list. Sort on every column; default by
  joint and calibration tickets. Search by arm number. Filter chips with counts: has a joint or
  calibration ticket, camera 3 or more frames late, cameras sampled, has a recurring problem, has
  clips. On a phone the table scrolls inside its own box with the arm column pinned; the page
  itself never scrolls sideways.
- **Arm view** (`#/fleet/<arm>`): header with the arm's counts; a strip chart with runs on x
  and one dot per incident, colored by rung, so clusters across runs are visible; the arm's
  bundled incidents as the same table as the inbox, opening the same detail pane. A note when
  the arm has incidents in the ledger but none bundled ("counted in the joint pass, no clip
  bundled").
- **States:** loading skeleton; fleet.json missing: the tiles still render from data.json and
  the table says "Arm table not built; run `triage report`".

### 3.4 Live

The screen that gets shared on the call.

- **Status bar:** connection state from polling `live/data.json` every 2 s. Three states:
  "No monitor connected" (file absent or unreadable), "Connected" with the robot id and "last
  update N s ago" from `generated_at`, and "Connection lost" when a previously working poll
  fails 3 times in a row. Incident count by rung for this session.
- **Stream:** incidents newest first. Each row: rung badge, route, time into the monitor
  session, injected truth when present ("injected: camera freeze on top"), "escalated" tag when
  it supersedes an earlier row, and the earlier row dimmed with "superseded". A row that arrived
  since the last poll gets a highlighted background that fades over 8 s and a "new" tag, plus
  a count in the browser tab title.
- **Detail:** the newest incident opens automatically in the detail pane, with the green truth
  band when present. If the viewer has clicked a different incident, auto open pauses and a
  "Follow newest" button appears, so a fault landing mid explanation doesn't yank the screen.
- **Layout:** stream and detail side by side from 1100 px; from 720 to 1100 px (a browser
  beside two terminals on a 1280 screen) the detail is on top and the stream is a compact list
  below it, so the newest incident is always in view without scrolling; phone stacks the same
  way.
- **Empty:** "No monitor connected." followed by the two commands, copyable:
  `.venv/bin/triage serve --site docs` and
  `.venv/bin/triage replay <dataset> --site docs` or
  `python recorder/record_labeled.py --monitor ...`. On GitHub Pages this is always the
  state, and it must never show an error. "Monitor running, nothing fired yet" when the file
  exists with zero incidents.

### 3.5 How it decides

- Intro paragraph (the current text, kept).
- **Checks:** three sections (Camera and timing, Joints, Task), each a table: check name,
  what it looks at (`signal`), fires when (`threshold`), why. From `data.checks`.
- **The ladder:** table of `data.rules` in order: rule, rung badge, when, to, count in the
  sample, count in all runs. Each count links to the inbox filtered by that rule. The sample
  count links to incidents; the all runs count is joint pass only and links only where bundles
  exist, with a note saying most of those are not bundled.
- **Thresholds:** `data.thresholds` as a two column table (name, value), with a link to
  `THRESHOLDS.md` for the physical reasons.

### 3.6 Trust

- The injected fault validation table from `data.validation.summary.faults`: fault, tries,
  caught, caught with low confidence, missed, skipped, right rung, false extras. Column
  meanings under the table (current text). The lag line ("measured within 1 frame of 3 on N of
  M runs"). The calibration paragraph with the frozen threshold and the number of calibration
  arms, as counts.
- **Physical arm:** while `data.bench` is null, a plain block: "Not yet validated on a physical
  arm. The recorder and run sheet are in the repo; scored results appear here once a set is
  recorded." When `bench` exists, its table and the frame by frame stale counts.

### 3.7 About

What this is (two paragraphs), what's wrong with it (the current list), what a robot should
record so this stops being inference (current list), running it on your own logs (the reader
seam, `episode_triage/readers_template.py`), the dataset and revision from `data.fleet`, repo
link, "Independent project, not affiliated with any robot company", "Logs never leave your
machine: the tool runs locally and this page is static." Also the footer text from the current
page about where every number comes from.

## 4. Design tokens

All colors are CSS custom properties on `:root`, switched by `prefers-color-scheme`, with a
manual override (`data-theme` on `<html>`, toggle in the top bar, stored in `localStorage`).
Rung colors are a tinted background with strong text, never white text on a mid color, so every
pair passes 4.5:1.

| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg` | `#f7f7f8` | `#0d0e10` | app background |
| `--surface` | `#ffffff` | `#15171a` | tables, panes, top bar |
| `--surface-2` | `#f1f2f4` | `#1c1f23` | hover, selected row, chips |
| `--border` | `#e4e6ea` | `#2a2e34` | dividers |
| `--border-strong` | `#cdd1d7` | `#3a3f46` | inputs, focused controls |
| `--fg` | `#14171a` | `#e7e9ec` | primary text |
| `--fg-2` | `#4a525c` | `#adb4bd` | secondary text |
| `--fg-3` | `#66707b` | `#8a929c` | muted text, axis labels (4.6:1 on surface) |
| `--accent` | `#2457c5` | `#7aa7ff` | links, selection, focus ring |
| `--r1-bg` / `--r1-fg` | `#e3f3e8` / `#1d6b3a` | `#16301f` / `#7ed69c` | rung 1, robot can clear it |
| `--r2-bg` / `--r2-fg` | `#fbefd9` / `#8a5300` | `#35270f` / `#f0b95c` | rung 2, ticket |
| `--r3-bg` / `--r3-fg` | `#e4ecfb` / `#2550a8` | `#17233d` / `#8fb2ff` | rung 3, training |
| `--r4-bg` / `--r4-fg` | `#fbe5e2` / `#a3271a` | `#3a1a17` / `#ff8f80` | rung 4, a person |
| `--r0-bg` / `--r0-fg` | `#eceef1` / `#535b65` | `#22262b` / `#a3aab3` | clean |
| `--tl-pos` | `#2457c5` | `#7aa7ff` | joint position, camera change |
| `--tl-cmd` | `#b06a12` | `#e8a54b` | joint command (dashed) |
| `--tl-motion` | `#d6d3cb` | `#3b3a36` | arm motion band |
| `--band-cause` | `#d23f2a` @ 0.20 | `#ff7a66` @ 0.22 | what started it |
| `--band-anchor` | `#2457c5` @ 0.12 | `#7aa7ff` @ 0.16 | what a person would see |
| `--band-context` | `#7d8590` @ 0.16 | `#8a929c` @ 0.18 | context |
| `--band-truth` | `#1f8a4c` @ 0.20 | `#4fd18b` @ 0.20 | injected truth |
| `--live` | `#1f8a4c` | `#4fd18b` | connected dot, new row tint |

Other tokens:

- **Type:** `--font-ui: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
  `--font-mono: ui-monospace, "SF Mono", Menlo, Consolas, monospace`. No web fonts. Sizes
  `--t-xs 11px` (axis, tags), `--t-sm 12px` (table headers, meta), `--t-md 13px` (table body,
  controls), `--t-lg 15px` (pane title, body copy on reference pages), `--t-xl 20px` (page
  titles). Line height 1.45 for prose, 20px rows for tables. `font-variant-numeric:
  tabular-nums` on every number; numbers right aligned in tables. Arm ids and rule ids in mono.
- **Space:** 4 px scale, `--s1 4px` to `--s6 24px`, `--s8 32px`.
- **Radius:** `--r-sm 4px` (badges, chips), `--r-md 6px` (inputs, panes). No shadows except the
  pane overlay at 720 to 1100 px.
- **Rows:** 32 px desktop, 44 px minimum touch target on phone.
- **Focus:** 2 px `--accent` outline with 2 px offset on every interactive element, visible on
  keyboard focus only (`:focus-visible`).
- **Motion:** 120 ms for hover and pane open; the live "new" fade is 8 s; all of it off under
  `prefers-reduced-motion`.

## 5. Stack

Vite 6 with TypeScript and Preact 10 (with `@preact/signals` for shared state), a hash router
of about 60 lines written here, and hand drawn SVG for the timeline and the per arm strip chart.
No table, chart or UI library. The reasoning: the app is six screens over static JSON, and the
hard parts are the timeline and the table behaviour, both of which are small enough to own
outright. Preact gives components and JSX for about 4 KB gzipped, and the whole bundle lands at
32 KB of JS and 6.5 KB of CSS gzipped against the 300 KB budget, which matters for first paint on a
phone. The largest table is 1,427 arms, which plain DOM rows with `content-visibility: auto`
handle without a virtualization dependency; if it measures slow on a phone I will add a 50 line
windowed list rather than a library. Signals keep the filter, selection and live state outside
the component tree, so the URL, the keyboard handler and the live poll all write to one place.
Node 22.22.2 and npm 10.9.7 are installed. Pinned versions: Preact 10.29.8,
@preact/signals 2.11.4, Vite 6.4.5, @preact/preset-vite 2.10.6, TypeScript 5.9.3 (npm offered
Preact 11 and TypeScript 7; I stayed on the majors this was designed against). Everything is in
`package-lock.json` and nothing is loaded from a CDN at runtime.

## 6. Data additions (in `site.py` and `monitor.py` only)

No threshold, rule, route text or number changes. Everything below is derived from
`results/` by the existing builder.

1. **Incident summaries** in `data.json` gain `fix_by` (the same map the inbox rows use),
   `label` (the plain problem name of its fingerprint) and `component` (the joint or camera,
   for search and the arm filter). Today the front end would have to rebuild these.
2. **`docs/fleet.json`** (new, loaded only by the Fleet screen so it doesn't slow the inbox):
   one row per arm with runs, joint and calibration tickets (`act_tickets`, so the Fleet tile's
   197 links to exactly 197 arms), incident counts by rung for the joint pass over all runs and for
   the video sample, recurring fingerprints, median camera lag in frames where cameras were
   sampled (from the `lag` field already in `fleet_video.jsonl`), the latest run with an
   incident, and the ids of its bundled incidents. Estimated 120 to 180 KB raw, under 30 KB
   gzipped.
3. **Fix a contributor name leak in `data.json`.** `validation.calibration.robots` currently
   publishes the raw dataset ids (contributor user names) of the calibration arms. The builder
   will write the anonymized arm ids instead. The UI only ever shows the count.
4. **Live robot id.** `triage replay` of a community dataset used to write `robot_id` as the
   dataset id, which is a contributor's user name, and the old page showed it in the badge and
   the incident header. `LiveSite` in `monitor.py` now looks the id up in
   `results/robot_index.json` and writes `arm NNNN` when it finds it, in `robot_id`, in incident
   ids and bundle file names, and in `supersedes`. An id that isn't in the index, such as a
   physical arm's follower id, passes through unchanged. `live/data.json` also gains
   `started_at`, and each row carries `supersedes`, so the stream can mark escalations without
   opening bundles.

After these, `.venv/bin/triage report` rebuilds `data.json`, `fleet.json` and the bundles, and
the 34 tests must still pass.

## 7. Build and publish

```
web/
  DESIGN.md        this file
  README.md        dev and build commands
  index.html       app shell (becomes docs/index.html)
  package.json     scripts: dev, build, check, preview
  vite.config.ts
  tsconfig.json
  src/
    main.tsx       boot, router, shell
    data.ts        loading data.json, fleet.json, bundles, live poll
    router.ts      hash routes, legacy link redirects
    state.ts       per viewer status, notes and theme (localStorage, guarded)
    keys.ts        the one keydown listener and the shortcuts list
    evidence.ts    the EVID map, ported
    format.ts      number and label helpers
    types.ts       shapes of the JSON the engine writes
    routes/        Inbox, Fleet, Live, Reference (How it decides, Trust, About)
    components/    IncidentDetail, IncidentTable, Timeline, FilterMenu, bits
    styles/        tokens.css, app.css
```

- **Dev:** `cd web && npm install && npm run dev`. Vite serves the app on port 5173 and, in
  dev only, serves `../docs` as its public directory, so `data.json`, `incidents/` and
  `live/` resolve exactly as in production. Run `triage replay` in another terminal and the dev
  server picks up `docs/live/` live.
- **Build:** `npm run build` runs `tsc --noEmit`, then `vite build` with `root: web`,
  `outDir: ../docs`, `base: "./"` (relative paths, so it works under `/episode-triage/` on Pages
  and at `/` on `triage serve`) and `emptyOutDir: false`. A small prebuild step deletes only
  `docs/assets/` and the old `docs/app.js`; it never touches `docs/data.json`, `docs/fleet.json`,
  `docs/incidents/`, `docs/live/` or `docs/THRESHOLDS.md`. Output: `docs/index.html` and hashed
  files in `docs/assets/`. A `docs/.nojekyll` file stops Pages running Jekyll over the folder.
- **Publish path:** `.venv/bin/triage report`, then `cd web && npm run build`, then commit
  `docs/` and push `main`. Pages serves `/docs` with no Actions step. Built files are committed.
- **Local viewing:** `.venv/bin/triage serve --site docs` serves the built app with no cache
  headers, as now.

## 8. Decisions made without asking

- Product name "Triage". The fleet badge says what data is loaded.
- Hash routing, so no `404.html` and nothing to configure on Pages.
- Incidents view is the default inbox view, sorted by problem priority; the problem grouping
  is one click away and remembered per viewer.
- Status and notes are per viewer in `localStorage`, empty by default, labeled as local
  everywhere they appear.
- Calibration TPR and FPR in `data.json` are rates, so the Trust screen shows the frame counts
  they come from and not the rates.
- The Live layout targets a browser 720 to 900 px wide beside two terminals on a 1280 screen,
  and a full 1280 window, both checked by screenshot in pass 3.
- Theme follows the system, with a manual toggle stored per viewer.

## 9. Things I noticed and did not change

- The route text says "a offset at rest" and "a calibration mismatch" in places ("a" before a
  vowel). It is route text from the ladder, so it stays.

- In live bundles, `t` and the clip axis are seconds since the monitor started, while times
  inside the `route` text are seconds inside the analysis window. In the replay, "one empty
  close on gripper at 8.6 s" arrives with `t = 13.1` and a clip from 11 to 24 s. The Live screen
  labels its own times "monitor time" and leaves the route text alone. Worth a look in
  `monitor.py`, but it is route text, so I have not touched it.
- Run 57's incidents arrive with monitor times around 13 to 16 s after run 58's 20 s, so live
  `t` does not appear to grow across runs. The stream orders by arrival, not by `t`.
