/** Model colour is presentation only; inspecting a model never changes routing. */
export function modelTint(modelId?: string): string {
  const id = modelId?.toLowerCase() ?? '';
  if (/openrouter/.test(id)) return '#aa9fff';
  if (/claude|anthropic/.test(id)) return '#efa889';
  if (/gpt|openai|demo-cloud-fast/.test(id)) return '#7be5c0';
  if (/gemini|google|demo-cloud-vision/.test(id)) return '#8fa9ff';
  if (/grok|xai/.test(id)) return '#c4dbed';
  if (/deepseek|qwen/.test(id)) return '#b29aff';
  if (/llama|ollama|local/.test(id)) return '#62d9ee';
  return '#e8be7c';
}

export type VisualPreset = 'auto' | 'gpt' | 'claude' | 'openrouter' | 'jarvis';
export const VISUAL_PRESETS: Record<VisualPreset, {label:string;model:string;shape:number}> = {
 auto:{label:'Follow model',model:'',shape:0},gpt:{label:'GPT-6.1 · GPT style',model:'gpt-6.1',shape:1},
 claude:{label:'Claude Opus 5.5',model:'claude-opus-5.5',shape:2},openrouter:{label:'OpenRouter',model:'openrouter',shape:3},jarvis:{label:'JARVIS gold',model:'jarvis',shape:0}
};
export function modelShape(id?:string):number {if(/openrouter/i.test(id??''))return 3;if(/claude|anthropic/i.test(id??''))return 2;if(/gpt|openai|demo-cloud-fast/i.test(id??''))return 1;return 0;}
