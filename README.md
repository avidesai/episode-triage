# episode-triage

A triage inbox for a robot fleet. Every failure arrives sorted by who should fix it: the
robot itself, a technician with the part named, the training team, or a person who has to
look. Each one comes with the moment it started, what started it, and the evidence.

**Viewer, loaded with 48,000 real runs from 1,427 arms:** https://avidesai.github.io/episode-triage/

Independent project. Not affiliated with any robot company.

## Why

A fleet that runs every day produces more failures than a small team can look at. Most of
the time spent on a failure goes into working out what kind of failure it is, and the costly
mistake is retraining the policy on a failure that was really a frozen camera or a joint that
didn't do what it was told. This checks the cheap layers first, from the logs alone, with
fixed rules anyone can read, and only then lets a failure count as a task failure.

## What it is

Three pieces share one engine:

- **The viewer** (`docs/`, built from `web/`): a static web app with an inbox, a fleet view,
  a live monitor screen and reference pages. The inbox is a queue of every bundled incident
  that can be sorted, filtered by rung, layer, who fixes it, arm, rule and status, searched, and
  grouped by problem type, ranked by how many arms and runs each hits weighted by how serious
  the rung is. Opening an incident shows its evidence: the arm, the cameras and the gripper on
  one clock, what started it, what a person would have been called for, the reasoning behind
  the verdict, and every measurement against its threshold. The fleet view has a row per arm
  with its incidents by rung, recurring problems and camera lag. Status and notes are kept per
  viewer in the browser. Keyboard: `j` and `k` to move, Enter to open, Esc to close, `?` for
  the rest. `web/README.md` has the build commands.
- **The batch run** (`triage fleet-joints`, `triage fleet-video`): the checks over a fleet's
  recorded runs. That is what produced the demo data.
- **The live monitor** (`triage replay`, `triage serve`, and `recorder/record_labeled.py
  --monitor`): the same checks over a sliding window of a running robot's log. When a stall,
  a missed grasp or a tracking loss fires, the monitor cuts the evidence window, orders the
  causes, routes it, and posts it to the inbox while the robot keeps running.

## The ladder

Ordered rules, first match wins. Rule 0 runs first: if the data is broken or a layer wasn't
checked, the failure goes to a person with one line saying what's missing, and nothing
reaches training on a guess.

| Rung | Meaning | Examples |
|---|---|---|
| 0 | clean | nothing fired |
| 1 | the robot can clear it itself | a camera froze under 1 s and came back; one bad bus read; a missed grasp then a good one |
| 2 | ticket for a named part | camera or USB link, joint not following, recalibrate a joint, bus or harness, leader angle wrap |
| 3 | send to training | a stall or missed grasps with fresh pictures and joints that followed |
| 4 | a person has to look | data missing, two causes too close to call, a joint held off its command with nothing moving |

Checks, cheapest evidence first:

1. **Integrity.** NaNs, runs under 2 s, frame index gaps, video and joint row counts that
   disagree, video that won't decode.
2. **Cameras and timing.** A camera that stopped updating while the joints that move it, or
   that it watches, were moving. The joint stream repeating while the command moves. Camera
   latency relative to the joints, judged per arm.
3. **Joints.** A follower joint that left its command and stayed away (stalled, sagging,
   lagging, or held off with nothing moving); a follower offset from its leader at rest;
   leader and follower calibrated over different spans; one frame jumps no real joint can make;
   a leader reading that wraps past 180 degrees and sends the follower the long way round; a
   joint pinned at its limit while pushed further.
4. **Task.** Stalls (nothing commanded and nothing moving for 2 s) and missed grasps, with a
   missed grasp sequence defined as 2 or more consecutive missed grasps.
5. **What started it.** For each stall, missed grasp sequence or tracking loss, look back 3 s.
   The earliest camera or joint event that began before it is the cause; anything that began
   after is context. A camera can make a policy stall but can't make a follower stop tracking
   its leader, so tracking losses only accept joint causes. Two causes from different layers
   within 0.2 s go to a person.

No model calls anywhere. Every decision is signal processing on aligned streams that can be
read line by line, and it runs over 48,000 runs in under a minute on a laptop.
[docs/THRESHOLDS.md](docs/THRESHOLDS.md) lists every threshold with its physical reason and
which ones changed after looking at healthy data, and why.

## What it found in the demo fleet

<!-- FINDING:start -->
Run on the LeRobot community dataset: 1,427 SO 100 and SO 101 arms built by different people, 48,208 recordings, 241.4 hours. Across those arms the check found joint or calibration faults on about 1 in 7 arms and frozen cameras in about 1 in 14 recordings. It also proved my own prediction wrong: nearly every stall was really the operator pausing.

