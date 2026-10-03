import {describe,expect,it} from 'vitest';
import {VisionQualification} from './qualification.ts';
import {verifyVisionAssets} from './local-assets.ts';
import pin from './runtime-assets.json';
import {readFile} from 'node:fs/promises';
describe('vision qualification and offline assets',()=>{
 it('does not manufacture unobserved measurements or attest without trials',()=>{const q=new VisionQualification();expect(q.report(0,true)).toMatchObject({physicalVerification:'pending',inferenceLatencyMs:{p50:null,p95:null},falseGesturesPerMinute:null});q.start(0);q.sample(8,{x:0,y:0});q.sample(12,{x:3,y:4});expect(q.report(60000,true).physicalVerification).toBe('pending');for(const kind of ['pinch','swipe','loss','false-gesture'] as const)q.trial(kind,true,100);q.trial('false-gesture',false);expect(q.report(60000,true)).toMatchObject({physicalVerification:'operator-attested',trackingStepPixels:5,falseGesturesPerMinute:1});});
 it('verifies every pinned local asset with no external runtime URL',async()=>{const urls:string[]=[];const fetcher=async(url:unknown)=>{urls.push(String(url));const file=String(url).replace('/assets/mediapipe/','');const bytes=await readFile(new URL(`../public/assets/mediapipe/${file}`,import.meta.url));return new Response(bytes);};await expect(verifyVisionAssets(fetcher as typeof fetch)).resolves.toMatchObject({version:pin.version,wasmRoot:'/assets/mediapipe/wasm'});expect(urls).toHaveLength(Object.keys(pin.files).length);expect(urls.every(u=>u.startsWith('/assets/mediapipe/'))).toBe(true);});
 it('refuses corrupted assets before loading inference',async()=>{await expect(verifyVisionAssets((async()=>new Response('tampered')) as typeof fetch)).rejects.toThrow('integrity');});
});
