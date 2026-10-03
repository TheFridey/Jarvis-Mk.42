param([Parameter(Mandatory=$true)][string]$PythonPath)
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '../../..')).Path
$version = & $PythonPath -c "import sys; print(str(sys.version_info.major)+'.'+str(sys.version_info.minor))"
if ($version -notin @('3.11','3.12')) { throw 'Use an isolated Python 3.11 or 3.12 interpreter. The default Windows adapter needs no Python.' }
$venv = Join-Path $repo '.voice-venv'
& $PythonPath -m venv $venv
if ($LASTEXITCODE -ne 0) { throw 'Voice virtual environment creation failed' }
$voicePython = Join-Path $venv 'Scripts/python.exe'
& $voicePython -m pip install -r (Join-Path $repo 'apps/voice/sidecar/requirements.txt')
if ($LASTEXITCODE -ne 0) { throw 'Voice dependency installation failed; verify native wheels for this CPU architecture' }
Write-Host 'Dependencies installed. Provision local models separately, then configure JARVIS_VOICE_PYTHON and run pnpm voice:preflight.'
