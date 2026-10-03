// Loopback-only browser qualification of the existing production export.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';
const root=resolve('apps/desktop/out');
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.json':'application/json','.txt':'text/plain','.woff2':'font/woff2'};
const server=createServer(async(req,res)=>{
  try{
    const path=new URL(req.url??'/', 'http://127.0.0.1').pathname;
    const file=resolve(root,'.'+decodeURIComponent(path==='/'?'/index.html':path));
    if(!file.startsWith(root+sep)){res.writeHead(403).end();return;}
    const body=await readFile(file);res.writeHead(200,{'content-type':mime[extname(file)]??'application/octet-stream','cache-control':'no-store'}).end(body);
  }catch{res.writeHead(404).end();}
});
server.listen(7426,'127.0.0.1',()=>console.log('Production desktop export qualification: http://127.0.0.1:7426'));
process.once('SIGINT',()=>server.close());process.once('SIGTERM',()=>server.close());
