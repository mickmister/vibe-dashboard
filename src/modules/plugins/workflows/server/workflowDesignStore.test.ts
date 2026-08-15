import { afterEach, describe, expect, it } from 'vitest';
import { initVdDb, type VdDbHandle } from '../../../../server/database';
import { BUILT_IN_WORKFLOW_TEMPLATES } from '../templates/builtInWorkflowTemplates';
import { DbWorkflowDesignStore, WorkflowDesignValidationError, type WorkflowTemplateCatalogEntry } from './workflowDesignStore';

const handles: VdDbHandle[] = [];

afterEach(async () => {
  for (const handle of handles.splice(0)) {
    await handle.db.destroy();
    handle.sqlite.close();
  }
});

describe('DbWorkflowDesignStore M91 foundation', () => {
  it('TEST_CASE_M91_1A keeps mutable drafts while publishing immutable versions', async () => {
    const { store } = await createStore();
    await seedPromptAssets(store);

    const created = await store.createDesign({
      designId: 'design.dev-review',
      draftId: 'draft.dev-review',
      name: 'Dev review workflow',
      definition: workflowDefinition('dev-review-v1'),
    });
    expect(created.draft.validationStatus).toBe('valid');

    const version1 = await store.publishDraft('draft.dev-review');
    expect(version1).toMatchObject({ designId: 'design.dev-review', version: 1, sourceDraftId: 'draft.dev-review' });
    expect(version1.definitionHash).toEqual(expect.any(String));
    expect(JSON.stringify(version1.resolvedDefinition)).toContain('Implement with the shared prompt.');

    await store.updateDraft('draft.dev-review', workflowDefinition('dev-review-v2', 'Updated draft prompt'));
    const version2 = await store.publishDraft('draft.dev-review');

    expect(version2.version).toBe(2);
    expect((await store.getDesign('design.dev-review'))?.latestPublishedVersion).toBe(2);
    expect((await store.getVersion('design.dev-review', 1))?.definition).toMatchObject({ name: 'dev-review-v1' });
    expect((await store.getVersion('design.dev-review', 2))?.definition).toMatchObject({ name: 'dev-review-v2' });
    await expect(store.replacePublishedVersionDefinition()).rejects.toThrow(/immutable/i);
  });

  it('TEST_CASE_M91_1A rejects invalid drafts at publish with stable validation issues', async () => {
    const { store } = await createStore();
    await store.createDesign({
      designId: 'design.invalid',
      draftId: 'draft.invalid',
      name: 'Invalid workflow',
      definition: { schemaVersion: 1, name: 'invalid', roles: {}, initialState: 'missing', states: {} },
    });

    await expect(store.publishDraft('draft.invalid')).rejects.toBeInstanceOf(WorkflowDesignValidationError);
    const draft = await store.getDraft('draft.invalid');
    expect(draft?.validationStatus).toBe('invalid');
    expect(draft?.validationIssues.map((issue) => issue.path)).toContain('initialState');
  });

  it('TEST_CASE_M117_1B rejects unknown command providers and commands at publish', async () => {
    const { store } = await createStore();
    await store.createDesign({
      designId: 'design.unknown-command-provider',
      draftId: 'draft.unknown-command-provider',
      name: 'Unknown command provider workflow',
      definition: commandWorkflowDefinition({ provider: 'unknown.command', command: 'workspace_status' }),
    });
    await expect(store.publishDraft('draft.unknown-command-provider')).rejects.toBeInstanceOf(WorkflowDesignValidationError);
    await expect(store.getDraft('draft.unknown-command-provider')).resolves.toMatchObject({
      validationStatus: 'invalid',
      validationIssues: [
        expect.objectContaining({
          code: 'WORKFLOW_CONFIG_INVALID_STEP',
          path: 'states.inspect.steps.0.provider',
          message: 'unknown command provider unknown.command',
        }),
      ],
    });

    await store.createDesign({
      designId: 'design.unknown-command-id',
      draftId: 'draft.unknown-command-id',
      name: 'Unknown command id workflow',
      definition: commandWorkflowDefinition({ provider: 'first_party.command', command: 'shell' }),
    });
    await expect(store.publishDraft('draft.unknown-command-id')).rejects.toBeInstanceOf(WorkflowDesignValidationError);
    await expect(store.getDraft('draft.unknown-command-id')).resolves.toMatchObject({
      validationStatus: 'invalid',
      validationIssues: [
        expect.objectContaining({
          code: 'WORKFLOW_CONFIG_INVALID_STEP',
          path: 'states.inspect.steps.0.command',
          message: 'unsupported first-party command shell',
        }),
      ],
    });
  });

  it('TEST_CASE_M91_1B keeps checked-in templates as catalog entries until Use/Duplicate materializes DB records', async () => {
    const { store } = await createStore({ templates: BUILT_IN_WORKFLOW_TEMPLATES });

    expect(store.listTemplateCatalog().map((entry) => entry.templateId)).toEqual(expect.arrayContaining(['built-in/simple-agent-decision', 'built-in/dev-review-tester', 'built-in/create-form-from-agent']));
    await expect(store.listTemplateCatalogReadModels()).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ templateId: 'built-in/simple-agent-decision', validationStatus: 'valid', unavailableReason: null }),
      expect.objectContaining({ templateId: 'built-in/dev-review-tester', validationStatus: 'valid', unavailableReason: null }),
      expect.objectContaining({ templateId: 'built-in/create-form-from-agent', validationStatus: 'valid', unavailableReason: null }),
    ]));
    await expect(store.listDesigns()).resolves.toEqual([]);
    await expect(store.getPromptAsset('prompt.simple-agent.instructions', 1)).resolves.toBeNull();
    await expect(store.getSkillAsset('skill.workflow.markdown-response', 1)).resolves.toBeNull();

    const used = await store.useTemplate({
      templateId: 'built-in/simple-agent-decision',
      designId: 'design.from-template',
      draftId: 'draft.from-template',
      name: 'My simple workflow',
    });

    expect(used.design).toMatchObject({ designId: 'design.from-template', source: 'user', name: 'My simple workflow' });
    expect(used.draft.validationStatus).toBe('valid');
    expect(await store.getPromptAsset('prompt.simple-agent.instructions', 1)).toMatchObject({ source: 'built_in' });
    expect(await store.getSkillAsset('skill.workflow.markdown-response', 1)).toMatchObject({ source: 'built_in' });
    await expect(store.publishDraft('draft.from-template')).resolves.toMatchObject({ version: 1 });

    const duplicate = await store.duplicateDesign({
      sourceDesignId: 'design.from-template',
      designId: 'design.from-template-copy',
      draftId: 'draft.from-template-copy',
      name: 'My simple workflow copy',
    });
    expect(duplicate.design).toMatchObject({ source: 'user', currentDraftId: 'draft.from-template-copy' });
    expect(JSON.stringify(duplicate.draft.definition)).not.toContain('session');
    expect(await store.listDesigns()).toHaveLength(2);
  });


  it('TEST_CASE_M91_1B marks invalid checked-in templates unavailable and does not leave partial DB records', async () => {
    const invalidTemplate = invalidBuiltInTemplate();
    const { store } = await createStore({ templates: [invalidTemplate] });

    const catalog = await store.listTemplateCatalogReadModels();
    expect(catalog).toMatchObject([
      {
        templateId: 'built-in/invalid-template',
        validationStatus: 'invalid',
        validationIssues: [{ code: 'WORKFLOW_CONFIG_INVALID_ACTIVE_STATE', path: 'states.dev.owner' }],
      },
    ]);
    expect(catalog[0]?.unavailableReason).toContain('WORKFLOW_CONFIG_INVALID_ACTIVE_STATE at states.dev.owner');

    await expect(store.useTemplate({
      templateId: 'built-in/invalid-template',
      designId: 'design.invalid-template',
      draftId: 'draft.invalid-template',
    })).rejects.toBeInstanceOf(WorkflowDesignValidationError);

    await expect(store.getDesign('design.invalid-template')).resolves.toBeNull();
    await expect(store.getDraft('draft.invalid-template')).resolves.toBeNull();
    await expect(store.getPromptAsset('prompt.invalid-template', 1)).resolves.toBeNull();
    await expect(store.getSkillAsset('skill.invalid-template', 1)).resolves.toBeNull();
  });

  it('TEST_CASE_M91_1B materializes template assets and draft atomically when design creation fails', async () => {
    const { store } = await createStore({ templates: BUILT_IN_WORKFLOW_TEMPLATES });
    await seedPromptAssets(store);
    await store.createDesign({
      designId: 'design.conflict',
      draftId: 'draft.conflict-existing',
      name: 'Existing design',
      definition: workflowDefinition('existing-design'),
    });

    await expect(store.useTemplate({
      templateId: 'built-in/simple-agent-decision',
      designId: 'design.conflict',
      draftId: 'draft.conflict-template',
    })).rejects.toThrow();

    await expect(store.getDraft('draft.conflict-template')).resolves.toBeNull();
    await expect(store.getPromptAsset('prompt.simple-agent.instructions', 1)).resolves.toBeNull();
    await expect(store.getSkillAsset('skill.workflow.markdown-response', 1)).resolves.toBeNull();
  });



  it('TEST_CASE_M98_1A and TEST_CASE_M98_2A catalog built-ins materialize as publishable real workflow designs', async () => {
    const { store } = await createStore({ templates: BUILT_IN_WORKFLOW_TEMPLATES });
    const catalog = await store.listTemplateCatalogReadModels();
    expect(catalog).toEqual(expect.arrayContaining([
      expect.objectContaining({ templateId: 'built-in/dev-review-tester', name: 'Dev / Review / Tester', validationStatus: 'valid' }),
      expect.objectContaining({ templateId: 'built-in/create-form-from-agent', name: 'Create form from agent', validationStatus: 'valid' }),
    ]));

    const drt = await store.useTemplate({ templateId: 'built-in/dev-review-tester', designId: 'design.drt', draftId: 'draft.drt' });
    expect(drt.draft.definition).toMatchObject({
      roles: { dev: { label: 'Dev' }, review: { label: 'Review' }, tester: { label: 'Tester' } },
      states: {
        dev: { steps: [{ id: 'implement' }, { id: 'self_review', turnType: 'decision' }] },
        review: { actions: { changes_requested: { targetState: 'dev' } } },
        tester: { actions: { bug_found: { targetState: 'dev' }, not_testable: { targetState: 'dev' }, approved: { targetState: 'done' } } },
      },
    });
    await expect(store.publishDraft('draft.drt')).resolves.toMatchObject({ designId: 'design.drt', version: 1 });

    const form = await store.useTemplate({ templateId: 'built-in/create-form-from-agent', designId: 'design.form', draftId: 'draft.form' });
    expect(form.draft.definition).toMatchObject({
      inputs: { formRequest: { required: true } },
      states: { create_form: { actions: { form_created: { result: { fields: { formSchema: { type: 'markdown' }, artifactRef: { type: 'string' } } } } } } },
    });
    await expect(store.publishDraft('draft.form')).resolves.toMatchObject({ designId: 'design.form', version: 1 });
  });

  it('TEST_CASE_M91_2A resolves prompt and skill refs for published versions and pins run snapshots', async () => {
    const { store } = await createStore();
    await seedPromptAssets(store, { promptBody: 'Prompt asset version one.', skillBody: 'Skill asset version one.' });
    await store.createDesign({
      designId: 'design.snapshot',
      draftId: 'draft.snapshot',
      name: 'Snapshot workflow',
      definition: workflowDefinition('snapshot-workflow'),
    });

    const published = await store.publishDraft('draft.snapshot');
    const publishedPrompt = promptText(published.resolvedDefinition);
    expect(publishedPrompt).toContain('Prompt asset version one.');
    expect(publishedPrompt).toContain('Skill asset version one.');
    expect(publishedPrompt).toContain('Implement with the shared prompt.');
    expect(published.resolvedPromptSnapshot.assets).toMatchObject([
      { kind: 'prompt', id: 'prompt.dev.instructions', version: 1, bodyMarkdown: 'Prompt asset version one.' },
      { kind: 'skill', id: 'skill.testing.notes', version: 1, bodyMarkdown: 'Skill asset version one.' },
    ]);

    await seedPromptAssets(store, {
      promptVersion: 1,
      skillVersion: 1,
      promptBody: 'Prompt asset version one edited after publish.',
      skillBody: 'Skill asset version one edited after publish.',
    });

    const runSnapshot = await store.createRunSnapshot({
      runSnapshotId: 'run-snapshot-1',
      designId: 'design.snapshot',
      workspaceId: 'workspace-a',
      runInput: { featureRequest: 'Build a thing' },
      roleBindings: { dev: { sessionId: 'session-dev' } },
      additionalInstructions: 'Please keep the implementation small.',
    });

    const runPrompt = promptText(runSnapshot.resolvedDefinition);
    expect(runPrompt).toContain('Prompt asset version one.');
    expect(runPrompt).toContain('Additional instructions for this run:\nPlease keep the implementation small.');
    expect(runSnapshot.resolvedPromptSnapshot.assets[0]).toMatchObject({ id: 'prompt.dev.instructions', version: 1, bodyMarkdown: 'Prompt asset version one.' });
    expect(runPrompt).not.toContain('edited after publish');

    await seedPromptAssets(store, { promptVersion: 2, skillVersion: 2, promptBody: 'Prompt asset version two.', skillBody: 'Skill asset version two.' });
    const pinned = await store.getRunSnapshot('run-snapshot-1');
    expect(pinned ? promptText(pinned.resolvedDefinition) : undefined).toContain('Prompt asset version one.');
    expect(pinned ? promptText(pinned.resolvedDefinition) : undefined).not.toContain('Prompt asset version two.');
  });

  it('TEST_CASE_M91_2B duplicates workflow design drafts without copying run/session state', async () => {
    const { store } = await createStore();
    await seedPromptAssets(store);
    await store.createDesign({
      designId: 'design.source',
      draftId: 'draft.source',
      name: 'Source workflow',
      definition: workflowDefinition('source-workflow'),
    });
    await store.publishDraft('draft.source');
    await store.createRunSnapshot({
      runSnapshotId: 'run-snapshot-source',
      designId: 'design.source',
      workspaceId: 'workspace-a',
      runInput: { featureRequest: 'Original run' },
      roleBindings: { dev: { sessionId: 'session-original-dev' }, review: { sessionId: 'session-original-review' } },
      additionalInstructions: 'Run-scoped note',
    });

    const duplicate = await store.duplicateDesign({
      sourceDesignId: 'design.source',
      designId: 'design.copy',
      draftId: 'draft.copy',
      name: 'Copied workflow',
    });

    expect(duplicate.draft.definition).toMatchObject({ roles: { dev: { label: 'Dev' }, review: { label: 'Review' } } });
    const duplicatedJson = JSON.stringify(duplicate.draft.definition);
    expect(duplicatedJson).not.toContain('session-original');
    expect(duplicatedJson).not.toContain('Run-scoped note');
    expect(await store.getRunSnapshot('run-snapshot-source')).toMatchObject({ designId: 'design.source' });
    await expect(store.publishDraft('draft.copy')).resolves.toMatchObject({ designId: 'design.copy', version: 1 });
  });
});

