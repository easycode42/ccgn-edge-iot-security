import zipfile

import pytest

from ccgn import detector as detector_module
from ccgn.benchmark import summary
from ccgn.detector import Detector
from ccgn.evaluate import primary, repeated
from ccgn.package import package
from ccgn.store import Store


class Reply:
    def __init__(self, rsc):
        self.headers = {"X-M2M-RSC": str(rsc)}
        self.status_code = 200
        self.content = b"{}"
        self.text = "{}"

    def json(self):
        return {}


def test_flood_block_records_latency(tmp_path, monkeypatch):
    calls = []

    def fake_call(method, path, origin=None, body=None, ty=None, base=None):
        calls.append((method, path, origin))
        # After the ACP update the sensor's verification GET is denied by the CSE.
        return Reply(4103 if method == "GET" and origin == "Ctemp" else 2001 if method == "POST" else 2004)

    monkeypatch.setattr(detector_module, "call", fake_call)
    engine = Detector(Store(tmp_path / "test.sqlite"))
    engine.resources = {"temperature": {"policy": "p", "container": "c", "ri": "r"},
                        "alerts": {"container": "a"}}
    for i in range(13):
        engine.observe_request({"origin": "Ctemp", "rsc": 2000, "monotonic": 100 + i / 1000})
        assert engine.blocked == (i == 12)       # 13th request in the window crosses the threshold
    block = engine.store.recent("response")[0]
    assert block["verified"] and block["rsc"] == 4103
    assert block["acp_update_ms"] >= 0 and block["arrival_to_enforced_ms"] >= block["acp_update_ms"]
    assert block["arrival_to_verified_ms"] >= block["arrival_to_enforced_ms"]
    alert = engine.store.recent("alert")[0]
    assert alert["threat"] == "flood" and alert["detect_ms"] >= 0
    assert [c[0] for c in calls] == ["POST", "PUT", "GET"]   # alert CIN, ACP update, verification


def test_summary_statistics():
    assert summary([]) == {"n": 0}
    result = summary(range(1, 101))
    assert (result["n"], result["median"], result["p95"], result["min"], result["max"]) == (100, 50.5, 95, 1, 100)
    assert summary([7])["stdev"] == 0.0


def test_primary_evaluation_is_reproducible():
    results, rows, normal, episodes = primary()
    assert (normal, episodes) == (600, 40)
    assert results["rules_only"]["detected_episodes"] == 20
    assert results["rules_only"]["by_kind"]["shift"]["detected"] == 0
    assert results["rules_plus_ai"]["detected_episodes"] == 40
    assert results["rules_plus_ai"]["false_alerts"] == 14
    assert len(rows) == 2 * (600 + 400)


def test_repeated_evaluation_shape():
    aggregate, per_trial = repeated(2)
    assert len(per_trial) == 2
    rules, ai = aggregate["rules_only"], aggregate["rules_plus_ai"]
    assert rules["by_kind"]["spike"]["detection_rate"]["mean"] == 1.0
    assert rules["false_alerts_per_minute"]["mean"] == 0.0
    assert ai["episode_detection_rate"]["mean"] >= rules["episode_detection_rate"]["mean"]
    assert rules["by_kind"]["small_shift"]["mean_samples_to_first_alert"] is None


def test_package_excludes_environment_and_runtime(tmp_path):
    (tmp_path / "ccgn" / "__pycache__").mkdir(parents=True)
    (tmp_path / "ccgn" / "a.py").write_text("x = 1")
    (tmp_path / "ccgn" / "__pycache__" / "a.pyc").write_text("")
    (tmp_path / "reports").mkdir()
    (tmp_path / "reports" / "r.json").write_text("{}")
    (tmp_path / "config").mkdir()
    (tmp_path / "config" / ".env").write_text("SECRET=1")
    for excluded in (".venv", ".vendor", "runtime"):
        (tmp_path / excluded).mkdir()
        (tmp_path / excluded / "big.bin").write_text("x")
    (tmp_path / "README.md").write_text("hi")
    names = zipfile.ZipFile(package(tmp_path)).namelist()
    assert sorted(names) == ["ccgn-edge-iot-security/README.md", "ccgn-edge-iot-security/ccgn/a.py",
                             "ccgn-edge-iot-security/reports/r.json"]
