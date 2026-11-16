#!/usr/bin/env bash
# Runs a CCGN command on Linux / WSL with tinyIoT as the CSE, e.g.
#   bash tools/ccgn_wsl.sh run        bash tools/ccgn_wsl.sh demo        bash tools/ccgn_wsl.sh benchmark --runs 30
# From Windows:  wsl --cd <repo folder> -- bash tools/ccgn_wsl.sh run     (or .\start-tinyiot.ps1)
set -euo pipefail
cd "$(dirname "$0")/.."
HOME_DIR="${CCGN_TINYIOT_HOME:-$HOME/ccgn-tinyiot}"
[ -x "$HOME_DIR/venv/bin/python" ] || { echo "Run: bash tools/setup_tinyiot.sh" >&2; exit 1; }
export CCGN_CSE=tinyiot PYTHONDONTWRITEBYTECODE=1
# Runtime data stays on the Linux file system: SQLite WAL is unreliable on a Windows-mounted drive.
export CCGN_RUNTIME="${CCGN_RUNTIME:-$HOME_DIR/runtime}"
exec "$HOME_DIR/venv/bin/python" -X utf8 -m ccgn "$@"
