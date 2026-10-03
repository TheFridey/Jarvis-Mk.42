import { spawnSync } from 'node:child_process';
const docker=spawnSync('docker',['ps'],{stdio:'ignore',windowsHide:true});
if(docker.status!==0){process.stderr.write('Node proof requires a running Docker daemon; no skipped proof is accepted.\n');process.exit(1);}
const result=spawnSync('pnpm',['exec','vitest','run','apps/core/test/node-protocol.integration.test.ts'],{stdio:'inherit',env:{...process.env,JARVIS_IT:'1'},shell:process.platform==='win32',windowsHide:true});
process.exit(result.status??1);
