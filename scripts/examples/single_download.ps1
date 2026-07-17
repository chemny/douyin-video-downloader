param(
  [Parameter(Mandatory = $true)][string]$Link,
  [string]$OutputDir = ".\output\single"
)

$ErrorActionPreference = "Stop"
$SkillDir = Resolve-Path (Join-Path $PSScriptRoot "..\..")

node (Join-Path $SkillDir "douyin-video.js") info $Link --cover-size medium
node (Join-Path $SkillDir "douyin-video.js") download $Link -o $OutputDir --quality best --cover-size medium
node (Join-Path $SkillDir "douyin-video.js") audio $Link -o $OutputDir
