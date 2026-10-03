// Explicit presentation fixture. This is not a Kernel or device-continuity proof.
import {createServer} from 'node:http';
import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../public/index.html',import.meta.url));
let variant='ambient',eventAt=0;
const server=createServer((req,res)=>{
  res.setHeader('cache-control','no-store');
  if(req.url==='/event'){variant='event';eventAt=Date.now();res.end('fixture event selected');return;}
  if(req.url==='/offline'){variant='offline';res.end('fixture offline selected');return;}
  if(req.url==='/state'){
    res.setHeader('content-type','application/json');
    res.end(JSON.stringify({live:variant!=='offline',receivedAt:Date.now(),picture:{mode:'AMBIENT',interaction:'AWARE',work:'IDLE',health:'PREVIEW FIXTURE',objective:'Prepare the next project briefing',business:[{name:'projects',status:'available'}],nextMeeting:null,alerts:variant==='event'?['fixture-alert']:[],agents:variant==='event'?[{id:'agents.nova',state:'RUNNING'}]:[],workflows:[],...(variant==='event'?{presented:{objectId:'fixture-object',title:'Selected Scene resource',resourceRefs:['objective:fixture-briefing'],expiresAt:new Date(eventAt+10000).toISOString()}}:{})}}));return;
  }
  res.setHeader('content-type','text/html');res.end(html);
});
server.listen(7424,'127.0.0.1',()=>process.stdout.write('Wall fixture preview http://127.0.0.1:7424\n'));
