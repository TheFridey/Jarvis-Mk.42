Add-Type -AssemblyName System.Speech
$recognizer = New-Object System.Speech.Recognition.SpeechRecognitionEngine
$recognizer.LoadGrammar((New-Object System.Speech.Recognition.DictationGrammar))
$recognizer.SetInputToDefaultAudioDevice()
Register-ObjectEvent $recognizer AudioStateChanged -Action { if ($Event.SourceEventArgs.AudioState -eq 'Speech') { [Console]::Out.WriteLine('{"type":"speech-start","deviceId":"windows-default"}') } } | Out-Null
Register-ObjectEvent $recognizer SpeechHypothesized -Action { $t=$Event.SourceEventArgs.Result.Text; [Console]::Out.WriteLine((@{type='partial';text=$t;deviceId='windows-default'}|ConvertTo-Json -Compress)) } | Out-Null
Register-ObjectEvent $recognizer SpeechRecognized -Action { $t=$Event.SourceEventArgs.Result.Text; [Console]::Out.WriteLine((@{type='final';text=$t;deviceId='windows-default'}|ConvertTo-Json -Compress)) } | Out-Null
$recognizer.RecognizeAsync([System.Speech.Recognition.RecognizeMode]::Multiple)
while ($true) { Wait-Event -Timeout 1 | Remove-Event -ErrorAction SilentlyContinue }
