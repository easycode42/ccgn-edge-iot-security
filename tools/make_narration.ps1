# Synthesises tools\narration.json into deliverables\narration\<key>.wav with the local Windows
# voice (no online service) and writes durations.json. Replace any .wav with your own recording
# of the same text to use a human voice; durations.json is re-read by the video tools.
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Split-Path $PSScriptRoot -Parent)
Add-Type -AssemblyName System.Speech
$out = 'deliverables\narration'
New-Item -ItemType Directory -Force $out | Out-Null
$lines = Get-Content -Raw -Encoding UTF8 'tools\narration.json' | ConvertFrom-Json
$voice = New-Object System.Speech.Synthesis.SpeechSynthesizer
$voice.SelectVoice('Microsoft Zira Desktop')
$voice.Rate = 1
$durations = [ordered]@{}
foreach ($p in $lines.PSObject.Properties) {
    if ($p.Name.StartsWith('_')) { continue }
    $file = Join-Path (Resolve-Path $out) ($p.Name + '.wav')
    $voice.SetOutputToWaveFile($file)
    $voice.Speak($p.Value)
    $voice.SetOutputToNull()
    $seconds = [double](& ffprobe -v error -show_entries format=duration -of csv=p=0 $file)
    $durations[$p.Name] = [math]::Round($seconds, 2)
}
$voice.Dispose()
$durations | ConvertTo-Json | Set-Content -Encoding UTF8 (Join-Path $out 'durations.json')
$total = ($durations.Values | Measure-Object -Sum).Sum
"{0} clips, {1:n0} s of narration -> {2}" -f $durations.Count, $total, $out
