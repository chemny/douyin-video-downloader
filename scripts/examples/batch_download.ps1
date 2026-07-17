param(
  [Parameter(Mandatory = $true)][string]$DbPath,
  [string]$OutputDir = ".\output\downloads"
)

$ErrorActionPreference = "Stop"
$SkillDir = Resolve-Path (Join-Path $PSScriptRoot "..\..")

node (Join-Path $SkillDir "douyin-video.js") db-download-batch `
  --db $DbPath `
  -o (Join-Path $OutputDir "videos") `
  --quality best `
  --cover-size medium `
  --delay-seconds 5 `
  --confirm-every 10 `
  --download-limit 100

node (Join-Path $SkillDir "douyin-video.js") db-download-audio-batch `
  --db $DbPath `
  -o (Join-Path $OutputDir "audios") `
  --delay-seconds 5 `
  --download-limit 100
