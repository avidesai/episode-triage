# Thresholds and how each one was set

Every threshold is in `episode_triage/checks.py` (`THRESHOLDS`) or `timeline.py`. Positional
values are fractions of a joint's range, where the range is the 1st to 99th percentile of
that joint's command over all of a robot's frames, floored at a tenth of the arm's median
range so an idle joint is never judged on its own encoder noise. That is what lets one rule
run on SO arms recorded in normalized units or degrees and ALOHA arms recorded in radians.

The order things were set in matters, so it is recorded here:

1. Physical starting values written down from the hardware (servo speed, gripper behavior).
2. Checked against the distribution of healthy data on a random sample of about 40 community
   robots before any validation, and changed only where the healthy data said the starting
   value would fire on normal behavior (noted below).
3. One value, the stale camera image change level, calibrated on injected faults on 20
   robots.
4. Everything frozen, then scored on 40 different robots, then run on the fleet. Bugs were
   fixed after the freeze; thresholds were not.

## Sensing and timing

| Name | Value | Why |
|---|---|---|
| `stale_tau_e` | calibrated, see `results/inject_eval.json` | Mean absolute gray level change at 80x60 below which a frame counts as unchanged. A repeated source frame decodes to exactly 0 after LeRobot's AV1 encode except for one boundary frame. Set at the point that best separates injected frozen frames from moving frames on the calibration robots. |
| `stale_tau_m` | 0.02 | Summed follower speed over the joints that move or are seen by the camera, as a fraction of range per frame. Below this the arm is close enough to still that an unchanged picture proves nothing. |
| `stale_min_frames` | 3 | 100 ms at 30 fps. Shorter runs are within what normal frame jitter produces. |
| `lag_min_corr`, `lag_min_sharpness` | 0.30, 0.10 | Below these the image change and joint motion don't line up well enough to read a delay. |
| `lag_flag_frames` (ledger) | 3 | 100 ms at 30 fps. A USB camera read with `read_latest` normally trails the joint read by 1 to 2 frames. Judged per robot (median over its episodes) because a single episode's estimate moves by a frame either way. |
| `stale_state_min_frames` | 3 | Every arm joint bit identical for 3 frames while the lag corrected command moves. A real follower can't do that. |
| duplicated rows | 25% of moving rows | A stream that was resampled or duplicated repeats on a regular pattern; a quarter of moving rows repeating exactly is far past chance. |

## Actuation

| Name | Value | Why |
|---|---|---|
| follower lag | per robot, 0 to 10 frames | The delay that minimizes median tracking error on moving frames. Healthy SO followers measured 3 to 5 frames. Without this, normal servo response reads as tracking error. |
| tracking fit | per robot gain and offset | Leader and follower are calibrated separately. Their readings can differ by a gain, so the gap grows with distance from the middle of the range. Tracking loss is measured against the fit; the fit itself is reported. Added after the healthy data check showed wrist joints flagged as "held off command" on robots whose arms were fine and only calibrated differently. |
| `follow_err` | 0.15 | Healthy SO followers stay under 0.07 at the 99th percentile on every arm joint (sampled community robots). A limp or stalled servo passes 0.15 within a few hundred milliseconds. |
| `follow_min_s` | 0.4 s | Long enough that one fast leader flick can't fire it. |
| `follow_edge_s` | 1.0 s | The follower is still converging from the reset when recording starts. Added after the healthy data check found nearly every "sagging" event at t = 0. |
| `follow_recover_s` | 1.0 s | A tracking loss shorter than this that catches up on its own is rung 1. |
| `offset_err`, `offset_agree` | 0.05, 80% | Healthy robots sit within 0.02 of their leader at rest. The offset has to agree in sign and size across at least 80% of rest periods, with 2 or more rest periods. |
| `gain_err` | 0.15 | Follower moving 15% more or less than its leader across the range. |
| `track_min_r` | 0.9 | Below this the follower isn't tracking its leader at all on that joint. |
| `calib_min_span` | 0.25 | Gain is judged only on joints commanded over a quarter of the arm's median span. Added after the healthy data check found nearly every "not tracking" robot was a wrist roll that never moved. |
| `glitch_jump` | 0.25 | An STS3215 tops out near 9 degrees per frame at 30 fps, far below a quarter of a joint's range. A jump that size that comes back within 3 frames is a bad read. |
| `glitch_ticket_count` | 3 | One bad read is logged. Three on one motor in one episode is a bus or harness ticket. |
| `wrap_jump` | 0.5 | A one frame command jump over half the joint's range that doesn't come back within 3 frames is the leader's angle wrapping past its end. Added after reading the fleet output: an episode flagged "wrist_roll sagging" turned out to be the leader jumping from +180 to -180 degrees and the follower spinning the long way round. It replaces a symptom with the cause. |
| `pin_margin`, `pin_push` | 0.01, 0.05 | Within 1% of the joint's observed extreme while the leader pushes 5% past it and is still moving. The moving condition was added after the healthy data check: a parked arm resting on its stop is the normal rest pose. |

## Task

| Name | Value | Why |
|---|---|---|
| `stall_speed`, `stall_min_s` | 0.005, 2.0 s | Every joint's command and position still for 2 s. The "stalls for some time" trigger, measured from motion. |
| `stall_edge_s` | 1.5 s | Episodes start and end at rest by design. |
| `close_zone` | 0.15 | A close command is the gripper command within 15% of the robot's closed end. Which end is closed is learned per robot from where the follower stops short. |
| `empty_gap`, `holding_gap` | 0.03, 0.05 | After a close, a follower within 3% of its command has nothing in the jaws; 5% or more short is holding something. On sampled robots the settled gaps split into a cluster at 0 to 3% and a cluster at 10 to 30%. Closes between 3 and 5% are ambiguous and break a sequence rather than extend it. |
| missed grasp sequence | 2 or more | Weave's published metric: 2 or more consecutive missed grasps. |

## Cause ordering

| Name | Value | Why |
|---|---|---|
| look back | 3 s | Long enough to catch a camera fault that preceded a 2 s stall trigger. |
| onset slack | 0.2 s | A stale run needs 3 frames to exist and a stall needs 2 s, so a stall's detected onset can trail its cause slightly. |
| tie window | 0.2 s | Two candidate causes from different layers this close together go to a person. |
