# Assembles deliverables\CCGN_Demo.mp4: intro slides + recorded dashboard walkthrough + result slides.
# Needs ffmpeg on PATH, deliverables\slides (render_slides.ps1) and deliverables\recording (record_demo.mjs).
# The video has captions and no audio track.
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Split-Path $PSScriptRoot -Parent)
$slides = 'deliverables\slides'
# slide number, seconds on screen
$intro = @(@(1, 5), @(2, 9), @(3, 10))
$outro = @(@(7, 9), @(8, 9), @(9, 10), @(12, 8))
$inputs = @(); $labels = @(); $filters = @(); $n = 0
function Add-Still($pair) {
    $script:inputs += @('-loop', '1', '-t', "$($pair[1])", '-i', (Join-Path $slides ('slide-{0:d2}.png' -f $pair[0])))
}
function Add-Stream {
    $script:filters += "[$($script:n):v]scale=1920:1080,fps=30,format=yuv420p,setsar=1[v$($script:n)]"
    $script:labels += "[v$($script:n)]"; $script:n++
}
foreach ($p in $intro) { Add-Still $p; Add-Stream }
$inputs += @('-f', 'concat', '-safe', '0', '-i', 'deliverables\recording\frames.txt'); Add-Stream
foreach ($p in $outro) { Add-Still $p; Add-Stream }
$graph = ($filters -join ';') + ';' + ($labels -join '') + "concat=n=$n`:v=1:a=0[out]"
& ffmpeg -y -hide_banner -loglevel error @inputs -filter_complex $graph -map '[out]' `
    -c:v libx264 -preset medium -crf 20 -movflags +faststart 'deliverables\CCGN_Demo.mp4'
if ($LASTEXITCODE -ne 0) { throw 'ffmpeg failed' }
& ffprobe -v error -show_entries format=duration,size -of default=noprint_wrappers=1 'deliverables\CCGN_Demo.mp4'
