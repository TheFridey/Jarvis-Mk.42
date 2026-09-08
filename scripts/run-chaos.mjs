import{spawnSync}from'node:child_process';
const docker=spawnSync('docker',['ps'],{stdio:'ignore',shell:process.platform==='win32'});if(docker.status!==0){console.error('MANDATORY INFRASTRUCTURE CHAOS GATE FAILED: Docker daemon is unavailable.');process.exit(1)}
// RC-audit fix: dropped the JARVIS_REAL_CHAOS flag — nothing read it, so it
// implied a level of fault injection the suite does not perform.
const result=spawnSync('pnpm',['exec','vitest','run','test/chaos'],{stdio:'inherit',env:{...process.env,JARVIS_GATE:'chaos'},shell:process.platform==='win32'});process.exit(result.status??1);
