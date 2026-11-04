# Run sheet: SO 101 bench set and live monitor

Two things come out of a session on the arm: a scored set of faults caused on purpose, with
the recorder's own log as ground truth, and the live monitor running during the session so
incidents appear in the viewer as they happen.

## Setup (once)

- SO 101 leader and follower, built and calibrated with LeRobot 0.6.x:
  `lerobot-calibrate --robot.type=so101_follower --robot.port=... --robot.id=so101_follower`
  and the same for the leader with `--teleop.type=so101_leader --teleop.id=so101_leader`.
- Wrist camera on the follower, scene camera on a fixed mount that sees the whole arm. Find
  the indices with `lerobot-find-cameras opencv`; on a Mac, index 0 is often the built in
  camera.
- In the `lerobot` environment: `pip install -e .` from this repo, so the recorder can import
  `episode_triage`.
- A towel on the table. Task: grab a corner, fold the towel in half, release. About 25 s.

Every command below is run from the repo root. `PORT_F` and `PORT_L` are the follower and
leader serial ports.

```
REC="python recorder/record_labeled.py --follower-port PORT_F --leader-port PORT_L \
  --wrist-cam 0 --scene-cam 1 --root data/so101_bench --repo-id avidesai/so101_bench \
  --task 'fold the towel in half'"
```

## 1. Dry run

One clean 10 s run into a throwaway folder, no fault:

```
$REC --root data/dryrun --repo-id avidesai/dryrun --episode-s 10 --fault none
```

Check `data/dryrun/sidecar/episode_000000.jsonl`: `loop_ms` near 33, both cameras showing
`.new: true` most ticks with `age_ms` well under 100, a `servo.*` reading every 6th tick. Then
`triage run data/dryrun` should come back clean or close to it.

## 2. Start of day baseline (block A)

Six clean runs. These are what every fault is judged against: the arm's normal follower
lag, calibration gain and joint ranges come from them.

```
$REC --episodes 6 --fault none
triage baseline data/so101_bench --out profile.json
```

`baseline` prints each joint's lag, gain and correlation and flags anything that already
needs recalibrating. Fix that before recording faults, or the faults land on top of a
standing calibration ticket.

## 3. Faults, with the monitor running

Open two terminals. In the first, the viewer:

```
triage serve --site docs
```

Open http://127.0.0.1:8080/#live. In the second, each block below with `--monitor --profile
profile.json`. The recorder prints `NOW` and `END` at the fault window; faults marked "by
hand" are things you do on that cue. With `--trigger key`, the fault starts when you press
Enter instead of on the schedule, which is the mode to use when someone is watching.

| Block | Runs | `--fault` | Options | What happens | Expected rung |
|---|---|---|---|---|---|
| B | 3 | `air_grasps` | `--fault-start-s 5 --fault-len-s 4` | by hand on `NOW`: close on air twice, then grasp | 3 |
| C | 3 | `camera_stall` | `--fault-target wrist --fault-start-s 8 --fault-len-s 3` | by hand on `NOW`: lights off for 3 s, or start a 1080p capture on the other camera on the same hub | 1 if it recovers, 2 if not |
| D | 2 | `camera_freeze` | `--fault-target wrist --fault-start-s 8 --fault-len-s 0.5` | recorder repeats one wrist frame for 0.5 s | 1 |
| E | 3 | `torque_off` | `--fault-target wrist_flex --fault-start-s 8 --fault-len-s 2` | wrist_flex goes limp for 2 s and sags | 2 |
| F | 3 | `calibration_shift` | `--fault-target elbow_flex --offset 8` | follower elbow sits 8 units off its leader all run | 2 |
| G | 2 | `camera_delay` | `--fault-target scene --fault-start-s 0 --fault-len-s 25 --delay-ticks 3` | scene frames served 3 ticks late | measured per arm |
| H | 2 | `camera_bump` | `--fault-target scene --fault-start-s 10 --fault-len-s 0.5` | by hand on `NOW`: nudge the scene camera mount | known miss |

Cut line if time is short: block A in full, then two runs each of B, D and E (12 runs).

Each incident the monitor finds appears in the viewer with a green band for the fault that
was injected and a red band for what the checks found, so detection is shown against truth
as it happens.

## 4. Score it

```
triage bench-eval data/so101_bench --out results/bench_eval.json
triage report
```

The viewer adds the physical fault table under "How much to trust it".

## Safety

- Block E happens with the arm low over the towel and a hand nearby. When torque comes back
  the joint moves to the leader's position at once, so keep the leader still near the end of
  the window.
- Never heat a servo to its thermal limit. Cutting torque reproduces the same signature (the
  joint unloads) without damaging anything. Temperature is logged every run regardless.

## Known limits of this set

- One arm, one task, one session, and most faults are injected rather than natural.
- `age_ms` is host receive time, not exposure time.
- The SO 101 bus has no per motor current sense beyond what `Present_Load` reports.
