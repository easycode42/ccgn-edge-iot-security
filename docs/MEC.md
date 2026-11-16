# Real ETSI MEC interworking check

[한국어](MEC.ko.md)

Port 7582 in a normal run is **CCGN's own contract double**. It does not replace the ETSI
MEC Sandbox and proves nothing about conformance. This page describes the check against a
real platform.

**Status on 2026-11-16:** the check **passed against the ETSI MEC Sandbox**
(`try-mec.etsi.org`, scenario `4g-5g-macro-v2x`, App Support v2); evidence in
`reports/mec-check-20261116-231048.json`. An earlier attempt the same day failed and is kept as
`reports/mec-check-20261116-230705-FAILED.json` (see the last section).

## Option A — automatic (recommended)

1. Start the local demo (`.\start.ps1`) and wait for `CCGN ready`.
2. In a second terminal:

   ```powershell
   .\.venv\Scripts\python.exe -X utf8 -m ccgn mec-check --sandbox
   ```

3. The command prints a device code. Open https://github.com/login/device, enter the
   code and authorise the ETSI MEC Sandbox. This is the same sign-in the web UI at
   https://try-mec.etsi.org uses.
4. Wait about 2–3 minutes. The Sandbox starts per-user services after login and after the
   scenario is activated, so the command pauses 15 s before each provisioning step and
   retries for up to 180 s.

What the command does:

| Step | API |
|---|---|
| Device login, get the sandbox name | Sandbox API `POST /login?provider=github`, `GET /namespace` |
| Activate a network scenario (first listed, or `CCGN_MEC_SCENARIO`) | `POST /sandboxNetworkScenarios/{sandbox}` |
| Create 3 application instance IDs on `mep1` | `POST /sandboxAppInstances/{sandbox}` |
| `confirm_ready` for the CSE helper, detector and test client apps | MEC011 App Support (`v2`, falling back to `v1`) |
| Register `ccgn-onem2m-cse-<random>` | MEC011 `POST .../mec_service_mgmt/v1/applications/{id}/services` |
| Discover it and retrieve a oneM2M resource as `Cdetector` over the discovered URI | MEC011 `GET .../services?ser_name=`, then oneM2M Mca |
| Register `ccgn-anomaly-alert-<random>`, discover it, read the alert JSON | MEC011, then the alert API |
| Deregister both services, delete the 3 app IDs, deactivate the scenario, log out | MEC011 `DELETE`, Sandbox API |

Only objects created by this run are removed. Service names carry a random suffix so they
cannot collide with anything else in the sandbox.

## Option B — manual IDs

If you provisioned the sandbox in the web UI, copy the two API roots from the *Try-it*
area and three application instance IDs, then:

```powershell
$env:CCGN_MEC_SERVICE_ROOT = '<...>/mec_service_mgmt/v1'
$env:CCGN_MEC_SUPPORT_ROOT = '<...>/mec_app_support/v2'
$env:CCGN_MEC_CSE_APP_ID = '<CSE helper app instance ID>'
$env:CCGN_MEC_DETECTOR_APP_ID = '<detector app instance ID>'
$env:CCGN_MEC_TEST_APP_ID = '<test client app instance ID>'
# $env:CCGN_MEC_TOKEN = '<bearer token, only if your platform needs one>'
.\.venv\Scripts\python.exe -X utf8 -m ccgn mec-check
```

In this mode the app IDs and the scenario are yours; the command only deregisters the two
services it registered.

## Result

- Pass: `reports/mec-check-<time>.json` with `"passed": true`. For the ETSI Sandbox it also
  has `"etsi_verified": true`, and the dashboard and start-up banner switch from
  "LOCAL MOCK" to "ETSI MEC Sandbox API interworking verified".
- Fail: `reports/mec-check-<time>-FAILED.json` with the failing step and HTTP status. The
  local result is never substituted.
- The report lists each call (step, method, status, duration). It never stores the sandbox
  name, application instance IDs, the device code, or a token.

## Optional settings

| Variable | Default | Meaning |
|---|---|---|
| `CCGN_MEC_SANDBOX_URL` | `https://try-mec.etsi.org` | Sandbox host |
| `CCGN_MEC_PLATFORM` | `mep1` | MEC platform (node) name in the scenario |
| `CCGN_MEC_SCENARIO` | first listed | e.g. `4g-5g-macro-v2x` |
| `CCGN_MEC_READY_WAIT` | `180` | Seconds to keep retrying while the platform comes up |
| `CCGN_MEC_SETTLE` | `15` | Pause before each Sandbox provisioning step |
| `CCGN_MEC_LOGIN_WAIT` | `300` | Seconds to wait for the GitHub authorisation |
| `CCGN_MEC_CSE_ENDPOINT`, `CCGN_MEC_ALERT_ENDPOINT` | loopback URLs | Endpoints written into the service registration |

## Scope of the evidence

The services are registered with **loopback endpoints**, and the consumer code runs on the
same PC. A pass therefore shows MEC011 API interworking — the real platform accepts the
application readiness, stores and returns the service registrations, and CCGN reaches the
oneM2M CSE and the alert API through the discovered entries. It does not show MEC
application hosting, reachability from another host, or conformance certification. Do not
expose the CSE to the Internet to "improve" this check.

If the Sandbox behaves differently from its published API description, the FAILED report
shows the exact step. Differences found and handled on 2026-11-16:

- The login endpoint accepts `provider=github` only, not the `GITHUB` value from the
  OpenAPI file.
- Right after login the Sandbox answers scenario activation with HTTP 500
  (`401 Unauthorized`) until its per-user services are up. The client now waits and retries.
- Scenario activation returns 204, not the documented 201.

References: [MEC Sandbox help](https://mecwiki.etsi.org/index.php?title=MEC_Sandbox_Help),
[Sandbox source and API](https://labs.etsi.org/rep/mec/etsi-mec-sandbox).
