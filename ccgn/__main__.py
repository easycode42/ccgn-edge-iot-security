import argparse
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import time
import uuid

import requests

from .onem2m import BASE, CSE_URL, UI_URL, DETECTOR, call, checked, provision, subscribe

ROOT = Path(__file__).resolve().parent.parent


def free_ports():
    for port in (7579, 7580, 7581, 7582):
        with socket.socket() as sock:
            try:
                sock.bind(("127.0.0.1", port))
            except OSError:
                raise RuntimeError(f"Port {port} already in use. Stop the previous demo first.")


CSE_NAMES = {"acme": "ACME", "tinyiot": "tinyIoT"}


def start_cse(kind, run_dir, log):
    """Start the chosen oneM2M CSE on :7579 with a fresh database inside run_dir."""
    env = {**os.environ, "PYTHONUTF8": "1", "PYTHONIOENCODING": "utf-8"}
    if kind == "acme":
        shutil.copyfile(ROOT / "config" / "acme.ini", run_dir / "acme.ini")
        command = [sys.executable, "-X", "utf8", "-m", "acmecse", "--headless", "--base-directory",
                   str(run_dir), "--config", "acme.ini", "--no-remote-cse"]
        cwd = ROOT
    else:
        # tinyIoT is a C server built by tools/setup_tinyiot.sh (Linux / WSL). Port, CSE name and
        # admin originator are compiled in to match config/acme.ini; its SQLite file lands in cwd.
        binary = Path(os.environ.get("CCGN_TINYIOT_BIN") or
                      Path.home() / "ccgn-tinyiot" / "tinyIoT" / "source" / "server" / "server")
        if not binary.is_file():
            raise RuntimeError(f"tinyIoT binary not found at {binary}; run tools/setup_tinyiot.sh "
                               "(Linux / WSL) or set CCGN_TINYIOT_BIN")
        command, cwd = [str(binary)], run_dir
    return subprocess.Popen(command, cwd=cwd, stdout=log, stderr=subprocess.STDOUT, env=env)


def run(cse="acme"):
    from .detector import Detector
    from .mec import MecClient, local_registry
    from .server import dashboard_app, logger_app, serve
    from .store import Store

    free_ports()
    name = CSE_NAMES[cse]
    runtime = Path(os.environ.get("CCGN_RUNTIME") or ROOT / "runtime")
    run_dir = runtime / (time.strftime("%Y%m%d-%H%M%S") + "-" + uuid.uuid4().hex[:6])
    run_dir.mkdir(parents=True)
    log = open(run_dir / f"{cse}-process.log", "w", encoding="utf-8")
    child = None
    servers = []
    try:
        child = start_cse(cse, run_dir, log)
        for _ in range(120):
            if child.poll() is not None:
                raise RuntimeError(f"{name} stopped; see {run_dir / (cse + '-process.log')}")
            try:
                checked(call("GET", BASE))
                break
            except (requests.RequestException, RuntimeError):
                time.sleep(0.25)
        else:
            raise TimeoutError(f"{name} did not become ready within 30 seconds")
        store = Store(run_dir / "events.sqlite3")
        engine = Detector(store)
        ui = dashboard_app(engine, run_dir, ROOT, name)
        servers.extend([serve(ui, 7581), serve(logger_app(engine), 7580), serve(local_registry(), 7582)])
        engine.resources = provision()
        mec = MecClient()
        mec.ready("cse-app")
        mec.register("cse-app", "onem2m-cse", CSE_URL)
        mec.ready("detector-app")
        engine.cse_url = mec.discover("onem2m-cse")
        checked(call("GET", BASE + "/temperature/data", DETECTOR, base=engine.cse_url))
        subscribe(engine.resources)
        mec.register("detector-app", "anomaly-alert", UI_URL + "/api/alerts")
        mec.ready("test-app")
        endpoint = mec.discover("anomaly-alert")
        requests.get(endpoint, timeout=5).raise_for_status()
        store.add("mec", {"mode": "local_mock", "cse": name, "cse_discovered_and_accessed": True,
                           "alert_discovered_and_accessed": True, "etsi_verified": False})
        ui.ccgn_state["ready"] = True
        (runtime / "latest.json").write_text(json.dumps({"directory": str(run_dir), "cse": name}),
                                             encoding="utf-8")
        from .mec_check import latest_status
        print(f"CCGN ready: {UI_URL}\noneM2M CSE: {name} at {CSE_URL}\n"
              f"MEC in this run: local contract double. Real platform: {latest_status(ROOT)}\n"
              f"Evidence: {run_dir}\nCtrl+C to stop.", flush=True)
        while child.poll() is None:
            time.sleep(0.5)
        raise RuntimeError(f"{name} process exited unexpectedly")
    finally:
        for server in servers:
            server.close()
        if child and child.poll() is None:
            child.terminate()
            try:
                child.wait(timeout=10)
            except subprocess.TimeoutExpired:
                child.kill()
                child.wait()
        log.close()


def demo():
    r = requests.post(UI_URL + "/api/scenario/all", headers={"X-CCGN-Control": "local-demo"}, timeout=5)
    r.raise_for_status()
    for _ in range(180):
        state = requests.get(UI_URL + "/api/state", timeout=5).json()
        scenario = state.get("scenario")
        if scenario and not scenario["running"]:
            report = {"cse": state.get("cse"), "mec": state["mec"], "scenario": scenario,
                      "counts": state["counts"]}
            dest = Path(state["runtime"]) / "demo-report.json"
            dest.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
            print(json.dumps(report, indent=2, ensure_ascii=False))
            print(f"Saved: {dest}")
            if not scenario.get("passed"):
                raise RuntimeError(scenario.get("error", "Scenario failed"))
            return
        time.sleep(0.5)
    raise TimeoutError("Demo did not complete within 90 seconds")


def main():
    parser = argparse.ArgumentParser(description="CCGN local edge security demonstrator")
    parser.add_argument("command", choices=["run", "demo", "benchmark", "evaluate", "mec-check", "package"])
    parser.add_argument("--cse", choices=sorted(CSE_NAMES), default=os.environ.get("CCGN_CSE", "acme"),
                        help="run: which oneM2M CSE to start (tinyiot needs Linux / WSL)")
    parser.add_argument("--runs", type=int, default=20, help="benchmark: repetitions per scenario")
    parser.add_argument("--trials", type=int, default=30, help="evaluate: repeated trials with new seeds")
    parser.add_argument("--sandbox", action="store_true",
                        help="mec-check: log in to the ETSI MEC Sandbox and provision app IDs")
    parser.add_argument("--dry-run", action="store_true",
                        help="mec-check: same flow against the local double (not ETSI evidence)")
    args = parser.parse_args()
    if args.command == "run":
        run(args.cse)
    elif args.command == "demo":
        demo()
    elif args.command == "evaluate":
        from .evaluate import evaluate
        evaluate(ROOT, args.trials)
    elif args.command == "benchmark":
        from .benchmark import benchmark
        benchmark(ROOT, args.runs)
    elif args.command == "mec-check":
        from .mec_check import check
        check(ROOT, "dry-run" if args.dry_run else "sandbox" if args.sandbox else "external")
    elif args.command == "package":
        from .package import package
        package(ROOT)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("Stopped.")
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)
