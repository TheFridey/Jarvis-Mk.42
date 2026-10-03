// Offline operator provisioning: no CA key ever enters Kernel or node transport.
import { spawnSync } from 'node:child_process';
import { existsSync,mkdirSync,writeFileSync,readdirSync,chmodSync } from 'node:fs';
import { resolve,join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
export function provisionNodePki(directory,nodeIds=['workstation-1','display-1','workstation-1-rotated']){
  const dir=resolve(directory);mkdirSync(dir,{recursive:true,mode:0o700});
  if(readdirSync(dir).length)throw new Error('PKI directory must be empty');
  if(process.platform==='win32'){
    const principal=`${process.env.USERDOMAIN}\\${process.env.USERNAME}`;
    const acl=spawnSync('icacls',[dir,'/inheritance:r','/grant:r',`${principal}:(OI)(CI)F`,'*S-1-5-18:(OI)(CI)F'],{stdio:'ignore',windowsHide:true});
    if(acl.status!==0)throw new Error('unable to protect private PKI directory ACL');
  }else chmodSync(dir,0o700);
  const openssl=process.env.JARVIS_OPENSSL??(process.platform==='win32'&&existsSync('C:/Program Files/Git/usr/bin/openssl.exe')?'C:/Program Files/Git/usr/bin/openssl.exe':'openssl');
  const run=args=>{const result=spawnSync(openssl,args,{cwd:dir,encoding:'utf8',windowsHide:true});if(result.status!==0)throw new Error('OpenSSL provisioning failed');};
  if(existsSync(join(dir,'ca.key')))throw new Error('refusing to overwrite existing PKI');
  run(['req','-x509','-newkey','ec','-pkeyopt','ec_paramgen_curve:prime256v1','-nodes','-days','365','-subj','/CN=Jarvis private node CA','-keyout','ca.key','-out','ca.crt','-addext','basicConstraints=critical,CA:TRUE','-addext','keyUsage=critical,keyCertSign,cRLSign']);
  function leaf(name,identity,server=false){
    if(!/^[A-Za-z0-9._:-]{3,128}$/.test(name)||! /^[A-Za-z0-9._:-]{3,128}$/.test(identity))throw new Error('invalid PKI identity');
    run(['req','-new','-newkey','ec','-pkeyopt','ec_paramgen_curve:prime256v1','-nodes','-subj',`/CN=${identity}`,'-keyout',`${name}.key`,'-out',`${name}.csr`]);
    writeFileSync(join(dir,`${name}.ext`),`basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=${server?'serverAuth':'clientAuth'}\nsubjectAltName=${server?'DNS:localhost,IP:127.0.0.1,IP:::1':`URI:urn:jarvis:node:${identity}`}\n`,{mode:0o600});
    run(['x509','-req','-in',`${name}.csr`,'-CA','ca.crt','-CAkey','ca.key','-set_serial',`0x${randomBytes(16).toString('hex')}`,'-days','7','-sha256','-extfile',`${name}.ext`,'-out',`${name}.crt`]);
  }
  leaf('server','kernel-server',true);for(const id of nodeIds)leaf(id,id.endsWith('-rotated')?id.slice(0,-8):id);
  return dir;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const directory=process.argv[2];if(!directory)throw new Error('usage: node scripts/node-pki.mjs <private-directory> [node-id ...]');
  provisionNodePki(directory,process.argv.length>3?process.argv.slice(3):undefined);process.stdout.write('Private PKI provisioned. Restrict directory ACLs to its operator. Keep ca.key offline.\n');
}
