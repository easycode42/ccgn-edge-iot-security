#!/usr/bin/env sh
# Linux/macOS setup. NOT TESTED by the team; the verified platform is Windows 11 + Python 3.12.
set -e
cd "$(dirname "$0")"
PYTHON="${PYTHON:-python3.12}"
ACME_COMMIT=283bd7d696090e983c07c149511102caab99642e
[ -x .venv/bin/python ] || "$PYTHON" -m venv .venv
if [ ! -f .vendor/acme/setup.py ]; then
    git clone https://github.com/ankraft/ACME-oneM2M-CSE.git .vendor/acme
    git -C .vendor/acme checkout "$ACME_COMMIT"
fi
.venv/bin/python -m pip install ./.vendor/acme -r requirements.lock.txt
echo 'Ready. Run ./start.sh and open http://127.0.0.1:7581'
