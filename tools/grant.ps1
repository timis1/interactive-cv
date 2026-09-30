#Requires -Version 7
<#
.SYNOPSIS
  Gives one person access to the full CV and prints their personal link.
.EXAMPLE
  .\tools\grant.ps1 -Name "Jane Doe, Acme"
.EXAMPLE
  .\tools\grant.ps1 -Name "Jane Doe, Acme" -Note "Senior Java role, requested 2026-09-28"
#>
param(
  [Parameter(Mandatory)] [string] $Name,
  [string] $Note = ''
)
. (Join-Path $PSScriptRoot '_common.ps1')

$keys = Get-Keys
$existing = @(Find-Grant $keys $Name)
if ($existing) {
  Write-Host "$Name already has access. Their link:" -ForegroundColor Yellow
  Write-Host (Get-AccessLink $existing[0])
  return
}

$grant = [ordered]@{
  id      = [Convert]::ToHexString((New-RandomBytes 6)).ToLower()
  name    = $Name
  note    = $Note
  code    = ConvertTo-Base64Url (New-RandomBytes 32)
  created = (Get-Date).ToString('yyyy-MM-dd HH:mm')
}
$keys.grants = @($keys.grants) + $grant

if (-not (Test-Path $ContentFile)) { Write-EncryptedContent $keys }
Write-AccessFile $keys
Save-Keys $keys

Write-Host "Access granted to $Name." -ForegroundColor Green
Write-Host 'Push the data\ folder, then send this personal link:'
Write-Host (Get-AccessLink $grant) -ForegroundColor Cyan
