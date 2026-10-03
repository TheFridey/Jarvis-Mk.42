/// <reference lib="dom" />
import pin from './runtime-assets.json';
export const VISION_ASSET_ROOT='/assets/mediapipe';
export async function verifyVisionAssets(fetcher:typeof fetch=fetch){
 for(const[file,expected]of Object.entries(pin.files)){
  const response=await fetcher(`${VISION_ASSET_ROOT}/${file}`,{cache:'no-cache'});if(!response.ok)throw new Error('Local vision assets missing; run vision:assets');
  const digest=await crypto.subtle.digest('SHA-256',await response.arrayBuffer());const actual=Array.from(new Uint8Array(digest),v=>v.toString(16).padStart(2,'0')).join('');if(actual!==expected)throw new Error('Local vision asset integrity check failed');
 }return{version:pin.version,modelPath:`${VISION_ASSET_ROOT}/hand_landmarker.task`,wasmRoot:`${VISION_ASSET_ROOT}/wasm`};
}
