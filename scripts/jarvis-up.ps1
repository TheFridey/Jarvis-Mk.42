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
  [switch]$RestartApp,
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

# pnpm and tsx spawn children; killing the wrapper leaves the real server listening.
# Terminate the whole owned tree, children first, then verify the port is free.
function Get-ChildIds([int]$ParentId) {
  $children = @(Get-CimInstance Win32_Process -Filter "ParentProcessId=$ParentId" -ErrorAction SilentlyContinue)
  $ids = @()
  foreach ($child in $children) { $ids += Get-ChildIds -ParentId $child.ProcessId }
  foreach ($child in $children) { $ids += [int]$child.ProcessId }
  return $ids
}

function Stop-Tree([int]$RootId, [string]$Name) {
  $ids = @(Get-ChildIds -ParentId $RootId) + @($RootId)
  $stopped = 0
  foreach ($id in $ids) {
    if ($id -eq $PID) { continue }   # never stop this script
    if (Get-Process -Id $id -ErrorAction SilentlyContinue) {
      Stop-Process -Id $id -Force -ErrorAction SilentlyContinue
      $stopped++
    }
  }
  if ($stopped -gt 0) { Ok "stopped $Name (pid $RootId and $($stopped - 1) child process(es))" }
}

function Test-PortOpen([int]$Port) {
  try { $client = New-Object System.Net.Sockets.TcpClient; $client.Connect('127.0.0.1', $Port); $client.Close(); return $true } catch { return $false }
}

