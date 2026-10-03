/** Audio lifecycle metadata is useful for audio diagnostics, not every question.
 * The actual utterance is already supplied by the authenticated voice gateway.
 * Keep source privacy classes intact; private memory/perception is unaffected.
 */
export function recentEventRelevant(type:string,intent:string):boolean {
  return !type.startsWith('jarvis.perception.audio.')||/\b(voice|audio|microphone|speech|transcript|listening|hear|heard|say|said)\b/i.test(intent);
}
