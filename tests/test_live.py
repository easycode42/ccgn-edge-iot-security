"""System view, MEC013 stand-in and flood-source lookup, without a running CSE."""
import threading

import pytest
from waitress import create_server

from ccgn import detector as detector_module
from ccgn.detector import Detector
from ccgn.edge_mec import MecSession
from ccgn.mec import local_registry
from ccgn.store import Store


@pytest.fixture()
def registry(monkeypatch):
    server = create_server(local_registry(), host="127.0.0.1", port=0, threads=4)
    threading.Thread(target=server.run, daemon=True).start()
    url = f"http://127.0.0.1:{server.effective_port}"
    monkeypatch.setattr("ccgn.edge_mec.LOCAL_MEC", url)
    monkeypatch.setattr("ccgn.mec.LOCAL_MEC", url)
    yield url
    server.close()


def test_local_session_pairs_devices_and_locates(registry):
    mec = MecSession("local")
    mec.start()
    assert mec.ue == {"Ctemp": "10.100.0.1", "Cdoor": "10.100.0.2"}
    mec.register("ccgn-cse", "onem2m-cse", "http://127.0.0.1:1", "oneM2M")
    assert mec.discover("onem2m-cse") == "http://127.0.0.1:1"
    where = mec.locate("Ctemp")
    assert (where["zone"], where["access_point"], where["mode"]) == ("zone01", "zone01-4g-macro-cell", "local")
    assert mec.locate("Cunknown") is None
    assert set(mec.locations()) == {"Ctemp", "Cdoor"}
    mec.close()
    assert mec.list_services() == []          # only what this run registered was removed


def test_flood_block_records_mec_location(registry, tmp_path, monkeypatch):
    class Reply:
        def __init__(self, rsc):
            self.headers, self.status_code, self.content, self.text = {"X-M2M-RSC": str(rsc)}, 200, b"{}", "{}"

        def json(self):
            return {}

    monkeypatch.setattr(detector_module, "call", lambda method, path, origin=None, body=None, ty=None, base=None:
                        Reply(4103 if method == "GET" else 2001 if method == "POST" else 2004))
    engine = Detector(Store(tmp_path / "t.sqlite"))
    engine.resources = {"temperature": {"policy": "p", "container": "c", "ri": "r"}, "alerts": {"container": "a"}}
    engine.mec = MecSession("local")
    engine.mec.start()
    for i in range(13):
        engine.observe_request({"origin": "Ctemp", "rsc": 2000, "monotonic": 100 + i / 1000})
    for _ in range(50):
        if engine.store.recent("locate"):
            break
        threading.Event().wait(0.05)
    located = engine.store.recent("locate")[0]
    assert engine.blocked and located["origin"] == "Ctemp" and located["zone"] == "zone01"
    assert located["threat"] == "flood"
