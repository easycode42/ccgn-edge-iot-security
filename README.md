# CCGN — Edge AI IoT Anomaly Detection on oneM2M and ETSI MEC

Team CCGN · 2026 oneM2M International Developer Competition · [한국어 안내](README.ko.md)

CCGN registers simulated sensors on a **real ACME oneM2M CSE**, observes both the
request stream and the sensor notifications, detects four kinds of misbehaviour
with rules plus an Isolation Forest, and **blocks a flooding sensor by updating its
ACP — then proves the block with a real request that the CSE denies**. The CSE and
the alert feed are published and discovered as ETSI MEC011 services.

## Status (2026-11-16)

| Area | State | Evidence |
|---|---|---|
| oneM2M flow: sensor AE → CSE → Subscription/Notification → detector AE | Working | `python -m ccgn demo`, `runtime/<run>/demo-report.json` |
| Detection and response for 4 threats | Working locally | 5 scenarios pass; 19 automated tests |
| Detection and blocking latency | Measured on one PC | [`reports/latency-20261116-225202.json`](reports/latency-20261116-225202.json) |
| AI model evaluation | Synthetic data, 30 repeated trials | [`reports/evaluation-20261116-225504.json`](reports/evaluation-20261116-225504.json) |
| MEC011 registration / discovery | Working against the **local contract double** | [`reports/mec-dryrun-20261116-225834.json`](reports/mec-dryrun-20261116-225834.json) |
| **Real ETSI MEC Sandbox interworking** | **Passed on 2026-11-16** (MEC011 API interworking, see scope below) | [`reports/mec-check-20261116-231048.json`](reports/mec-check-20261116-231048.json) |

The ETSI claim is limited to what the passed report shows: MEC011 API interworking from
the CCGN host with loopback service endpoints. The dashboard derives its MEC status from
the same report file.

## Presentation and demo video

- [`deliverables/CCGN_Final_Report.pptx`](deliverables/CCGN_Final_Report.pptx) — final report, 12 slides with speaker notes.
- [`deliverables/CCGN_Demo.mp4`](deliverables/CCGN_Demo.mp4) — 2 min 12 s captioned walkthrough (no audio): summary slides,
  a screen recording of all five scenarios on the live dashboard, then the measured results.

Both are generated from the repository: `tools/record_demo.mjs` drives and records the running dashboard,
`tools/build_deck.js` builds the deck from `reports/*.json`, `tools/render_slides.ps1` and `tools/make_video.ps1`
assemble the video (Node 22+, PowerPoint and ffmpeg required for these tools only).

## Quick start (Windows, Python 3.12, Git)

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
Request logger :7580 ── forwards ──► ACME MN-CSE :7579
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
The service registration is performed by CCGN code, not by an ACME plug-in, and the
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

| Metric | Median | Mean | p95 | Max |
|---|---|---|---|---|
| Sensor reading → model decision (via CSE notification), n=180 | 66.6 ms | 67.9 ms | 96.2 ms | 131.9 ms |
| Abnormal reading sent → alert, n=60 | 60.5 ms | 62.4 ms | 80.8 ms | 100.2 ms |
| Unknown originator: request arrival → alert, n=30 | 16.5 ms | 19.5 ms | 34.0 ms | 42.4 ms |
| Cross-device access: request arrival → alert, n=30 | 15.7 ms | 20.2 ms | 35.8 ms | 47.7 ms |
| Flood: threshold-crossing request → alert, n=30 | 15.2 ms | 20.8 ms | 35.7 ms | 42.1 ms |
| Flood: block decision → ACP update acknowledged, n=30 | 15.4 ms | 16.8 ms | 30.6 ms | 35.2 ms |
| **Flood: threshold-crossing request → sensor blocked at the CSE**, n=30 | **60.5 ms** | **63.5 ms** | **84.9 ms** | **121.1 ms** |
| Flood requests still accepted after the threshold was crossed | 1 | 1.13 | 2 | 2 |

Normal traffic in the same runs: 180 readings, **0 alerts**. "Request arrival → alert"
includes the forwarded CSE round trip because the logger records the CSE response first.
These are single-host figures (Windows 11, Python 3.12, in-memory CSE); they are not a
field, network, or scale claim.

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
it created. A failure is written as `mec-check-*-FAILED.json` and is never replaced by the
local result.

**Result on 2026-11-16:** passed against `try-mec.etsi.org` (scenario `4g-5g-macro-v2x`,
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
