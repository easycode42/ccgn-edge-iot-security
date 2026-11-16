# CCGN — oneM2M·ETSI MEC 기반 엣지 AI IoT 이상 탐지

팀 CCGN · 2026 oneM2M 국제 개발자 대회 · [English README](README.md) (제출 기준 문서)

실제 oneM2M CSE(**세종대 tinyIoT 또는 ACME, 탐지기 코드는 동일**)에 가상 센서를 등록하고, 요청 기록과 센서 알림을 함께 관찰해 네 가지 이상 행위를 탐지합니다. 요청을 폭주시키는 센서는 **ACP를 변경해 차단하고, 실제 요청이 CSE에서 거부되는 것까지 확인**합니다. CSE와 경고 조회 API는 ETSI MEC011 서비스로 등록·검색됩니다.

## 현재 상태 (2026-11-16)

| 항목 | 상태 | 근거 |
|---|---|---|
| oneM2M 기본 흐름 | **tinyIoT와 ACME 모두** 작동 | `python -m ccgn demo` |
| 4가지 위협 탐지·대응 | 로컬 검증 완료 | 시나리오 5개 통과, 자동 테스트 19개 |
| 탐지·차단 지연 | 두 CSE 모두 측정 완료 | tinyIoT `reports/latency-20261117-000002.json`, ACME `reports/latency-20261116-225202.json` |
| AI 모델 평가 | 합성 데이터, 30회 반복 | `reports/evaluation-20261116-225504.json` |
| MEC 서비스 등록·검색 | **로컬 모의 환경**에서 작동 | `reports/mec-dryrun-20261116-225834.json` |
| **실제 ETSI MEC Sandbox 연동** | **통과** — tinyIoT(11/17), ACME(11/16). MEC011 API 연동, 범위는 아래 한계 참고 | tinyIoT `reports/mec-check-20261117-001405.json`, ACME `reports/mec-check-20261116-231048.json` |

ETSI 관련 주장은 통과 기록이 보여 주는 범위(loopback 주소로 등록한 서비스의 MEC011 API 연동)로 한정합니다. 대시보드의 MEC 상태도 같은 보고서 파일에서 읽습니다.

## 발표자료와 데모 영상

- `deliverables/CCGN_Final_Report.pptx` — 영어 최종 발표자료 12장(발표자 노트 포함)
- `deliverables/CCGN_Demo.mp4` — 2분 12초 자막 영상(음성 없음): 요약 슬라이드 → 대시보드에서 시나리오 5개 실행 녹화 → 측정 결과

둘 다 `tools/` 스크립트로 다시 만들 수 있습니다. 발표자료의 숫자는 `reports/*.json`에서 직접 읽습니다.

## tinyIoT로 실행하기 (WSL)

tinyIoT는 Linux용 C 서버이고, CSE가 탐지기에 알림을 보내려면 같은 쪽에 있어야 해서 이 모드에서는 CCGN 전체가 WSL 안에서 실행됩니다. 대시보드는 그대로 Windows 브라우저에서 http://127.0.0.1:7581 로 엽니다.

1. 최초 1회: `wsl --cd <이 폴더> -- bash tools/setup_tinyiot.sh` (tinyIoT 빌드와 Python 환경 생성, 관리자 권한 불필요). 이 PC에는 이미 되어 있습니다.
2. 실행: **`start-tinyiot.ps1`**
3. 다른 명령: `wsl --cd <이 폴더> -- bash tools/ccgn_wsl.sh demo` (demo, benchmark, mec-check 등)

ACME와 다른 점: tinyIoT에는 AE 등록 허용 목록이 없어서 미등록 ID도 자기 AE는 만들 수 있습니다. 남의 데이터 접근은 두 CSE 모두 ACP로 거부(4103)되며, 미등록 접근 시나리오는 이 거부를 확인합니다.

## ACME로 바로 실행하기

이 컴퓨터에서는 설치가 끝났습니다.

1. **`실행.cmd`** 를 더블클릭합니다.
2. 실행 창에 `CCGN ready`가 나오면 **http://127.0.0.1:7581** 을 엽니다.
3. **Run full demo**를 누릅니다. 정상 → 미등록 접근 → 타 기기 접근 → 센서 이상값 → 요청 폭주 순서로 실행되고, 각 단계의 탐지·차단 시간이 함께 표시됩니다.
4. 끝나면 온도 센서가 차단된 상태입니다. **Restore sensor access**로 복원합니다.
5. 종료는 실행 창에서 `Ctrl+C`입니다.

포트 사용 중 오류가 나오면 기존 실행 창이 떠 있는지 확인하세요. 다른 컴퓨터에서는 Python 3.12와 Git을 준비한 뒤 `.\setup.ps1 -Python '<python.exe 경로>'` → `.\start.ps1` 순서로 실행합니다.

## 명령어

데모를 실행해 둔 상태에서 다른 터미널에서 실행합니다.

