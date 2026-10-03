$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$request = [Console]::In.ReadLine() | ConvertFrom-Json
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
try { $synth.SelectVoiceByHints([System.Speech.Synthesis.VoiceGender]::Male,[System.Speech.Synthesis.VoiceAge]::Adult,0,[cultureinfo]'en-GB') } catch { }
$synth.Rate = -1
Register-ObjectEvent $synth SpeakStarted -Action { [Console]::Out.WriteLine('PLAYBACK_STARTED') } | Out-Null
$task = $synth.SpeakAsync([string]$request.text)
while (-not $task.IsCompleted) { Wait-Event -Timeout 1 | Remove-Event -ErrorAction SilentlyContinue }
$synth.Dispose()
