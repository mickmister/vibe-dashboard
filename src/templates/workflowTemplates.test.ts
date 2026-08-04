import { describe, expect, it } from 'vitest';
import {
  addWorkflowTemplate,
  createBuiltInWorkflowTemplates,
  createDefaultWorkflowTemplateState,
  createWorkflowTemplate,
  deleteWorkflowTemplate,
  duplicateWorkflowTemplate,
  migrateWorkflowTemplateState,
  selectWorkflowTemplate,
  updateWorkflowTemplate,
  validateWorkflowTemplate,
} from './workflowTemplates';

describe('workflow template config model', () => {
  const ids = { templateId: (() => { let i = 0; return () => ['template-1', 'template-2', 'template-3'][i++] ?? `template-${i}`; })() };

  it('creates versioned workflow templates with practical defaults', () => {
    const template = createWorkflowTemplate({
      name: 'Plan and review',
      body: 'Please plan {{task}}',
      teamId: 'team-1',
      targetRoles: ['implementer', 'reviewer', 'implementer'],
      policyOverrides: { maxConcurrentAgents: 2, fanInMode: 'all_at_once' },
    }, { ids, now: '2026-07-30T00:00:00.000Z' });

    expect(template).toMatchObject({
      id: 'template-1',
      version: 1,
      name: 'Plan and review',
      teamId: 'team-1',
      defaultWorkflowId: 'manual-agent-team-runner',
      targetRoles: ['implementer', 'reviewer'],
      policyOverrides: { maxConcurrentAgents: 2, maxNudgesPerRun: null, fanInMode: 'all_at_once' },
    });
  });

  it('adds updates duplicates selects and deletes templates immutably', () => {
    let state = createDefaultWorkflowTemplateState();
    state = addWorkflowTemplate(state, { id: 'template-a', name: 'A', body: 'Do A' }, { now: '2026-07-30T00:00:00.000Z' });
    expect(state.selectedTemplateId).toBe('template-a');

    state = updateWorkflowTemplate(state, 'template-a', { name: 'Alpha', targetRoles: ['pm'], skillRefs: ['skills/review.md'] }, '2026-07-30T00:01:00.000Z');
    expect(state.templates[0]).toMatchObject({ name: 'Alpha', targetRoles: ['pm'], skillRefs: ['skills/review.md'], updatedAt: '2026-07-30T00:01:00.000Z' });

    state = duplicateWorkflowTemplate(state, 'template-a', { ids: { templateId: () => 'template-b' }, now: '2026-07-30T00:02:00.000Z' });
    expect(state.templates).toHaveLength(2);
    expect(state.templates[1]).toMatchObject({ id: 'template-b', name: 'Alpha copy', body: 'Do A' });

    state = selectWorkflowTemplate(state, 'template-b');
    expect(state.selectedTemplateId).toBe('template-b');
    state = deleteWorkflowTemplate(state, 'template-b');
    expect(state.selectedTemplateId).toBe('template-a');
  });

  it('migrates partial state and drops invalid templates', () => {
    const migrated = migrateWorkflowTemplateState({
      version: 0,
      selectedTemplateId: 'template-old',
      templates: [
        { id: 'template-old', name: 'Old', body: 'Body', targetRoles: ['implementer'] },
        { id: 'template-bad', name: '', body: '' },
      ],
    });

    expect(migrated).toMatchObject({
      version: 1,
      selectedTemplateId: 'template-old',
      templates: [{ id: 'template-old', defaultWorkflowId: 'manual-agent-team-runner' }],
    });
  });

  it('rejects invalid templates and provides a resettable built-in example', () => {
    expect(() => validateWorkflowTemplate({
      ...createWorkflowTemplate({ name: 'Valid', body: 'Body' }),
      body: '',
    })).toThrow(/Template body is required/);

    const builtIns = createBuiltInWorkflowTemplates({ ids: { templateId: () => 'builtin-1' }, now: '2026-07-30T00:00:00.000Z' });
    expect(builtIns[0]).toMatchObject({ id: 'builtin-1', targetRoles: ['implementer', 'reviewer'] });
  });
});
