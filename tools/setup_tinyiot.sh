#!/usr/bin/env bash
# Builds tinyIoT (Sejong University seslab oneM2M CSE) for CCGN on Linux / WSL. No root needed:
# libwebsockets is unpacked into a private prefix when the system does not provide it.
# Result: $CCGN_TINYIOT_HOME/tinyIoT/source/server/server   (default ~/ccgn-tinyiot)
set -euo pipefail
HOME_DIR="${CCGN_TINYIOT_HOME:-$HOME/ccgn-tinyiot}"
COMMIT=c140495622a6271fe16c8cf92315c2892c803003      # 2026-10-06, the revision CCGN was verified with
mkdir -p "$HOME_DIR" && cd "$HOME_DIR"

if [ ! -d tinyIoT/.git ]; then
    git clone -q https://github.com/seslabSJU/tinyIoT.git
fi
git -C tinyIoT fetch -q origin "$COMMIT" 2>/dev/null || true
git -C tinyIoT checkout -q -f "$COMMIT"

if ! pkg-config --exists libwebsockets; then
    PREFIX="$HOME_DIR/local/usr"
    if [ ! -f "$PREFIX/include/libwebsockets.h" ] || [ ! -f "$PREFIX/include/sys/capability.h" ]; then
        mkdir -p debs local
        (cd debs && apt-get download libwebsockets-dev libwebsockets19t64 libcap-dev >/dev/null)
        for deb in debs/*.deb; do dpkg -x "$deb" local; done
    fi
    PC_DIR="$PREFIX/lib/x86_64-linux-gnu/pkgconfig"
    # Point the .pc file at the private prefix; drop its Requires lines (libcap/libuv dev packages
    # are only needed for static linking, the shared runtime libraries are already on the system).
    sed -i -e "s|^prefix=.*|prefix=$PREFIX|" -e '/^Requires/d' "$PC_DIR/libwebsockets.pc"
    export PKG_CONFIG_PATH="$PC_DIR"
    # Bake the private library path into the binary so it runs without LD_LIBRARY_PATH.
    export LDFLAGS="-Wl,-rpath,$PREFIX/lib/x86_64-linux-gnu"
fi

cd tinyIoT/source/server
# CCGN settings: same port, CSE name and admin originator as the ACME configuration (config/acme.ini).
sed -i \
    -e 's|^#define SERVER_PORT .*|#define SERVER_PORT "7579"|' \
    -e 's|^#define CSE_BASE_NAME .*|#define CSE_BASE_NAME "cse-ccgn"|' \
    -e 's|^#define CSE_BASE_RI .*|#define CSE_BASE_RI "id-ccgn"|' \
    -e 's|^// #define DB_TYPE DB_SQLITE|#define DB_TYPE DB_SQLITE|' \
    -e 's|^#define DB_TYPE DB_POSTGRESQL|// #define DB_TYPE DB_POSTGRESQL|' \
    -e 's|^#define LOG_LEVEL .*|#define LOG_LEVEL LOG_LEVEL_INFO|' config.h
grep -E '^#define (SERVER_IP|SERVER_PORT|CSE_BASE_NAME|CSE_BASE_RI|DB_TYPE|ADMIN_AE_ID|CSE_RVI)' config.h
make -j"$(nproc)" >build.log 2>&1 || { tail -30 build.log; exit 1; }
ls -la server
echo "tinyIoT built: $PWD/server"

# Python environment for running CCGN next to tinyIoT (the CSE must reach the detector on loopback).
VENV="$HOME_DIR/venv"
[ -x "$VENV/bin/python" ] || python3 -m venv "$VENV"
"$VENV/bin/python" -m pip install -q --upgrade pip
"$VENV/bin/python" -m pip install -q -r "${CCGN_REPO:-$OLDPWD}/requirements.txt" 2>/dev/null \
    || "$VENV/bin/python" -m pip install -q 'Flask>=3.1,<4' 'requests>=2.32,<3' 'scikit-learn>=1.6,<2' 'waitress>=3,<4' 'pytest>=8,<10'
"$VENV/bin/python" -c 'import flask, requests, sklearn, waitress; print("Python environment ready:", sklearn.__version__)'
