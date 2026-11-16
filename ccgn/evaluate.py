"""Offline synthetic evaluation; not a real deployment performance claim.

primary   The fixed-seed experiment reported since the interim build (kept
          byte-for-byte reproducible so earlier numbers remain comparable).
repeated  The same protocol repeated with fresh training / normal / attack seeds
          and two harder attack shapes, summarised as mean and spread.
"""
import csv
import json
import random
import statistics
import time

from .model import SensorModel, normal_values

METHODS = ("rules_only", "rules_plus_ai", "rules_plus_ai_2consecutive")
KINDS = ("spike", "shift", "small_shift", "drift")


def ai_flags(model, streams):
    """One batched model call for many streams (the forest is slow on tiny batches)."""
    scores = iter(model.model.decision_function([[v] for values in streams for v in values]))
    return [[next(scores) < 0 for _ in values] for values in streams]


def flags(values, ai, method):
    """Per-sample alert decisions for a stream of temperatures and its AI flags."""
    rule = [v < 15 or v > 40 for v in values]
    if method == "rules_only":
        return rule
    if method == "rules_plus_ai":
        return [r or a for r, a in zip(rule, ai)]
    # Offline-only variant: the AI must flag two consecutive samples. Not what the live detector runs.
    return [r or (a and i > 0 and ai[i - 1]) for i, (r, a) in enumerate(zip(rule, ai))]


def episode(kind, rng):
    if kind == "spike":
        return [rng.gauss(65, .3) for _ in range(10)]
    if kind == "shift":
        return [rng.gauss(29, .3) for _ in range(10)]
    if kind == "small_shift":      # 2.5 sigma of the normal distribution; inside the rule range
        return [rng.gauss(24.6, .3) for _ in range(10)]
    return [rng.gauss(23 + 0.8 * i, .3) for i in range(10)]   # drift: +0.8 °C per sample


def score(normal, episodes, ai, method):
    """ai = ai_flags(model, [normal] + episode streams)."""
    normal_flags = flags(normal, ai[0], method)
    result = {"false_alerts": int(sum(normal_flags)),
              "false_alerts_per_minute": sum(normal_flags) / (len(normal) / 60), "by_kind": {}}
    for kind in dict.fromkeys(k for k, _ in episodes):
        runs = [flags(values, a, method) for (k, values), a in zip(episodes, ai[1:]) if k == kind]
        delays = [f.index(True) + 1 for f in runs if any(f)]
        result["by_kind"][kind] = {"detected": len(delays), "total": len(runs),
                                   "mean_samples_to_first_alert":
                                       statistics.fmean(delays) if delays else None}
    detected = sum(v["detected"] for v in result["by_kind"].values())
    result["detected_episodes"] = detected
    result["episode_detection_rate"] = detected / len(episodes)
    return result


def spread(values):
    values = [v for v in values if v is not None]
    if not values:
        return None
    return {"mean": statistics.fmean(values), "stdev": statistics.stdev(values) if len(values) > 1 else 0.0,
            "min": min(values), "max": max(values)}


def primary():
    model = SensorModel()
    normal = normal_values(2026, 600)
    rng = random.Random(31415)
    episodes = [(kind, episode(kind, rng)) for kind in ("spike", "shift") for _ in range(20)]
    ai = ai_flags(model, [normal] + [values for _, values in episodes])
    rows = []
    results = {}
    for method in ("rules_only", "rules_plus_ai"):
        results[method] = score(normal, episodes, ai, method)
        counter = {}
        for (kind, values), a in zip(episodes, ai[1:]):
            index = counter[kind] = counter.get(kind, -1) + 1
            for i, (value, flag) in enumerate(zip(values, flags(values, a, method))):
                rows.append([method, kind, index, i, value, int(flag)])
        for i, (value, flag) in enumerate(zip(normal, flags(normal, ai[0], method))):
            rows.append([method, "normal", "", i, value, int(flag)])
    return results, rows, len(normal), len(episodes)


def repeated(trials):
    per_trial = []
    for trial in range(trials):
        model = SensorModel(seed=1000 + trial)
        normal = normal_values(2000 + trial, 600)
        rng = random.Random(3000 + trial)
        episodes = [(kind, episode(kind, rng)) for kind in KINDS for _ in range(20)]
        ai = ai_flags(model, [normal] + [values for _, values in episodes])
        per_trial.append({method: score(normal, episodes, ai, method) for method in METHODS})
    aggregate = {}
    for method in METHODS:
        runs = [t[method] for t in per_trial]
        aggregate[method] = {
            "false_alerts_per_minute": spread([r["false_alerts_per_minute"] for r in runs]),
            "episode_detection_rate": spread([r["episode_detection_rate"] for r in runs]),
            "by_kind": {kind: {
                "detection_rate": spread([r["by_kind"][kind]["detected"] / r["by_kind"][kind]["total"]
                                          for r in runs]),
                "mean_samples_to_first_alert": spread([r["by_kind"][kind]["mean_samples_to_first_alert"]
                                                       for r in runs])} for kind in KINDS}}
    return aggregate, per_trial


def evaluate(root, trials=30):
    if trials < 1:
        raise ValueError("--trials must be at least 1")
    results, rows, normal_count, episode_count = primary()
    aggregate, per_trial = repeated(trials)
    metrics = {"dataset": "synthetic", "training_seed": 42, "test_seed": 2026,
               "attack_seed": 31415, "normal_samples": normal_count, "normal_sample_interval_seconds": 1,
               "normal_minutes": normal_count / 60, "attack_episodes": episode_count,
               "warning": "Single-temperature feature; no temporal drift model. Offline scores exclude "
                          "network latency. Synthetic Gaussian data; not field accuracy.",
               "results": results,
               "repeated": {
                   "trials": trials, "seeds": "training 1000+t, normal 2000+t, attack 3000+t",
                   "normal_samples_per_trial": 600, "episodes_per_kind_per_trial": 20,
                   "attack_kinds": {"spike": "N(65, 0.3)", "shift": "N(29, 0.3)",
                                    "small_shift": "N(24.6, 0.3)", "drift": "23 + 0.8 °C per sample"},
                   "note": "rules_plus_ai_2consecutive is an offline what-if; the live detector "
                           "runs rules_plus_ai.",
                   "summary": aggregate}}
    out = root / "reports"
    out.mkdir(exist_ok=True)
    stamp = time.strftime("%Y%m%d-%H%M%S")
    path = out / f"evaluation-{stamp}.json"
    path.write_text(json.dumps(metrics, indent=2, ensure_ascii=False), encoding="utf-8")
    with (out / f"evaluation-{stamp}.csv").open("w", newline="", encoding="utf-8") as file:
        writer = csv.writer(file)
        writer.writerow(["method", "scenario", "episode", "sample", "temperature", "alert"])
        writer.writerows(rows)
    with (out / f"evaluation-{stamp}-trials.csv").open("w", newline="", encoding="utf-8") as file:
        writer = csv.writer(file)
        writer.writerow(["trial", "method", "false_alerts_per_minute", "episode_detection_rate"]
                        + [f"{kind}_detected_of_20" for kind in KINDS])
        for trial, result in enumerate(per_trial):
            for method in METHODS:
                r = result[method]
                writer.writerow([trial, method, r["false_alerts_per_minute"], r["episode_detection_rate"]]
                                + [r["by_kind"][kind]["detected"] for kind in KINDS])
    print(json.dumps(metrics, indent=2, ensure_ascii=False))
    print(f"Saved: {path}")
    return metrics
