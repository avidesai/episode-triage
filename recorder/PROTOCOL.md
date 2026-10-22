# Bench protocol: SO 101 labeled fault set

The point of this set is ground truth that public data can't give: the real age of every
camera frame, servo diagnostics, and an exact log of which fault was active on which tick.
`triage bench-eval` scores the tool against it.

## Setup

- SO 101 leader and follower, calibrated with LeRobot 0.6.1 (`lerobot-calibrate`).
- Wrist camera on the follower, scene camera on a fixed mount that sees the whole arm.
- A towel on the table. Task: grab a corner, fold the towel in half, release. About 25 s.
- `pip install lerobot==0.6.1`, then from this repo:

```
python recorder/record_labeled.py --follower-port PORT_F --leader-port PORT_L \
  --wrist-cam 0 --scene-cam 1 --root data/so101_bench --repo-id avidesai/so101_bench \
  --task "fold the towel in half" --episode-s 25 --episodes N --fault FAULT [options]
```

The recorder prints `NOW` and `END` at the scheduled fault window. Faults marked
"label only" are things you do by hand on that cue; the rest the recorder does itself.

## Blocks

| Block | Episodes | `--fault` | Options | What happens | Expected rung |
|---|---|---|---|---|---|
| A | 6 | `none` | | normal teleop, natural misses allowed | 0, or 1 for a recovered miss |
| B | 3 | `air_grasps` | `--fault-start-s 5 --fault-len-s 4` | on `NOW`, close on air twice, then grasp | 3 |
| C | 3 | `camera_stall` | `--fault-target wrist --fault-start-s 8 --fault-len-s 3` | on `NOW`, lights off for 3 s (or start a 1080p capture on the other camera on the same hub) | 1 if it recovers, 2 if not |
| D | 2 | `camera_freeze` | `--fault-target wrist --fault-start-s 8 --fault-len-s 0.5` | recorder repeats one wrist frame for 0.5 s | 1 |
| E | 3 | `torque_off` | `--fault-target wrist_flex --fault-start-s 8 --fault-len-s 2` | wrist_flex goes limp for 2 s and sags | 2 |
| F | 3 | `calibration_shift` | `--fault-target elbow_flex --offset 8` | follower elbow sits 8 units off its leader all episode | 2 |
| G | 2 | `camera_delay` | `--fault-target scene --fault-start-s 0 --fault-len-s 25 --delay-ticks 3` | scene frames served 3 ticks late | measured per robot, see below |
| H | 2 | `camera_bump` | `--fault-target scene --fault-start-s 10 --fault-len-s 0.5` | on `NOW`, nudge the scene camera mount | known miss (no camera moved check yet) |

Cut line if time is short: blocks A and B in full, then at least two episodes from each
other block (15 episodes).

Block G is scored as a measurement: the scene camera's lag estimate on G episodes should sit
3 frames (plus or minus 1) above its estimate on block A episodes.

## Safety

- Block E happens with the arm low over the towel and a hand nearby. When torque comes back
  the joint moves to the leader's position at once, so keep the leader still near the end
  of the window.
- Never heat a servo to its thermal limit. Cutting torque reproduces the same signature (the
  joint unloads) without damaging anything. Temperature is logged every run, so any natural
  heating still shows up.

## After recording

```
triage bench-eval data/so101_bench --out results/bench_eval.json
triage report
```

The report adds the bench table automatically once `results/bench_eval.json` exists.

## Known limits of this set

- One arm, one task, one session, and most faults are injected rather than natural.
- `age_ms` is host receive time, not exposure time.
- The SO 101 bus has no per motor current sense beyond what `Present_Load` reports.