- **Frozen cameras don't show up in the timestamps.** LeRobot writes each timestamp as `frame_index / fps`, so all 48,208 recordings have a perfect clock. Comparing each camera's picture with the arm's motion, in a random sample of 809 recordings from 298 arms, found 58 recordings on 43 arms where a camera stopped updating for 3 frames or more while the arm moved (90 freezes, median 3 frames). I predicted at least 1 in 10 beforehand.
- **Joint faults are common, and mostly calibration.** 197 of 1,427 arms have at least one: the follower sits off its leader at rest (92 arms), the two arms were calibrated over different ranges (36), a follower joint doesn't track its leader at all (25), bad motor readings (34), or a reading that wraps from +180 to -180 degrees so the follower spins the long way round.
- **My stall prediction was wrong.** I wrote down beforehand that at least a quarter of stalls and missed grasp sequences would start with a camera or joint fault. It was 4 of 355. In this teleoperated data nearly every stall is a person pausing, so the check mostly confirms that a stall is a real task failure: 322 went to training with every layer checked, and the rest went to a person because another fault on the same recording made the call unsafe.
- **Cameras run late by different amounts.** Most of 395 cameras run 0 to 2 frames behind the joints; 46 cameras on 40 arms run 3 frames (100 ms) or more behind, up to 5. 4 appear to run ahead, which can't happen, so the estimate is probably wrong for them.

