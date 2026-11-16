import json
import math

import pytest

from ccgn.detector import Detector
from ccgn.model import SensorModel, normal_values
from ccgn.server import dashboard_app
from ccgn.store import Store


@pytest.fixture(scope="module")
def model():
    return SensorModel()


@pytest.mark.parametrize("value", [float("nan"), float("inf"), "23", True, None])
def test_invalid_sensor_value_rejected(model, value):
    with pytest.raises(ValueError):
        model.inspect(value)


def test_range_rule_and_model_differ(model):
    assert model.inspect(65)["rule"]
    assert not model.inspect(29)["rule"]
    assert model.inspect(29)["ai"]
    assert not model.inspect(23)["ai"]
    assert normal_values(42, 20) != normal_values(2026, 20)


def test_duplicate_and_wrong_container_notifications(tmp_path):
    engine = Detector(Store(tmp_path / "test.sqlite"))
    engine.resources = {"temperature": {"ri": "expected"}}
    cin = {"ri": "cin1", "pi": "expected", "con": json.dumps({"temperature": 23})}
    engine.observe_sensor(cin)
    engine.observe_sensor(cin)
    assert engine.store.counts()["sensor"] == 1
    with pytest.raises(ValueError):
        engine.observe_sensor({**cin, "ri": "cin2", "pi": "wrong"})


def test_unknown_originator_does_not_trigger_block(tmp_path):
    engine = Detector(Store(tmp_path / "test.sqlite"))
    for i in range(30):
        engine.observe_request({"origin": "Cunknown", "rsc": 4103, "monotonic": i / 100})
    assert not engine.blocked
    assert all(e["threat"] == "unregistered" for e in engine.store.recent("alert"))


def test_browser_control_requires_same_origin_and_header(tmp_path):
    engine = Detector(Store(tmp_path / "test.sqlite"))
    client = dashboard_app(engine, tmp_path).test_client()
    assert client.post("/api/restore").status_code == 403
    assert client.post("/api/restore", headers={"X-CCGN-Control": "local-demo",
                                               "Origin": "https://example.com"}).status_code == 403
    assert client.get("/api/state").status_code == 200

