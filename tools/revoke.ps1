#Requires -Version 7
<#
.SYNOPSIS
  Removes one person's access. Creates a new content key, so their link stops working, while everyone
  else's link keeps working.
.EXAMPLE
  .\tools\revoke.ps1 -Name "Jane Doe, Acme"
#>
param([Parameter(Mandatory)] [string] $Name)
. (Join-Path $PSScriptRoot '_common.ps1')

$keys = Get-Keys
$match = @(Find-Grant $keys $Name)
if (-not $match) { throw "No access found for '$Name'. Run .\tools\list-access.ps1 to see names." }

$keys.grants = @($keys.grants | Where-Object { $_.id -ne $match[0].id })
$keys.contentKey = ConvertTo-Base64Url (New-RandomBytes 32)
Write-EncryptedContent $keys
Write-AccessFile $keys
Save-Keys $keys

Write-Host "Access removed for $($match[0].name). $($keys.grants.Count) people still have access." -ForegroundColor Green
Write-Host 'Push the data\ folder to apply it.'
