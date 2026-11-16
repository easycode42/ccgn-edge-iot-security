"""MEC client and check flow against the local contract double (never ETSI evidence)."""
import json
import threading

import pytest
from flask import Flask
from waitress import create_server

from ccgn import mec_check
from ccgn.mec import MecClient, MecError, Sandbox, local_registry


def start(app):
    server = create_server(app, host="127.0.0.1", port=0, threads=4)
    threading.Thread(target=server.run, daemon=True).start()
    return server, f"http://127.0.0.1:{server.effective_port}"


@pytest.fixture()
def double():
    server, url = start(local_registry())
    yield url
    server.close()


@pytest.fixture()
def stub():
    """Stands in for the local CSE and the alert API consumed through discovered endpoints."""
    app = Flask("stub")

    @app.get("/cse-ccgn/temperature/data")
    def container():
        return {"m2m:cnt": {"rn": "data"}}, 200, {"X-M2M-RSC": "2000"}

    @app.get("/api/alerts")
    def alerts():
        return {"alerts": [{"threat": "flood"}]}

    server, url = start(app)
    yield url
    server.close()


def client(url):
    return MecClient(url + "/mec_service_mgmt/v1", url + "/mec_app_support/v1")


def test_register_discover_deregister(double):
    mec = client(double)
    with pytest.raises(MecError, match="409"):
        mec.register("app-a", "svc", "http://127.0.0.1:1/x")
    mec.ready("app-a")
    info = mec.register("app-a", "svc", "http://127.0.0.1:1/x")
    assert info["serInstanceId"]
    mec.register("app-a", "other", "http://127.0.0.1:1/y")
    assert mec.discover("svc") == "http://127.0.0.1:1/x"
    with pytest.raises(MecError):
        mec.deregister("app-b", info["serInstanceId"])   # another app must not remove it
    mec.deregister("app-a", info["serInstanceId"])
    with pytest.raises(MecError, match="found 0"):
        mec.discover("svc")
    assert all(step["ok"] is not None and "app-a" not in json.dumps(step) for step in mec.trace.steps)


def test_sandbox_session_provisions_and_cleans_up(double):
    sandbox = Sandbox(double)
    sandbox.login(announce=lambda *a, **k: None, poll_seconds=0)
    with pytest.raises(MecError):
        sandbox.create_app("too-early")           # no network scenario yet
    sandbox.apps.clear()
    sandbox.activate()
    app_id = sandbox.create_app("ccgn-test")
    mec = MecClient(*sandbox.roots("v2"))
    mec.ready(app_id)
    with pytest.raises(MecError, match="404"):
        mec.ready("not-provisioned")
    mec.register(app_id, "svc", "http://127.0.0.1:1/x")
    # Services of one sandbox are not visible through the flat root or another sandbox.
    assert client(double).services() == []
    sandbox.close()
    assert [s["step"] for s in sandbox.trace.steps][-3:] == [
        "delete_app_instance", "deactivate_network_scenario", "sandbox_logout"]
    assert all(s["ok"] for s in sandbox.trace.steps[-3:])


def test_dry_run_check_end_to_end(double, stub, tmp_path, monkeypatch):
    monkeypatch.setattr(mec_check, "LOCAL_MEC", double)
    monkeypatch.setattr(mec_check, "CSE_URL", stub)
    monkeypatch.setattr(mec_check, "UI_URL", stub)
    monkeypatch.setattr(mec_check, "require_local_demo", lambda: None)
    monkeypatch.setattr("builtins.print", lambda *a, **k: None)
    report = mec_check.check(tmp_path, "dry-run")
    assert report["passed"] and report["mode"] == "local_contract_double"
    assert not report["etsi_verified"]
    steps = [s["step"] for s in report["steps"]]
    assert "onem2m_retrieve_via_discovered_cse" in steps and "alerts_via_discovered_service" in steps
    assert steps.count("deregister_service") == 2 and steps[-1] == "sandbox_logout"
    saved = list((tmp_path / "reports").glob("*.json"))
    assert [p.name.startswith("mec-dryrun-") for p in saved] == [True]
    assert "sbx" not in saved[0].read_text(encoding="utf-8")       # no sandbox identifier stored
    # A dry run never changes the dashboard's real-platform status.
    assert mec_check.latest_status(tmp_path).startswith("LOCAL MOCK")


def test_real_modes_refuse_local_double(tmp_path, monkeypatch):
    for key in mec_check.MANUAL_KEYS:
        monkeypatch.delenv(key, raising=False)
    with pytest.raises(RuntimeError, match="configure"):
        mec_check.check(tmp_path)
    for key in mec_check.MANUAL_KEYS:
        monkeypatch.setenv(key, "http://127.0.0.1:7582/mec_service_mgmt/v1")
    with pytest.raises(RuntimeError, match="Local double"):
        mec_check.check(tmp_path)
    monkeypatch.setenv("CCGN_MEC_SANDBOX_URL", "http://localhost:7582")
    with pytest.raises(RuntimeError, match="Local double"):
        mec_check.check(tmp_path, "sandbox")


def test_failed_check_is_recorded_and_cleaned_up(double, tmp_path, monkeypatch):
    monkeypatch.setattr(mec_check, "LOCAL_MEC", double)
    monkeypatch.setattr(mec_check, "CSE_URL", "http://127.0.0.1:9")   # nothing listens: CSE access fails
    monkeypatch.setattr(mec_check, "require_local_demo", lambda: None)
    monkeypatch.setattr("builtins.print", lambda *a, **k: None)
    with pytest.raises(RuntimeError, match="MEC check failed"):
        mec_check.check(tmp_path, "dry-run")
    report = json.loads(next((tmp_path / "reports").glob("*-FAILED.json")).read_text(encoding="utf-8"))
    assert not report["passed"] and report["error"]
    assert "deregister_service" in [s["step"] for s in report["steps"]]
