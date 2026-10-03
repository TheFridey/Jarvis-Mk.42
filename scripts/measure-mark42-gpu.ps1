param([ValidateSet('idle','active')][string]$Phase='idle')
$ErrorActionPreference='Stop'
# Identify the task's headless browser and descendants without exporting args,
# user profiles, window titles or any application credentials.
$processes=Get-CimInstance Win32_Process
$roots=@($processes|Where-Object { $_.Name -match 'chrome|headless' -and $_.CommandLine -match '--headless' -and ($processes|Where-Object ProcessId -eq $_.ParentProcessId).CommandLine -match 'agent-browser' })
$owned=@($roots.ProcessId)
do {
  $added=@($processes|Where-Object { $owned -contains $_.ParentProcessId -and $owned -notcontains $_.ProcessId }|Select-Object -ExpandProperty ProcessId)
  $owned+= $added
} while($added.Count -gt 0)
if($owned.Count -eq 0){throw 'No headless qualification browser found; GPU evidence unavailable'}
$observations=@(Get-Counter '\GPU Engine(*)\Utilization Percentage' -SampleInterval 1 -MaxSamples 10 | ForEach-Object {
  $counter=$_
  $samples=@($counter.CounterSamples|Where-Object { $_.Status -eq 0 -and $_.InstanceName -match '^pid_(\d+)_.*engtype_3D$' -and $owned -contains [uint32]$Matches[1] })
  [pscustomobject]@{ observedAt=$counter.Timestamp.ToUniversalTime().ToString('o'); engines=@($samples|ForEach-Object {[pscustomobject]@{instance=$_.InstanceName;utilisationPercent=$_.CookedValue}}) }
})
if(-not ($observations.engines|Measure-Object).Count){throw 'No owned-browser 3D-engine counter samples; GPU evidence unavailable'}
$memory=@(Get-Process -Id $owned -ErrorAction SilentlyContinue|Select-Object Id,WorkingSet64,PrivateMemorySize64)
$report=[pscustomobject]@{phase=$Phase;scope='Windows GPU Engine counters for detected headless-browser process tree. Per-process 3D engine percentage, not aggregate GPU utilisation or native Tauri measurement. Active window includes command startup/completion.';processIds=$owned;observations=$observations;processMemory=$memory}
$report|ConvertTo-Json -Depth 7|Set-Content -LiteralPath "artifacts/mark42/gpu-performance-$Phase.json" -Encoding UTF8
Write-Output "Measured owned-browser GPU counters: artifacts/mark42/gpu-performance-$Phase.json"
