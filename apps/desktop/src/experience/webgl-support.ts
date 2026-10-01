export interface CanvasContextProbe { getContext(name:'webgl2'|'webgl'):unknown }
export function supportsWebGL(createCanvas:()=>CanvasContextProbe=()=>document.createElement('canvas')){try{const canvas=createCanvas();return Boolean(canvas.getContext('webgl2')||canvas.getContext('webgl'))}catch{return false}}
