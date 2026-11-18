"""MEC side of a running demo: MEC011 service registry/discovery and MEC013 device location.

mode "local"   the labelled local stand-in on :7582 (offline, no account needed)
mode "sandbox" the real ETSI MEC Sandbox: GitHub device login, network scenario and three app
               instances are created for this run and removed again when it stops

Each simulated oneM2M device is paired with one UE of the MEC network scenario, so the MEC
Location API can say where a misbehaving device is attached (zone and access point).
"""
import os
import threading
import time

import requests

from .mec import LOCAL_MEC, MecClient, MecError, Sandbox, Trace
from .onem2m import DOOR, SENSOR

APPS = ("ccgn-cse", "ccgn-detector", "ccgn-consumer")


def _first(value):
    return value[0] if isinstance(value, list) and value else value


class MecSession:
    def __init__(self, mode="local", announce=print):
        if mode not in ("local", "sandbox"):
            raise ValueError("MEC mode must be local or sandbox")
        self.mode, self.announce = mode, announce
        self.trace = Trace()
        self.sandbox = None
        self.created = []           # (app id, service instance id) registered by this run
        self.ue = {}                # oneM2M originator -> UE address
        self.lock = threading.Lock()
        self._loc_cache, self._loc_time = {}, 0.0

    # ── setup / teardown ─────────────────────────────────────────────────────────────
    def start(self):
        if self.mode == "local":
            self.client = MecClient(trace=self.trace)
            self.apps = dict(zip(APPS, APPS))
            self.location_root = LOCAL_MEC + "/location/v3"
            for app in self.apps.values():
                self.client.ready(app)
        else:
            self.sandbox = Sandbox(trace=self.trace)
            self.sandbox.login(self.announce)
            self.scenario = self.sandbox.activate()
            self.apps = {label: self.sandbox.create_app(label) for label in APPS}
            self.client = MecClient(*self.sandbox.roots("v2"), trace=self.trace)
            self._confirm_ready()
            self.location_root = f"{self.sandbox.base}/{self.sandbox.name}/{self.sandbox.mep}/location/v3"
        self._pair_devices()

    def _confirm_ready(self, wait=float(os.environ.get("CCGN_MEC_READY_WAIT", 180))):
        deadline = time.monotonic() + wait
        while True:
            for version in ("v2", "v1"):
                self.client.service_root, self.client.support_root = self.sandbox.roots(version)
                try:
                    for app in self.apps.values():
                        self.client.ready(app)
                    return
                except MecError as exc:
                    error = exc
            if time.monotonic() >= deadline:
                raise error
            time.sleep(5)

    def close(self):
        for app, service in self.created:
            try:
                self.client.deregister(app, service)
            except MecError:
                pass
        self.created = []
        if self.sandbox:
            self.sandbox.close()

    # ── MEC011 ───────────────────────────────────────────────────────────────────────
    def register(self, app_label, name, endpoint, category):
        info = self.client.register(self.apps[app_label], name, endpoint, category)
        self.created.append((self.apps[app_label], info["serInstanceId"]))
        return info

    def discover(self, name):
        return self.client.discover(name)

    def list_services(self):
        """For the dashboard: a plain GET that does not grow the evidence trace."""
        r = requests.get(self.client.service_root + "/services", headers=self.client.headers, timeout=5)
        r.raise_for_status()
        return r.json()

    # ── MEC013 location ──────────────────────────────────────────────────────────────
    def users(self):
        r = requests.get(self.location_root + "/queries/users", headers=self.client.headers, timeout=8)
        r.raise_for_status()
        body = r.json()
        users = (body.get("userList") or body.get("userInfo") or {}).get("user", [])
        out = {}
        for u in users if isinstance(users, list) else [users]:
            info = u.get("locationInfo") or {}
            out[u.get("address")] = {"address": u.get("address"), "zone": u.get("zoneId"),
                                     "access_point": u.get("accessPointId"),
                                     "lat": _first(info.get("latitude")), "lon": _first(info.get("longitude"))}
        return out

    def _pair_devices(self):
        try:
            found = sorted(self.users())
        except (requests.RequestException, ValueError) as exc:
            self.trace.note("location_users", ok=False, error=type(exc).__name__)
            return
        wanted = {SENSOR: os.environ.get("CCGN_MEC_UE_CTEMP"), DOOR: os.environ.get("CCGN_MEC_UE_CDOOR")}
        spare = [a for a in found if a not in wanted.values()]
        for origin, address in wanted.items():
            self.ue[origin] = address or (spare.pop(0) if spare else None)
        self.trace.note("location_users", users=len(found))

    def locations(self, max_age=3.0):
        """Current position of each paired device, refreshed at most every few seconds."""
        with self.lock:
            if time.monotonic() - self._loc_time > max_age:
                try:
                    users = self.users()
                    self._loc_cache = {o: users.get(a) for o, a in self.ue.items() if a}
                except (requests.RequestException, ValueError):
                    pass
                self._loc_time = time.monotonic()
            return dict(self._loc_cache)

    def locate(self, origin):
        address = self.ue.get(origin)
        if not address:
            return None
        started = time.perf_counter()
        r = requests.get(self.location_root + "/queries/users", params={"address": address},
                         headers=self.client.headers, timeout=8)
        r.raise_for_status()
        body = r.json()
        users = (body.get("userList") or body.get("userInfo") or {}).get("user", [])
        user = (users[0] if isinstance(users, list) and users else users) or {}
        info = user.get("locationInfo") or {}
        return {"origin": origin, "address": address, "zone": user.get("zoneId"),
                "access_point": user.get("accessPointId"), "lat": _first(info.get("latitude")),
                "lon": _first(info.get("longitude")), "mode": self.mode,
                "query_ms": (time.perf_counter() - started) * 1000}

    def describe(self):
        if self.mode == "sandbox":
            return f"ETSI MEC Sandbox ({self.sandbox.base}, scenario {self.scenario}, {self.sandbox.mep})"
        return "local MEC011/MEC013 stand-in on :7582 (not ETSI)"
