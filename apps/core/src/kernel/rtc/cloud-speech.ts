/** Cloud audio is used only after the user selects cloud speech for this room. */
export async function cloudSpeech(request:{operation:'recognize';audio:string}|{operation:'synthesize';text:string},signal:AbortSignal):Promise<{text?:string;audio?:string}> {
  const key=process.env.OPENAI_API_KEY;if(!key)throw new Error('Cloud speech is not configured');
  const headers={authorization:`Bearer ${key}`};let response:Response;
  if(request.operation==='recognize'){
    const data=new FormData();data.set('model',process.env.JARVIS_RTC_ASR_MODEL??'gpt-4o-mini-transcribe');data.set('file',new Blob([Uint8Array.from(Buffer.from(request.audio,'base64'))],{type:'audio/wav'}),'utterance.wav');
    response=await fetch('https://api.openai.com/v1/audio/transcriptions',{method:'POST',headers,body:data,signal:AbortSignal.any([signal,AbortSignal.timeout(25000)])});
    if(!response.ok)throw new Error('Cloud recognition unavailable');const value=await response.json() as {text?:string};return{text:value.text?.slice(0,8192)};
  }
  response=await fetch('https://api.openai.com/v1/audio/speech',{method:'POST',headers:{...headers,'content-type':'application/json'},body:JSON.stringify({model:process.env.JARVIS_RTC_TTS_MODEL??'gpt-4o-mini-tts',voice:'alloy',input:request.text.slice(0,4096),response_format:'pcm'}),signal:AbortSignal.any([signal,AbortSignal.timeout(25000)])});
  if(!response.ok)throw new Error('Cloud synthesis unavailable');const input=Buffer.from(await response.arrayBuffer());if(input.length>4000000)throw new Error('Cloud audio exceeds budget');
  // OpenAI PCM is 24 kHz mono int16; the local media track uses 16 kHz.
  const output=Buffer.alloc(Math.floor(input.length/2*2/3)*2);for(let i=0;i<output.length/2;i++){const source=i*1.5,low=Math.floor(source),high=Math.min(low+1,input.length/2-1),fraction=source-low;output.writeInt16LE(Math.round(input.readInt16LE(low*2)*(1-fraction)+input.readInt16LE(high*2)*fraction),i*2);}return{audio:output.toString('base64')};
}
