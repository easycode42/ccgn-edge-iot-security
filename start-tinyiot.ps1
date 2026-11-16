# Starts CCGN with tinyIoT as the oneM2M CSE inside WSL. First time: wsl --cd $PSScriptRoot -- bash tools/setup_tinyiot.sh
$ErrorActionPreference = 'Stop'
& wsl.exe --cd $PSScriptRoot -- bash tools/ccgn_wsl.sh run
exit $LASTEXITCODE