async function createStore(options: { templates?: ConstructorParameters<typeof DbWorkflowDesignStore>[0]['templates'] } = {}) {
  const handle = await initVdDb({ path: ':memory:' });
  handles.push(handle);
  let time = 1_700_000_000_000;
  const store = new DbWorkflowDesignStore({ db: handle.db, now: () => time++, templates: options.templates });
  return { handle, store };
}

async function seedPromptAssets(
  store: DbWorkflowDesignStore,
  options: { promptVersion?: number; skillVersion?: number; promptBody?: string; skillBody?: string } = {},
) {
  await store.createPromptAsset({
    promptAssetId: 'prompt.dev.instructions',
    version: options.promptVersion ?? 1,
    name: 'Dev instructions',
    bodyMarkdown: options.promptBody ?? 'Dev shared prompt body.',
  });
  await store.createSkillAsset({
    skillAssetId: 'skill.testing.notes',
    version: options.skillVersion ?? 1,
    name: 'Testing skill notes',
    bodyMarkdown: options.skillBody ?? 'Testing shared skill body.',
  });
}


function invalidBuiltInTemplate(): WorkflowTemplateCatalogEntry {
  return {
    templateId: 'built-in/invalid-template',
    name: 'Invalid template',
    promptAssets: [
      {
        promptAssetId: 'prompt.invalid-template',
        version: 1,
        name: 'Invalid template prompt',
        bodyMarkdown: 'This asset must not be materialized when the template is invalid.',
      },
    ],
    skillAssets: [
      {
        skillAssetId: 'skill.invalid-template',
        version: 1,
        name: 'Invalid template skill',
        bodyMarkdown: 'This skill must not be materialized when the template is invalid.',
      },
    ],
    definition: {
      ...workflowDefinition('invalid-template'),
      states: {
        ...workflowDefinition('invalid-template').states,
        dev: {
          ...workflowDefinition('invalid-template').states.dev,
          owner: undefined,
          steps: [
            {
              ...workflowDefinition('invalid-template').states.dev.steps[0],
              prompt: { refs: [{ kind: 'prompt', id: 'prompt.invalid-template', version: 1 }], template: 'Invalid template prompt.' },
            },
          ],
        },
      },
    },
  };
}

