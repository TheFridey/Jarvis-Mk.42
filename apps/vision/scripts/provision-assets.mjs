import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url)),version='0.10.35';
const pkg=JSON.parse(await readFile(`${root}/node_modules/@mediapipe/tasks-vision/package.json`,'utf8'));
if(pkg.version!==version)throw new Error('Install the pinned MediaPipe package before provisioning');
const destination=`${root}/public/assets/mediapipe`;await mkdir(`${destination}/wasm`,{recursive:true});
const files=['vision_wasm_internal.js','vision_wasm_internal.wasm','vision_wasm_nosimd_internal.js','vision_wasm_nosimd_internal.wasm','vision_wasm_module_internal.js','vision_wasm_module_internal.wasm'];
for(const name of files)await copyFile(`${root}/node_modules/@mediapipe/tasks-vision/wasm/${name}`,`${destination}/wasm/${name}`);
const modelUrl='https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
let model;try{model=await readFile(`${destination}/hand_landmarker.task`);}catch{const response=await fetch(modelUrl,{signal:AbortSignal.timeout(60000)});if(!response.ok)throw new Error('Official model download failed');model=Buffer.from(await response.arrayBuffer());if(model.length>20000000)throw new Error('Unexpected model size');await writeFile(`${destination}/hand_landmarker.task`,model);}
const hashes={};for(const file of ['hand_landmarker.task',...files.map(name=>`wasm/${name}`)])hashes[file]=createHash('sha256').update(await readFile(`${destination}/${file}`)).digest('hex');
const manifest={schemaVersion:1,package:'@mediapipe/tasks-vision',version,modelSource:modelUrl,files:hashes};const pinPath=`${root}/src/runtime-assets.json`;
try{const pinned=JSON.parse(await readFile(pinPath,'utf8'));if(JSON.stringify(pinned)!==JSON.stringify(manifest))throw new Error('Runtime assets differ from committed pins; refusing implicit repin');}catch(error){if(error.code!=='ENOENT')throw error;await writeFile(pinPath,JSON.stringify(manifest,null,2)+'\n');}
await writeFile(`${destination}/manifest.json`,JSON.stringify(manifest,null,2)+'\n');process.stdout.write(`SHA-256 verified ${Object.keys(hashes).length} local assets for MediaPipe ${version}.\n`);
