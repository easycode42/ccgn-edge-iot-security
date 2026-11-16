"""ETSI MEC011 client, MEC Sandbox session helper, and a labelled local contract double.

`MecClient` speaks the MEC011 subset CCGN needs (confirm_ready, service
registration, discovery, deregistration). `Sandbox` drives the ETSI MEC Sandbox
management API (GitHub device login, network scenario, application instance IDs).
`local_registry` is a contract double for offline development only: it is NOT an
ETSI platform and passing against it is never reported as real MEC validation.
"""
import os
import time
import uuid
from urllib.parse import urlsplit

import requests
from flask import Flask, jsonify, request

LOCAL_MEC = "http://127.0.0.1:7582"
SANDBOX_URL = "https://try-mec.etsi.org"
TIMEOUT = 30


class MecError(RuntimeError):
    pass


def is_local(url):
    return urlsplit(url).hostname in ("127.0.0.1", "localhost", "::1")


class Trace:
    """Evidence of each call without identifiers: step name, method, status, duration."""

    def __init__(self):
        self.steps = []

    def send(self, session, step, method, url, expected, **kwargs):
        started = time.perf_counter()
        try:
            response = session.request(method, url, timeout=TIMEOUT, **kwargs)
        except requests.RequestException as exc:
            self.steps.append({"step": step, "method": method, "status": None, "ok": False,
                               "ms": round((time.perf_counter() - started) * 1000, 1)})
            raise MecError(f"{step}: {type(exc).__name__} while calling {urlsplit(url).netloc}") from exc
        ok = response.status_code in expected
        self.steps.append({"step": step, "method": method, "status": response.status_code, "ok": ok,
                           "ms": round((time.perf_counter() - started) * 1000, 1)})
        if not ok:
            raise MecError(f"{step}: HTTP {response.status_code} (expected {sorted(expected)}): "
                           f"{response.text[:300]}")
        return response

    def note(self, step, ok=True, **data):
        self.steps.append({"step": step, "ok": ok, **data})


class MecClient:
    def __init__(self, service_root=None, support_root=None, token=None, trace=None):
        self.service_root = (service_root or LOCAL_MEC + "/mec_service_mgmt/v1").rstrip("/")
        self.support_root = (support_root or LOCAL_MEC + "/mec_app_support/v1").rstrip("/")
        self.trace = trace or Trace()
        self.session = requests.Session()
        self.session.headers["Accept"] = "application/json"
        if token := (token or os.environ.get("CCGN_MEC_TOKEN")):
            self.session.headers["Authorization"] = "Bearer " + token
        self.headers = dict(self.session.headers)

    def ready(self, app_id):
        self.trace.send(self.session, "confirm_ready", "POST",
                        f"{self.support_root}/applications/{app_id}/confirm_ready",
                        {200, 204}, json={"indication": "READY"})

    def register(self, app_id, name, endpoint, category="CCGN"):
        """MEC011 ServiceInfo (clause 8.1.2.2). Returns it with serInstanceId set."""
        body = {"serName": name,
                "serCategory": {"href": "/ccgn/catalogue", "id": category.lower() + "-id",
                                "name": category, "version": "v1"},
                "version": "1.0.0", "state": "ACTIVE",
                "transportInfo": {"id": name + "-http", "name": "REST",
                                  "description": "CCGN " + name, "type": "REST_HTTP",
                                  "protocol": "HTTP", "version": "1.1",
                                  "endpoint": {"uris": [endpoint]}, "security": {}},
                "serializer": "JSON", "scopeOfLocality": "MEC_SYSTEM",
                "consumedLocalOnly": False, "isLocal": True}
        r = self.trace.send(self.session, "register_service:" + name, "POST",
                            f"{self.service_root}/applications/{app_id}/services", {200, 201}, json=body)
        try:
            info = r.json()
        except ValueError:
            info = {}
        if not isinstance(info, dict):
            info = {}
        if not info.get("serInstanceId"):
            location = r.headers.get("Location", "").rstrip("/")
            if not location:
                raise MecError("register_service: response carried neither serInstanceId nor Location")
            info["serInstanceId"] = location.rsplit("/", 1)[-1]
        return info

    def services(self, name=None):
        params = {"ser_name": name} if name else None
        r = self.trace.send(self.session, "discover_services" + (":" + name if name else ""), "GET",
                            f"{self.service_root}/services", {200}, params=params)
        found = r.json()
        if not isinstance(found, list):
            raise MecError("discover_services: expected a JSON list of ServiceInfo")
        # Filter again client-side: a platform may ignore an unsupported query parameter.
        return [s for s in found if not name or s.get("serName") == name]

    def discover(self, name, instance_id=None):
        matches = [s for s in self.services(name) if s.get("state") == "ACTIVE"
                   and (instance_id is None or s.get("serInstanceId") == instance_id)]
        if len(matches) != 1:
            raise MecError(f"Expected one active {name} service, found {len(matches)}")
        try:
            return matches[0]["transportInfo"]["endpoint"]["uris"][0]
        except (KeyError, IndexError, TypeError):
            raise MecError(f"Service {name} has no REST endpoint URI") from None

    def deregister(self, app_id, instance_id):
        self.trace.send(self.session, "deregister_service", "DELETE",
                        f"{self.service_root}/applications/{app_id}/services/{instance_id}", {200, 204})