```powershell
$py = '.\.venv\Scripts\python.exe'
& $py -X utf8 -m ccgn demo                  # 시나리오 5개 통과 여부와 지연 시간
& $py -X utf8 -m ccgn benchmark --runs 30   # 지연 반복 측정 → reports/latency-*
& $py -X utf8 -m ccgn evaluate --trials 30  # 모델 평가 → reports/evaluation-* (데모 불필요)
& $py -X utf8 -m ccgn mec-check --sandbox   # 실제 ETSI MEC Sandbox 검증 (GitHub 기기 코드 로그인)
& $py -X utf8 -m ccgn mec-check --dry-run   # 같은 절차를 로컬 모의 환경으로 연습 (ETSI 증거 아님)
& $py -m pytest -q                          # 자동 테스트 19개 (데모 불필요)
& $py -X utf8 -m ccgn package               # 제출용 소스 압축 → dist/
```

## 측정 결과 요약

**실시간 지연 (시나리오별 30회, PC 1대 loopback, 중앙값 / p95)**

| 지표 | tinyIoT | ACME |
|---|---|---|
| 센서값 전송 → 모델 판정 (CSE 알림 경유) | 37.6 / 57.8 ms | 66.6 / 96.2 ms |
| 이상값 전송 → 경고 | 32.2 / 54.0 ms | 60.5 / 80.8 ms |
| 미등록 접근 요청 도착 → 경고 | 4.8 / 10.2 ms | 16.5 / 34.0 ms |
| 폭주 기준 초과 요청 도착 → **CSE에서 차단 완료** | **40.8 / 79.7 ms** | **60.5 / 84.9 ms** |
| 기준 초과 후에도 통과된 폭주 요청 수 (평균, 최대) | 7.90개, 12개 | 1.13개, 2개 |

두 CSE 모두 정상 센서값 180건의 오경보는 **0건**이었습니다. tinyIoT는 응답이 빨라서 차단이 걸리기 전에 남은 폭주 요청(12개) 대부분이 처리됩니다. 사후 차단 방식의 한계이며, 첫 요청부터 막으려면 CSE 앞단의 속도 제한이 필요합니다. 두 CSE의 성능 비교 실험은 아닙니다(실행 환경이 다릅니다).

**모델 평가 (합성 데이터, 30회 반복)**

| 방식 | spike | shift | 작은 shift | drift | 분당 오경보 |
|---|---|---|---|---|---|
| 규칙만 | 100% | 0% | 0% | 0% | 0.00 |
| 규칙 + AI (실제 탐지기) | 100% | 100% | 100% | 100% | 1.26 ± 0.41 |
| 규칙 + AI 2회 연속 판정 *(오프라인 가정 실험, 미적용)* | 100% | 100% | 95.3% | 100% | 0.03 ± 0.05 |

기존 고정 시드 실험(규칙만 20/40, AI 추가 40/40, 분당 오경보 1.4회)은 그대로 재현됩니다.

**해석 주의:** PC 한 대, 가상 센서 한 개, 단일 온도 특징의 합성 데이터 결과입니다. 실제 현장 정확도나 네트워크 규모 성능을 의미하지 않습니다.

## 실제 ETSI MEC 연동

[MEC 연동 안내](docs/MEC.ko.md)를 따릅니다. 데모를 켠 상태에서 `mec-check --sandbox`를 실행하고, 화면에 나오는 코드를 GitHub에 입력하면 나머지(네트워크 시나리오 활성화, 앱 ID 3개 발급, 등록·검색·조회, 정리)는 자동으로 진행됩니다.

**결과:** `try-mec.etsi.org`(시나리오 `4g-5g-macro-v2x`)에서 ACME(11/16)와 tinyIoT(11/17) 각각 통과했습니다. 앱 준비 확인 3건, 서비스 등록 2건, 검색 2건이 모두 성공했고, 검색된 주소로 CSE 리소스 조회(RSC 2000)와 경고 API 조회까지 확인한 뒤 만든 것을 모두 정리했습니다. 첫 시도는 Sandbox가 준비되기 전에 호출해 실패했으며, 그 기록(`reports/mec-check-20261116-230705-FAILED.json`)도 남겨 두었습니다.

## 한계

- Originator 문자열은 인증이 아닙니다. 등록된 ID를 복사한 공격자는 식별하지 못합니다. 인터넷에 공개하면 안 됩니다.
- 요청 기록기를 우회해 CSE(:7579)에 직접 접근하면 요청 로그 기반 탐지는 우회됩니다.
- 알림 송신자를 암호학적으로 인증하지 않습니다(구독 대상 Container와 중복 CIN은 검사).
- ACP 차단은 리소스 접근 거부이며 네트워크 트래픽 자체를 막지 않습니다.
- 온도 센서 1개, 고정 규칙, 합성 학습 데이터로 범위를 제한했습니다.
- MEC 서비스는 loopback 주소로 등록됩니다. MEC011 API 연동 검증이며, MEC 앱 호스팅이나 원격 접근 검증이 아닙니다.

구조, 위협별 처리, 리소스 트리, 라이선스는 [English README](README.md)를 참고하세요.
