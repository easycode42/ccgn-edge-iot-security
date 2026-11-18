# CCGN — Edge AI IoT Anomaly Detection on oneM2M and ETSI MEC

Team CCGN · 2026 oneM2M International Developer Competition · [한국어 안내](README.ko.md)

CCGN registers simulated sensors on a **real oneM2M CSE — tinyIoT (Sejong University) or ACME,
with the same detector code** — observes both the
request stream and the sensor notifications, detects four kinds of misbehaviour
with rules plus an Isolation Forest, and **blocks a flooding sensor by updating its
ACP — then proves the block with a real request that the CSE denies**. The CSE and
the alert feed are published and discovered as ETSI MEC011 services.

## Status (2026-11-16)

| Area | State | Evidence |
|---|---|---|
| oneM2M flow: sensor AE → CSE → Subscription/Notification → detector AE | Working on **tinyIoT** and **ACME** | `python -m ccgn demo`, `demo-report.json` in the run folder |
| Detection and response for 4 threats | Working locally | 5 scenarios pass; 19 automated tests |
| Detection and blocking latency | Measured on one PC for both CSEs | tinyIoT: [`reports/latency-20261117-000002.json`](reports/latency-20261117-000002.json), ACME: [`reports/latency-20261116-225202.json`](reports/latency-20261116-225202.json) |
| AI model evaluation | Synthetic data, 30 repeated trials | [`reports/evaluation-20261116-225504.json`](reports/evaluation-20261116-225504.json) |
| MEC011 registration / discovery | Working against the **local contract double** | [`reports/mec-dryrun-20261116-225834.json`](reports/mec-dryrun-20261116-225834.json) |
| **Real ETSI MEC Sandbox interworking** | **Passed** with tinyIoT (2026-11-17) and with ACME (2026-11-16); MEC011 API interworking, see scope below | tinyIoT: [`reports/mec-check-20261117-001405.json`](reports/mec-check-20261117-001405.json), ACME: [`reports/mec-check-20261116-231048.json`](reports/mec-check-20261116-231048.json) |

The ETSI claim is limited to what the passed report shows: MEC011 API interworking from
the CCGN host with loopback service endpoints. The dashboard derives its MEC status from
the same report file.

## Presentation and demo video

- [`deliverables/CCGN_Final_Report.pptx`](deliverables/CCGN_Final_Report.pptx) — final report, 17 slides with speaker notes: what we set out to do, use case, how oneM2M is used, how oneM2M and MEC work together, data path, flood walk-through, dashboard, demo, results, limits.
- [`deliverables/CCGN_Demo.mp4`](deliverables/CCGN_Demo.mp4) — 4 min 44 s narrated video: problem and goal, how oneM2M
  and MEC are used, the data path, then a recording of the live dashboard on tinyIoT and the ETSI MEC Sandbox with
  attacks sent from a separate terminal, then the measured results. The narration is synthesised locally from
  [`tools/narration.json`](tools/narration.json) with the Windows voice; replace any clip in
  `deliverables/narration/` with your own recording and rerun `tools/make_video.py`.

Both are generated from the repository: `tools/make_narration.ps1` (narration), `tools/record_walkthrough.mjs`
(drives and records the running dashboard and the attack tool), `tools/build_deck.js` (deck from `reports/*.json`),
`tools/render_slides.ps1` and `tools/make_video.py` (video). Node 22+, PowerPoint and ffmpeg are needed for these
tools only.

## How the demo explains itself

