"""Small oneM2M HTTP binding client; actual authorization belongs to the CSE."""
import json
import uuid

import requests

BASE = "cse-ccgn"
ADMIN = "CAdmin"
DETECTOR = "Cdetector"
SENSOR = "Ctemp"
DOOR = "Cdoor"
CSE_URL = "http://127.0.0.1:7579"
GATEWAY_URL = "http://127.0.0.1:7580"
UI_URL = "http://127.0.0.1:7581"


def call(method, path, origin=ADMIN, body=None, ty=None, base=CSE_URL):
    headers = {"X-M2M-Origin": origin, "X-M2M-RI": uuid.uuid4().hex,
               "X-M2M-RVI": "3", "Accept": "application/json"}
    if body is not None:
        headers["Content-Type"] = "application/json" + (f";ty={ty}" if ty else "")
    return requests.request(method, f"{base.rstrip('/')}/{path.lstrip('/')}",
                            json=body, headers=headers, timeout=8)


def checked(response, expected=(2000, 2001, 2004)):
    rsc = int(response.headers.get("X-M2M-RSC", 0))
    if rsc not in expected:
        raise RuntimeError(f"oneM2M failed: HTTP {response.status_code}, RSC {rsc}: {response.text[:500]}")
    return response.json() if response.content else {}


def privileges(device=None):
    rules = [{"acor": [ADMIN, DETECTOR], "acop": 63}]
    if device:
        rules.append({"acor": [device], "acop": 3})  # CREATE + RETRIEVE only
    return {"acr": rules}


def provision():
    """Provision our isolated, fresh in-memory CSE. Never delete existing resources."""
    result = {}
    for name, origin in (("detector", DETECTOR), ("temperature", SENSOR), ("door", DOOR)):
        attributes = {"rn": name, "api": "Nccgn." + name,
                      "rr": origin == DETECTOR, "srv": ["3"]}
        if origin == DETECTOR:
            attributes["poa"] = [UI_URL + "/notify"]
        ae = checked(call("POST", BASE, origin, {"m2m:ae": attributes}, 2))["m2m:ae"]
        if ae["aei"] != origin:
            raise RuntimeError(f"Unexpected AE-ID: {ae['aei']} != {origin}")
    for name, origin in (("temperature", SENSOR), ("door", DOOR), ("alerts", None)):
        acp = checked(call("POST", BASE, body={"m2m:acp": {
            "rn": name + "-policy", "pv": privileges(origin),
            "pvs": {"acr": [{"acor": [ADMIN, DETECTOR], "acop": 63}]}}}, ty=1))["m2m:acp"]
        parent = BASE + ("/detector" if name == "alerts" else "/" + name)
        cnt = checked(call("POST", parent, body={"m2m:cnt": {
            "rn": "alerts" if name == "alerts" else "data",
            "acpi": [acp["ri"]], "mni": 1000}}, ty=3))["m2m:cnt"]
        result[name] = {"policy": BASE + "/" + name + "-policy",
                        "container": parent + "/" + cnt["rn"], "ri": cnt["ri"]}
    return result


def subscribe(resources):
    return checked(call("POST", resources["temperature"]["container"], DETECTOR,
                        {"m2m:sub": {"rn": "detector-sub", "nu": [UI_URL + "/notify"],
                                     "enc": {"net": [3]}, "nct": 1}}, 23))


def send_temperature(value, base=GATEWAY_URL, sample=None):
    return call("POST", BASE + "/temperature/data", SENSOR,
                {"m2m:cin": {"con": json.dumps({"temperature": value,
                             "sample": sample or uuid.uuid4().hex})}}, 4, base)
