# episode-triage

Before a robot's failure goes to retraining, check the cheap layers first: did the cameras
deliver fresh pictures, and did the joints do what they were told? This tool does that from the
logs alone, then puts every problem on a ladder: clean, the robot can clear it itself, a ticket
for a named part, send it to training, or a person has to look and here is why.

**Report:** https://avidesai.github.io/episode-triage/

Independent project. Not affiliated with Weave Robotics.

## Why

A fleet that runs every day produces more failures than a small team can look at. Most of the
time spent on a failure goes into working out what kind of failure it is, and the costly mistake
is retraining the policy on a failure that was really a frozen camera or a misbehaving joint. I
wanted to see how much of that first pass can be done from the logs alone, with fixed rules,
before a person opens anything.

## What it found

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

## What it does

For each episode:

1. **Rule 0.** Integrity first: NaNs, episodes under 2 s, frame index gaps, video and joint
   row counts that disagree, video that won't decode. Any of these, or a layer that wasn't
   checked, and the episode goes to a person with one line saying what's missing.
2. **Sensing and timing.** A camera that stopped updating while the joints that move it (or
   that it watches) were moving. The joint stream repeating while the command moves. Camera
   latency relative to the joints, judged per robot.
3. **Actuation.** A follower joint that left its command and stayed away (stalled, sagging,
   lagging, or held off with nothing moving), a follower that sits offset from its leader at
   rest, leader and follower calibrated over different spans, one frame jumps no real joint
   can make (bad bus reads), a leader reading that wraps past +-180 degrees and sends the
   follower the long way round, and a joint pinned at its limit while pushed further.
4. **Task.** Stalls (nothing commanded and nothing moving for 2 s) and missed grasps, using
   the definition of a missed grasp sequence as 2 or more consecutive missed grasps.
5. **What started it.** Stalls, missed grasp sequences and tracking losses are anchors. For
   each one it looks back 3 s; the earliest sensing or actuation event that began before the
   anchor is the cause, and anything that began after is context. A camera can make a policy
   stall but can't make a follower stop tracking its leader, so tracking losses can only be
   explained by actuation events. Two causes from different layers within 0.2 s go to a person.
6. **The ladder.** Ordered rules, first match wins. Route text is generated from event fields,
   so the same situation always reads the same way.

| Rung | Meaning | Examples |
|---|---|---|
| 0 | clean | nothing fired |
| 1 | the robot can clear it itself | a camera froze under 1 s and came back; one bad bus read; a missed grasp followed by a good one |
| 2 | ticket for a named part | camera or USB link, joint not following, recalibrate a joint, bus or harness, recorder |
| 3 | send to training | a stall or missed grasps with fresh inputs and healthy tracking |
| 4 | a person has to look | data missing, two causes too close to call, a joint held off its command with nothing moving (contact or a dead joint) |

Across a fleet, every incident becomes a ledger row with a fingerprint (check plus the part it
names), and fingerprints are ranked by robots affected times episodes affected times a rung
weight, with a recurring flag at 2 or more robots or 3 or more times on one.

No model calls anywhere. Every decision is signal processing on aligned streams that can be
read line by line, and it runs over 48,000 episodes in under a minute on a laptop.

## How it works, and why each piece is there

**The clock can't be trusted, so the content has to be.** In LeRobot, `add_frame` writes
`timestamp = frame_index / fps`, and the SO follower reads its cameras with `read_latest()`,
which returns whatever frame is in the buffer unless it's more than 500 ms old. A camera that
stalls for 400 ms is recorded as fresh frames with perfect timestamps. So stale frames are
found by cross checking: the picture didn't change while the joints that move that camera, or
that it can see, did. A still scene and a frozen camera look identical in the image alone; the
joints are what separate a dead sensor from a quiet room.

**Video is lossy, so "didn't change" needs a threshold calibrated on real compression.** Frames
are decoded to 80x60 grayscale with area averaging, which cuts most AV1 noise. Faults were
injected into decoded frames and reencoded with LeRobot's own defaults (libsvtav1, crf 30,
GOP 2, yuv420p). A repeated frame comes back as exactly 0 change except at one GOP boundary.

**The follower trails its leader, so tracking error is measured against the lagged command.**
Healthy SO followers trail by 3 to 5 frames. Leader and follower are also calibrated
separately and can disagree by a gain, so tracking loss is measured against a per robot fit of
follower against leader. The fit itself is reported as a calibration ticket when the gain is
off by more than 15% or the follower doesn't track at all.

**Every threshold is a fraction of a joint's range,** where the range comes from all of a
robot's data. The same rule then runs on arms recorded in normalized units, degrees, or
radians. [docs/THRESHOLDS.md](docs/THRESHOLDS.md) lists every value with its physical reason
and records which ones were changed after looking at healthy data, and why.