function workflowDefinition(name: string, extraPrompt = 'Implement with the shared prompt.') {
  return {
    schemaVersion: 1,
    name,
    inputs: {
      featureRequest: { type: 'markdown', required: true },
    },
    roles: {
      dev: { label: 'Dev' },
      review: { label: 'Review' },
    },
    initialState: 'dev',
    states: {
      dev: {
        owner: 'dev',
        steps: [
          {
            id: 'implement',
            type: 'agent_turn',
            turnType: 'decision',
            prompt: {
              refs: [
                { kind: 'prompt', id: 'prompt.dev.instructions', version: 1 },
                { kind: 'skill', id: 'skill.testing.notes', version: 1 },
              ],
              template: extraPrompt,
            },
            response: decisionResponsePolicy(),
          },
        ],
        actions: {
          readyForReview: {
            label: 'Ready for review',
            targetState: 'review',
            result: {
              fields: { summary: { type: 'markdown' } },
              required: ['summary'],
              unknownFields: 'reject',
            },
            handoff: {
              prompt: { template: 'Dev summary: {{transition.parsed.summary}}' },
            },
          },
        },
      },
      review: {
        owner: 'review',
        steps: [
          {
            id: 'review',
            type: 'agent_turn',
            turnType: 'decision',
            prompt: { template: 'Review {{transition.handoffText}}' },
            response: decisionResponsePolicy(),
          },
        ],
        actions: {
          approve: { targetState: 'done' },
        },
      },
      done: { terminal: true },
    },
  };
}

