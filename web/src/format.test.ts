// node --test src/format.test.ts  (Node 22 strips the types)
import { test } from "node:test";
import assert from "node:assert/strict";
import { agoShort, axisNum, displayTitle, fixed, niceMax, num, partWords, plainLabel, secs, span, splitLabel } from "./format.ts";

test("partWords", () => {
  assert.equal(partWords("observation.images.front_side"), "front side camera");
  assert.equal(partWords("front_side"), "front side camera");
  assert.equal(partWords("top", { cams: ["observation.images.top"] }), "top camera");
  assert.equal(partWords("wrist_flex"), "wrist flex");
  assert.equal(partWords("shoulder_lift"), "shoulder lift");
  assert.equal(partWords("leader.gripper"), "leader gripper");
  assert.equal(partWords("follower.wrist_flex"), "follower wrist flex");
  assert.equal(partWords("joint_stream"), "joint stream");
  assert.equal(partWords("episode"), "recording");
  assert.equal(partWords("arm"), "arm");
  assert.equal(partWords("wrist camera", { fingerprint: "sensing.stale_camera.wrist camera" }), "wrist camera");
});

test("splitLabel", () => {
  assert.deepEqual(splitLabel("follower sits offset from its leader at rest (wrist flex)"), {
    base: "follower sits offset from its leader at rest",
    part: "wrist flex",
  });
  assert.deepEqual(splitLabel("joint stream repeated while commanded to move", "sensing.stale_state.joint_stream"), {
    base: "joint stream repeated while commanded to move",
    part: "joint stream",
  });
  assert.deepEqual(splitLabel("stopped making progress for 2 s or more (arm)", "task.stall.arm"), {
    base: "stopped making progress for 2 s or more",
    part: "arm",
  });
  assert.equal(splitLabel("impossible one frame jumps on a motor (follower.elbow flex)").part, "follower elbow flex");
  assert.equal(splitLabel("video and joint row counts disagree (fixed camera)").part, "fixed camera");
  assert.equal(splitLabel("scene camera froze while the arm moved", "sensing.stale_camera.fixed camera").part, "fixed camera");
});

test("fallback label", () => {
  assert.equal(plainLabel("sensing.duplicated_rows.joint_stream"), "rows repeated in the joint stream");
  assert.deepEqual(splitLabel("sensing.duplicated_rows.joint_stream", "sensing.duplicated_rows.joint_stream"), {
    base: "rows repeated in the joint stream",
    part: "joint stream",
  });
});

test("displayTitle", () => {
  const base = { source: "joint pass", supersedes: null };
  assert.equal(
    displayTitle({ ...base, label: "joint pinned at its limit while pushed further (elbow flex)", fingerprint: "actuation.pinned.elbow_flex", rule: "R3", route: "x" }),
    "Joint pinned at its limit while pushed further",
  );
  assert.equal(
    displayTitle({ ...base, source: "video sample", label: "scene camera froze while the arm moved", fingerprint: "sensing.stale_camera.fixed camera", rule: "R1", route: "camera front_side froze for 167 ms at 2.4 s and came back" }),
    "Scene camera froze while the arm moved",
  );
  assert.equal(
    displayTitle({ ...base, label: "stopped making progress for 2 s or more (arm)", fingerprint: "task.stall.arm", rule: "R5", route: "stall of 3.5 s at 6.9 s, on a recording that also has a offset at rest on wrist_flex; a person should decide whether the task or the arm is at fault" }),
    "Stall on an arm with a standing fault",
  );
  assert.equal(
    displayTitle({ ...base, label: "2 or more missed grasps in a row (gripper)", fingerprint: "task.missed_grasp_sequence.gripper", rule: "R5", route: "2 missed grasps in a row on gripper at 5.0 s, on a recording that also has a calibration mismatch on wrist_flex; a person should decide" }),
    "Missed grasps on an arm with a standing fault",
  );
  assert.equal(
    displayTitle({ ...base, fingerprint: "sensing.stale_camera.observation.images.top", rule: "R1b", supersedes: "x", route: "camera top froze 4 times in this recording; check the camera and its USB link" }),
    "Same camera froze 4 times in this recording",
  );
  assert.equal(
    displayTitle({ ...base, label: "wrist camera froze while the arm moved", fingerprint: "sensing.stale_camera.wrist camera", rule: "R1b", route: "stall of 2.2 s at 8.2 s, right after this: camera wrist froze 5 times in this recording; check the camera and its USB link" }),
    "Stall right after the camera froze",
  );
  assert.equal(
    displayTitle({ ...base, label: "joint stream repeated while commanded to move", fingerprint: "sensing.stale_state.joint_stream", rule: "R1", route: "joint state stream froze for 100 ms at 9.4 s and came back" }),
    "Joint stream froze and came back",
  );
  assert.equal(
    displayTitle({ ...base, label: "stopped making progress for 2 s or more (arm)", fingerprint: "task.stall.arm", rule: "R4", route: "stall of 2.7 s from 17.5 to 20.2 s" }),
    "Stopped making progress for 2 s or more",
  );
});

test("numbers and times", () => {
  assert.equal(num(48208), "48,208");
  assert.equal(num(1427), "1,427");
  assert.equal(secs(2.43, 2), "2.43 s");
  assert.equal(secs(6.93), "6.9 s");
  assert.equal(span(2.43, 2.6), "2.43 to 2.60 s");
  assert.equal(fixed(-74.2, 0), "−74");
  assert.equal(fixed(-0.001, 1), "0.0");
  assert.equal(agoShort(0.4), "0.4 s ago");
  assert.equal(agoShort(14.2), "14 s ago");
  assert.equal(niceMax(2.43), 2.5);
  assert.equal(niceMax(8.71), 8.8);
  assert.equal(niceMax(1.26), 1.3);
  assert.equal(axisNum(2.5), "2.5");
  assert.equal(axisNum(0), "0");
});
