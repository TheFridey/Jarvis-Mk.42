import { KokoroTTS } from 'kokoro-js';
import { mkdir,writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// Synthetic output proof; this does not certify browser autoplay or physical speakers.
const ids=['bm_george','bm_fable','bm_daniel','bm_lewis','am_michael','am_fenrir','am_puck','am_adam','am_echo','am_eric','am_liam','am_onyx','am_santa'];
const directory=resolve('.voice-models/free-voice-proof');await mkdir(directory,{recursive:true});
console.log('Loading the free Kokoro model for synthetic audio qualification');
const tts=await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX',{dtype:'q8',device:'cpu'});
const results=[];
for(const voice of ids){
  if(tts.voices[voice]?.gender!=='Male')throw new Error(`Unverified male voice: ${voice}`);
  const audio=await tts.generate('Good morning. I am Jarvis. How can I help you today?',{voice});
  const peak=audio.audio.reduce((max,sample)=>Math.max(max,Math.abs(sample)),0);
  if(!audio.audio.length||!Number.isFinite(peak)||peak<=0)throw new Error(`No valid audio for ${voice}`);
  await audio.save(resolve(directory,`${voice}.wav`));
  results.push({voice,sampleRate:audio.sampling_rate,samples:audio.audio.length,peak});
  console.log(`${voice}: generated ${audio.audio.length} samples`);
}
await writeFile(resolve(directory,'qualification.json'),JSON.stringify({generatedAt:new Date().toISOString(),engine:'Kokoro q8 CPU',synthetic:true,browserVerified:false,physicalSpeakersVerified:false,results},null,2));
console.log(`Qualified ${results.length} male voices; output: ${directory}`);
