#!/usr/bin/env sh
set -e
cd "$(dirname "$0")"
[ -x .venv/bin/python ] || { echo 'Run ./setup.sh first.' >&2; exit 1; }
exec .venv/bin/python -X utf8 -m ccgn run
