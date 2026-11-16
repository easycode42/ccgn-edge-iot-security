param([string]$Python = 'python')
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$taskCommit = '283bd7d696090e983c07c149511102caab99642e'
if (-not (Test-Path -LiteralPath '.venv\Scripts\python.exe')) {
    & $Python -m venv .venv
    if ($LASTEXITCODE -ne 0) { throw 'Failed to create Python environment. Python 3.12 recommended.' }
}
if (-not (Test-Path -LiteralPath '.vendor\acme\setup.py')) {
    git clone https://github.com/ankraft/ACME-oneM2M-CSE.git .vendor/acme
    if ($LASTEXITCODE -ne 0) { throw 'ACME download failed.' }
    git -C .vendor/acme checkout $taskCommit
    if ($LASTEXITCODE -ne 0) { throw 'Could not check out the tested ACME revision.' }
}
& .\.venv\Scripts\python.exe -m pip install ./.vendor/acme -r requirements.lock.txt
if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
Write-Host 'Ready. Run .\start.ps1 and open http://127.0.0.1:7581'