class Sandbox:
    """ETSI MEC Sandbox management API (sandbox-api/v1). The user authorises on GitHub."""

    def __init__(self, base=None, mep=None, trace=None):
        self.base = (base or os.environ.get("CCGN_MEC_SANDBOX_URL") or SANDBOX_URL).rstrip("/")
        self.api = self.base + "/sandbox-api/v1"
        self.mep = mep or os.environ.get("CCGN_MEC_PLATFORM", "mep1")
        self.trace = trace or Trace()
        self.session = requests.Session()
        self.name = None
        self.scenario = None
        self.apps = []
        # The live Sandbox answers 500 ("401 Unauthorized") while its per-user pods start; the ETSI
        # sample client sleeps 10-20 s between steps. Settle, then retry. No waiting for the double.
        local = is_local(self.base)
        self.settle = 0 if local else float(os.environ.get("CCGN_MEC_SETTLE", 15))
        self.patience = 0 if local else float(os.environ.get("CCGN_MEC_READY_WAIT", 180))

    def _patient(self, call):
        time.sleep(self.settle)
        deadline = time.monotonic() + self.patience
        while True:
            try:
                return call()
            except MecError:
                if time.monotonic() >= deadline:
                    raise
                time.sleep(10)

    def login(self, announce=print, wait_seconds=None, poll_seconds=5):
        wait_seconds = wait_seconds or int(os.environ.get("CCGN_MEC_LOGIN_WAIT", 300))
        provider = os.environ.get("CCGN_MEC_PROVIDER", "github")  # the live Sandbox rejects "GITHUB"
        r = self.trace.send(self.session, "sandbox_login", "POST", self.api + "/login",
                            {200, 201}, params={"provider": provider})
        grant = r.json()
        announce(f"\nOpen {grant['verification_uri']} and enter the code: {grant['user_code']}\n"
                 f"Waiting up to {wait_seconds} s for the authorisation...", flush=True)
        deadline = time.monotonic() + wait_seconds
        while time.monotonic() < deadline:
            try:
                r = self.session.get(self.api + "/namespace", params={"user_code": grant["user_code"]},
                                     timeout=TIMEOUT)
                if r.status_code == 200 and r.json().get("sandbox_name"):
                    self.name = r.json()["sandbox_name"]
                    self.trace.note("sandbox_namespace", status=200)
                    return
            except (requests.RequestException, ValueError):
                pass
            time.sleep(poll_seconds)
        self.trace.note("sandbox_namespace", ok=False)
        raise MecError("Sandbox login was not authorised in time")

    def activate(self):
        wanted = os.environ.get("CCGN_MEC_SCENARIO")
        if not wanted:
            r = self._patient(lambda: self.trace.send(
                self.session, "list_network_scenarios", "GET", self.api + "/sandboxNetworkScenarios",
                {200}, params={"sandbox_name": self.name}))
            listed = r.json()
            if not listed:
                raise MecError("Sandbox returned no network scenarios")
            wanted = listed[0]["id"]
        self._patient(lambda: self.trace.send(
            self.session, "activate_network_scenario", "POST",
            f"{self.api}/sandboxNetworkScenarios/{self.name}", {200, 201, 204},
            params={"network_scenario_id": wanted}))
        self.scenario = wanted
        return wanted

    def create_app(self, label):
        body = {"id": str(uuid.uuid4()), "name": label, "nodeName": self.mep, "type": "USER"}
        self._patient(lambda: self.trace.send(
            self.session, "create_app_instance:" + label, "POST",
            f"{self.api}/sandboxAppInstances/{self.name}", {200, 201}, json=body))
        self.apps.append(body["id"])
        return body["id"]

    def roots(self, support_version="v2"):
        prefix = f"{self.base}/{self.name}/{self.mep}"
        return prefix + "/mec_service_mgmt/v1", f"{prefix}/mec_app_support/{support_version}"

    def close(self):
        """Remove only what this session created. Errors are recorded, not raised."""
        if not self.name:
            return
        calls = [("delete_app_instance", "DELETE", f"{self.api}/sandboxAppInstances/{self.name}/{app}", {})
                 for app in self.apps]
        if self.scenario:
            calls.append(("deactivate_network_scenario", "DELETE",
                          f"{self.api}/sandboxNetworkScenarios/{self.name}/{self.scenario}", {}))
        calls.append(("sandbox_logout", "POST", self.api + "/logout", {"sandbox_name": self.name}))
        for step, method, url, params in calls:
            try:
                self.trace.send(self.session, step, method, url, {200, 204}, params=params)
            except MecError:
                pass
        self.apps, self.scenario, self.name = [], None, None


