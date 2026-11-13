<#
  JARVIS - one-step local operator startup.

  Starts only what is configured and authorised:
    data plane   postgres + redis + nats   (Docker, local-server.compose.yml)
    model gateway                          only when a provider key is present
    kernel        @jarvis/core on 127.0.0.1:7420
    presence      the desktop export in dev mode, opened in your browser

  It never prints secrets, never starts a paid inference request, never opens a
  microphone and never touches production. Optional capabilities that are not
  configured are reported as unavailable rather than started.

  Usage
    powershell -ExecutionPolicy Bypass -File scripts/jarvis-up.ps1
    powershell ... -File scripts/jarvis-up.ps1 -Check      # verify only, start nothing
    powershell ... -File scripts/jarvis-up.ps1 -Build      # rebuild the desktop first
    powershell ... -File scripts/jarvis-up.ps1 -Down       # clean shutdown
#>
[CmdletBinding()]
param(
  [switch]$Down,
  [switch]$Check,
  [switch]$Build,
  [switch]$NoOpen,
  [int]$DesktopPort = 4300
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$pnpmPath = Join-Path $env:LOCALAPPDATA 'node/corepack/v1/pnpm/9.15.9/bin/pnpm.cjs'
$logDir = Join-Path $repo '.logs'
$pidFile = Join-Path $logDir 'jarvis-up.pids.json'
$compose = Join-Path $repo 'infrastructure/docker/local-server.compose.yml'
$kernelHealth = 'http://127.0.0.1:7420/healthz'
$presenceUrl = "http://127.0.0.1:$DesktopPort/?mode=presence"

function Say($text) { Write-Host $text }
function Ok($text)   { Write-Host "  [ok]   $text" -ForegroundColor Green }
function Warn($text) { Write-Host "  [--]   $text" -ForegroundColor Yellow }
function Bad($text)  { Write-Host "  [stop] $text" -ForegroundColor Red }

function Pnpm {
  & node $pnpmPath @args
  if ($LASTEXITCODE -ne 0) { throw "pnpm failed: $args" }
}

function Stop-Tracked {
  if (-not (Test-Path $pidFile)) { return }
  $tracked = Get-Content $pidFile -Raw | ConvertFrom-Json
  foreach ($entry in $tracked) {
    $process = Get-Process -Id $entry.pid -ErrorAction SilentlyContinue
    if ($process) { Stop-Process -Id $entry.pid -Force -ErrorAction SilentlyContinue; Ok "stopped $($entry.name) (pid $($entry.pid))" }
  }
  Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
}

function Start-Tracked($name, $file, $argList) {
  $out = Join-Path $logDir "$name.log"
  $err = Join-Path $logDir "$name.err.log"
  $process = Start-Process -FilePath $file -ArgumentList $argList -WorkingDirectory $repo `
    -RedirectStandardOutput $out -RedirectStandardError $err -PassThru -WindowStyle Hidden
  return [pscustomobject]@{ name = $name; pid = $process.Id }
}

function Test-Kernel {
  try { return (Invoke-WebRequest -Uri $kernelHealth -TimeoutSec 4 -UseBasicParsing).StatusCode -eq 200 } catch { return $false }
}

# ---------------------------------------------------------------- shutdown
if ($Down) {
  Say 'JARVIS - shutdown'
  Stop-Tracked
  if (-not $Check) { & docker compose -f $compose stop postgres redis nats | Out-Null; Ok 'data plane stopped (volumes kept)' }
  Say "Presence and kernel are stopped. Redis/NATS data and the database volume are preserved."
  return
}

# ---------------------------------------------------------------- preflight
Say ''
Say 'JARVIS - preflight'
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Bad 'Node.js not on PATH'; return }
if (-not (Test-Path $pnpmPath)) { Bad "pinned pnpm not found at $pnpmPath"; return }
$pnpmVersion = (& node $pnpmPath --version) 2>$null
Ok "node $(& node --version) - pnpm $pnpmVersion"
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { Bad 'docker not on PATH'; return }
try { & docker info --format '{{.ServerVersion}}' | Out-Null; Ok "docker engine reachable" } catch { Bad 'docker engine not reachable - start Docker Desktop, then rerun'; return }

$gatewayConfigured = [bool]$env:OPENROUTER_API_KEY -and [bool]$env:JARVIS_OPENROUTER_MODEL
$rtcConfigured = [bool]$env:JARVIS_LIVEKIT_URL -and [bool]$env:JARVIS_LIVEKIT_API_KEY -and [bool]$env:JARVIS_LIVEKIT_API_SECRET
if ($gatewayConfigured) { Ok "model gateway: provider key present, model $($env:JARVIS_OPENROUTER_MODEL)" }
else { Warn 'model gateway: no provider key in this shell - inference will fail closed (set OPENROUTER_API_KEY + JARVIS_OPENROUTER_MODEL to enable)' }
if ($rtcConfigured) { Ok 'rtc: LiveKit credentials present' } else { Warn 'rtc: no LiveKit credentials - voice stays unavailable, text still works' }

if ($Check) {
  Say ''
  Say 'Check complete: tooling and containers verified, nothing started.'
  & docker compose -f $compose ps --format '{{.Name}} {{.Health}}'
  return
}

# ---------------------------------------------------------------- start
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
Stop-Tracked
$tracked = @()

Say ''
Say 'Data plane'
& docker compose -f $compose up -d postgres redis nats | Out-Null
foreach ($service in 'postgres', 'redis', 'nats') {
  $healthy = $false
  for ($i = 0; $i -lt 40; $i++) {
    $state = (& docker compose -f $compose ps --format '{{.Name}} {{.Health}}' | Select-String $service) -join ''
    if ($state -match 'healthy') { $healthy = $true; break }
    Start-Sleep -Milliseconds 1500
  }
  if ($healthy) { Ok "$service healthy" } else { throw "$service did not become healthy - see: docker compose -f $compose logs $service" }
}

# 127.0.0.1, never localhost: localhost resolves to ::1 first here and times out
# against Docker's published ports. Set before migrations, which read the same var.
$env:JARVIS_TELEMETRY_DISABLED = '1'
$env:JARVIS_DB_URL = 'postgres://jarvis:jarvis@127.0.0.1:5433/jarvis'
$env:JARVIS_REDIS_URL = 'redis://127.0.0.1:6380'
$env:JARVIS_NATS_URL = 'nats://127.0.0.1:4222'

Say ''
Say 'Migrations'
Pnpm --filter '@jarvis/persistence' db:migrate
Ok 'database schema current'

Say ''
Say 'Services'
if ($gatewayConfigured) {
  $env:JARVIS_GATEWAY_TOKEN = if ($env:JARVIS_GATEWAY_TOKEN) { $env:JARVIS_GATEWAY_TOKEN } else { 'dev-gateway-token' }
  $tracked += Start-Tracked 'gateway' 'node' @($pnpmPath, '--filter', '@jarvis/gateway', 'dev')
  Ok "gateway starting (log: .logs/gateway.log)"
} else { Warn 'gateway not started - no provider key' }

if ($gatewayConfigured) { $env:JARVIS_MODEL_CLOUD_ALLOWED = '1' } else { $env:JARVIS_MODEL_CLOUD_ALLOWED = '0' }
$tracked += Start-Tracked 'kernel' 'node' @($pnpmPath, '--filter', '@jarvis/core', 'start')
Ok 'kernel starting (log: .logs/kernel.log)'

$up = $false
for ($i = 0; $i -lt 90; $i++) { if (Test-Kernel) { $up = $true; break }; Start-Sleep -Seconds 2 }
if (-not $up) { Bad 'kernel did not answer /healthz within 3 minutes - see .logs/kernel.log'; }
else { Ok 'kernel healthy on http://127.0.0.1:7420' }

if (-not (Test-Path (Join-Path $repo 'apps/desktop/.next'))) { $Build = $true }
if ($Build) { Say '  building the desktop (first run or -Build)'; Pnpm --filter '@jarvis/desktop' build; Ok 'desktop built' }
# -H 127.0.0.1: without it Next binds ::1 only on this host, and both the browser
# and the qualifier reach 127.0.0.1, so the page would look down while it is up.
$tracked += Start-Tracked 'desktop' 'node' @($pnpmPath, '--filter', '@jarvis/desktop', 'exec', 'next', 'dev', '-H', '127.0.0.1', '-p', "$DesktopPort")
Ok "presence starting on $presenceUrl"

$tracked | ConvertTo-Json | Set-Content -Path $pidFile -Encoding UTF8

Say ''
Say 'JARVIS is up'
Say "  presence   $presenceUrl"
Say "  kernel     http://127.0.0.1:7420/healthz"
Say "  logs       $logDir"
if ($gatewayConfigured) { Say '  inference  authorised per capability; nothing is sent until you ask' } else { Say '  inference  unavailable (no provider key in this shell)' }
if (-not $rtcConfigured) { Say '  voice      unavailable (no LiveKit credentials); the microphone control reports it' }
Say '  shutdown   powershell -File scripts/jarvis-up.ps1 -Down'
if (-not $NoOpen) { Start-Process $presenceUrl | Out-Null }
