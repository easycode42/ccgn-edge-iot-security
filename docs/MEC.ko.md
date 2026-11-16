# 실제 ETSI MEC 연동 검증

[English](MEC.md)

기본 데모의 7582 포트는 **CCGN이 만든 모의 API**입니다. ETSI MEC Sandbox를 대신하지 않으며 표준 적합성을 증명하지 않습니다. 이 문서는 실제 플랫폼에서 검증하는 방법입니다.

**2026-11-16 기준:** **실제 ETSI MEC Sandbox(`try-mec.etsi.org`)에서 통과했습니다.** 근거는 `reports/mec-check-20261116-231048.json`입니다. 같은 날 첫 시도는 실패했고 그 기록도 `reports/mec-check-20261116-230705-FAILED.json`에 남아 있습니다.

## 방법 A — 자동 (권장)

1. `실행.cmd`로 데모를 켜고 `CCGN ready`를 기다립니다.
2. 다른 터미널에서 실행합니다.

   ```powershell
   .\.venv\Scripts\python.exe -X utf8 -m ccgn mec-check --sandbox
   ```

3. 화면에 기기 코드가 나옵니다. https://github.com/login/device 를 열어 코드를 입력하고 ETSI MEC Sandbox를 승인합니다. https://try-mec.etsi.org 웹 화면과 같은 로그인입니다.
4. 2~3분 기다립니다. Sandbox는 로그인 직후와 시나리오 활성화 직후에 내부 서비스를 띄우므로, 각 준비 단계 전에 15초 쉬고 최대 180초 동안 다시 시도합니다. 로그인 직후 바로 호출하면 `401 Unauthorized`(HTTP 500)가 납니다.

명령이 하는 일:

1. 기기 코드 로그인 후 Sandbox 이름을 받습니다.
2. 네트워크 시나리오를 활성화합니다(목록의 첫 번째, 또는 `CCGN_MEC_SCENARIO`).
3. `mep1`에 앱 인스턴스 ID 3개(CSE 등록 도우미, 탐지기, 테스트 클라이언트)를 만듭니다.
4. 세 앱에 `confirm_ready`를 호출합니다.
5. CSE 주소를 `ccgn-onem2m-cse-<임의값>`으로 등록하고, 검색된 주소로 Cdetector가 실제 CSE 리소스를 조회합니다.
6. 경고 API를 `ccgn-anomaly-alert-<임의값>`으로 등록하고, 검색된 주소에서 경고 JSON을 읽습니다.
7. 등록한 서비스 2개와 앱 ID 3개를 삭제하고, 시나리오를 비활성화한 뒤 로그아웃합니다.

이번 실행이 만든 것만 삭제합니다.

## 방법 B — 직접 준비한 ID 사용

웹 화면에서 Sandbox를 직접 구성했다면 *Try-it* 영역의 API 주소 2개와 앱 인스턴스 ID 3개를 복사해 설정합니다.

```powershell
$env:CCGN_MEC_SERVICE_ROOT = '<복사한 주소, /mec_service_mgmt/v1까지>'
$env:CCGN_MEC_SUPPORT_ROOT = '<복사한 주소, /mec_app_support/v2까지>'
$env:CCGN_MEC_CSE_APP_ID = '<CSE 앱 인스턴스 ID>'
$env:CCGN_MEC_DETECTOR_APP_ID = '<탐지기 앱 인스턴스 ID>'
$env:CCGN_MEC_TEST_APP_ID = '<테스트 앱 인스턴스 ID>'
.\.venv\Scripts\python.exe -X utf8 -m ccgn mec-check
```

이 방법에서는 등록한 서비스 2개만 삭제하고 앱 ID와 시나리오는 건드리지 않습니다.

## 결과 확인

- 성공: `reports/mec-check-<시각>.json`에 `"passed": true`, ETSI Sandbox라면 `"etsi_verified": true`가 기록됩니다. 이후 대시보드와 시작 메시지가 "LOCAL MOCK"에서 "ETSI MEC Sandbox API interworking verified"로 바뀝니다.
- 실패: `reports/mec-check-<시각>-FAILED.json`에 실패한 단계와 HTTP 상태가 남습니다. 로컬 결과로 대체하지 않습니다.
- 보고서에는 호출별 단계·상태·소요 시간만 남습니다. Sandbox 이름, 앱 ID, 기기 코드, 토큰은 저장하지 않습니다.

실패하면 FAILED 파일의 `error`와 마지막 `steps` 항목을 확인하세요. `confirm_ready`에서 404가 계속되면 플랫폼 이름이 `mep1`이 아닐 수 있으니 `CCGN_MEC_PLATFORM`을, 배포가 느리면 `CCGN_MEC_READY_WAIT`을 늘려 다시 실행합니다.

## 이 검증이 증명하는 범위

서비스는 **loopback 주소**로 등록되고, 서비스를 사용하는 코드도 같은 PC에서 실행됩니다. 따라서 성공은 "실제 MEC 플랫폼이 앱 준비 상태를 받고, 서비스 등록을 저장·반환하며, CCGN이 검색된 정보로 oneM2M CSE와 경고 API에 접근한다"는 **MEC011 API 연동**을 뜻합니다. MEC 앱 호스팅, 다른 PC에서의 접근, 표준 적합성 인증을 뜻하지 않습니다. 이 검증을 위해 CSE를 인터넷에 노출하지 마세요.
