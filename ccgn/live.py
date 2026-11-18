"""Live system view: what the dashboard shows is read from the running CSE and MEC registry.

Nothing here is simulated. The readouts are real oneM2M requests sent by the dashboard as the
admin originator straight to the CSE (they bypass the request logger, so they never count as
traffic for the detector). The service probe sends one request per second as each sensor, also
straight to the CSE, to show which device's service is affected while an attack is handled.
"""
import json
import threading
import time
from collections import deque

import requests

from .onem2m import ADMIN, BASE, DOOR, SENSOR, call

PROBES = ((SENSOR, "temperature"), (DOOR, "door"))


class SystemView:
    def __init__(self, engine, cse_name, mec=None):
        self.engine = engine
        self.cse_name = cse_name
        self.mec = mec
        self.health = {origin: deque(maxlen=90) for origin, _ in PROBES}
        self.cache, self.cache_time = None, 0.0
        self.lock = threading.Lock()
        self.running = False

    # ── service probe ────────────────────────────────────────────────────────────────
    def start_probe(self, interval=1.0):
        self.running = True

        def loop():
            while self.running:
                if self.engine.resources:
                    for origin, name in PROBES:
                        started = time.perf_counter()
                        try:
                            r = call("GET", self.engine.resources[name]["container"], origin,
                                     base=self.engine.cse_url)
                            rsc = int(r.headers.get("X-M2M-RSC", 0))
                        except requests.RequestException:
                            rsc = 0
                        self.health[origin].append({"t": time.time(), "rsc": rsc,
                                                    "ms": (time.perf_counter() - started) * 1000})
                time.sleep(interval)
        threading.Thread(target=loop, daemon=True, name="service-probe").start()

    # ── readouts from the CSE ────────────────────────────────────────────────────────
    def _get(self, path, **params):
        query = "&".join(f"{k}={v}" for k, v in params.items())
        r = call("GET", path + ("?" + query if query else ""), ADMIN, base=self.engine.cse_url)
        rsc = int(r.headers.get("X-M2M-RSC", 0))
        return rsc, (r.json() if r.content and rsc < 3000 else {})

    def _container(self, key):
        res = self.engine.resources[key]
        rsc, body = self._get(res["container"])
        cnt = body.get("m2m:cnt", {})
        out = {"path": res["container"], "ri": res["ri"], "cni": cnt.get("cni"), "cbs": cnt.get("cbs"),
               "acpi": cnt.get("acpi"), "rsc": rsc}
        rsc, body = self._get(res["container"] + "/la")
        cin = body.get("m2m:cin")
        if cin:
            out["latest"] = {"ri": cin.get("ri"), "ct": cin.get("ct"), "con": cin.get("con")}
        return out

    def _policy(self, key):
        path = self.engine.resources[key]["policy"]
        rsc, body = self._get(path)
        rules = body.get("m2m:acp", {}).get("pv", {}).get("acr", [])
        return {"path": path, "rsc": rsc,
                "rules": [{"acor": r.get("acor", []), "acop": r.get("acop")} for r in rules]}

    def _tree(self):
        # Structural resources only (ACP 1, AE 2, CNT 3, SUB 23): content instances are counted per CNT.
        rsc, body = self._get(BASE, fu=1, ty="1+2+3+23")
        uris = body.get("m2m:uril", [])
        if isinstance(uris, dict):
            uris = uris.get("m2m:uril", [])
        return {"rsc": rsc, "uris": sorted(u for u in uris if isinstance(u, str))}

    def _mec(self):
        if not self.mec:
            return {"reachable": False, "services": []}
        out = {"mode": self.mec.mode, "platform": self.mec.describe(), "ue": self.mec.ue}
        try:
            services = self.mec.list_services()
            out.update(reachable=True, services=[
                {"name": s.get("serName"), "state": s.get("state"),
                 "endpoint": (s.get("transportInfo", {}).get("endpoint", {}).get("uris") or [None])[0]}
                for s in services])
        except (requests.RequestException, ValueError):
            out.update(reachable=False, services=[])
        out["locations"] = self.mec.locations()
        return out

    def snapshot(self):
        """Readouts are cached for 0.8 s so a busy dashboard does not load the CSE."""
        with self.lock:
            if self.cache and time.monotonic() - self.cache_time < 0.8:
                return self.cache
            out = {"cse": self.cse_name, "cse_url": self.engine.cse_url, "error": None}
            try:
                if self.engine.resources:
                    out["containers"] = {k: self._container(k) for k in ("temperature", "door", "alerts")}
                    out["policies"] = {k: self._policy(k) for k in ("temperature", "door")}
                    out["tree"] = self._tree()
                    latest = out["containers"]["alerts"].get("latest")
                    if latest:
                        try:
                            latest["alert"] = json.loads(latest["con"])
                            latest["alert"].pop("evidence", None)
                        except (TypeError, ValueError):
                            pass
            except requests.RequestException as exc:
                out["error"] = f"CSE not reachable: {type(exc).__name__}"
            out["mec"] = self._mec()
            now = time.perf_counter()
            with self.engine.lock:
                window = [t for t in self.engine.windows.get(SENSOR, ()) if t >= now - self.engine.window_seconds]
            out["detector"] = {"window_count": len(window), "threshold": self.engine.threshold,
                               "window_seconds": self.engine.window_seconds, "blocked": self.engine.blocked}
            out["health"] = {o: list(h)[-40:] for o, h in self.health.items()}
            self.cache, self.cache_time = out, time.monotonic()
            return out
