import { describe, expect, it, vi } from 'vitest';
import type { CognitionRequest } from '@jarvis/contracts';
import { CognitionOrchestrator, cognitionIdentity } from './cognition-orchestrator.ts';
import { BusinessIntelligence } from '../integrations/intelligence.ts';

const request: CognitionRequest = {
  requestId: 'greeting', principalId: 'operator', correlationId: 'conversation', agentId: 'agents.oracle', task: 'reason',
  currentTurnInput: 'Hey Jarvis',
  input: JSON.stringify({ conversation: [{ user: 'Who needs following up?', assistant: 'ScaleSmiths unavailable' }], user: 'Hey Jarvis' }),
};

describe('current conversation turn routing', () => {
  it.each([request, {...request, currentTurnInput: 'Who needs following up?'}])('routes only the current turn while retaining history for the model', async req => {
    const business = new BusinessIntelligence({now: () => '2026-10-08T12:00:00Z'} as ConstructorParameters<typeof BusinessIntelligence>[0]);
    const refresh = vi.spyOn(business, 'refresh').mockResolvedValue({picture: business.picture('operator'), unavailable: []});
    const businessAnswer = vi.fn((principal, text, correlation) => business.answer(principal, text, correlation));
    const runtime = { invoke: vi.fn(async () => ({ result: {proposals: [], evidence: []}, response: {modelId: 'test', usage: {}} })) };
    const sql = vi.fn(async () => [{ request_id: req.requestId }]);
    const context = { compile: vi.fn(async () => ({id: 'context', maxPrivacyClass: 'PUBLIC', budget: {usedUnits: 10}})) };
    const orchestrator = new CognitionOrchestrator({sql, context, runtime, businessAnswer, events: {emit: vi.fn()}, now: () => '2026-10-08T12:00:00Z', cloudAllowed: false} as unknown as ConstructorParameters<typeof CognitionOrchestrator>[0]);
    const response = await orchestrator.submit(req);
    expect(businessAnswer).toHaveBeenCalledWith('operator', req.currentTurnInput, 'conversation');
    if (req.currentTurnInput === 'Hey Jarvis') {
      expect(refresh).not.toHaveBeenCalled();
      expect(runtime.invoke).toHaveBeenCalledOnce();
      const call = runtime.invoke.mock.calls[0] as unknown as [string, {input: {instruction: string; constraints: string[]}}];
      expect(call[1].input.instruction).toBe(req.input);
      expect(call[1].input.constraints).toContain('Respond to the current operator turn: "Hey Jarvis"');
    } else {
      expect(refresh).toHaveBeenCalledOnce();
      expect(runtime.invoke).not.toHaveBeenCalled();
      expect(response.answer).toContain('your follow-ups');
    }
  });

  it('binds recovery identity to the current turn independently of its model input', () => {
    expect(cognitionIdentity(request, false)).not.toBe(cognitionIdentity({...request, currentTurnInput: 'Who needs following up?'}, false));
  });
});
