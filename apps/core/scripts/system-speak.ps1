# Local, offline synthesis to a WAV file. Text arrives on stdin as JSON; only a file path is
# ever passed as an argument, so no caller-supplied string is interpolated into a command.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$request = [Console]::In.ReadToEnd() | ConvertFrom-Json
if (-not $request.out -or -not $request.text) { throw 'text and out are required' }
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
if ($request.voice) { try { $synth.SelectVoice($request.voice) } catch { } }
$format = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
$synth.SetOutputToWaveFile($request.out, $format)
try { $synth.Speak($request.text) } finally { $synth.Dispose() }
