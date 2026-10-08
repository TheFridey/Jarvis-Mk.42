/** Ordinary chat can use the operator-enabled cloud route without ambient
 * business records. Explicit private/system requests retain full context. */
export function needsPrivateContext(text: string): boolean {
  return /\b(scalesmiths|clients?|customers?|leads?|invoices?|payments?|retainers?|proposals?|revenue|sales|crm|pipeline|follow.up|following up|meetings?|calendar|emails?|mailbox|production|telemetry|objectives?|workspace|repository|codebase|screen|selected|confidential|restricted|password|credentials?|secrets?|tokens?)\b/i.test(text)
    || /\b(my|our)\s+(business|company|data|files?|accounts?|projects?|tasks?|history)\b/i.test(text)
    || /\b(remember|recorded knowledge|personal history)\b/i.test(text);
}
export function cloudConversationEnabled() { return ['1','true'].includes(process.env.JARVIS_CONVERSATION_CLOUD_ALLOWED??''); }
export function isCloudChatInput(input: string, currentTurn: string): boolean {
  try { const envelope = JSON.parse(input); return envelope?.conversationScope === 'cloud-chat-v1' && envelope.user === currentTurn && Array.isArray(envelope.conversation); } catch { return false; }
}