The dashboard (http://127.0.0.1:7581) is built to show *how* the system works, not only that it works:

- **Live architecture** — every request, notification, alert and ACP change lights up the path it actually takes
  (device → request logger → CSE → subscription → detector → alert CIN / ACP update → MEC), with a step-by-step
  list in words underneath.
- **Read from the CSE right now** — the dashboard sends real oneM2M GETs (as `CAdmin`) to the CSE: the ACP rules of
  `temperature-policy` (the `Ctemp` rule disappears when it is blocked), the latest CIN, the alerts stored by the
  detector, and the resource tree via discovery.
- **Inside the detector** — the flood window (requests in the last 2 s vs. the threshold of 12) and the Isolation
  Forest score of every reading.
- **Which service is affected** — one request per second as each device, straight to the CSE: during a flood only
  `Ctemp → temperature/data` is refused; `Cdoor → door/data` keeps working.
- **MEC panel** — the MEC011 service registry (on the Sandbox, next to the platform's own services) and the
  MEC013 location of each device.

Attacks can be sent from a **separate terminal**, independent of the page:

```powershell
wsl --cd "$PWD" -- bash tools/ccgn_wsl.sh attack flood        # also: unregistered, cross, anomaly, normal
```

To run the whole demo on the **real ETSI MEC Sandbox** (MEC011 registry/discovery and MEC013 location):

```powershell
wsl --cd "$PWD" -- bash tools/ccgn_wsl.sh run --mec sandbox   # prints a GitHub device code; ~2-3 min to start
```

Each simulated device AE is paired with one UE of the Sandbox network scenario. After a flood block the detector
asks the MEC013 location API where that UE is attached. On 2026-11-18 this returned `Ctemp = UE 10.1.0.1, zone03,
4g-macro-cell-6` ([`reports/edge-demo-sandbox-20261118-153727.json`](reports/edge-demo-sandbox-20261118-153727.json)).
The pairing is an assignment for the demo: the simulated sensors have no radio of their own. Stop the run with
`Ctrl+C`; it removes the services, app instances and scenario it created on the Sandbox.

## Quick start with ACME (Windows, Python 3.12, Git)

```powershell
.\setup.ps1 -Python 'C:\path\to\python.exe'   # venv + ACME (pinned commit) + dependencies
.\start.ps1                                    # or double-click 실행.cmd
```

When `CCGN ready` appears, open **http://127.0.0.1:7581** and press **Run full demo**
(normal → unknown originator → cross-device access → sensor anomaly → request flood).
The temperature sensor ends up blocked; **Restore sensor access** re-allows it.
Stop with `Ctrl+C`. Everything binds to 127.0.0.1 only.

Linux/macOS: `./setup.sh && ./start.sh` are provided but **have not been tested**;
the verified platform is Windows 11 with Python 3.12.

## Quick start with tinyIoT (Linux or WSL2)

tinyIoT is a C server for Linux/macOS, and the CSE must reach the detector's notification
endpoint on loopback, so in this mode the whole of CCGN runs on the Linux side. On Windows
that means WSL2; the dashboard is still opened at http://127.0.0.1:7581 in the Windows browser.

```powershell
wsl --cd <this folder> -- bash tools/setup_tinyiot.sh   # once: builds tinyIoT (pinned commit), creates a Python venv; no root needed
.\start-tinyiot.ps1                                      # every time
wsl --cd <this folder> -- bash tools/ccgn_wsl.sh demo    # any other command: demo, benchmark, mec-check ...
```

On native Linux: `bash tools/setup_tinyiot.sh`, then `bash tools/ccgn_wsl.sh run`.
tinyIoT is pinned to commit `c140495622a6271fe16c8cf92315c2892c803003` (2026-10-06) and built with
SQLite, port 7579, CSE name `cse-ccgn` and admin originator `CAdmin`, the same values as
`config/acme.ini`. Verified on WSL2 with Ubuntu 24.04.

**Difference between the two CSEs that matters here:** ACME is configured with an allow-list
of AE originators, tinyIoT has none, so on tinyIoT an unknown originator can register an AE of
its own. Reading or writing another AE's data is denied by ACP on both (RSC 4103), which is what
the unknown-originator scenario checks.

ACME is pinned to commit `283bd7d696090e983c07c149511102caab99642e`.
`requirements.lock.txt` holds the verified versions; `.vendor/` and `.venv/` are not
part of the source submission.

## Commands

Run these in a second terminal while the demo is running.

```powershell
$py = '.\.venv\Scripts\python.exe'
& $py -X utf8 -m ccgn demo                  # 5 scenarios with pass/fail and latency
& $py -X utf8 -m ccgn benchmark --runs 30   # repeated live latency measurement -> reports/latency-*
& $py -X utf8 -m ccgn evaluate --trials 30  # offline model evaluation -> reports/evaluation-* (no demo needed)
& $py -X utf8 -m ccgn mec-check --sandbox   # real ETSI MEC Sandbox check (GitHub device login)
& $py -X utf8 -m ccgn mec-check --dry-run   # same flow against the local double (not ETSI evidence)
& $py -m pytest -q                          # 19 automated tests (no demo needed)
& $py -X utf8 -m ccgn package               # source archive -> dist/ccgn-source-<date>.zip
```

## Architecture

```text
Simulated sensors / bounded attack scenarios
          │ oneM2M Mca
          ▼
Request logger :7580 ── forwards ──► oneM2M CSE :7579 (tinyIoT or ACME)
          │ request + response log     │ Subscription / Notification
          ▼                            ▼
              Detector (AE: Cdetector) :7581
                    │ rules + Isolation Forest
                    ├─ alert  → CSE `alerts` container + alert API
                    ├─ flood  → ACP update on the sensor container → verified denial
                    └─ dashboard

CSE registration helper ── MEC011 (Mp1 subset) ──► MEC platform
Detector ── discovers `onem2m-cse` ──────────────► MEC platform, then uses Mca on the discovered URI
Test client ── discovers `anomaly-alert` ────────► MEC platform, then reads the alert API
```

The MEC platform is the local contract double on :7582 in a normal run, or the ETSI MEC
Sandbox when `mec-check --sandbox` is used. The target deployment is TR-0080 Option D.
The service registration is performed by CCGN code, not by a CSE plug-in, and the
request logger is not a protocol-translating IPE.

### Threat handling

| Scenario | Observed data | Detection | Response / verification |
|---|---|---|---|
| Unregistered originator | Logger: originator, request, CSE response | Not in the known ID list | Alert; CSE already denies (RSC 4103) |
| Cross-device access | `Ctemp` reading `door/data`, denied | CSE ACP denial in the log | Alert; not counted as a new block |
| Abnormal temperature | CIN notification from the CSE | 15–40 °C rule + Isolation Forest | Alert only, never an automatic block |
| Request flood by a registered sensor | Requests in a 2 s sliding window | More than 12 requests | Sensor removed from the container ACP, then a real GET must be denied |

The flood scenario sends about 26 requests to this PC only; it is not a DDoS tool.

### oneM2M resources

```text
cse-ccgn (MN-CSE)
├─ temperature (AE: Ctemp) ─ data (CNT, temperature-policy) ─ CINs, detector-sub (SUB, net=3)
├─ door (AE: Cdoor) ─ data (CNT, door-policy)
├─ detector (AE: Cdetector) ─ alerts (CNT, alerts-policy)
└─ temperature-policy / door-policy / alerts-policy (ACP)
```

## Results

All numbers below are from this repository's report files and can be regenerated with
the commands above.

### Live latency — 30 runs of every scenario, one PC, loopback

| Metric (median / 95th percentile) | tinyIoT | ACME |
|---|---|---|
| Sensor reading → model decision (via CSE notification), n=180 | 37.6 / 57.8 ms | 66.6 / 96.2 ms |
| Abnormal reading sent → alert, n=60 | 32.2 / 54.0 ms | 60.5 / 80.8 ms |
| Unknown originator: request arrival → alert, n=30 | 4.8 / 10.2 ms | 16.5 / 34.0 ms |
| Cross-device access: request arrival → alert, n=30 | 5.3 / 12.6 ms | 15.7 / 35.8 ms |
| Flood: threshold-crossing request → alert, n=30 | 6.7 / 47.6 ms | 15.2 / 35.7 ms |
| Flood: block decision → ACP update acknowledged, n=30 | 14.2 / 26.1 ms | 15.4 / 30.6 ms |
| **Flood: threshold-crossing request → sensor blocked at the CSE**, n=30 | **40.8 / 79.7 ms** | **60.5 / 84.9 ms** |
| Flood requests still accepted after the threshold was crossed (mean, max) | 7.90, 12 | 1.13, 2 |

Normal traffic in the same runs: 180 readings and **0 alerts** on each CSE.

The last row is the honest cost of reacting after the fact: the block lands tens of
milliseconds after the threshold is crossed, and tinyIoT answers so quickly that most of the
remaining bounded burst (12 requests) is served before it. A larger burst would be cut off at
that point; a rate limiter in front of the CSE would be needed to stop the first requests.
"Request arrival → alert" includes the forwarded CSE round trip because the logger records the
CSE response first. tinyIoT ran under WSL2 (Ubuntu 24.04, SQLite), ACME on Windows 11 (Python
3.12, in-memory database), both on the same PC. These are single-host figures, not a field,
network, or scale claim, and not a benchmark of the two CSEs against each other.

### Model evaluation — synthetic data

Fixed-seed experiment (unchanged since the interim build): 600 normal samples (10 min at
1 Hz), 20 spike + 20 shift episodes.

| Method | Episodes detected | False alerts / min |
|---|---|---|
| Rules only | 20 / 40 (spike 20, shift 0) | 0.0 |
| Rules + Isolation Forest (what the live detector runs) | 40 / 40 | 1.4 |

Repeated 30 times with new training, normal and attack seeds and two harder attack
shapes (`small_shift` = +2.5 σ, `drift` = +0.8 °C per sample), 20 episodes per kind:

| Method | Spike | Shift | Small shift | Drift | False alerts / min (mean ± sd, range) |
|---|---|---|---|---|---|
| Rules only | 100 % | 0 % | 0 % | 0 % | 0.00 ± 0.00 |
| Rules + AI | 100 % | 100 % | 100 % | 100 % | 1.26 ± 0.41 (0.5–2.0) |
| Rules + AI, two consecutive AI flags *(offline what-if, not deployed)* | 100 % | 100 % | 95.3 % | 100 % | 0.03 ± 0.05 (0.0–0.2) |

Mean samples until the first alert for Rules + AI: spike 1.0, shift 1.0, small shift 1.6,
drift 3.3; the two-consecutive variant needs 1.0 / 2.0 / 3.8 / 4.4.

**How to read this:** a single temperature feature and Gaussian synthetic data make these
attacks easy to separate. The result shows that the AI path adds coverage the fixed range
rule lacks, at the price of about one false alert per minute, and that requiring
persistence would remove most of them. It does not prove real-world accuracy.

## Real ETSI MEC Sandbox check

See [docs/MEC.md](docs/MEC.md). In short, with the demo running:

```powershell
.\.venv\Scripts\python.exe -X utf8 -m ccgn mec-check --sandbox
```

The command prints a GitHub device code, waits for you to authorise the ETSI MEC Sandbox,
activates a network scenario, creates three application instance IDs, runs
`confirm_ready` → register → discover → consume for both services, and removes everything
it created. With tinyIoT: `wsl --cd <this folder> -- bash tools/ccgn_wsl.sh mec-check --sandbox`. A failure is written as `mec-check-*-FAILED.json` and is never replaced by the
local result.

**Result:** passed against `try-mec.etsi.org` with ACME as the CSE on 2026-11-16 and with tinyIoT on 2026-11-17 (scenario `4g-5g-macro-v2x`,
App Support v2): 3 × `confirm_ready` 204, both registrations 201, both discoveries 200,
oneM2M retrieve through the discovered CSE entry RSC 2000, alert API read through the
discovered entry 200, then full clean-up. The first attempt failed because the Sandbox was
called before its per-user services had started; that report is kept as
`reports/mec-check-20261116-230705-FAILED.json` and the client now waits and retries.

## Limits

- The originator string is not authentication. An attacker who copies a registered ID is
  not identified. Do not expose this demo to the Internet.
- Requests sent straight to the CSE (:7579) bypass the request logger; only the
  notification-based detection still sees them. Real deployments need network isolation
  and an authenticated device-to-key mapping.
- Notifications are accepted on loopback without cryptographic sender authentication
  (the subscribed container and duplicate CIN IDs are checked).
- An ACP block denies resource access. It does not stop network traffic or protect the
  CSE from resource exhaustion.
- One temperature sensor, fixed rules, synthetic training data. Multiple devices,
  retraining and real sensor data are future work.
- MEC services are registered with loopback endpoints: the check demonstrates MEC011 API
  interworking from the CCGN host, not MEC application hosting or remote reachability.

## Repository layout

```text
ccgn/            application (CLI, detector, model, oneM2M client, MEC client, dashboard)
config/acme.ini  ACME CSE configuration (loopback, in-memory, ACP checks on)
docs/            MEC Sandbox guide (English and Korean)
deliverables/    final presentation, demo video, dashboard stills
tools/           scripts that regenerate the presentation and the video
reports/         evaluation, latency and MEC check evidence
tests/           automated tests
```

## References and licence

- [ACME oneM2M CSE](https://github.com/ankraft/ACME-oneM2M-CSE)
- [oneM2M Access Control Policies](https://recipes.onem2m.org/basics/Access-Control-Policies/)
- [oneM2M TR-0080 deployment options](https://specifications.onem2m.org/tr/tr-0080/latest/5.1/)
- [ETSI MEC Sandbox help (MEC011)](https://mecwiki.etsi.org/index.php?title=MEC_Sandbox_Help)
- [ETSI MEC Sandbox source and Sandbox API](https://labs.etsi.org/rep/mec/etsi-mec-sandbox)

CCGN source code: [Apache License 2.0](LICENSE). CCGN documentation:
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). ACME (BSD-3-Clause) and all
dependencies keep their own licences. AI coding tools were used as development aids.
