#Requires -Version 7
<#
.SYNOPSIS
  Lists everyone who has access, with their personal links.
.EXAMPLE
  .\tools\list-access.ps1
#>
. (Join-Path $PSScriptRoot '_common.ps1')

$keys = Get-Keys
if (-not $keys.grants.Count) { Write-Host 'Nobody has access yet. Use .\tools\grant.ps1 -Name "..."'; return }
foreach ($g in $keys.grants) {
  Write-Host "$($g.name)" -ForegroundColor Cyan -NoNewline
  Write-Host "  (since $($g.created)$(if ($g.note) { ", $($g.note)" }))"
  Write-Host "  $(Get-AccessLink $g)"
}
