"""README sections generated from results, spliced in by site.build."""

from __future__ import annotations

# ---------------------------------------------------------------- README sections

FAULT_NAMES = {"freeze_3": "camera frozen 3 frames", "freeze_6": "camera frozen 6 frames",
               "freeze_10": "camera frozen 10 frames", "freeze_20": "camera frozen 20 frames",
               "stall": "joint stalls for 1.5 s", "offset": "joint offset 8% of range",
               "glitch": "3 bad reads on one motor", "stale_state": "joint stream repeats 6 frames"}


from .report import plain


def ratio(whole: int, part: int) -> int:
    return round(whole / part) if part else 0


def readme_finding(F, top) -> str:
    J, V = F["joints"], F["video"]
    A = V["anchors"]
    n_anchor = sum(A.values())
    began = A.get("began with sensing or actuation", 0)
    training = A.get("training, inputs healthy", 0)
    lines = [
        f"Run on the LeRobot community dataset: {J['robots']:,} SO 100 and SO 101 arms built by different "
        f"people, {J['episodes']:,} recordings, {J['hours']} hours. Across those arms the check found joint or "
        f"calibration faults on about 1 in {ratio(J['robots'], J['robots_any_actuation_ticket'])} arms and "
        f"frozen cameras in about 1 in {ratio(V['episodes_all_cameras'], V['episodes_stale_camera'])} recordings. "
        f"It also proved my own prediction wrong: nearly every stall was really the operator pausing.",
        "",
        f"- **Frozen cameras don't show up in the timestamps.** LeRobot writes each timestamp as "
        f"`frame_index / fps`, so all {J['episodes']:,} recordings have a perfect clock. Comparing each "
        f"camera's picture with the arm's motion, in a random sample of {V['episodes_all_cameras']:,} "
        f"recordings from {V['robots']:,} arms, found {V['episodes_stale_camera']:,} recordings on "
        f"{V['robots_stale_camera']:,} arms where a camera stopped updating for 3 frames or more while the arm "
        f"moved ({V['stale_runs']:,} freezes, median {V['stale_run_frames_median']:g} frames). I predicted at "
        f"least 1 in 10 beforehand.",
        f"- **Joint faults are common, and mostly calibration.** {J['robots_any_actuation_ticket']:,} of "
        f"{J['robots']:,} arms have at least one: the follower sits off its leader at rest "
        f"({J['robots_rest_offset']:,} arms), the two arms were calibrated over different ranges "
        f"({J['robots_gain_mismatch']:,}), a follower joint doesn't track its leader at all "
        f"({J['robots_not_tracking']:,}), bad motor readings ({J['robots_bus_glitch']:,}), or a reading that "
        f"wraps from +180 to -180 degrees so the follower spins the long way round.",
        f"- **My stall prediction was wrong.** I wrote down beforehand that at least a quarter of stalls and "
        f"missed grasp sequences would start with a camera or joint fault. It was {began:,} of {n_anchor:,}. "
        f"In this teleoperated data nearly every stall is a person pausing, so the check mostly confirms that a "
        f"stall is a real task failure: {training:,} went to training with every layer checked, and the rest "
        f"went to a person because another fault on the same recording made the call unsafe.",
        f"- **Cameras run late by different amounts.** Most of {V['lag_streams']:,} cameras run 0 to 2 frames "
        f"behind the joints; {V['camera_streams_lag_ge_3']:,} cameras on {V['robots_lag_ge_3']:,} arms run 3 "
        f"frames (100 ms) or more behind, up to {V['lag_max_frames']:g}. {V['camera_streams_lag_negative']} "
        f"appear to run ahead, which can't happen, so the estimate is probably wrong for them.",
        "",
        "What to fix first across all arms (joint and data problems; stalls need the video checked, so they're "
        "ranked on the video sample in the report):",
        "",
        "| problem | code name | rung | arms | recordings |",
        "|---|---|---|---|---|",
    ]
    for t in top[:8]:
        lines.append(f"| {plain(t['fingerprint'])} | `{t['fingerprint']}` | {t['rung']} | {t['robots']:,} | "
                     f"{t['episodes']:,} |")
    lines += ["", "Every number here is computed by `episode_triage/ledger.py` from `results/`, and the same "
                  "numbers are in `docs/data.json`."]
    return "\n".join(lines)


def readme_validation(inj, bench) -> str:
    if not inj:
        return "Not run yet."
    cal, S = inj["calibration"], inj["summary"]
    lines = [
        "Faults injected into real community episodes with a known answer. Video faults were reencoded with "
        "LeRobot's default encoder settings so they reach the detector through real compression.",
        "",
        f"One threshold was tuned on data: the stale camera image change level, set to {cal['stale_tau_e']} "
        f"gray levels on {len(cal['robots'])} calibration robots ({cal['n_frozen_frames']:,} injected frozen "
        f"frames against {cal['n_moving_frames']:,} moving frames: {cal['tpr_at_tau'] * 100:.0f}% of frozen "
        f"frames below it, {cal['fpr_at_tau'] * 100:.1f}% of moving frames below it, and the moving frames "
        f"include natural freezes, so that second number is an upper bound). Then every threshold was frozen and "
        f"the faults below were scored on different robots.",
        "",
        "| fault injected | tries | caught | caught, low confidence | missed | skipped | right rung | false extras |",
        "|---|---|---|---|---|---|---|---|",
    ]
    for k, v in S["faults"].items():
        lines.append(f"| {FAULT_NAMES.get(k, k)} | {v['n']} | {v['caught']} | {v['caught_low_confidence']} | "
                     f"{v['missed']} | {v['abstained']} | {v['right_rung']} | {v['new_other_events']} |")
    lines += ["", "**Caught, low confidence** means the tool found the frozen picture, but that camera barely shows "
                  "the arm moving, so the finding is logged and the ladder doesn't act on it. That guard is what stopped "
                  "cameras that can't see the arm from being blamed for stalls in the fleet run, and on these "
                  "episodes it costs more than half the recall. It is defined as 3 times the stale threshold, so "
                  "freezing that threshold at 0.51 made the guard stricter too; I didn't retune it on the test "
                  "robots. **Skipped** means the recording had fewer than two pauses, so a resting offset can't be "
                  "measured in it. **False extras** counts anything else the injected fault set off."]
    L = S["lag"]
    lines += ["", f"Camera delayed by 3 frames: the lag estimate moved by 3 plus or minus 1 on {L['within_1_of_3']} "
                  f"of {L['estimated']} episodes where both estimates existed ({L['n']} tried). Shifts seen: "
                  f"{', '.join(f'{k}: {v}' for k, v in sorted(L['shift_counts'].items(), key=lambda x: int(x[0])))}.",
              "", "Raw rows are in `results/inject_eval.json`."]
    if bench:
        sf = bench["stale_frames"]
        lines += ["", "**Bench set on a physical SO 101** (`recorder/`, `results/bench_eval.json`): stale frames "
                      f"{sf.get('true_stale', 0)} true, {sf.get('caught', 0)} caught, {sf.get('missed', 0)} missed, "
                      f"{sf.get('false_alarm', 0)} false alarms; {len(bench['rows'])} scheduled faults scored."]
    else:
        lines += ["", "**Bench set on a physical arm: not recorded yet.** The recorder and run sheet are in "
                      "`recorder/` but haven't been run on hardware. `triage bench-eval` scores the set and "
                      "`triage report` adds it here once it exists."]
    return "\n".join(lines)
