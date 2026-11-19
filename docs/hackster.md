# Hackster write-up draft — CCGN

Draft text for the hackster.io project page, in the section order of the oneM2M hackathon template
(as used by the ESTIMED Hackathon #1 entries). Paste section by section; replace the image
placeholders with the files named in brackets.

The 2026 competition runs together with ESTIMED Hackathon #2. The ESTIMED #1 rubric scored: use case and
the justification for oneM2M–MEC interworking, requirements and measurable KPIs with a baseline,
architecture mapped to a deployment option, a working and reproducible prototype using standard APIs,
and documentation with use-case workflow, architecture, sequence flows and API usage. The sections below
cover each of these.

---

**Title:** CCGN: Edge AI anomaly detection for IoT devices on oneM2M (tinyIoT) and ETSI MEC

**Elevator pitch (one line):** A detector application on the MEC host watches a oneM2M CSE, finds misbehaving
devices with rules and an Isolation Forest, blocks them through oneM2M access control, and asks the MEC
location API where they are attached.

**Things used in this project**

- Software: tinyIoT (oneM2M CSE, Sejong University), ACME oneM2M CSE (second supported CSE), ETSI MEC Sandbox
  (MEC011, MEC013), Python 3.12, Flask, waitress, scikit-learn (Isolation Forest), requests, WSL2 Ubuntu 24.04
- Hardware: one PC (Windows 11). Sensors are simulated oneM2M AEs.

**Video:** [deliverables/CCGN_Demo.mp4] (4 min 44 s, narrated)

---

## 1. Demonstration high level architecture

IoT devices cannot run their own security, and sending every request to the cloud for analysis is slow and moves raw
data off site. CCGN watches the standard oneM2M platform itself, at the edge, and answers with standard oneM2M access
control.

Use case: a smart building runs its sensors on a oneM2M platform hosted on an on-site MEC server. The temperature
sensor is compromised: it floods requests, sends abnormal values and tries to read the door sensor.

1. **Normal:** sensor AEs write readings into their containers on the edge CSE.
2. **Attack:** the compromised sensor floods requests, sends abnormal values, reads another device's data.
3. **Detect at the edge:** the detector AE checks the request records and every reading the CSE notifies:
   rules plus an Isolation Forest.
4. **Respond with oneM2M:** the alert is stored as a content instance. For a flood the sensor is removed from its
   ACP, and the CSE itself refuses it from then on.
5. **Locate with MEC:** the MEC013 location API returns the device's zone and cell. Other devices keep working.

**Why oneM2M and MEC together.** oneM2M alone gives a standard data model and access control, but no
standard way for edge applications to find each other or to learn where a device is attached. MEC alone
gives edge compute and network information, but no common IoT data model or device access control. CCGN
needs both: the detector reads devices through oneM2M, blocks them through oneM2M ACPs, finds the CSE
through MEC011, and locates the offending device through MEC013.

Deployment follows oneM2M TR-0080 **Option D**: the CSE and the detector are both applications on the MEC
host. We chose D because detection, blocking and the data all stay on one edge node: the reaction loop
never leaves the host.

**Requirements and KPIs**

| Requirement | KPI | Target | Measured (tinyIoT, one PC, 30 runs) | Baseline |
|---|---|---|---|---|
| Stop a flooding device quickly | threshold request → block enforced by the CSE | < 100 ms | 40.8 ms median, 79.7 ms p95 | ACME on the same PC: 60.5 ms |
| Prove the block | refusal by the CSE after the ACP update | 100 % of blocks | 30 / 30 verified with RSC 4103 | — |
| Do not disturb normal devices | alerts on normal readings | 0 | 0 of 180 | — |
| Detect value anomalies the rule misses | episodes detected (synthetic) | > rules only | rules + AI 100 % on 4 shapes | rules only: spike 100 %, others 0 % |
| Keep false alarms low | false alerts per minute (synthetic) | ≤ 1 | 1.26 ± 0.41 | rules only 0.00; 2-in-a-row filter 0.03 |
| Locate the source | MEC013 lookup after a block | answered | zone03 · 4g-macro-cell-6, ~1 s | — |
| Standard APIs only | oneM2M Mca, MEC011, MEC013 | — | passed on the ETSI MEC Sandbox | — |

The false-alarm target is not met by the deployed rules + AI setting; the offline two-in-a-row filter
meets it and is the next step.

[image: deliverables/architecture-as-built.png — architecture as built, paths 1–8]

[image: deliverables/slides/slide-06.png — how oneM2M and MEC work together: the MEC011 and MEC013 calls]

## 2. Prerequisites

- oneM2M: TS-0001 (architecture), TS-0004 (core protocol), TS-0009 (HTTP binding), TR-0080 (MEC deployment options)
- ETSI MEC: GS MEC 003 (framework), GS MEC 011 (application enablement: service registry and discovery),
  GS MEC 013 (location API); ETSI MEC Sandbox account (GitHub sign-in)
- Windows 11 with WSL2 (Ubuntu 22.04 or later), Python 3.12, Git, Node 22+ (only for the video tools)

## 3. Download the project

Repository: https://github.com/easycode42/ccgn-edge-iot-security (Apache-2.0 code, CC BY 4.0 documents). Pinned versions: tinyIoT commit `c140495622a6271fe16c8cf92315c2892c803003`,
ACME commit `283bd7d696090e983c07c149511102caab99642e`.

## 4. Start oneM2M platform instance

```powershell
wsl --cd "<repo folder>" -- bash tools/setup_tinyiot.sh      # once: builds tinyIoT, creates the Python environment
wsl --cd "<repo folder>" -- bash tools/ccgn_wsl.sh run        # or: run --mec sandbox for the real ETSI MEC Sandbox
```

tinyIoT is built with SQLite, port 7579, CSE name `cse-ccgn` and admin originator `CAdmin`. On start the runner
provisions the resource tree, registers the CSE as the MEC service `onem2m-cse`, lets the detector discover it,
and creates the subscription.

```text
cse-ccgn (tinyIoT MN-CSE)
├─ temperature (AE Ctemp) ─ data (CNT) ─ CINs, detector-sub (SUB → detector)
├─ door (AE Cdoor) ─ data (CNT)
├─ detector (AE Cdetector) ─ alerts (CNT) ─ alert CINs
└─ temperature-policy · door-policy · alerts-policy (ACP)
```

| oneM2M feature | What it does in CCGN |
|---|---|
| AE registration | Device identity. An originator that is not registered is flagged. |
| CNT / CIN | Sensor readings and alerts are stored at the edge, in the CSE. |
| SUB / notification | The CSE pushes every new reading to the detector: no polling. |
| ACP | Who may read or write. The detector updates it to block a device. |
| RSC 4103 | The CSE's own refusal proves the block is enforced. |
| Discovery (fu=1) | The dashboard lists the live resource tree. |

## 5. Connect your IoT device

The sensors are simulated AEs (`Ctemp`, `Cdoor`). They talk oneM2M over HTTP to the edge entry point (the request
logger on :7580), which forwards to the CSE and records originator, operation and the CSE's result.

Misbehaviour is sent from a separate terminal with the attack tool, the way a compromised device would:

```powershell
wsl --cd "<repo folder>" -- bash tools/ccgn_wsl.sh attack flood      # unregistered | cross | anomaly | normal
```

In MEC Sandbox mode each device AE is paired with one UE of the network scenario (an assignment for the demo; the
simulated sensors have no radio of their own).

## 6. Connect your IoT application

- **Detector AE (`Cdetector`)** — MEC application on the same host. Rules: unknown originator, CSE ACP denial,
  more than 12 requests in 2 s, 15–40 °C. AI: Isolation Forest on every notified temperature reading. Responses:
  alert CIN in `detector/alerts`; for a flood, `PUT temperature-policy` without the sensor, then a real `GET` as the
  sensor must return 4103 before the block counts. After the block it asks MEC013 where the device is attached.
- **MEC011:** the CSE helper app registers `onem2m-cse`; the detector discovers it and uses the discovered URI for
  every Mca request; it publishes `anomaly-alert`, which a consumer MEC app discovers and reads.
- **Dashboard** — shows the live architecture, values read straight from the CSE, the detector internals, which
  service is affected, and the MEC registry and device locations.

## 7. Demonstration

| Scenario | Sent from | Path | What to look at |
|---|---|---|---|
| Normal | dashboard button | sensor → CSE → notification → detector | AI score above 0, no alert |
| Unknown originator | `attack unregistered` | Cunknown → logger → CSE: 4103 | alert stored in the CSE |
| Cross-device access | `attack cross` | Ctemp reads door/data: 4103 | `acp_violation` alert |
| Sensor anomaly | `attack anomaly` | 65 °C and 29 °C via notification | rule catches 65, only AI catches 29; no block |
| Request flood | `attack flood` | burst → >12 in 2 s → ACP update | 2000 → 4103, ACP rule gone, door still OK, MEC013 location |

Run on 2026-11-18 against the ETSI MEC Sandbox (scenario 4g-5g-macro-v2x): the flood source was located as
`Ctemp = UE 10.1.0.1, zone03, 4g-macro-cell-6`; the MEC registry listed our two services next to the platform's own
(mec012, mec013, mec030 …).

Measured on one PC, 30 runs per scenario, tinyIoT: threshold request → block at the CSE 40.8 ms median (79.7 ms p95);
180 normal readings, 0 alerts. Because the block lands after the fact, about 8 more requests of a fast burst are
served first. Offline, on synthetic data, the Isolation Forest adds detection of shifts and slow drifts that the
range rule misses, at about 1.26 false alerts per minute.

**Sequence of a request flood** (every arrow is a real oneM2M or MEC call):

[image: deliverables/sequence-flood.png]

**API usage**

| Step | Standard | Call |
|---|---|---|
| Device data | oneM2M Mca | `CREATE cse-ccgn/temperature/data` (CIN), `RETRIEVE …/data` |
| Analysis input | oneM2M Mca | `SUB detector-sub` → notification to the detector for each new CIN |
| Alert | oneM2M Mca | `CREATE cse-ccgn/detector/alerts` (CIN) |
| Block | oneM2M Mca | `UPDATE cse-ccgn/temperature-policy` (ACP without Ctemp), then `RETRIEVE` as Ctemp → 4103 |
| Find the CSE | MEC011 | `POST …/applications/{appId}/services` (onem2m-cse), `GET …/services` |
| Publish alerts | MEC011 | `POST …/services` (anomaly-alert); a consumer app discovers it |
| Locate the source | MEC013 | `GET …/location/v3/queries/users?address=<UE>` |

[images: deliverables/walkthrough/05-flood-terminal.png, 08-cse-evidence.png, 09-mec-location.png]

## 8. Additional oneM2M resources

- The same detector code runs unchanged on ACME (`--cse acme`); both CSEs passed the ETSI MEC Sandbox MEC011 check.
- Limits: the originator string is not authentication (a copied ID is not detected); requests sent straight to the
  CSE bypass the request logger; one PC, simulated sensors, synthetic training data; MEC endpoints are loopback
  addresses, so this is MEC011/MEC013 API interworking, not MEC application hosting.

## 9. Custom parts and enclosures

None. All devices are simulated oneM2M AEs.

## 10. Schematics

Device (AE) → request logger (edge entry) → tinyIoT MN-CSE (MEC app 1) → subscription → detector AE (MEC app 2)
→ alert CIN / ACP update → MEC platform (MEC011 registry, MEC013 location).

[image: deliverables/walkthrough/01-architecture.png]
