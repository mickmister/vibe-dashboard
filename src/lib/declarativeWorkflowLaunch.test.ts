import { describe, expect, it } from 'vitest';
import { BUILT_IN_DECLARATIVE_WORKFLOW_DEFINITIONS } from '../workflows/declarative/builtins';

const TWO_AGENT_REVIEW_ROUND_DEFINITION = BUILT_IN_DECLARATIVE_WORKFLOW_DEFINITIONS[0]!;
import { buildDeclarativeWorkflowInput, createDraftFromDefinition, createMinimalWorkflowTeam, describeDefinitionRoles, validateDeclarativeWorkflowLaunch } from './declarativeWorkflowLaunch';

describe('declarative workflow launch helpers', () => {
  it('validates required inputs and role/session choices before launch', () => {
    const draft = createDraftFromDefinition(TWO_AGENT_REVIEW_ROUND_DEFINITION, { sourceRole: '', reviewRole: '' });
    const result = validateDeclarativeWorkflowLaunch(TWO_AGENT_REVIEW_ROUND_DEFINITION, draft);

    expect(result.ok).toBe(false);
    expect(result.fieldErrors).toMatchObject({
      workspaceId: 'Workspace id is required.',
      task: 'Task is required.',
      sourceRole: 'Choose a source session or role.',
      reviewRole: 'Choose a reviewer session or role.',
    });
  });

  it('blocks same explicit source/reviewer session when definition policy requires it', () => {
    const draft = createDraftFromDefinition(TWO_AGENT_REVIEW_ROUND_DEFINITION, {
      workspaceId: 'ws-1',
      task: 'Review this',
      sourceSessionId: 'session-same',
      reviewSessionId: 'session-same',
    });

    const result = validateDeclarativeWorkflowLaunch(TWO_AGENT_REVIEW_ROUND_DEFINITION, draft);

    expect(result.ok).toBe(false);
    expect(result.fieldErrors.reviewSessionId).toBe('Source and reviewer must use different VK sessions.');
  });

  it('builds sparse input and a minimal runtime team for durable start', () => {
    const draft = createDraftFromDefinition(TWO_AGENT_REVIEW_ROUND_DEFINITION, {
      workspaceId: 'ws-1',
      task: 'Implement feature',
      sourceRole: 'impl',
      reviewRole: 'review',
      sourceSessionId: 'source-session',
      reviewSessionId: 'review-session',
      overseerSessionId: '',
    });

    expect(buildDeclarativeWorkflowInput(draft)).toEqual({
      workspaceId: 'ws-1',
      task: 'Implement feature',
      sourceRole: 'impl',
      reviewRole: 'review',
      sourceSessionId: 'source-session',
      reviewSessionId: 'review-session',
    });
    expect(createMinimalWorkflowTeam({ workspaceId: 'ws-1', sourceRole: 'impl', reviewRole: 'review', sourceSessionId: 'source-session', reviewSessionId: 'review-session' })).toMatchObject({
      agents: [
        { id: 'source', role: 'impl', vkWorkspaceId: 'ws-1', vkSessionId: 'source-session' },
        { id: 'review', role: 'review', vkWorkspaceId: 'ws-1', vkSessionId: 'review-session' },
      ],
      policies: { requireOrchestrator: false, allowWorkspaceParallelism: false },
      workflowBindings: [{ workflowId: 'two-agent-review-round', trigger: 'manual', enabled: true }],
    });
  });

  it('summarizes role-resolution expectations from a definition', () => {
    expect(describeDefinitionRoles(TWO_AGENT_REVIEW_ROUND_DEFINITION)).toEqual([
      'source: implementer',
      'review: reviewer',
    ]);
  });
});
