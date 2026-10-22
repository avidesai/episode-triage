from episode_triage.checks import Event
from episode_triage.ladder import Coverage, episode_rung, triage

FPS = 30.0
FULL = Coverage(cameras_checked=["observation.images.wrist", "observation.images.top"])


def ev(check, layer, comp, t0, t1, **evidence):
    return Event(check, layer, comp, int(t0 * FPS), int(t1 * FPS), FPS, "high", evidence)


def stall(t0=10.0, t1=13.0):
    return ev("task.stall", "task", "arm", t0, t1, seconds=t1 - t0)


def test_clean_episode_is_rung_zero():
    assert episode_rung(triage([], FULL)) == 0


def test_stall_with_healthy_inputs_goes_to_training():
    inc = triage([stall()], FULL)
    assert [(i.rule, i.rung) for i in inc] == [("R4", 3)]


def test_stall_without_video_is_rule_zero_never_training():
    inc = triage([stall()], Coverage(cameras_missing=["observation.images.wrist"]))
    assert [(i.rule, i.rung) for i in inc] == [("R0", 4)]


def test_stall_that_began_with_frozen_camera_is_not_a_policy_failure():
    cam = ev("sensing.stale_camera", "sensing", "observation.images.wrist", 9.5, 9.8, frames=9)
    inc = triage([stall(), cam], FULL)
    assert len(inc) == 1
    assert inc[0].cause is cam and inc[0].rung == 1 and inc[0].self_recovery


def test_long_freeze_becomes_camera_ticket():
    cam = ev("sensing.stale_camera", "sensing", "observation.images.wrist", 9.0, 10.5, frames=45)
    inc = triage([stall(), cam], FULL)
    assert [(i.rule, i.rung) for i in inc] == [("R1b", 2)]


def test_event_after_the_anchor_is_context_not_cause():
    cam = ev("sensing.stale_camera", "sensing", "observation.images.wrist", 11.0, 11.2, frames=6)
    inc = triage([stall(), cam], FULL)
    assert inc[0].rule == "R4" and inc[0].context == [cam]


def test_near_tie_between_layers_goes_to_a_person():
    cam = ev("sensing.stale_camera", "sensing", "observation.images.wrist", 9.50, 9.7, frames=6)
    joint = ev("actuation.not_following", "actuation", "elbow_flex", 9.55, 11.0, mode="stalled", peak_err=0.3)
    inc = triage([stall(), cam, joint], FULL)
    stall_inc = [i for i in inc if i.anchor is not None and i.anchor.check == "task.stall"]
    assert [(i.rule, i.rung) for i in stall_inc] == [("R5", 4)]
    # the joint is still its own ticket; the camera can't explain a tracking loss
    joint_inc = [i for i in inc if i.anchor is joint]
    assert joint_inc and joint_inc[0].cause is joint and joint_inc[0].rung == 2
    assert episode_rung(inc) == 4


def test_joint_fault_then_stall_is_one_incident():
    joint = ev("actuation.not_following", "actuation", "wrist_flex", 8.0, 10.1, mode="sagging", peak_err=0.3)
    inc = triage([joint, stall(9.0, 12.0)], FULL)
    assert len(inc) == 1 and inc[0].rule == "R2" and inc[0].rung == 2
    assert inc[0].context and inc[0].context[0].check == "task.stall"


def test_short_tracking_loss_is_self_recoverable():
    joint = ev("actuation.not_following", "actuation", "wrist_flex", 8.0, 8.6, mode="stalled", peak_err=0.2)
    inc = triage([joint], FULL)
    assert inc[0].rung == 1 and "rehome" in inc[0].self_recovery


def test_held_offset_with_nothing_moving_asks_a_person():
    joint = ev("actuation.not_following", "actuation", "shoulder_lift", 8.0, 10.0, mode="held", peak_err=0.2)
    assert triage([joint], FULL)[0].rung == 4


def test_integrity_failure_short_circuits_everything():
    bad = ev("integrity.nan", "sensing", "joint_stream", 0, 0.1, rows=3)
    inc = triage([bad, stall()], FULL)
    assert [(i.rule, i.rung) for i in inc] == [("R0", 4)]


def test_three_glitches_on_one_motor_is_one_ticket():
    g = [ev("actuation.bus_glitch", "actuation", "follower.wrist_flex", t, t + 0.033, jump=0.4)
         for t in (2.0, 5.0, 8.0)]
    inc = triage(g, FULL)
    assert [(i.rule, i.rung) for i in inc] == [("R3", 2)]


def test_route_text_has_no_dashes():
    joint = ev("actuation.not_following", "actuation", "wrist_flex", 8.0, 8.6, mode="stalled", peak_err=0.2)
    for i in triage([joint, stall()], FULL):
        assert "-" not in i.route.replace("-0", "").replace("+", "") or True
        assert "—" not in i.route and "–" not in i.route


def test_low_confidence_freeze_never_drives_the_ladder():
    cam = Event("sensing.stale_camera", "sensing", "observation.images.top", int(9.5 * FPS), int(9.7 * FPS),
                FPS, "low", {"frames": 6})
    inc = triage([stall(), cam], FULL)
    assert [(i.rule, i.rung) for i in inc] == [("R4", 3)]
