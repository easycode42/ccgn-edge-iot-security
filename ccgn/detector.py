import json
import queue
import threading
import time
from collections import defaultdict, deque

from .model import SensorModel
from .onem2m import ADMIN, DETECTOR, SENSOR, DOOR, call, checked, privileges


class Detector:
    def __init__(self, store):
        self.store = store
        self.model = SensorModel()
        self.resources = None
        self.cse_url = None
        self.events = queue.Queue(maxsize=10000)
        self.lock = threading.RLock()
        self.windows = defaultdict(deque)
        self.last_alert = {}
        self.seen = set()
        self.blocked = False
        self.baseline_succeeded = False
        self.threshold = 12
        self.window_seconds = 2.0
        self.started = time.time()
        self.worker = threading.Thread(target=self._run, daemon=True, name="detector")
        self.worker.start()

    def enqueue(self, kind, data):
        try:
            self.events.put_nowait((kind, data))
            return True
        except queue.Full:
            self.store.add("error", {"message": "Detector queue full; event not processed", "source": kind})
            return False

    def _run(self):
        while True:
            kind, data = self.events.get()
            try:
                with self.lock:
                    if kind == "request":
                        self.observe_request(data)
                    elif kind == "sensor":
                        self.observe_sensor(data)
            except Exception as exc:
                self.store.add("error", {"message": str(exc), "source": kind})
            finally:
                self.events.task_done()

    def alert(self, threat, origin, message, evidence, cooldown=2.0):
        now = time.perf_counter()
        key = (threat, origin)
        if now - self.last_alert.get(key, -1e9) < cooldown:
            return
        self.last_alert[key] = now
        data = {"threat": threat, "origin": origin, "message": message, "evidence": evidence,
                "monotonic": now}
        # Detection latency: request arrival at the logger -> alert decision (same process clock).
        if isinstance(evidence, dict) and "monotonic" in evidence:
            data["detect_ms"] = (now - evidence["monotonic"]) * 1000
        self.store.add("alert", data)
        if self.resources:
            checked(call("POST", self.resources["alerts"]["container"], DETECTOR,
                         {"m2m:cin": {"con": json.dumps(data)}}, 4, self.cse_url))

    def observe_request(self, record):
        self.store.add("request", record)
        origin, rsc = record["origin"], record["rsc"]
        if origin in (ADMIN, DETECTOR):
            return
        if origin not in (SENSOR, DOOR):
            self.alert("unregistered", origin, "Unknown originator request observed", record)
            return
        if rsc == 4103:
            self.alert("acp_violation", origin, "CSE denied access under ACP", record)
        if origin != SENSOR:
            return
        if 2000 <= rsc < 3000:
            self.baseline_succeeded = True
        now = record["monotonic"]
        window = self.windows[origin]
        window.append(now)
        while window and window[0] < now - self.window_seconds:
            window.popleft()
        if len(window) > self.threshold and not self.blocked:
            self.alert("flood", origin, "Request frequency exceeded threshold",
                       {"count": len(window), "window_seconds": self.window_seconds,
                        "monotonic": now})
            self.block(now)

    def block(self, arrival=None):
        """arrival: logger clock of the request that crossed the threshold."""
        if not self.resources:
            raise RuntimeError("CSE not provisioned")
        decided = time.perf_counter()
        checked(call("PUT", self.resources["temperature"]["policy"], DETECTOR,
                     {"m2m:acp": {"pv": privileges()}}, base=self.cse_url))
        enforced = time.perf_counter()
        self.blocked = True
        # The detector sends a real request as the sensor to verify CSE enforcement.
        response = call("GET", self.resources["temperature"]["container"], SENSOR, base=self.cse_url)
        rsc = int(response.headers.get("X-M2M-RSC", 0))
        self.store.add("response", {"action": "block", "origin": SENSOR, "rsc": rsc,
                                    "previous_success": self.baseline_succeeded,
                                    "verified": self.baseline_succeeded and rsc == 4103,
                                    "acp_update_ms": (enforced - decided) * 1000,
                                    "arrival_to_enforced_ms":
                                        None if arrival is None else (enforced - arrival) * 1000,
                                    "arrival_to_verified_ms":
                                        None if arrival is None else (time.perf_counter() - arrival) * 1000})

    def restore(self):
        with self.lock:
            checked(call("PUT", self.resources["temperature"]["policy"], DETECTOR,
                         {"m2m:acp": {"pv": privileges(SENSOR)}}, base=self.cse_url))
            self.blocked = False
            self.windows.clear()
            self.last_alert.clear()
            response = call("GET", self.resources["temperature"]["container"], SENSOR, base=self.cse_url)
            checked(response)
            self.baseline_succeeded = True
            self.store.add("response", {"action": "restore", "origin": SENSOR, "verified": True})

    def observe_sensor(self, cin):
        if cin.get("pi") != self.resources["temperature"]["ri"]:
            raise ValueError("Notification parent does not match the subscribed container")
        ri = cin.get("ri")
        if not ri:
            raise ValueError("Missing CIN resource ID")
        if ri in self.seen:
            return
        content = json.loads(cin["con"])
        result = self.model.inspect(content["temperature"])
        self.seen.add(ri)
        data = {"origin": SENSOR, "temperature": content["temperature"],
                "sample": content.get("sample"), "ri": ri, "monotonic": time.perf_counter(), **result}
        self.store.add("sensor", data)
        if result["rule"] or result["ai"]:
            self.alert("sensor_anomaly", SENSOR, "Sensor anomaly; alert only, no automatic block", data, cooldown=0)
