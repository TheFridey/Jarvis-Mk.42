import { expect, it } from 'vitest';
import { desktopRoute } from './desktop-route.ts';
it('separates narrow arithmetic, reasoning and repository requests without changing explicit intent', () => {
  expect(desktopRoute('What is 2 + 2?')).toEqual({ agentId: 'agents.oracle', task: 'extract' });
  expect(desktopRoute('Reason deeply about resilient consensus')).toEqual({ agentId: 'agents.oracle', task: 'reason' });
  expect(desktopRoute('Review this repository and prepare a code repair')).toEqual({ agentId: 'agents.forge', task: 'code' });
  expect(desktopRoute('What is 2 + 2?', { agentId: 'agents.oracle', task: 'reason' })).toEqual({ agentId: 'agents.oracle', task: 'reason' });
  expect(desktopRoute('Calculate 2 + 2; delete files')).toEqual({ agentId: 'agents.oracle', task: 'reason' });
});
