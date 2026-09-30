#Requires -Version 7
# Shared helpers for encrypt.ps1, grant.ps1, revoke.ps1 and list-access.ps1. Not meant to be run directly.
#
# How the protection works
# - The private CV content (private\*.json + photo) is encrypted with a random 256-bit content key (AES-256-GCM)
#   and published as data\private.enc.json.
# - Every approved person gets their own random 256-bit access code. The content key is encrypted ("wrapped")
#   with each code and published in data\access.json next to a random id. Names are never published.
# - The personal link is  <site>#access=<id>.<code>. The part after # is never sent to the server.
# - private\keys.json (git-ignored) holds the content key and the list of grants. Back it up. Without it
#   you can't add people or resend links. You can still start over, but every existing link stops working.

$ErrorActionPreference = 'Stop'
$Root = Split-Path $PSScriptRoot -Parent
$PrivateDir = Join-Path $Root 'private'
$KeysFile = Join-Path $PrivateDir 'keys.json'
$ContentFile = Join-Path $Root 'data\private.enc.json'
$AccessFile = Join-Path $Root 'data\access.json'
$PublicFile = Join-Path $Root 'data\public.json'

function New-RandomBytes([int] $count) {
  $b = [byte[]]::new($count); [Security.Cryptography.RandomNumberGenerator]::Fill($b); return $b
}
function ConvertTo-Base64Url([byte[]] $bytes) { [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_') }
function ConvertFrom-Base64Url([string] $s) {
  $s = $s.Replace('-', '+').Replace('_', '/'); while ($s.Length % 4) { $s += '=' }; [Convert]::FromBase64String($s)
}

# AES-256-GCM. Returns iv + (ciphertext||tag), the format WebCrypto expects.
function Protect-Bytes([byte[]] $key, [byte[]] $plain) {
  $iv = New-RandomBytes 12
  $cipher = [byte[]]::new($plain.Length); $tag = [byte[]]::new(16)
  $aes = [Security.Cryptography.AesGcm]::new($key, 16)
  try { $aes.Encrypt($iv, $plain, $cipher, $tag) } finally { $aes.Dispose() }
  [ordered]@{ iv = [Convert]::ToBase64String($iv); data = [Convert]::ToBase64String($cipher + $tag) }
}

function Write-Utf8([string] $path, [string] $text) { [IO.File]::WriteAllText($path, $text + "`n", [Text.UTF8Encoding]::new($false)) }

function Get-Keys {
  if (Test-Path $KeysFile) {
    $k = Get-Content $KeysFile -Raw | ConvertFrom-Json -AsHashtable -DateKind String
    if (-not $k.grants) { $k.grants = @() }
    return $k
  }
  Write-Host 'No private\keys.json found: creating a new content key.' -ForegroundColor Yellow
  return @{ contentKey = ConvertTo-Base64Url (New-RandomBytes 32); grants = @() }
}
function Save-Keys($keys) { Write-Utf8 $KeysFile ($keys | ConvertTo-Json -Depth 5) }

function Read-JsonText([string] $name) {
  $path = Join-Path $PrivateDir "$name.json"
  if (-not (Test-Path $path)) { throw "Missing file: $path" }
  $text = [IO.File]::ReadAllText($path, [Text.Encoding]::UTF8)
  try { $null = $text | ConvertFrom-Json -Depth 50 }
  catch { throw "private\$name.json is not valid JSON: $($_.Exception.Message)" }
  return $text.Trim()
}

# Bundles private\*.json and the photo (as a data URL) into one JSON document and encrypts it.
function Write-EncryptedContent($keys) {
  $parts = [ordered]@{}
  foreach ($name in 'profile', 'skills', 'experience', 'certifications', 'projects') { $parts[$name] = Read-JsonText $name }

  $profile = $parts.profile | ConvertFrom-Json
  $photoJson = 'null'
  if ($profile.photo) {
    $photoPath = Join-Path $PrivateDir $profile.photo
    if (-not (Test-Path $photoPath)) { throw "Photo not found: $photoPath" }
    $mime = @{ '.jpg' = 'image/jpeg'; '.jpeg' = 'image/jpeg'; '.png' = 'image/png'; '.webp' = 'image/webp' }[[IO.Path]::GetExtension($photoPath).ToLower()]
    if (-not $mime) { throw "Unsupported photo type: $photoPath (use .jpg, .png or .webp)" }
    $photoJson = '"data:' + $mime + ';base64,' + [Convert]::ToBase64String([IO.File]::ReadAllBytes($photoPath)) + '"'
  }
  $payload = '{' + (($parts.Keys | ForEach-Object { '"' + $_ + '":' + $parts[$_] }) -join ',') + ',"photo":' + $photoJson + '}'

  $enc = Protect-Bytes (ConvertFrom-Base64Url $keys.contentKey) ([Text.Encoding]::UTF8.GetBytes($payload))
  $doc = [ordered]@{ v = 2; alg = 'AES-256-GCM' } + $enc
  Write-Utf8 $ContentFile ($doc | ConvertTo-Json)
}

# Publishes one wrapped copy of the content key per grant.
function Write-AccessFile($keys) {
  $contentKey = ConvertFrom-Base64Url $keys.contentKey
  $entries = @(foreach ($g in $keys.grants) {
      [ordered]@{ id = $g.id } + (Protect-Bytes (ConvertFrom-Base64Url $g.code) $contentKey)
    })
  Write-Utf8 $AccessFile (ConvertTo-Json -InputObject $entries -Depth 5)
}

function Get-SiteUrl {
  $url = (Get-Content $PublicFile -Raw | ConvertFrom-Json).siteUrl
  if (-not $url -or $url -match '<') { return $null }
  if (-not $url.EndsWith('/')) { $url += '/' }
  return $url
}
function Get-AccessLink($grant) {
  $fragment = "#access=$($grant.id).$($grant.code)"
  $site = Get-SiteUrl
  if ($site) { return "$site$fragment" }
  return "<your site URL>$fragment   (set ""siteUrl"" in data\public.json to get full links)"
}

function Find-Grant($keys, [string] $nameOrId) {
  @($keys.grants | Where-Object { $_.name -eq $nameOrId -or $_.id -eq $nameOrId })
}
