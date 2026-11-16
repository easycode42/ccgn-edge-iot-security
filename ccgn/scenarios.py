"""Bounded scenarios target only this machine's demo CSE through its logger."""
import time
import uuid

from .onem2m import BASE, SENSOR, GATEWAY_URL, call, checked, send_temperature


def wait_for(predicate, timeout=8):
    end = time.perf_counter() + timeout
    while time.perf_counter() < end:
        if predicate():
            return
        time.sleep(0.05)
    raise TimeoutError("Expected detector result did not arrive")


def run_scenario(name, engine):
    # Do not restore while previously queued events are still being processed.
    engine.events.join()
    engine.restore()
    start_id = engine.store.recent(limit=1)[0]["id"]
    started = time.perf_counter()
    evidence = []
    latency = {}

    def new(kind, **match):
        return [r for r in engine.store.recent(kind) if r["id"] > start_id
                and all(r.get(k) == v for k, v in match.items())]

    def timed_alert(threat, sent):
        """Client send -> alert decision, plus logger arrival -> alert decision."""
        alert = new("alert", threat=threat)[-1]
        latency["send_to_alert_ms"] = (alert["monotonic"] - sent) * 1000
        latency["arrival_to_alert_ms"] = alert["detect_ms"]

    def result(response):
        data = {"http": response.status_code, "rsc": int(response.headers.get("X-M2M-RSC", 0))}
        evidence.append(data)
        return data

    if name == "normal":
        sent = {}
        for temp in (23.0, 23.2, 22.8, 23.1, 22.9, 23.3):
            sample = uuid.uuid4().hex
            sent[sample] = time.perf_counter()
            checked(send_temperature(temp, sample=sample))
            time.sleep(0.35)
        wait_for(lambda: len(new("sensor")) >= 6)
        # Sensor send -> CSE -> notification -> model decision, per reading.
        latency["send_to_inspected_ms"] = [(r["monotonic"] - sent[r["sample"]]) * 1000
                                           for r in reversed(new("sensor"))]
    elif name == "unregistered":
        sent = time.perf_counter()
        r = result(call("GET", BASE + "/temperature/data", "Cunknown", base=GATEWAY_URL))
        if r["rsc"] != 4103:
            raise AssertionError(f"Expected ACP denial, got {r}")
        wait_for(lambda: new("alert", threat="unregistered"))
        timed_alert("unregistered", sent)
    elif name == "acp":
        sent = time.perf_counter()
        r = result(call("GET", BASE + "/door/data", SENSOR, base=GATEWAY_URL))
        if r["rsc"] != 4103:
            raise AssertionError(f"Expected cross-device denial, got {r}")
        wait_for(lambda: new("alert", threat="acp_violation"))
        timed_alert("acp_violation", sent)
    elif name == "anomaly":
        sent = {}
        for value in (65.0, 29.0):
            sample = uuid.uuid4().hex
            sent[sample] = time.perf_counter()
            checked(send_temperature(value, sample=sample))
            wait_for(lambda: new("sensor", sample=sample))
        wait_for(lambda: len(new("alert", threat="sensor_anomaly")) >= 2)
        # Sensor send -> CSE -> notification -> model -> alert decision (65°C rule, 29°C AI only).
        latency["send_to_alert_ms"] = [(a["monotonic"] - sent[a["evidence"]["sample"]]) * 1000
                                       for a in reversed(new("alert", threat="sensor_anomaly"))]
    elif name == "flood":
        # One successful request is explicitly observed before the bounded burst.
        checked(call("GET", BASE + "/temperature/data", SENSOR, base=GATEWAY_URL))
        for _ in range(24):
            result(call("GET", BASE + "/temperature/data", SENSOR, base=GATEWAY_URL))
        wait_for(lambda: new("response", action="block", verified=True))
        burst = list(evidence)
        r = result(call("GET", BASE + "/temperature/data", SENSOR, base=GATEWAY_URL))
        if r["rsc"] != 4103:
            raise AssertionError("Post-block sensor request was not denied")
        block = new("response", action="block")[-1]
        latency["arrival_to_alert_ms"] = new("alert", threat="flood")[-1]["detect_ms"]
        latency["acp_update_ms"] = block["acp_update_ms"]
        latency["arrival_to_enforced_ms"] = block["arrival_to_enforced_ms"]
        # The pre-burst GET counts in the window, so burst[threshold - 1] crosses the threshold.
        latency["requests_admitted_after_trigger"] = sum(
            1 for item in burst[engine.threshold:] if item["rsc"] == 2000)
    else:
        raise ValueError("Unknown scenario")
    engine.events.join()
    alerts = [r for r in engine.store.recent("alert") if r["id"] > start_id]
    if name == "normal" and alerts:
        raise AssertionError(f"Unexpected normal-traffic alerts: {alerts}")
    report = {"scenario": name, "passed": True, "duration_seconds": time.perf_counter() - started,
              "responses": evidence, "alerts": len(alerts), "since_event_id": start_id,
              "latency": latency}
    engine.store.add("scenario", report)
    return report
