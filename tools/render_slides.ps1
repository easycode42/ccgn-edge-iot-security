# Renders every slide of a .pptx to PNG with the installed PowerPoint (used for QA and for the demo video).
# Usage: .\tools\render_slides.ps1 -Deck deliverables\CCGN_Final_Report.pptx -Out deliverables\slides
param([Parameter(Mandatory)][string]$Deck, [Parameter(Mandatory)][string]$Out, [int]$Width = 1920, [int]$Height = 1080)
$ErrorActionPreference = 'Stop'
$deckPath = (Resolve-Path -LiteralPath $Deck).Path
New-Item -ItemType Directory -Force $Out | Out-Null
$outPath = (Resolve-Path -LiteralPath $Out).Path
Get-ChildItem -LiteralPath $outPath -Filter 'slide-*.png' | Remove-Item
$app = New-Object -ComObject PowerPoint.Application
try {
    $pres = $app.Presentations.Open($deckPath, $true, $false, $false)
    foreach ($slide in $pres.Slides) {
        $slide.Export((Join-Path $outPath ('slide-{0:d2}.png' -f $slide.SlideIndex)), 'PNG', $Width, $Height)
    }
    "$($pres.Slides.Count) slides -> $outPath"
    $pres.Close()
} finally { $app.Quit() }
