param(
  [Parameter(Mandatory = $true)][string]$UserUrl,
  [string]$Account = "default",
  [string]$OutputDir = ".\output\collection"
)

$ErrorActionPreference = "Stop"
$SkillDir = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$DbPath = Join-Path $OutputDir "douyin_collection.sqlite"

node (Join-Path $SkillDir "douyin-video.js") check-login --account $Account
$LoginStatus = $LASTEXITCODE
if ($LoginStatus -ne 0 -and $LoginStatus -ne 2) {
  exit $LoginStatus
}

node (Join-Path $SkillDir "douyin-video.js") collect-user $UserUrl --account $Account --db $DbPath -o $OutputDir --limit 100
