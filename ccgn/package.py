"""Build the source submission archive: no virtualenv, vendored ACME, runtime data or secrets."""
import time
import zipfile

INCLUDE_DIRS = ("ccgn", "config", "docs", "tests", "tools", "reports")
INCLUDE_FILES = ("README.md", "README.ko.md", "LICENSE", "requirements.txt", "requirements.lock.txt",
                 "setup.ps1", "start.ps1", "start-tinyiot.ps1", "setup.sh", "start.sh", "실행.cmd", ".gitignore")
SKIP_PARTS = {"__pycache__", ".pytest_cache"}
SKIP_SUFFIXES = {".pyc", ".sqlite3", ".log"}


def package(root):
    files = [root / name for name in INCLUDE_FILES if (root / name).is_file()]
    for directory in INCLUDE_DIRS:
        files += [p for p in sorted((root / directory).rglob("*")) if p.is_file()
                  and not SKIP_PARTS & set(p.parts) and p.suffix not in SKIP_SUFFIXES
                  and p.name != ".env"]
    out = root / "dist"
    out.mkdir(exist_ok=True)
    path = out / f"ccgn-source-{time.strftime('%Y%m%d')}.zip"
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as archive:
        for file in files:
            archive.write(file, "ccgn-edge-iot-security/" + file.relative_to(root).as_posix())
    print(f"{len(files)} files, {path.stat().st_size / 1024:.0f} KiB\nSaved: {path}")
    return path
