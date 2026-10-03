import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { platform } from 'node:os';
const run=promisify(execFile);
// Fixed local probes, no user-supplied shell text or executable paths.
export async function optionalHostProbes():Promise<Record<string,number>>{
  const values:Record<string,number>={};
  await Promise.all([
    (async()=>{try{const {stdout}=await run('nvidia-smi',['--query-gpu=utilization.gpu,memory.used,temperature.gpu,power.draw','--format=csv,noheader,nounits'],{timeout:1500,maxBuffer:8192,windowsHide:true});const rows=stdout.trim().split(/\r?\n/).map(line=>line.split(',').map(v=>Number(v.trim())));for(const[index,key]of ['gpu','gpuVram','gpuTemperature','gpuPower'].entries()){const valid=rows.map(row=>row[index]).filter((v):v is number=>v!==undefined&&Number.isFinite(v));if(valid.length){const value=key==='gpu'||key==='gpuTemperature'?Math.max(...valid):valid.reduce((a,b)=>a+b,0);values[key]=key==='gpuVram'?value*1048576:value;}}}catch{/* NVIDIA is optional, including driver absence and N/A fields. */}})(),
    (async()=>{if(platform()!=='win32')return;try{const {stdout}=await run('powershell.exe',['-NoProfile','-NonInteractive','-Command',"$disks=Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3'; $size=($disks|Measure-Object Size -Sum).Sum; $free=($disks|Measure-Object FreeSpace -Sum).Sum; $net=(Get-CimInstance Win32_PerfFormattedData_Tcpip_NetworkInterface|Measure-Object BytesTotalPersec -Sum).Sum; @{disk=($(if($size -gt 0){100*(1-$free/$size)}else{$null}));network=$net}|ConvertTo-Json -Compress"],{timeout:2500,maxBuffer:4096,windowsHide:true});const data=JSON.parse(stdout) as Record<string,unknown>;for(const key of ['disk','network'])if(typeof data[key]==='number'&&Number.isFinite(data[key]))values[key]=data[key];}catch{/* Exporter readings remain usable if CIM is unavailable. */}})(),
  ]);return values;
}