What to fix first across all arms (joint and data problems; stalls need the video checked, so they're ranked on the video sample in the report):

| problem | code name | rung | arms | recordings |
|---|---|---|---|---|
| follower sits offset from its leader at rest (wrist flex) | `actuation.rest_offset.wrist_flex` | 2 | 49 | 329 |
| joint stopped following its command (wrist roll) | `actuation.not_following.wrist_roll` | 2 | 65 | 153 |
| follower doesn't track its leader on a joint (wrist roll) | `actuation.not_tracking.wrist_roll` | 2 | 21 | 386 |
| follower and leader calibrated over different spans (wrist flex) | `actuation.gain_mismatch.wrist_flex` | 2 | 20 | 396 |
| follower sits offset from its leader at rest (elbow flex) | `actuation.rest_offset.elbow_flex` | 2 | 22 | 220 |
| joint stream repeated while commanded to move | `sensing.stale_state.joint_stream` | 1 | 90 | 303 |
| joint pinned at its limit while pushed further (wrist flex) | `actuation.pinned.wrist_flex` | 2 | 31 | 95 |
| joint stopped following its command (wrist flex) | `actuation.not_following.wrist_flex` | 4 | 31 | 128 |

Every number here is computed by `episode_triage/ledger.py` from `results/`, and the same numbers are in `docs/data.json`.
<!-- FINDING:end -->

## How much to trust it

<!-- VALIDATION:start -->
Faults injected into real community episodes with a known answer. Video faults were reencoded with LeRobot's default encoder settings so they reach the detector through real compression.

One threshold was tuned on data: the stale camera image change level, set to 0.51 gray levels on 20 calibration robots (740 injected frozen frames against 3,173 moving frames: 99% of frozen frames below it, 7.7% of moving frames below it, and the moving frames include natural freezes, so that second number is an upper bound). Then every threshold was frozen and the faults below were scored on different robots.

| fault injected | tries | caught | caught, low confidence | missed | skipped | right rung | false extras |
|---|---|---|---|---|---|---|---|
| camera frozen 10 frames | 40 | 16 | 24 | 0 | 0 | 14 | 0 |
| camera frozen 20 frames | 40 | 16 | 24 | 0 | 0 | 14 | 0 |
| camera frozen 3 frames | 40 | 16 | 22 | 2 | 0 | 14 | 0 |
| camera frozen 6 frames | 40 | 17 | 23 | 0 | 0 | 16 | 0 |
| 3 bad reads on one motor | 40 | 40 | 0 | 0 | 0 | 34 | 3 |
| joint offset 8% of range | 40 | 20 | 0 | 0 | 20 | 20 | 0 |
| joint stream repeats 6 frames | 37 | 37 | 0 | 0 | 0 | 37 | 2 |
| joint stalls for 1.5 s | 37 | 37 | 0 | 0 | 0 | 33 | 4 |

**Caught, low confidence** means the tool found the frozen picture, but that camera barely shows the arm moving, so the finding is logged and the ladder doesn't act on it. That guard is what stopped cameras that can't see the arm from being blamed for stalls in the fleet run, and on these episodes it costs more than half the recall. It is defined as 3 times the stale threshold, so freezing that threshold at 0.51 made the guard stricter too; I didn't retune it on the test robots. **Skipped** means the recording had fewer than two pauses, so a resting offset can't be measured in it. **False extras** counts anything else the injected fault set off.

Camera delayed by 3 frames: the lag estimate moved by 3 plus or minus 1 on 37 of 38 episodes where both estimates existed (40 tried). Shifts seen: 0: 1, 2: 4, 3: 20, 4: 13.

Raw rows are in `results/inject_eval.json`.

**Bench set on a physical arm: not recorded yet.** The recorder and run sheet are in `recorder/` but haven't been run on hardware. `triage bench-eval` scores the set and `triage report` adds it here once it exists.
<!-- VALIDATION:end -->

## Running it

```bash
pip install -e .

# one recorded dataset, from the Hub or a local LeRobot v3.0 directory
triage run lerobot/aloha_static_towel --episodes 0,1,2

# the fleet behind the viewer
triage fleet-joints .cache/community_v3
triage fleet-video .cache/community_v3 --robots 300 --episodes 3 --seed 7
triage inject-eval .cache/community_v3
triage report                      # rebuilds docs/ from results/

# live: rehearse with a recorded run, then watch it in the viewer
triage serve --site docs           # http://127.0.0.1:8080/
triage replay path/to/dataset --site docs --speed 1
```

The demo data is `lerobot/community_dataset_v3` at revision
`ab92ac3fa4d0c08336e21b8e51cb9dc279535539`. `results/` holds every output the viewer reads,
including each sampled camera's image change trace, so `triage rescore` and `triage report`
rebuild everything without downloading video again. Arms on the page are numbered, not
named; `results/robot_index.json` maps them back.

### On a physical arm

`recorder/record_labeled.py` drives an SO 101 leader and follower, records a normal LeRobot
dataset plus a sidecar with what the format drops (real loop timing, the true age of every
camera frame, servo load, temperature, voltage and status, and an exact log of injected
faults), and with `--monitor` runs the live monitor on every tick. `recorder/PROTOCOL.md` is
the run sheet, from the start of day baseline to a scored set of faults caused on purpose.

### On your own log format

Everything downstream of the reader works on one object, `Episode` (commanded and measured
joint positions, frame rate, which columns are grippers, and each camera's frames as small
grayscale images). A new log format needs one file that produces it; the checks, the cause
ordering, the ladder, the inbox and the live monitor run unchanged.
`episode_triage/readers_template.py` is the starting point and `episode_triage/readers.py`
is the worked example. Logs never leave your machine: the tool runs locally and the page is
static.

## What's wrong with it

- **Frozen cameras and camera lag are inferences.** With no real capture time in the data,
  both come from picture content against joint motion. A camera moving over a blank surface
  can look frozen; those cases get low confidence and never drive a verdict, but they cost
  recall.
- **"Training" means the operator in this data.** Almost all community data is
  teleoperation, so rung 3 is task level stalls and misses, not a learned policy failing.
  Most stalls are people pausing.
- **Thin cloth.** Joint positions alone can't always tell a grasp on one layer of fabric from
  an empty close. Closes between 3% and 5% of range are called ambiguous.
- **Contact versus a dead joint.** A joint held off its command with nothing moving could be
  pushing against the table or could be dead. Position data can't tell, so it goes to a
  person.
- **Arms are datasets.** Some people recorded several datasets on one arm, so arm counts are
  an upper bound.
- **Injected faults are clean.** The injection eval proves the detectors and the ladder fire
  on a known answer. It doesn't prove natural faults look the same. The recorder and the
  live monitor exist so the same checks can be scored against faults caused on purpose on a
  physical arm.
- **The live monitor adds a few seconds of latency.** A stall needs 2 s to exist and an
  incident is reported once its evidence window is complete, so a fault appears in the inbox
  roughly 2 to 5 s after it starts.

## What I'd build next

- **An MCAP reader** for ROS 2 bags and logs with real capture timestamps and PTP, where
  frozen frames and lag become exact and the content checks become a fallback.
- **Servo load, current and temperature in the recorded observation** by default, so every
  "not following" says whether the motor unloaded, overheated or browned out.
- **A learned progress model** in place of the motion stall heuristic, which is what a real
  behavior executive uses to decide a robot is stuck.
- **Takeovers as anchors.** Run it on a fleet's own intervention logs, where every operator
  takeover is a failure with a human label already attached, and measure how many began with
  something the robot could have cleared itself.
- **A camera moved check** for bumped mounts and calibration drift.

## Layout

```
episode_triage/
  readers.py           LeRobot v3.0 -> Episode
  readers_template.py  the one file a new log format needs
  video.py             decode one run's slice of an MP4 to 80x60 gray
  signals.py           ranges, speeds, follower lag, image change, cross correlation
  checks.py            sensing, actuation and task checks, THRESHOLDS
  timeline.py          anchors, look back, cause versus context
  ladder.py            ordered rules, route text, the reasoning trace
  pipeline.py          one run end to end
  monitor.py           the online monitor and the incident bundle
  replay.py            stream a recorded run through the monitor
  fleet.py             fleet runs and the video sample
  inject.py            software fault injection with the recorder's encoder settings
  validate.py          injection eval and bench eval
  ledger.py            fingerprints, recurrence, priority, every number the page quotes
  site.py              builds docs/data.json, docs/fleet.json and docs/incidents/ from results/
  cli.py               triage run | fleet-joints | fleet-video | rescore | inject-eval | bench-eval | baseline | replay | serve | report
docs/                  the built viewer (index.html, assets/), its data, THRESHOLDS.md
web/                   the viewer's source (Preact and TypeScript), DESIGN.md, build commands
recorder/              SO 101 flight recorder with fault injection and monitor mode, run sheet
results/               everything the viewer reads
tests/                 checks on small hand built arrays: math only, never findings
```

## License

MIT for the code. The community dataset is Apache 2.0; nothing from it is redistributed here
beyond derived per frame statistics and dataset ids.
