$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$request = [Console]::In.ReadLine() | ConvertFrom-Json
if ($request.operation -eq 'recognize') {
  $bytes = [Convert]::FromBase64String([string]$request.audio)
  if ($bytes.Length -gt 500000) { throw 'Audio limit exceeded' }
  $stream = New-Object IO.MemoryStream(,$bytes)
  $engine = New-Object System.Speech.Recognition.SpeechRecognitionEngine
  try {
    $engine.LoadGrammar((New-Object System.Speech.Recognition.DictationGrammar))
    $engine.SetInputToWaveStream($stream)
    $result = $engine.Recognize([TimeSpan]::FromSeconds(15))
    if ($result) { @{text=$result.Text;confidence=$result.Confidence} | ConvertTo-Json -Compress }
    else { @{text='';confidence=0} | ConvertTo-Json -Compress }
  } finally { $engine.Dispose(); $stream.Dispose() }
} elseif ($request.operation -eq 'synthesize') {
  $stream = New-Object IO.MemoryStream
  $engine = New-Object System.Speech.Synthesis.SpeechSynthesizer
  try {
    $format = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000,[System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen,[System.Speech.AudioFormat.AudioChannel]::Mono)
    $engine.SetOutputToAudioStream($stream,$format)
    $engine.Speak(([string]$request.text).Substring(0,[Math]::Min(4096,([string]$request.text).Length)))
    @{audio=[Convert]::ToBase64String($stream.ToArray())} | ConvertTo-Json -Compress
  } finally { $engine.Dispose(); $stream.Dispose() }
} else { throw 'Unsupported operation' }
