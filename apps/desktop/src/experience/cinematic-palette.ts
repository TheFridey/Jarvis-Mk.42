/** Model colour is presentation only; inspecting a model never changes routing. */
export function modelTint(modelId?: string): string {
  const id = modelId?.toLowerCase() ?? '';
  if (/claude|anthropic/.test(id)) return '#efa889';
  if (/gpt|openai|demo-cloud-fast/.test(id)) return '#7be5c0';
  if (/gemini|google|demo-cloud-vision/.test(id)) return '#8fa9ff';
  if (/grok|xai/.test(id)) return '#c4dbed';
  if (/deepseek|qwen/.test(id)) return '#b29aff';
  if (/llama|ollama|local/.test(id)) return '#62d9ee';
  return '#e8be7c';
}