function commandWorkflowDefinition(options: { provider: string; command: string }) {
  return {
    schemaVersion: 1,
    name: 'command-workflow',
    roles: { dev: { label: 'Dev' } },
    initialState: 'inspect',
    states: {
      inspect: {
        owner: 'dev',
        steps: [
          {
            id: 'collect_status',
            type: 'command',
            provider: options.provider,
            command: options.command,
            args: { includeDiffSummary: true },
            policy: {
              access: 'read',
              cwd: { mode: 'workspace_root' },
              timeoutMs: 10_000,
              output: { stdoutMaxChars: 64, stderrMaxChars: 64, combinedMaxChars: 4_096 },
            },
          },
          {
            id: 'decide',
            type: 'agent_turn',
            turnType: 'decision',
            prompt: { template: 'Review command result.' },
            response: decisionResponsePolicy(),
          },
        ],
        actions: { done: { targetState: 'done' } },
      },
      done: { terminal: true },
    },
  };
}

function promptText(definition: { states: Record<string, unknown> }): string {
  const state = definition.states.dev;
  if (!state || typeof state !== 'object' || !('steps' in state) || !Array.isArray(state.steps)) {
    throw new Error('Expected dev state with steps');
  }
  const firstStep = state.steps[0] as { prompt?: { template?: string } };
  return firstStep.prompt?.template ?? '';
}

function decisionResponsePolicy() {
  return {
    format: 'xml',
    schema: { format: 'xsd', source: 'state_actions' },
    invalidXmlRetry: {
      maxAttempts: 1,
      prompt: 'engine_default_with_validation_errors',
      onExhausted: 'blocked',
    },
    storeRawXml: true,
    rawXmlMaxChars: 20000,
    storeParsedFields: true,
    unknownFields: 'reject_unless_allowed_by_result_contract',
  };
}
