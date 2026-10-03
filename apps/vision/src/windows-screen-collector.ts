import {execFile} from 'node:child_process';import {promisify} from 'node:util';import {fileURLToPath} from 'node:url';import {realpath,stat} from 'node:fs/promises';import {join} from 'node:path';import type {ScreenContext} from '@jarvis/contracts';
const execFileAsync=promisify(execFile);
export interface WorkspaceBinding {processId:number;application:string;rootPath:string}
export async function bindWorkspace(context:ScreenContext,bindings:readonly WorkspaceBinding[]):Promise<ScreenContext>{
 const binding=bindings.find(b=>Number.isSafeInteger(b.processId)&&b.processId===context.activeWindow?.processId&&b.application===context.activeWindow.application);
 if(!binding)return context;const rootPath=await realpath(binding.rootPath);if(!(await stat(rootPath)).isDirectory())return context;
 let repositoryRoot:string|undefined;try{await stat(join(rootPath,'.git'));repositoryRoot=rootPath;}catch{/* No deterministic repository evidence. */}
 return{...context,workspace:{rootPath,...(repositoryRoot?{repositoryRoot}:{}),source:'explicit-process-binding',processId:binding.processId}};
}
export async function collectWindowsScreenContext(bindings:readonly WorkspaceBinding[]=[]):Promise<ScreenContext>{const {stdout}=await execFileAsync('powershell.exe',['-NoProfile','-NonInteractive','-File',fileURLToPath(new URL('../scripts/screen-context.ps1',import.meta.url))],{windowsHide:true,timeout:10000});return bindWorkspace(JSON.parse(stdout) as ScreenContext,bindings);}