def local_registry():
    """Contract double of the MEC011 subset and the Sandbox management API. Not ETSI."""
    app = Flask("local-mec-contract-double")
    ready_apps, services, sandboxes = set(), {}, {}

    def routes(rule, **options):
        # The same handler serves the flat root and the Sandbox-style /<sandbox>/<mep>/ prefix.
        def decorator(view):
            app.add_url_rule(rule, view.__name__, view, defaults={"sbx": None, "mep": None}, **options)
            app.add_url_rule("/<sbx>/<mep>" + rule, view.__name__ + "_sbx", view, **options)
            return view
        return decorator

    def unknown(sbx, app_id=None):
        if sbx is None:
            return False
        return sbx not in sandboxes or (app_id is not None and app_id not in sandboxes[sbx]["apps"])

    @app.get("/health")
    def health():
        return {"mode": "LOCAL MOCK — NOT ETSI Sandbox", "services": len(services)}

    @routes("/mec_app_support/<ver>/applications/<app_id>/confirm_ready", methods=["POST"])
    def ready(sbx, mep, ver, app_id):
        if unknown(sbx, app_id):
            return {"error": "Unknown sandbox or application instance"}, 404
        if (request.get_json(silent=True) or {}).get("indication") != "READY":
            return {"error": "Expected READY"}, 400
        ready_apps.add((sbx, app_id))
        return "", 204

    @routes("/mec_service_mgmt/v1/applications/<app_id>/services", methods=["POST"])
    def register(sbx, mep, app_id):
        if unknown(sbx, app_id):
            return {"error": "Unknown sandbox or application instance"}, 404
        if (sbx, app_id) not in ready_apps:
            return {"error": "App not ready"}, 409
        value = request.get_json(silent=True) or {}
        transport = value.get("transportInfo")
        if not all(k in value for k in ("serName", "version", "state", "serializer")) or \
                not isinstance(transport, dict) or \
                not all(k in transport for k in ("id", "name", "type", "protocol", "version",
                                                  "endpoint", "security")):
            return {"error": "Missing mandatory ServiceInfo fields"}, 400
        value["serInstanceId"] = str(uuid.uuid4())
        services[value["serInstanceId"]] = (sbx, app_id, value)
        response = jsonify(value)
        response.headers["Location"] = request.path + "/" + value["serInstanceId"]
        return response, 201

    @routes("/mec_service_mgmt/v1/applications/<app_id>/services/<ser_id>", methods=["DELETE"])
    def deregister(sbx, mep, app_id, ser_id):
        if services.get(ser_id, (None, None))[:2] != (sbx, app_id):
            return {"error": "Service not found for this application"}, 404
        del services[ser_id]
        return "", 204

    @routes("/mec_service_mgmt/v1/services", methods=["GET"])
    def discover(sbx, mep):
        if unknown(sbx):
            return {"error": "Unknown sandbox"}, 404
        name = request.args.get("ser_name")
        return jsonify([v for owner, _, v in services.values()
                        if owner == sbx and (not name or v["serName"] == name)])

    api = "/sandbox-api/v1"

    @app.post(api + "/login")
    def login():
        if request.args.get("provider") != "github":   # as the live Sandbox behaves (2026-11-16)
            return "", 400
        return {"user_code": "LOCAL-" + uuid.uuid4().hex[:4].upper(),
                "verification_uri": LOCAL_MEC + "/health"}, 201

    @app.get(api + "/namespace")
    def namespace():
        if not request.args.get("user_code", "").startswith("LOCAL-"):
            return "", 404
        name = "sbx" + uuid.uuid4().hex[:8]
        sandboxes[name] = {"apps": set(), "scenario": None}
        return {"sandbox_name": name}

    @app.get(api + "/sandboxNetworkScenarios")
    def scenarios():
        if request.args.get("sandbox_name") not in sandboxes:
            return "", 400
        return jsonify([{"id": "local-double-scenario"}])

    @app.post(api + "/sandboxNetworkScenarios/<sbx>")
    def activate(sbx):
        if sbx not in sandboxes or not request.args.get("network_scenario_id"):
            return "", 404
        sandboxes[sbx]["scenario"] = request.args["network_scenario_id"]
        return "", 201

    @app.delete(api + "/sandboxNetworkScenarios/<sbx>/<scenario>")
    def deactivate(sbx, scenario):
        if sbx not in sandboxes or sandboxes[sbx]["scenario"] != scenario:
            return "", 404
        sandboxes[sbx]["scenario"] = None
        return "", 204

    @app.post(api + "/sandboxAppInstances/<sbx>")
    def create_app(sbx):
        value = request.get_json(silent=True) or {}
        if sbx not in sandboxes or not sandboxes[sbx]["scenario"]:
            return "", 404
        if not all(k in value for k in ("id", "name", "nodeName")):
            return "", 400
        sandboxes[sbx]["apps"].add(value["id"])
        return jsonify([value]), 201

    @app.delete(api + "/sandboxAppInstances/<sbx>/<app_id>")
    def delete_app(sbx, app_id):
        if sbx not in sandboxes or app_id not in sandboxes[sbx]["apps"]:
            return "", 404
        sandboxes[sbx]["apps"].discard(app_id)
        return "", 204

    @app.post(api + "/logout")
    def logout():
        if sandboxes.pop(request.args.get("sandbox_name"), None) is None:
            return "", 404
        return "", 200

    return app
