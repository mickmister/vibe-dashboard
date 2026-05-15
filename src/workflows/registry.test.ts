import { describe, expect, it } from 'vitest';
import { workflowRegistry } from './registry';

describe('workflowRegistry', () => {
  it('registers the GitHub CI failure workflow', () => {
    expect(workflowRegistry.list()).toEqual([
      expect.objectContaining({
        id: 'github-ci-failure',
        trigger: 'github.workflow_run',
      }),
    ]);
  });
});
