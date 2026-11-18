"""Attack tool that runs in its own terminal, independent of the dashboard.

It talks oneM2M over HTTP to the edge entry point (the request logger in front of the CSE), exactly
like a misbehaving device would. The dashboard is not involved: whatever the dashboard shows
afterwards comes from the detector, the CSE and the MEC registry reacting to these requests.

Bounded on purpose: fixed local address, at most 200 requests. It is not a load-testing tool.
"""
import json
import time
import uuid

import requests

from .onem2m import BASE, DOOR, GATEWAY_URL, SENSOR, UI_URL, call

RESULT = {2000: "OK", 2001: "CREATED", 2004: "UPDATED", 4103: "DENIED by ACP", 4004: "NOT FOUND"}


def show(n, label, r, started):
    rsc = int(r.headers.get("X-M2M-RSC", 0))
    mark = "x" if rsc >= 4000 else " "
    print(f" [{mark}] {n:>3}  {label:<52} RSC {rsc} {RESULT.get(rsc, ''):<14}"
          f"{(time.perf_counter() - started) * 1000:6.1f} ms", flush=True)
    return rsc


def flood(count=40, interval=0.0):
    count = max(1, min(int(count), 200))
    print(f"Request flood: registered temperature sensor {SENSOR} sends {count} GET requests "
          f"to {BASE}/temperature/data via the edge entry point {GATEWAY_URL}\n", flush=True)
    denied_from = None
    for n in range(1, count + 1):
        started = time.perf_counter()
        rsc = show(n, f"GET {BASE}/temperature/data as {SENSOR}",
                   call("GET", BASE + "/temperature/data", SENSOR, base=GATEWAY_URL), started)
        if rsc == 4103 and denied_from is None:
            denied_from = n
        if interval:
            time.sleep(interval)
    print()
    if denied_from:
        print(f"Requests 1-{denied_from - 1} were served. From request {denied_from} on, the CSE itself "
              f"refused {SENSOR}: the detector removed it from the container's ACP.")
    else:
        print("No request was refused. Is the detector running and was access restored before?")


def unregistered():
    print("Unknown originator Cunknown tries to read the temperature data\n")
    started = time.perf_counter()
    show(1, f"GET {BASE}/temperature/data as Cunknown",
         call("GET", BASE + "/temperature/data", "Cunknown", base=GATEWAY_URL), started)


def cross():
    print(f"Registered temperature sensor {SENSOR} tries to read the door sensor's data\n")
    started = time.perf_counter()
    show(1, f"GET {BASE}/door/data as {SENSOR}",
         call("GET", BASE + "/door/data", SENSOR, base=GATEWAY_URL), started)


def anomaly(values=(65.0, 29.0)):
    print(f"Temperature sensor {SENSOR} reports abnormal values (stored in the CSE, then analysed "
          "by the detector through a subscription notification)\n")
    for n, value in enumerate(values, 1):
        body = {"m2m:cin": {"con": json.dumps({"temperature": value, "sample": uuid.uuid4().hex})}}
        started = time.perf_counter()
        show(n, f"POST {BASE}/temperature/data  temperature={value}",
             call("POST", BASE + "/temperature/data", SENSOR, body, 4, GATEWAY_URL), started)


def normal(values=(23.0, 23.2, 22.8)):
    print(f"Temperature sensor {SENSOR} reports normal values\n")
    for n, value in enumerate(values, 1):
        body = {"m2m:cin": {"con": json.dumps({"temperature": value, "sample": uuid.uuid4().hex})}}
        started = time.perf_counter()
        show(n, f"POST {BASE}/temperature/data  temperature={value}",
             call("POST", BASE + "/temperature/data", SENSOR, body, 4, GATEWAY_URL), started)
        time.sleep(0.4)


ATTACKS = {"flood": flood, "unregistered": unregistered, "cross": cross, "anomaly": anomaly,
           "normal": normal}


def attack(kind, count=40):
    try:
        # Readiness is asked from the dashboard, not the logger: a probe there would be logged
        # as traffic from an unknown originator and raise an alert of its own.
        requests.get(UI_URL + "/api/state", timeout=3).raise_for_status()
    except requests.RequestException:
        raise RuntimeError("Start the demo first: the edge entry point is not reachable") from None
    if kind == "flood":
        flood(count)
    else:
        ATTACKS[kind]()
