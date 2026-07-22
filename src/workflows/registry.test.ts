import { describe, expect, it } from 'vitest';
import { workflowRegistry } from './registry';

describe('workflowRegistry', () => {
  it('registers built-in workflows', () => {
    expect(workflowRegistry.list()).toEqual([
      expect.objectContaining({
        id: 'github-ci-failure',
        trigger: 'github.workflow_run',
      }),
      expect.objectContaining({
        id: 'manual-agent-team-runner',
        trigger: 'manual',
      }),
    ]);
  });
});
