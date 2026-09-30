#Requires -Version 7
<#
.SYNOPSIS
  Re-encrypts the private CV content after you edit files in the private\ folder.
.EXAMPLE
  .\tools\encrypt.ps1
#>
. (Join-Path $PSScriptRoot '_common.ps1')

$keys = Get-Keys
Write-EncryptedContent $keys
Write-AccessFile $keys
Save-Keys $keys
Write-Host "Private content encrypted -> data\private.enc.json ($($keys.grants.Count) people have access)." -ForegroundColor Green
Write-Host 'Commit and push the data\ folder to publish the change.'
