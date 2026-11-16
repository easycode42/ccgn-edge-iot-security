"""MEC interworking check against a real platform. Never relabels the local double as real.

Modes
  sandbox   ETSI MEC Sandbox: GitHub device login, scenario and app instance IDs
            are provisioned through the Sandbox API, then removed again.
  external  API roots and app instance IDs supplied through CCGN_MEC_* variables.
  dry-run   The same sandbox code path against the local contract double (:7582).
            Written as mec-dryrun-*.json and never counted as ETSI evidence.
"""
import json
import os
import time
from urllib.parse import urlsplit

import requests

from .mec import LOCAL_MEC, MecClient, MecError, Sandbox, Trace, is_local
from .onem2m import BASE, CSE_URL, UI_URL, DETECTOR, call, checked

MANUAL_KEYS = ("CCGN_MEC_SERVICE_ROOT", "CCGN_MEC_SUPPORT_ROOT", "CCGN_MEC_CSE_APP_ID",
               "CCGN_MEC_DETECTOR_APP_ID", "CCGN_MEC_TEST_APP_ID")
SCOPE = ("MEC011 API interworking driven from the local CCGN host: registration, discovery and "
         "consumption of the oneM2M CSE and anomaly-alert services. Registered endpoints are "
         "loopback addresses, so this is not MEC application hosting, remote reachability, or "
         "conformance certification.")


def require_local_demo():
    try:
        checked(call("GET", BASE + "/temperature/data", DETECTOR))
        requests.get(UI_URL + "/api/alerts", timeout=5).raise_for_status()
    except (requests.RequestException, RuntimeError) as exc:
        raise RuntimeError("Start the local demo first (start.ps1 / 실행.cmd); "
                           f"the CSE or alert API is not reachable: {exc}") from None


def confirm_ready(mec, sandbox, ids, wait_seconds):
    """The platform of a freshly activated scenario needs time to come up; v2 then v1."""
    versions = ("v2", "v1") if sandbox else (None,)
    deadline = time.monotonic() + wait_seconds
    while True:
        for version in versions:
            if version:
                mec.service_root, mec.support_root = sandbox.roots(version)
            try:
                mec.ready(ids[0])
                for app in ids[1:]:
                    mec.ready(app)
                return version
            except MecError as exc:
                error = exc
        if time.monotonic() >= deadline:
            raise error
        time.sleep(5)


def interwork(mec, ids, cse_endpoint, alert_endpoint, created):
    """ids = (CSE helper app, detector app, test client app)."""
    suffix = "-" + os.urandom(3).hex()  # unique names: never collide with other services
    cse = mec.register(ids[0], "ccgn-onem2m-cse" + suffix, cse_endpoint, "oneM2M")
    created.append((ids[0], cse["serInstanceId"]))
    discovered = mec.discover("ccgn-onem2m-cse" + suffix, cse["serInstanceId"])
    if discovered.rstrip("/") != cse_endpoint.rstrip("/"):
        raise MecError("Discovered CSE endpoint differs from the registered one")
    started = time.perf_counter()
    checked(call("GET", BASE + "/temperature/data", DETECTOR, base=discovered))
    mec.trace.note("onem2m_retrieve_via_discovered_cse", rsc=2000,
                   ms=round((time.perf_counter() - started) * 1000, 1))

    alert = mec.register(ids[1], "ccgn-anomaly-alert" + suffix, alert_endpoint, "Security")
    created.append((ids[1], alert["serInstanceId"]))
    discovered = mec.discover("ccgn-anomaly-alert" + suffix, alert["serInstanceId"])
    started = time.perf_counter()
    response = requests.get(discovered, timeout=10)
    response.raise_for_status()
    alerts = response.json().get("alerts")
    if not isinstance(alerts, list):
        raise MecError("Discovered alert endpoint did not return an alert list")
    mec.trace.note("alerts_via_discovered_service", status=response.status_code, alerts=len(alerts),
                   ms=round((time.perf_counter() - started) * 1000, 1))