**Cause before context.** Two or three signals usually light up around a failure; only the
one that came first can explain it. That is what keeps a stall that began with a frozen wrist
camera from going to training as a policy failure.

## Validation

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

## Run it

```bash
pip install -e .
# one dataset from the Hub or a local LeRobot v3.0 directory
triage run lerobot/aloha_static_towel --episodes 0,1,2
# the fleet run behind the report
triage fleet-joints .cache/community_v3
triage fleet-video .cache/community_v3 --robots 300 --episodes 3 --seed 7
triage inject-eval .cache/community_v3
triage report
```

The community data is `lerobot/community_dataset_v3` at revision
`ab92ac3fa4d0c08336e21b8e51cb9dc279535539`. `results/` holds every output the page reads,
including each sampled camera's image change trace (`results/energy/`), so `triage rescore` and
`triage report` rebuild everything without downloading video again.

To point it at another log format, write a reader that returns `Episode` objects
(`episode_triage/readers.py`); everything downstream reads only that.

## Recording ground truth on a real arm

`recorder/record_labeled.py` records an SO 101 leader and follower into a normal LeRobot
dataset plus a sidecar with what the format drops: real loop timing, the true age of every
camera frame, servo load, temperature, voltage and status, and an exact log of injected faults
(camera freeze, camera delay, torque cut on one joint, calibration shift, and operator
performed ones on a cue). `recorder/PROTOCOL.md` is the run sheet; `triage bench-eval` scores
the tool against it. The recorder is written against LeRobot 0.6.1 and checked against 0.6.2,
but it hasn't been run on hardware yet, so the first session starts with a dry run.

## What's wrong with it

- **Stale camera and lag are inferences.** With no real capture time, both come from picture
  content against joint motion. A wrist camera moving over a blank surface can look frozen;
  those runs get low confidence and stay out of the counts, but they still cost recall.
- **"Policy" means the operator here.** Almost all community data is teleoperation, so rung 3
  is task level stalls and misses, not a learned policy failing. Most stalls are people pausing.
- **Thin cloth.** Proprioception alone can't always tell a grasp on one layer of fabric from an
  empty close. Closes between 3% and 5% of range are called ambiguous and never extend a
  missed grasp sequence.
- **Robots are datasets.** Each community dataset counts as one robot. Some people recorded
  several datasets on one arm, so robot counts are an upper bound on physical arms.
- **Injected faults are clean.** The injection eval proves the detectors and the ladder fire on
  a known answer. It doesn't prove natural faults look the same. The bench set on a physical
  arm is the step that tests that.
- **The video checks ran on a seeded sample** of robots and episodes, not every episode.
- **Format version tells you nothing here.** Every community dataset was converted to v3.0, so
  the original recording software version is gone and failure rates can't be sliced by it.
- **Contact versus a dead joint.** A joint held off its command with nothing moving could be
  pushing against the table or could be dead. Position data can't tell them apart, so it goes
  to a person.

## What I'd build next

- **An MCAP reader** for ROS 2 bags and logs with real capture timestamps and PTP. Stale frames
  and lag then become exact, and the content checks become a fallback for data that lost its
  clock.
- **Servo load, current and temperature in the recorded observation** by default. Every
  "not following" event would then say whether the motor unloaded, overheated, or browned out.
- **A learned progress or value model** in place of the motion stall heuristic, which is what a
  real behavior executive uses to decide a robot is stuck.
- **Takeovers as anchors.** Run it on a fleet's own intervention logs, where every specialist
  takeover is an anchor with a human label already attached, and measure how many takeovers
  started with something the robot could have cleared itself.
- **A camera moved check** (phase correlation on the scene view with the arm masked out) for
  bumped mounts and calibration drift.

## Layout

```
episode_triage/
  readers.py    LeRobot v3.0 -> Episode
  video.py      decode one episode's slice of an MP4 to 80x60 gray
  signals.py    ranges, speeds, follower lag, image change, cross correlation
  checks.py     sensing, actuation and task checks, THRESHOLDS
  timeline.py   anchors, look back, cause versus context
  ladder.py     ordered rules R0 to R6, route text
  pipeline.py   one episode end to end
  fleet.py      fleet runs and the video sample
  inject.py     software fault injection with LeRobot's encoder settings
  validate.py   injection eval and bench eval
  ledger.py     fingerprints, recurrence, priority, every number the page quotes
  report.py     builds docs/index.html from results/
recorder/       SO 101 flight recorder and protocol
results/        everything the page reads
docs/           the report page and THRESHOLDS.md
tests/          checks on small hand built arrays: math only, never findings
```

## License

MIT for the code. The community dataset is Apache 2.0; nothing from it is redistributed here
beyond derived per frame statistics and dataset ids.
