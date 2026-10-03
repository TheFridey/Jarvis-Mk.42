// Measures the actual opened renderer. No synthetic FPS or GPU utilisation.
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const active=process.argv.includes('--active');
const renderer=process.argv.includes('--production')?'production export':'dev renderer';
const code = `new Promise(resolve => {
  const samples = [];
  const coreResponses=[];
  const listener = event => samples.push({...event.detail, state:document.querySelector('.gpu-environment')?.className, kernelState:document.querySelector('[aria-label="Kernel presentation state"]')?.textContent, observedAt:new Date().toISOString(), at:performance.now()});
  const core=document.querySelector('[aria-label="Kernel presentation state"]');
  let previous=core?.textContent;
  const observer=new MutationObserver(()=>{const value=core?.textContent;if(value===previous)return;previous=value;const at=performance.now();requestAnimationFrame(()=>coreResponses.push({state:value,domStateToNextAnimationFrameMs:performance.now()-at}));});
  if(core)observer.observe(core,{subtree:true,childList:true,characterData:true});
  window.addEventListener('jarvis:renderer-metrics',listener);
  if(${active})setTimeout(()=>{
    document.querySelector('.command-line')?.click();
    setTimeout(()=>{
      const input=document.querySelector('#proposal-json');
      if(!input)return;
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'Reason deeply to qualify renderer');
      input.dispatchEvent(new Event('input',{bubbles:true}));
      setTimeout(()=>Array.from(document.querySelectorAll('.proposal-entry button')).find(b=>b.textContent==='SUBMIT TO JARVIS')?.click(),100);
    },100);
  },1000);
  setTimeout(() => {
    window.removeEventListener('jarvis:renderer-metrics',listener);
    observer.disconnect();
    resolve(JSON.stringify({observedAt:new Date().toISOString(), scope:'Headless Chromium ${renderer} on Windows ARM, ${active?'UI cognition command with controlled four-second provider hold':'ambient fixture Kernel'}; rendered frames, not monitor refresh. Core timing is DOM state to next browser animation frame, not GPU scanout.', viewport:{width:innerWidth,height:innerHeight,dpr:devicePixelRatio}, samples,coreResponses, memory:performance.memory?{usedJSHeapSize:performance.memory.usedJSHeapSize,totalJSHeapSize:performance.memory.totalJSHeapSize,jsHeapSizeLimit:performance.memory.jsHeapSizeLimit}:null, gpuUtilisation:null, firstToken:null,speech:null,airTouch:null}));
  },10000);
})`;
const raw = execFileSync('npx', ['--yes','agent-browser','eval','--stdin'], {input:code,encoding:'utf8',shell:process.platform==='win32',windowsHide:true,timeout:30000});
const value=JSON.parse(raw.trim());
const report=typeof value==='string'?JSON.parse(value):value;
const target=active?'artifacts/mark42/browser-performance-active.json':'artifacts/mark42/browser-performance.json';
writeFileSync(target,JSON.stringify(report,null,2));
if(!report.samples?.length)throw new Error('No rendered-frame samples were observed');
if(active&&!report.coreResponses?.some(sample=>/THINKING|ROUTING|WAITING|INTERPRETING/.test(sample.state)))throw new Error('Active UI cognition was not observed; do not certify the active renderer');
console.log('Measured renderer samples written to '+target);
