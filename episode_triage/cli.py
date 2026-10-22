"""triage: command line entry points.

  triage run <dataset dir or hub repo id>      triage every episode of one dataset
  triage fleet-joints <community root>         joint and task checks on every SO arm
  triage fleet-video <community root>          video checks on a seeded random sample
  triage inject-eval <community root>          software fault injection on real episodes
  triage bench-eval <own dataset dir>          compare against the flight recorder's ground truth
  triage report                                rebuild docs/ from results/
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .fleet import _json


def cmd_run(a):
    from .pipeline import profile_for, triage_episode
    from .readers import open_robot

    root = Path(a.dataset)
    remote = None
    if not root.exists():
        from huggingface_hub import snapshot_download
        rev = a.revision
        root = Path(snapshot_download(a.dataset, repo_type="dataset", revision=rev,
                                      allow_patterns=["meta/*", "meta/episodes/*/*", "data/*/*"]))
        remote = (a.dataset, rev or "main")
    robot = open_robot(root, robot_id=a.dataset, remote=remote)
    prof = profile_for(robot)
    eps = robot.episode_indices if a.episodes is None else [int(x) for x in a.episodes.split(",")]
    out = Path(a.out) if a.out else None
    rows = []
    for i in eps:
        r = triage_episode(robot.episode(i), prof, video=not a.no_video)
        rows.append(r.to_dict())
        print(f"episode {i:4d}  rung {r.rung}  " + ("; ".join(x.route for x in r.incidents) or "clean"))
    if out:
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text("\n".join(json.dumps(x, default=_json) for x in rows) + "\n")


def cmd_fleet_joints(a):
    from .fleet import fleet_joint_run
    out = Path(a.out)
    res = fleet_joint_run(a.root, out, workers=a.workers)
    import gzip
    out.with_name(out.name + ".gz").write_bytes(gzip.compress(out.read_bytes()))
    out.unlink()
    n_err = sum("error" in r for r in res)
    n_ep = sum(len(r.get("episodes", [])) for r in res)
    print(f"{len(res)} robots, {n_ep} episodes, {n_err} robots failed to load")


def cmd_fleet_video(a):
    from concurrent.futures import ThreadPoolExecutor

    from .fleet import pick_video_sample, robot_id, run_video_sample, so_arm_dirs
    dirs = so_arm_dirs(a.root)
    picks = pick_video_sample(dirs, a.robots, a.episodes, a.seed)
    out, cache = Path(a.out), Path(a.cache)
    out.parent.mkdir(parents=True, exist_ok=True)
    (out.parent / "video_sample.json").write_text(json.dumps(
        {"seed": a.seed, "robots": a.robots, "episodes_per_robot": a.episodes,
         "picks": [[robot_id(d), e] for d, e in picks]}, indent=1))
    print(f"{len(picks)} robots sampled")
    with ThreadPoolExecutor(a.workers) as ex, out.open("w") as f:
        for k, res in enumerate(ex.map(lambda p: run_video_sample(p[0], p[1], cache), picks), 1):
            f.write(json.dumps(res, default=_json) + "\n")
            f.flush()
            print(f"[{k}/{len(picks)}] {res['robot_id']}: {res.get('error', 'ok')[:80]}", flush=True)


def cmd_rescore(a):
    """Re-score the video sample from cached image change traces, no video download."""
    from .fleet import _read_energies, score_video_sample
    sample = json.loads(Path(a.sample).read_text())
    cache, out = Path(a.cache), Path(a.out)
    root = Path(a.root)
    with out.open("w") as f:
        for rid, eps in sample["picks"]:
            fz = cache / (rid.replace("/", "__") + ".npz")
            if not fz.exists():
                f.write(json.dumps({"robot_id": rid, "error": "no cached video for this robot"}) + "\n")
                continue
            res = score_video_sample(root / rid, eps, _read_energies(fz))
            f.write(json.dumps(res, default=_json) + "\n")
    print(f"rescored {len(sample['picks'])} robots into {out}")


def cmd_inject_eval(a):
    from .validate import inject_eval
    inject_eval(Path(a.sample), Path(a.root), Path(a.out), seed=a.seed, n_calib=a.calib, n_test=a.test,
                reuse_calibration=Path(a.reuse_calibration) if a.reuse_calibration else None)


def cmd_bench_eval(a):
    from .validate import bench_eval
    bench_eval(Path(a.dataset), Path(a.out))


def cmd_report(a):
    from .report import build
    build(Path(a.results), Path(a.out))


def main(argv=None):
    p = argparse.ArgumentParser(prog="triage", description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)

    s = sub.add_parser("run", help="triage one dataset")
    s.add_argument("dataset")
    s.add_argument("--revision")
    s.add_argument("--episodes", help="comma separated episode indices")
    s.add_argument("--no-video", action="store_true")
    s.add_argument("--out")
    s.set_defaults(fn=cmd_run)

    s = sub.add_parser("fleet-joints")
    s.add_argument("root")
    s.add_argument("--out", default="results/fleet_joints.jsonl")
    s.add_argument("--workers", type=int, default=8)
    s.set_defaults(fn=cmd_fleet_joints)

    s = sub.add_parser("fleet-video")
    s.add_argument("root")
    s.add_argument("--robots", type=int, default=120)
    s.add_argument("--episodes", type=int, default=3)
    s.add_argument("--seed", type=int, default=7)
    s.add_argument("--workers", type=int, default=3)
    s.add_argument("--cache", default="results/energy")
    s.add_argument("--out", default="results/fleet_video.jsonl")
    s.set_defaults(fn=cmd_fleet_video)

    s = sub.add_parser("rescore")
    s.add_argument("root")
    s.add_argument("--sample", default="results/video_sample.json")
    s.add_argument("--cache", default="results/energy")
    s.add_argument("--out", default="results/fleet_video.jsonl")
    s.set_defaults(fn=cmd_rescore)

    s = sub.add_parser("inject-eval")
    s.add_argument("root")
    s.add_argument("--sample", default="results/fleet_video.jsonl")
    s.add_argument("--calib", type=int, default=20)
    s.add_argument("--test", type=int, default=40)
    s.add_argument("--seed", type=int, default=11)
    s.add_argument("--reuse-calibration", help="score held out robots only, with the frozen threshold")
    s.add_argument("--out", default="results/inject_eval.json")
    s.set_defaults(fn=cmd_inject_eval)

    s = sub.add_parser("bench-eval")
    s.add_argument("dataset")
    s.add_argument("--out", default="results/bench_eval.json")
    s.set_defaults(fn=cmd_bench_eval)

    s = sub.add_parser("report")
    s.add_argument("--results", default="results")
    s.add_argument("--out", default="docs")
    s.set_defaults(fn=cmd_report)

    a = p.parse_args(argv)
    a.fn(a)


if __name__ == "__main__":
    sys.exit(main())
