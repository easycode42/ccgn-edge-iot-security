"""Repeated live measurements against the running local demo (loopback only).

Latencies come from one process clock (time.perf_counter) inside the CCGN host, so
they describe this single-PC prototype, not a distributed edge deployment.
"""
import csv
import json
import math
import platform
import statistics
import time

import requests

from .onem2m import UI_URL

SCENARIOS = ("normal", "unregistered", "acp", "anomaly", "flood")
CONTROL = {"X-CCGN-Control": "local-demo"}


def summary(values):
    values = sorted(float(v) for v in values)
    if not values:
        return {"n": 0}
    return {"n": len(values), "mean": statistics.fmean(values), "median": statistics.median(values),
            "p95": values[max(0, math.ceil(0.95 * len(values)) - 1)],
            "min": values[0], "max": values[-1],
            "stdev": statistics.stdev(values) if len(values) > 1 else 0.0}


def run_once(name, timeout=60):
    r = requests.post(f"{UI_URL}/api/scenario/{name}", headers=CONTROL, timeout=5)
    if r.status_code != 202:
        raise RuntimeError(f"Could not start {name}: {r.status_code} {r.text[:200]}")
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        scenario = requests.get(UI_URL + "/api/state", timeout=5).json().get("scenario")
        if scenario and scenario["name"] == name and not scenario["running"]:
            if not scenario.get("passed"):
                raise RuntimeError(f"{name} failed: {scenario.get('error')}")
            return scenario["results"][0]
        time.sleep(0.05)
    raise TimeoutError(f"{name} did not finish within {timeout} s")


def benchmark(root, runs=20):
    if runs < 1:
        raise ValueError("--runs must be at least 1")
    try:
        state = requests.get(UI_URL + "/api/state", timeout=5).json()
    except requests.RequestException:
        raise RuntimeError("Start the local demo first (start.ps1 / 실행.cmd)") from None
    if not state.get("ready"):
        raise RuntimeError("Demo is still starting")
    samples = {}   # metric name -> list of values
    rows = []      # (run, scenario, metric, value)
    normal_alerts = normal_readings = 0
    try:
        for run in range(1, runs + 1):
            for name in SCENARIOS:
                result = run_once(name)
                if name == "normal":
                    normal_alerts += result["alerts"]
                    normal_readings += len(result["latency"]["send_to_inspected_ms"])
                for metric, value in result["latency"].items():
                    for item in value if isinstance(value, list) else [value]:
                        samples.setdefault(f"{name}.{metric}", []).append(item)
                        rows.append((run, name, metric, item))
            print(f"run {run}/{runs} ok", flush=True)
    finally:
        # Leave the temperature sensor usable after the last flood scenario.
        requests.post(UI_URL + "/api/restore", headers=CONTROL, timeout=30)
    report = {
        "kind": "live_loopback_benchmark", "cse": state.get("cse"), "runs": runs,
        "finished": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "host": {"system": platform.platform(), "python": platform.python_version(),
                 "machine": platform.machine()},
        "definitions": {
            "send_to_inspected_ms": "sensor client send -> logger -> CSE -> notification -> model decision",
            "send_to_alert_ms": "client send -> alert decision (anomaly: via CSE notification)",
            "arrival_to_alert_ms": "request arrival at the request logger -> alert decision "
                                   "(includes the forwarded CSE round trip)",
            "acp_update_ms": "block decision -> ACP update acknowledged by the CSE",
            "arrival_to_enforced_ms": "arrival of the threshold-crossing request -> ACP update acknowledged",
            "requests_admitted_after_trigger": "flood requests the CSE still accepted after the "
                                               "threshold-crossing request (count, not ms)"},
        "normal_traffic": {"readings": normal_readings, "alerts": normal_alerts},
        "metrics": {name: summary(values) for name, values in sorted(samples.items())},
        "warning": "Single PC, loopback, one simulated sensor, bounded 25-request burst. "
                   "Not a field or network-scale performance claim."}
    out = root / "reports"
    out.mkdir(exist_ok=True)
    stamp = time.strftime("%Y%m%d-%H%M%S")
    path = out / f"latency-{stamp}.json"
    path.write_text(json.dumps(report, indent=2), encoding="utf-8")
    with (out / f"latency-{stamp}.csv").open("w", newline="", encoding="utf-8") as file:
        writer = csv.writer(file)
        writer.writerow(["run", "scenario", "metric", "value"])
        writer.writerows(rows)
    print(json.dumps(report, indent=2))
    print(f"Saved: {path}")
    return report