function Stop-Tracked {
  if (-not (Test-Path $pidFile)) { return }
  $tracked = Get-Content $pidFile -Raw | ConvertFrom-Json
  foreach ($entry in $tracked) { Stop-Tree -RootId ([int]$entry.pid) -Name $entry.name }
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
  $lingering = @()
  foreach ($port in 7420, 7430, $DesktopPort) { if (Test-PortOpen $port) { $lingering += $port } }
  if ($lingering.Count -gt 0) {
    Bad "ports still listening after shutdown: $($lingering -join ', ')"
    foreach ($port in $lingering) {
      $owner = (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1).OwningProcess
      if ($owner) { Warn "port $port held by pid $owner - not this script's tracked process; inspect before killing" }
    }
    Say 'Shutdown incomplete. Nothing else was stopped.'
    return
  }
  if (-not $Check) { & docker compose -f $compose stop postgres redis nats | Out-Null; Ok 'data plane stopped (volumes kept)' }
  Say "Stopped: kernel, gateway, presence. Ports released. Database volume and Redis/NATS data preserved."
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

# Source the local LiveKit environment file when it exists. Values are never printed.
$rtcEnvFile = Join-Path $repo 'artifacts/local-runtime/pki/livekit.env'
$rtcYaml = Join-Path $repo 'artifacts/local-runtime/pki/livekit.yaml'
if (Test-Path $rtcEnvFile) {
  Get-Content $rtcEnvFile | ForEach-Object {
    if ($_ -match '^\s*(JARVIS_LIVEKIT_[A-Z_]+)=(.*)$') { Set-Item -Path ('env:' + $Matches[1]) -Value $Matches[2] }
  }
}

$gatewayConfigured = [bool]$env:OPENROUTER_API_KEY -and [bool]$env:JARVIS_OPENROUTER_MODEL
$rtcConfigured = [bool]$env:JARVIS_LIVEKIT_URL -and [bool]$env:JARVIS_LIVEKIT_API_KEY -and [bool]$env:JARVIS_LIVEKIT_API_SECRET
if ($rtcConfigured) { Ok 'rtc: local LiveKit credentials loaded (values not shown)' }
elseif (Test-Path $rtcYaml) { Warn 'rtc: livekit.yaml exists but livekit.env does not - run: pnpm rtc:config' }
else { Warn 'rtc: no local LiveKit configuration - run: node <pinned pnpm> rtc:config (voice stays unavailable)' }
if ($gatewayConfigured) { Ok "model gateway: provider key present, model $($env:JARVIS_OPENROUTER_MODEL)" }
else { Warn 'model gateway: no provider key in this shell - inference will fail closed (set OPENROUTER_API_KEY + JARVIS_OPENROUTER_MODEL to enable)' }

if ($Check) {
  Say ''
  Say 'Check complete: tooling and containers verified, nothing started.'
  & docker compose -f $compose ps --format '{{.Name}} {{.Health}}'
  return
}

# ---------------------------------------------------------------- start
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
Stop-Tracked

# -RestartApp stops only Jarvis's own application processes and starts them again, leaving PostgreSQL,
# Redis, NATS and LiveKit untouched. Without it the owner had to hand-kill process trees and risked
# stopping the data plane with them.
if ($RestartApp) {
  Say ''
  Say 'Application restart'
  foreach ($port in @(7420, 7430, $DesktopPort)) {
    for ($attempt = 0; $attempt -lt 20 -and (Test-PortOpen $port); $attempt++) { Start-Sleep -Milliseconds 250 }
    if (-not (Test-PortOpen $port)) { continue }
    $owner = (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1).OwningProcess
    $command = if ($owner) { (Get-CimInstance Win32_Process -Filter "ProcessId = $owner" -ErrorAction SilentlyContinue).CommandLine } else { '' }
    # Only something demonstrably running this repository's application is stopped.
    if ($owner -and $command -and ($command -match 'Jarvis-Sentience' -or $command -match 'apps[\/](core|gateway)' -or $command -match 'serve-export')) {
      Stop-Tree -RootId ([int]$owner) -Name "app on port $port"
      for ($attempt = 0; $attempt -lt 20 -and (Test-PortOpen $port); $attempt++) { Start-Sleep -Milliseconds 250 }
    }
    if (Test-PortOpen $port) {
      Bad "port $port is still held by pid $owner, which is not this project's application - leaving it alone"
      return
    }
  }
  Ok 'application ports released; data plane preserved'
}

$tracked = @()

# An env change only reaches a process that starts after it. If a Kernel or Gateway is
# already listening from an earlier run, this script cannot reconfigure it: say so instead
# of starting a second one that quietly fails to bind.
foreach ($port in 7420, 7430) {
  $inUse = $false
  try { $client = New-Object System.Net.Sockets.TcpClient; $client.Connect('127.0.0.1', $port); $inUse = $true; $client.Close() } catch { }
  if ($inUse) {
    $owner = (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1).OwningProcess
    Bad "port $port is already in use (pid $owner) - stop it first, then rerun, so the new configuration is actually applied"
    return
  }
}

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
$env:JARVIS_DESKTOP_PORT = "$DesktopPort"
$env:JARVIS_PRESENCE_URL = $presenceUrl
$env:JARVIS_DB_URL = 'postgres://jarvis:jarvis@127.0.0.1:5433/jarvis'
$env:JARVIS_REDIS_URL = 'redis://127.0.0.1:6380'
$env:JARVIS_NATS_URL = 'nats://127.0.0.1:4222'

Say ''
# A listening port is not a database that can answer a query. Migrations run only once PostgreSQL
# actually responds: bounded retries for transient startup errors, fail closed on timeout.
$pgReady = $false
for ($attempt = 0; $attempt -lt 30; $attempt++) {
  & docker exec jarvis-mk43-postgres-1 pg_isready -U jarvis -d jarvis *> $null
  if ($LASTEXITCODE -eq 0) { $pgReady = $true; break }
  Start-Sleep -Seconds 1
}
if (-not $pgReady) {
  Bad 'PostgreSQL did not answer a readiness probe within 30s; not migrating against an unready database'
  return
}
Ok 'PostgreSQL answering queries'
Say 'Migrations'
Pnpm --filter '@jarvis/persistence' db:migrate
Ok 'database schema current'

Say ''
if ($rtcConfigured) {
  Say 'RTC'
  & docker compose -f (Join-Path $repo 'infrastructure/docker/rtc.compose.yml') up -d | Out-Null
  Ok 'livekit container started (loopback 7880/7881/7882)'
}

Say ''
Say 'Services'
if ($gatewayConfigured) {
  $env:JARVIS_GATEWAY_TOKEN = if ($env:JARVIS_GATEWAY_TOKEN) { $env:JARVIS_GATEWAY_TOKEN } else { 'dev-gateway-token' }
  $tracked += Start-Tracked 'gateway' 'node' @($pnpmPath, '--filter', '@jarvis/gateway', 'dev')
  Ok "gateway starting (log: .logs/gateway.log)"
} else { Warn 'gateway not started - no provider key' }

if ($gatewayConfigured) { $env:JARVIS_MODEL_CLOUD_ALLOWED = '1' } else { $env:JARVIS_MODEL_CLOUD_ALLOWED = '0' }
# RTC is constructed only when this flag is set; without it the Kernel reports rtc OFFLINE
# even with valid LiveKit credentials in the environment.
if ($rtcConfigured) { $env:JARVIS_RTC_ENABLED = '1' } else { $env:JARVIS_RTC_ENABLED = '0' }

# Preflight: a path is validated before anything is launched. A stray control character in
# an environment value once turned D:\JarvisData\Speech	mp into a literal tab, so the
# launcher failed half-way through with 'Illegal characters in path' and left a Gateway
# running with no Kernel beside it.
function Assert-CleanPath([string] $name, [string] $value) {
  if (-not $value.Trim()) { throw "$name is empty" }
  $bad = @($value.ToCharArray() | Where-Object { [int]$_ -lt 32 -or [int]$_ -eq 127 })
  if ($bad.Count -gt 0) { throw "$name contains a control character" }
}

foreach ($pair in @(
  @{ Name = 'JARVIS_ASR_TEMP_DIR'; Value = 'D:/JarvisData/Speech/tmp' },
  @{ Name = 'JARVIS_ASR_EXECUTABLE'; Value = 'D:/AI/Runtimes/whisper-arm64/Release/whisper-cli.exe' },
  @{ Name = 'JARVIS_ASR_MODEL_PATH'; Value = 'D:/AI/Models/SpeechRecognition/ggml-base.en.bin' }
)) { Assert-CleanPath $pair.Name $pair.Value }

# Local speech recognition: point the Kernel at the engine that is actually installed.
# Without this the voice endpoint answers 503 and the microphone appears broken.
$asrExe = 'D:/AI/Runtimes/whisper-arm64/Release/whisper-cli.exe'
$asrModel = 'D:/AI/Models/SpeechRecognition/ggml-base.en.bin'
if (Test-Path $asrExe) {
  if (Test-Path $asrModel) {
    $env:JARVIS_ASR_ENGINE = 'whisper-cpp'
    $env:JARVIS_ASR_EXECUTABLE = $asrExe
    $env:JARVIS_ASR_MODEL_PATH = $asrModel
    $env:JARVIS_ASR_TEMP_DIR = "D:/JarvisData/Speech/tmp"
    New-Item -ItemType Directory -Force -Path $env:JARVIS_ASR_TEMP_DIR | Out-Null
    Write-Host 'speech: whisper.cpp ready'
  } else { Write-Host 'speech: model missing, dictation unavailable' }
} else { Write-Host 'speech: engine missing, dictation unavailable' }
$tracked += Start-Tracked 'kernel' 'node' @($pnpmPath, '--filter', '@jarvis/core', 'start')
Ok 'kernel starting (log: .logs/kernel.log)'

$up = $false
for ($i = 0; $i -lt 90; $i++) { if (Test-Kernel) { $up = $true; break }; Start-Sleep -Seconds 2 }
if (-not $up) { Bad 'kernel did not answer /healthz within 3 minutes - see .logs/kernel.log'; }
else { Ok 'kernel healthy on http://127.0.0.1:7420' }

# An acceptance run builds with a synthetic credential and an ephemeral kernel port. If such a
# build is ever found here, refuse to serve it: rebuild rather than run a test configuration.
$acceptanceMarker = Join-Path $repo 'apps/desktop/out/.acceptance-build'
if (Test-Path $acceptanceMarker) {
  Write-Host 'desktop export is an acceptance-test build; rebuilding it' -ForegroundColor Yellow
  Remove-Item -Recurse -Force (Join-Path $repo 'apps/desktop/out')
  $Build = $true
}
if ($Build -or -not (Test-Path (Join-Path $repo 'apps/desktop/out/index.html'))) { Say '  building the desktop export'; Pnpm --filter '@jarvis/desktop' build; Ok 'desktop export built' }

# A leftover frontend from an earlier run keeps the port and quietly shadows the new one.
# Only a process whose command line points at this repository is touched.
$stale = Get-NetTCPConnection -LocalPort $DesktopPort -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($stale) {
  $staleProc = Get-CimInstance Win32_Process -Filter "ProcessId=$($stale.OwningProcess)" -ErrorAction SilentlyContinue
  if ($staleProc -and $staleProc.CommandLine -and $staleProc.CommandLine -like "*Jarvis-Sentience*") {
    Stop-Process -Id $stale.OwningProcess -Force -ErrorAction SilentlyContinue
    Ok "stopped a stale frontend on port $DesktopPort (pid $($stale.OwningProcess))"
  } else {
    Warn "port $DesktopPort is held by pid $($stale.OwningProcess), which is not this project - leaving it alone"
  }
}
# The production export is served, not `next dev`: it is what ships, and the dev server
# currently fails the page with a Client Manifest error that the built output does not have.
$tracked += Start-Tracked 'desktop' 'node' @((Join-Path $repo 'scripts/serve-export.mjs'))
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
