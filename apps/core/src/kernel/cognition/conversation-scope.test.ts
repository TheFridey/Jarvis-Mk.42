import { expect,it } from 'vitest';
import { isCloudChatInput,needsPrivateContext } from './conversation-scope.ts';
it.each(['Hey Jarvis','Explain how rainbows form','Can you help me plan a walk?','Tell me more about that'])('allows ordinary conversational scope: %s',text=>expect(needsPrivateContext(text)).toBe(false));
it.each(['What is our revenue?','Who needs following up?','List my clients','Check production','Read my emails','Review the repository','Remember my personal history'])('retains private context: %s',text=>expect(needsPrivateContext(text)).toBe(true));
it('recognises only a Kernel-built conversation envelope bound to the saved current turn',()=>{
  expect(isCloudChatInput(JSON.stringify({conversationScope:'cloud-chat-v1',conversation:[],user:'Hey'}),'Hey')).toBe(true);
  expect(isCloudChatInput(JSON.stringify({conversationScope:'cloud-chat-v1',conversation:[],user:'old'}),'Hey')).toBe(false);
  expect(isCloudChatInput('unclassified old private input','Hey')).toBe(false);
});
