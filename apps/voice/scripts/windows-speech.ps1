Add-Type -AssemblyName System.Speech
$recognizer = New-Object System.Speech.Recognition.SpeechRecognitionEngine
$recognizer.LoadGrammar((New-Object System.Speech.Recognition.DictationGrammar))
$recognizer.SetInputToDefaultAudioDevice()
Register-ObjectEvent $recognizer AudioStateChanged -Action { if ($Event.SourceEventArgs.AudioState -eq 'Speech') { [Console]::Out.WriteLine('{"type":"speech-start","deviceId":"windows-default"}') } elseif ($Event.SourceEventArgs.AudioState -eq 'Silence') { [Console]::Out.WriteLine('{"type":"audio-state","deviceId":"windows-default","vad":"silence","amplitude":0}') } } | Out-Null
Register-ObjectEvent $recognizer RecognizeCompleted -Action { [Console]::Out.WriteLine('{"type":"device-lost","deviceId":"windows-default"}'); [Environment]::Exit(1) } | Out-Null
Register-ObjectEvent $recognizer SpeechHypothesized -Action { $t=$Event.SourceEventArgs.Result.Text; [Console]::Out.WriteLine((@{type='partial';text=$t;deviceId='windows-default'}|ConvertTo-Json -Compress)) } | Out-Null
Register-ObjectEvent $recognizer SpeechRecognized -Action { $r=$Event.SourceEventArgs.Result; [Console]::Out.WriteLine((@{type='final';text=$r.Text;confidence=$r.Confidence;deviceId='windows-default'}|ConvertTo-Json -Compress)) } | Out-Null
Register-ObjectEvent $recognizer AudioLevelUpdated -Action { [Console]::Out.WriteLine((@{type='audio-state';amplitude=([double]$Event.SourceEventArgs.AudioLevel/100);deviceId='windows-default'}|ConvertTo-Json -Compress)) } | Out-Null
$recognizer.RecognizeAsync([System.Speech.Recognition.RecognizeMode]::Multiple)
[Console]::Out.WriteLine('{"type":"device-ready","deviceId":"windows-default"}')
while ($true) { Wait-Event -Timeout 1 | Remove-Event -ErrorAction SilentlyContinue }
