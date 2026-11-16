'use client';
import React, { useEffect, useRef, useState } from 'react';
import Markdown from 'react-markdown';
import { Volume2, VolumeX, Square, ChevronDown, ChevronUp } from 'lucide-react';
import { speakAnswer } from './answer-speech.ts';

/** Speech is presentation of an already delivered answer, using an explicitly local voice. */
export function ResponsePanel({text,answerId,live}:{text:string;answerId?:string;live:boolean}) {
  const [expanded,setExpanded]=useState(true);
  const [enabled,setEnabled]=useState(true);
  const [status,setStatus]=useState('Local voice · ready');
  const [speaking,setSpeaking]=useState(false);
  const [voices,setVoices]=useState<SpeechSynthesisVoice[]>([]);
  const [voiceURI,setVoiceURI]=useState('');
  const observed=useRef<string|undefined>(answerId);
  const cancelSpeech=useRef<(()=>void)|undefined>(undefined);
  useEffect(()=>{
    if(!('speechSynthesis' in window)){setStatus('Speech unavailable in this browser');return;}
    const refresh=()=>{const local=window.speechSynthesis.getVoices().filter(voice=>voice.localService);setVoices(local);if(!local.some(voice=>voice.lang.startsWith('en')))setStatus('No local English voice available');};
    refresh();window.speechSynthesis.addEventListener('voiceschanged',refresh);
    setEnabled(localStorage.getItem('jarvis-response-voice')!=='off');
    setVoiceURI(localStorage.getItem('jarvis-response-voice-uri')??'');
    return()=>{window.speechSynthesis.removeEventListener('voiceschanged',refresh);cancelSpeech.current?.();};
  },[]);
  const stop=()=>{cancelSpeech.current?.();setSpeaking(false);setStatus('Local voice · stopped');};
  const speak=(preview=false)=>{
    const textToRead=preview?'Good morning. I am Jarvis. This is a preview of my voice. How can I help you today?':text;
    if(!('speechSynthesis' in window)){setStatus('Speech unavailable in this browser');return;}
    cancelSpeech.current?.();
    cancelSpeech.current=speakAnswer(textToRead,window.speechSynthesis,value=>new SpeechSynthesisUtterance(value),(playing,message)=>{setSpeaking(playing);setStatus(message);},voiceURI);
  };
  useEffect(()=>{
    if(!answerId||answerId===observed.current)return;
    observed.current=answerId;setExpanded(true);
    if(enabled&&live)speak();
  },[answerId,enabled,live]);
  if(!text)return null;
  return <aside className={`response-panel${expanded?'':' collapsed'}`} aria-label="JARVIS response">
    <header><div><span className="response-mark" aria-hidden="true">◇</span><strong>JARVIS</strong><small>{live?'RESPONSE':'LAST RECORDED RESPONSE'}</small></div><button onClick={()=>setExpanded(value=>!value)} aria-label={expanded?'Minimise response':'Expand response'} aria-expanded={expanded}>{expanded?<ChevronDown size={18}/>:<ChevronUp size={18}/>}</button></header>
    {expanded&&<div className="response-body"><Markdown skipHtml components={{a:({children,href})=><a href={href} target="_blank" rel="noopener noreferrer">{children}</a>,img:({alt})=><span>{alt}</span>}}>{text}</Markdown></div>}
    <details className="response-settings"><summary>Voice &amp; playback <span>{speaking?'SPEAKING':enabled?'ON':'OFF'}</span></summary>
    <label className="response-voice-selector">Speaking voice<select aria-label="Speaking voice" value={voices.some(voice=>voice.voiceURI===voiceURI)?voiceURI:''} onChange={event=>{stop();setVoiceURI(event.target.value);localStorage.setItem('jarvis-response-voice-uri',event.target.value);setStatus('Local voice · ready');}}><option value="">Automatic · installed English voice</option><optgroup label="Installed local voices">{voices.map(voice=><option key={voice.voiceURI} value={voice.voiceURI}>{voice.name} · {voice.lang}</option>)}</optgroup></select></label>
    <footer><button aria-pressed={enabled} onClick={()=>{const value=!enabled;setEnabled(value);localStorage.setItem('jarvis-response-voice',value?'on':'off');if(!value)stop();else speak();}}>{enabled?<Volume2 size={15}/>:<VolumeX size={15}/>} Voice {enabled?'on':'off'}</button><span role="status">{speaking||enabled?status:'Automatic voice off'}</span><button onClick={()=>speak(true)} disabled={!voices.length}>Preview</button>{speaking?<button onClick={stop}><Square size={13}/> Stop</button>:<button onClick={()=>speak()} disabled={!voices.some(v=>v.lang.startsWith('en'))}>Read aloud</button>}</footer></details>
  </aside>;
}
