/// <reference lib="dom" />
import type { ScreenContext } from '@jarvis/contracts';
export function collectBrowserScreenContext():ScreenContext { const detail=globalThis.screen;return{monitors:[{id:'primary',label:'Browser primary screen',x:0,y:0,width:detail.availWidth,height:detail.availHeight,scaleFactor:devicePixelRatio,primary:true}],activeMonitorId:'primary',observedAt:new Date().toISOString()} }