def cleanup(mec, created):
    names = set()
    for app, service in created:
        try:
            mec.deregister(app, service)
        except MecError:
            pass
    try:
        names = {s.get("serInstanceId") for s in mec.services()}
        mec.trace.note("services_removed", ok=not names & {s for _, s in created})
    except MecError:
        pass


def check(root, mode="external"):
    trace = Trace()
    sandbox = None
    if mode in ("sandbox", "dry-run"):
        sandbox = Sandbox(LOCAL_MEC if mode == "dry-run" else None, trace=trace)
        if mode == "sandbox" and is_local(sandbox.base):
            raise RuntimeError("Local double must not be labelled as real MEC validation; use --dry-run")
        host = urlsplit(sandbox.base).netloc
    else:
        missing = [k for k in MANUAL_KEYS if not os.environ.get(k)]
        if missing:
            raise RuntimeError("Real MEC validation not run. Use `mec-check --sandbox`, or configure: "
                               + ", ".join(missing))
        if is_local(os.environ[MANUAL_KEYS[0]]) or is_local(os.environ[MANUAL_KEYS[1]]):
            raise RuntimeError("Local double must not be labelled as real MEC validation; use --dry-run")
        host = urlsplit(os.environ[MANUAL_KEYS[0]]).netloc
    require_local_demo()

    report = {"mode": {"sandbox": "etsi_mec_sandbox", "external": "external_mec",
                       "dry-run": "local_contract_double"}[mode],
              "platform_host": host, "etsi_verified": False, "passed": False,
              "started": time.strftime("%Y-%m-%dT%H:%M:%S%z"), "scope": SCOPE}
    created = []
    mec = None
    try:
        if sandbox:
            sandbox.login()
            report["network_scenario"] = sandbox.activate()
            ids = [sandbox.create_app(label) for label in ("ccgn-cse", "ccgn-detector", "ccgn-test")]
            mec = MecClient(*sandbox.roots(), trace=trace)
        else:
            mec = MecClient(os.environ[MANUAL_KEYS[0]], os.environ[MANUAL_KEYS[1]], trace=trace)
            ids = [os.environ[k] for k in MANUAL_KEYS[2:]]
        wait = float(os.environ.get("CCGN_MEC_READY_WAIT", 180 if mode == "sandbox" else 0))
        version = confirm_ready(mec, sandbox, ids, wait)
        if version:
            report["app_support_version"] = version
        interwork(mec, ids, os.getenv("CCGN_MEC_CSE_ENDPOINT", CSE_URL),
                  os.getenv("CCGN_MEC_ALERT_ENDPOINT", UI_URL + "/api/alerts"), created)
        report["passed"] = True
        report["etsi_verified"] = mode == "sandbox" and host.endswith("etsi.org")
        report.update(cse_discovered_and_accessed=True, alerts_discovered_and_accessed=True)
    except Exception as exc:
        report["error"] = str(exc)[:500]
    finally:
        if mec:
            cleanup(mec, created)
        if sandbox:
            sandbox.close()
    # Identifiers (sandbox name, app instance IDs, user code, token) are never written.
    report["steps"] = trace.steps
    out = root / "reports"
    out.mkdir(exist_ok=True)
    prefix = "mec-dryrun" if mode == "dry-run" else "mec-check"
    path = out / f"{prefix}-{time.strftime('%Y%m%d-%H%M%S')}{'' if report['passed'] else '-FAILED'}.json"
    path.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2))
    print(f"Saved: {path}")
    if not report["passed"]:
        raise RuntimeError("MEC check failed: " + report["error"])
    return report


def latest_status(root):
    """Dashboard label: only a passed check against a non-local platform counts."""
    for path in sorted((root / "reports").glob("mec-check-*.json"), reverse=True):
        if path.name.endswith("-FAILED.json"):
            continue
        try:
            report = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        if report.get("passed") and report.get("mode") != "local_contract_double":
            kind = "ETSI MEC Sandbox" if report.get("etsi_verified") else "External MEC platform"
            return f"{kind} API interworking verified {report.get('started', '')[:10]} ({path.name})"
    return "LOCAL MOCK — actual ETSI integration not verified"
