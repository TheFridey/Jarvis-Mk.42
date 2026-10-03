import './local-env.ts';
import { randomBytes } from 'node:crypto';
import { readFileSync,writeFileSync,appendFileSync,existsSync,mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const envPath=resolve('.env'),dir=resolve('artifacts/local-runtime/pki');mkdirSync(dir,{recursive:true});
if(process.platform==='win32'){
  const result=spawnSync('icacls',[dir,'/inheritance:r','/grant:r',`${process.env.USERDOMAIN}\\${process.env.USERNAME}:(OI)(CI)F`,'*S-1-5-18:(OI)(CI)F'],{stdio:'ignore',windowsHide:true});if(result.status!==0)throw new Error('Could not protect RTC configuration');
}
let env=existsSync(envPath)?readFileSync(envPath,'utf8'):'';
const key=process.env.JARVIS_LIVEKIT_API_KEY||randomBytes(12).toString('hex'),secret=process.env.JARVIS_LIVEKIT_API_SECRET||randomBytes(32).toString('hex');
for(const [name,value] of Object.entries({JARVIS_RTC_ENABLED:'1',JARVIS_LIVEKIT_URL:'ws://127.0.0.1:7880',JARVIS_LIVEKIT_API_KEY:key,JARVIS_LIVEKIT_API_SECRET:secret})){
  const pattern=new RegExp(`^${name}=.*$`,'m');if(pattern.test(env))env=env.replace(pattern,`${name}=${value}`);else env+=`\n${name}=${value}`;
}
writeFileSync(envPath,env,{mode:0o600});
writeFileSync(resolve(dir,'livekit.yaml'),`port: 7880\nbind_addresses: ["0.0.0.0"]\nrtc:\n  tcp_port: 7881\n  udp_port: 7882\n  node_ip: 127.0.0.1\n  use_external_ip: false\nkeys:\n  ${JSON.stringify(key)}: ${JSON.stringify(secret)}\nlogging:\n  level: warn\n`,{mode:0o600});
console.log('Private local RTC configuration provisioned. No credentials printed.');
