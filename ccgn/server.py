import logging
import threading
import time
from pathlib import Path

import requests
from flask import Flask, Response, request, send_file

from .mec_check import latest_status
from .onem2m import CSE_URL, UI_URL
from .scenarios import run_scenario

HOP_HEADERS = {"connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
               "te", "trailer", "transfer-encoding", "upgrade", "host", "content-length", "content-encoding"}


def logger_app(engine):
    app = Flask("request-logger")
    app.config["MAX_CONTENT_LENGTH"] = 1024 * 1024

    @app.route("/", defaults={"path": ""}, methods=["GET", "POST", "PUT", "DELETE"])
    @app.route("/<path:path>", methods=["GET", "POST", "PUT", "DELETE"])
    def forward(path):
        started = time.perf_counter()
        # Fixed upstream: never accept an arbitrary destination supplied by the caller.
        headers = {k: v for k, v in request.headers if k.lower() not in HOP_HEADERS}
        try:
            r = requests.request(request.method, CSE_URL + "/" + path, params=request.args,
                                 headers=headers, data=request.get_data(), timeout=8,
                                 allow_redirects=False)
        except requests.RequestException as exc:
            engine.store.add("error", {"source": "request-logger", "message": str(exc)})
            return {"error": "CSE unavailable"}, 502
        record = {"origin": request.headers.get("X-M2M-Origin", ""), "method": request.method,
                  "path": path, "http": r.status_code, "rsc": int(r.headers.get("X-M2M-RSC", 0)),
                  "request_id": request.headers.get("X-M2M-RI", ""), "monotonic": started,
                  "duration_ms": (time.perf_counter() - started) * 1000}
        engine.enqueue("request", record)
        return Response(r.content, r.status_code,
                        {k: v for k, v in r.headers.items() if k.lower() not in HOP_HEADERS})

    return app


def dashboard_app(engine, runtime_dir, root=None, cse="ACME"):
    app = Flask("ccgn-dashboard")
    app.config["MAX_CONTENT_LENGTH"] = 1024 * 1024
    scenario_lock = threading.Lock()
    state = {"ready": False, "scenario": None, "cse": cse}
    app.ccgn_state = state

    @app.get("/")
    def home():
        return send_file(Path(__file__).parent / "static" / "index.html")

    @app.get("/api/state")
    def status():
        # The label changes only when a passed real-platform report exists in reports/.
        mec = latest_status(root) if root else "LOCAL MOCK — actual ETSI integration not verified"
        return {**state, "mec": mec, "blocked": engine.blocked, "counts": engine.store.counts(),
                "events": engine.store.recent(limit=60), "sensors": engine.store.recent("sensor", 60),
                "runtime": str(runtime_dir), "queue": engine.events.qsize()}

    @app.get("/api/system")
    def system():
        view = getattr(app, "ccgn_system", None)
        if view is None:
            return {"error": "Starting up"}, 503
        return view.snapshot()

    @app.get("/api/alerts")
    def alerts():
        return {"alerts": engine.store.recent("alert", 100)}

    @app.post("/notify")
    def notify():
        signal = (request.get_json(silent=True) or {}).get("m2m:sgn", {})
        headers = {"X-M2M-RSC": "2000", "X-M2M-RI": request.headers.get("X-M2M-RI", ""),
                   "X-M2M-RVI": "3"}
        if signal.get("vrq"):
            engine.store.add("notification_verified", {"subscription": signal.get("sur")})
            return "", 200, headers
        cin = signal.get("nev", {}).get("rep", {}).get("m2m:cin")
        if cin is None:
            return {"error": "Expected CIN notification"}, 400
        if not engine.enqueue("sensor", cin):
            return {"error": "Queue full"}, 503
        return "", 200, headers

    @app.before_request
    def guard_controls():
        if request.path.startswith("/api/") and request.method == "POST":
            if request.headers.get("X-CCGN-Control") != "local-demo":
                return {"error": "Missing local control header"}, 403
            if request.headers.get("Origin") not in (None, UI_URL):
                return {"error": "Cross-origin control rejected"}, 403

    @app.post("/api/scenario/<name>")
    def scenario(name):
        if name not in ("normal", "unregistered", "acp", "anomaly", "flood", "all"):
            return {"error": "Unknown scenario"}, 404
        if not state["ready"]:
            return {"error": "Starting up"}, 503
        if not scenario_lock.acquire(blocking=False):
            return {"error": "Another scenario is running"}, 409
        state["scenario"] = {"name": name, "running": True}

        def work():
            try:
                names = ("normal", "unregistered", "acp", "anomaly", "flood") if name == "all" else (name,)
                results = [run_scenario(n, engine) for n in names]
                state["scenario"] = {"name": name, "running": False, "passed": True, "results": results}
            except Exception as exc:
                state["scenario"] = {"name": name, "running": False, "passed": False, "error": str(exc)}
                engine.store.add("error", {"source": "scenario", "message": str(exc)})
            finally:
                scenario_lock.release()
        threading.Thread(target=work, daemon=True).start()
        return {"started": name}, 202

    @app.post("/api/restore")
    def restore():
        if not state["ready"] or not scenario_lock.acquire(blocking=False):
            return {"error": "Busy or starting"}, 409
        try:
            engine.events.join()
            engine.restore()
            return {"restored": True}
        finally:
            scenario_lock.release()

    return app


def serve(app, port):
    from waitress import create_server
    logging.getLogger("werkzeug").setLevel(logging.ERROR)
    server = create_server(app, host="127.0.0.1", port=port, threads=6)
    threading.Thread(target=server.run, daemon=True, name=app.name).start()
    return server
