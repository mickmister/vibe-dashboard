import type { AgentWorkflowDefinitionV1 } from '@vibe-dashboard/workflow-core';
import type { WorkflowPresentationModel } from '../../../../lib/workflowPresentationApi';
import type { WorkflowDesignEditorModel } from '../client/workflowDesignEditorApi';
import type { WorkflowAssetsModel } from '../client/workflowAssetsApi';
import type { WorkspaceWorkflowsHomeModel } from '../client/workflowsHomeApi';

const decisionResponse = {
  format: 'xml' as const,
  schema: { format: 'xsd' as const, source: 'state_actions' as const },
  invalidXmlRetry: {
    maxAttempts: 1,
    prompt: 'engine_default_with_validation_errors' as const,
    onExhausted: 'blocked' as const,
  },
  storeRawXml: true,
  rawXmlMaxChars: 20000,
  storeParsedFields: true,
  unknownFields: 'reject_unless_allowed_by_result_contract' as const,
};

type PromptWithRefs = { template: string; refs?: Array<{ kind: 'prompt' | 'skill'; id: string; version: number }> };

export const workflowStoryAssets: WorkflowAssetsModel = {
  prompts: [
    { kind: 'prompt', id: 'prompt.drt.dev.implement', version: 1, name: 'Dev implementation prompt', description: 'Implement the requested feature.', source: 'built_in', preview: 'Implement {{inputs.featureRequest}} and note tests.' },
    { kind: 'prompt', id: 'prompt.drt.dev.self-review', version: 1, name: 'Dev self-review prompt', description: 'Required Dev self-review.', source: 'built_in', preview: 'Review without code changes and choose ready_for_review or needs_more_work.' },
    { kind: 'prompt', id: 'prompt.drt.review', version: 1, name: 'Reviewer prompt', description: 'Review implementation and concerns.', source: 'built_in', preview: 'Approve or request changes with markdown remarks.' },
    { kind: 'prompt', id: 'prompt.drt.tester', version: 1, name: 'Tester prompt', description: 'Test the implementation.', source: 'built_in', preview: 'Approve, report a bug, or explain why it is not testable.' },
    { kind: 'prompt', id: 'prompt.ci.wait', version: 1, name: 'CI wait prompt', description: 'Ask the agent to push and report CI.', source: 'user', preview: 'Push the branch and return the CI run id.' },
  ],
  skills: [
    { kind: 'skill', id: 'skill.workflow.xml-decision', version: 1, name: 'Workflow XML decision skill', description: 'Use final XML for workflow actions.', source: 'built_in', preview: 'Return XML matching the current state actions.' },
    { kind: 'skill', id: 'skill.beads-form.schema', version: 1, name: 'Beads-form schema skill', description: 'Markdown form authoring guidance.', source: 'built_in', preview: 'Represent forms as beads-form-compatible schemas.' },
  ],
  roleTemplates: [
    { id: 'role.template.dev', version: 1, name: 'Reusable Dev role', description: 'Shared implementation instructions.', source: 'user', promptPreview: 'Implement carefully and summarize risks.', skillRefs: [{ kind: 'skill', id: 'skill.workflow.xml-decision', version: 1 }], executorPreference: { executorType: 'CODEX', model: 'gpt-5-codex', mode: 'preferred' }, active: true },
  ],
};

export function simpleAgentWorkflowDefinition(): AgentWorkflowDefinitionV1 {
  return {
    schemaVersion: 1,
    name: 'Simple Agent Decision',
    description: 'One decision turn that can finish the workflow.',
    inputs: { featureRequest: { type: 'markdown', required: true, description: 'Task to complete.' } },
    roles: { implementer: { label: 'Implementer' } },
    initialState: 'work',
    states: {
      work: {
        owner: 'implementer',
        steps: [{ id: 'decide', type: 'agent_turn', turnType: 'decision', prompt: { template: 'Handle {{inputs.featureRequest}}.' }, response: decisionResponse }],
        actions: { done: { label: 'Done', targetState: 'done', result: { fields: { summary: { type: 'markdown' } }, required: ['summary'], unknownFields: 'reject' } } },
      },
      done: { terminal: true },
    },
  };
}

export function devReviewTesterWorkflowDefinition(): AgentWorkflowDefinitionV1 {
  return {
    schemaVersion: 1,
    name: 'Dev / Review / Tester',
    description: 'Implement, self-review, review, and test with loops back to Dev.',
    inputs: { featureRequest: { type: 'markdown', required: true, description: 'Feature request or task to implement.' } },
    roles: {
      dev: { label: 'Dev', description: 'Implements changes and performs required self-review.' },
      review: { label: 'Review', description: 'Reviews code and requests changes or approves.' },
      tester: { label: 'Tester', description: 'Tests the approved implementation.' },
    },
    initialState: 'dev',
    states: {
      dev: {
        owner: 'dev',
        steps: [
          { id: 'implement', type: 'agent_turn', turnType: 'non_decision', prompt: withRefs('Implement {{inputs.featureRequest}}.', [{ kind: 'prompt', id: 'prompt.drt.dev.implement', version: 1 }]) },
          { id: 'self_review', type: 'agent_turn', turnType: 'decision', prompt: withRefs('Self-review and choose the next action.', [{ kind: 'prompt', id: 'prompt.drt.dev.self-review', version: 1 }, { kind: 'skill', id: 'skill.workflow.xml-decision', version: 1 }]), response: decisionResponse },
        ],
        actions: {
          ready_for_review: { label: 'Ready for review', targetState: 'review', result: { fields: { summary: { type: 'markdown' }, concerns: { type: 'markdown' } }, required: ['summary'], unknownFields: 'reject' } },
          needs_more_work: { label: 'Needs more work', targetState: 'dev', result: { fields: { concerns: { type: 'markdown' }, fixPlan: { type: 'markdown' } }, required: ['concerns', 'fixPlan'], unknownFields: 'reject' } },
        },
      },
      review: {
        owner: 'review',
        steps: [{ id: 'review', type: 'agent_turn', turnType: 'decision', prompt: withRefs('Review the implementation.', [{ kind: 'prompt', id: 'prompt.drt.review', version: 1 }, { kind: 'skill', id: 'skill.workflow.xml-decision', version: 1 }]), response: decisionResponse }],
        actions: {
          approved: { label: 'Approved', targetState: 'tester', result: { fields: { remarks: { type: 'markdown' } }, unknownFields: 'reject' } },
          changes_requested: { label: 'Request changes', targetState: 'dev', result: { fields: { summary: { type: 'markdown' }, requestedChangesForm: { type: 'markdown', provider: 'beads_form', providerSchema: 'requested_changes_form', description: 'A beads-form XML payload. Each requested change is a choices question; each solution is a choice; choice descriptions include Markdown Pros and Cons sections.' } }, required: ['summary', 'requestedChangesForm'], unknownFields: 'reject' } },
        },
      },
      tester: {
        owner: 'tester',
        steps: [{ id: 'test', type: 'agent_turn', turnType: 'decision', prompt: withRefs('Test the implementation.', [{ kind: 'prompt', id: 'prompt.drt.tester', version: 1 }, { kind: 'skill', id: 'skill.workflow.xml-decision', version: 1 }]), response: decisionResponse }],
        actions: {
          approved: { label: 'Approved', targetState: 'done', result: { fields: { testSummary: { type: 'markdown' } }, required: ['testSummary'], unknownFields: 'reject' } },
          bug_found: { label: 'Bug found', targetState: 'dev', result: { fields: { bugReport: { type: 'markdown' } }, required: ['bugReport'], unknownFields: 'reject' } },
          not_testable: { label: 'Not testable', targetState: 'dev', result: { fields: { advice: { type: 'markdown' } }, required: ['advice'], unknownFields: 'reject' } },
        },
      },
      done: { terminal: true },
    },
  };
}

export function humanFormWorkflowDefinition(): AgentWorkflowDefinitionV1 {
  return {
    schemaVersion: 1,
    name: 'Human approval workflow',
    roles: { dev: { label: 'Dev' } },
    initialState: 'approval',
    states: {
      approval: {
        owner: 'dev',
        steps: [
          { id: 'approval_form', type: 'human_form', title: 'Approve implementation plan', description: 'Review the plan before the agent continues.', form: { providerType: 'beads_form', formSchema: { format: 'standard', title: 'Approve plan', questions: [{ id: 'approved', type: 'boolean', label: 'Approved?', required: true }] }, submitLabel: 'Submit approval' } },
          { id: 'decide_after_approval', type: 'agent_turn', turnType: 'decision', prompt: { template: 'Human approved: {{human.approval_form.approved}}.' }, response: decisionResponse },
        ],
        actions: { done: { label: 'Done', targetState: 'done' } },
      },
      done: { terminal: true },
    },
  };
}

export function workflowCallDefinition(): AgentWorkflowDefinitionV1 {
  return {
    schemaVersion: 1,
    name: 'Parent workflow call',
    inputs: { featureRequest: { type: 'markdown', required: false } },
    roles: { dev: { label: 'Dev' } },
    initialState: 'parent',
    states: {
      parent: {
        owner: 'dev',
        steps: [
          { id: 'call_child', type: 'workflow_call', mode: 'blocking', workflow: { designId: 'design.child-review', version: 2 }, args: { featureRequest: '{{inputs.featureRequest}}' } },
          { id: 'decide_after_child', type: 'agent_turn', turnType: 'decision', prompt: { template: 'Child status: {{child.call_child.childStatus}}.' }, response: decisionResponse },
        ],
        actions: { done: { label: 'Done', targetState: 'done' } },
      },
      done: { terminal: true },
    },
  };
}

export function githubCiWaitWorkflowDefinition(): AgentWorkflowDefinitionV1 {
  return {
    schemaVersion: 1,
    name: 'Wait for GitHub CI',
    description: 'Agent pushes work, returns a CI run id, then workflow waits for CI before review.',
    inputs: { featureRequest: { type: 'markdown', required: true } },
    roles: { dev: { label: 'Dev' }, review: { label: 'Review' } },
    initialState: 'dev',
    states: {
      dev: {
        owner: 'dev',
        steps: [{ id: 'push_and_report_ci', type: 'agent_turn', turnType: 'decision', prompt: withRefs('Push the branch and return CI info.', [{ kind: 'prompt', id: 'prompt.ci.wait', version: 1 }, { kind: 'skill', id: 'skill.workflow.xml-decision', version: 1 }]), response: decisionResponse }],
        actions: {
          wait_for_ci: {
            label: 'Wait for CI',
            targetState: 'review',
            result: { fields: { summary: { type: 'markdown' }, ciRunId: { type: 'string' }, repo: { type: 'string' }, sha: { type: 'string' } }, required: ['summary', 'ciRunId'], unknownFields: 'reject' },
            waitFor: { provider: 'github_ci', runIdField: 'ciRunId', repoField: 'repo', shaField: 'sha' },
          },
        },
      },
      review: { owner: 'review', steps: [{ id: 'review_after_ci', type: 'agent_turn', turnType: 'decision', prompt: { template: 'Review after CI: {{transition.parsed.ciSummary}}.' }, response: decisionResponse }], actions: { approved: { label: 'Approved', targetState: 'done' } } },
      done: { terminal: true },
    },
  } as AgentWorkflowDefinitionV1;
}

export function denseTransitionWorkflowDefinition(): AgentWorkflowDefinitionV1 {
  return {
    schemaVersion: 1,
    name: 'Dense transition visibility',
    description: 'Stress fixture for long transition labels, loops, and parallel review paths.',
    inputs: { featureRequest: { type: 'markdown', required: true } },
    roles: {
      dev: { label: 'Dev' },
      review: { label: 'Review' },
      tester: { label: 'Tester' },
      security: { label: 'Security' },
    },
    initialState: 'dev',
    states: {
      dev: {
        owner: 'dev',
        steps: [
          { id: 'implement', type: 'agent_turn', turnType: 'non_decision', prompt: withRefs('Implement {{inputs.featureRequest}}.', [{ kind: 'prompt', id: 'prompt.drt.dev.implement', version: 1 }]) },
          { id: 'self_review', type: 'agent_turn', turnType: 'decision', prompt: withRefs('Self-review and choose the next action.', [{ kind: 'prompt', id: 'prompt.drt.dev.self-review', version: 1 }]), response: decisionResponse },
        ],
        actions: { ready_for_multi_review: { label: 'Ready for multi-review with CI evidence', targetState: 'review', result: { fields: { summary: { type: 'markdown' }, ciRunId: { type: 'string' } }, required: ['summary'], unknownFields: 'reject' } } },
      },
      review: {
        owner: 'review',
        steps: [{ id: 'review', type: 'agent_turn', turnType: 'decision', prompt: withRefs('Review the implementation.', [{ kind: 'prompt', id: 'prompt.drt.review', version: 1 }]), response: decisionResponse }],
        actions: {
          approved_for_testing: { label: 'Approved for tester validation', targetState: 'tester', result: { fields: { remarks: { type: 'markdown' } }, unknownFields: 'reject' } },
          needs_security_review: { label: 'Needs security review before testing', targetState: 'security', result: { fields: { concerns: { type: 'markdown' } }, unknownFields: 'reject' } },
          changes_requested: { label: 'Request changes from developer', targetState: 'dev', result: { fields: { summary: { type: 'markdown' }, requestedChangesForm: { type: 'markdown', provider: 'beads_form', providerSchema: 'requested_changes_form', description: 'A beads-form XML payload. Each requested change is a choices question; each solution is a choice; choice descriptions include Markdown Pros and Cons sections.' } }, required: ['summary', 'requestedChangesForm'], unknownFields: 'reject' } },
        },
      },
      security: {
        owner: 'security',
        steps: [{ id: 'security_review', type: 'agent_turn', turnType: 'decision', prompt: { template: 'Review security implications.' }, response: decisionResponse }],
        actions: {
          security_ok: { label: 'Security ok; send to tester', targetState: 'tester' },
          security_changes: { label: 'Security changes required', targetState: 'dev' },
        },
      },
      tester: {
        owner: 'tester',
        steps: [{ id: 'test', type: 'agent_turn', turnType: 'decision', prompt: withRefs('Test the implementation.', [{ kind: 'prompt', id: 'prompt.drt.tester', version: 1 }]), response: decisionResponse }],
        actions: {
          approved: { label: 'Tester approved final result', targetState: 'done', result: { fields: { testSummary: { type: 'markdown' } }, unknownFields: 'reject' } },
          bug_found: { label: 'Bug found; return to developer', targetState: 'dev', result: { fields: { bugReport: { type: 'markdown' } }, required: ['bugReport'], unknownFields: 'reject' } },
        },
      },
      done: { terminal: true },
    },
  };
}

export function invalidWorkflowDefinition(): AgentWorkflowDefinitionV1 {
  const definition = simpleAgentWorkflowDefinition();
  definition.name = 'Invalid workflow example';
  const work = definition.states.work;
  if (work && !('terminal' in work) && work.actions.done) {
    work.actions.done.targetState = 'missing_state';
  }
  return definition;
}

export function workflowEditorFixture(definition: AgentWorkflowDefinitionV1, patch: Partial<WorkflowDesignEditorModel> = {}): WorkflowDesignEditorModel {
  return {
    designId: 'design.storybook',
    name: definition.name,
    description: definition.description ?? null,
    draftId: 'draft.storybook',
    version: 1,
    readonly: false,
    definition,
    validationStatus: 'valid',
    validationIssues: [],
    ...patch,
  };
}

export function workflowsHomeFixture(): WorkspaceWorkflowsHomeModel {
  return {
    workspaceId: 'workspace-storybook',
    lanes: {
      parentWorkspaceId: 'workspace-storybook',
      lanes: [
        { laneId: 'lane-story', parentWorkspaceId: 'workspace-storybook', name: 'Story lane', purpose: 'Isolated Storybook workflow work.', label: 'Story lane', breadcrumb: 'workspace-storybook / Story lane', status: 'ready', sourceBranch: 'main', workingBranch: 'workflow/story-lane', worktree: { status: 'clean', display: 'Clean worktree', summary: null }, capacity: { write: { status: 'available', activeLeaseId: null, ownerId: null, reason: null } }, boundRunIds: [], boundBeadIds: [], nextAction: 'Ready for isolated workflow work.', createdAt: 1_000, updatedAt: 1_000, archivedAt: null },
      ],
      counts: { ready: 1 },
      activeWriteLanes: 0,
      nextAction: 'One lane is ready for workflow work.',
    },
    userWorkflows: [
      { id: 'design-drt', title: 'Dev / Review / Tester', description: 'Your published three-agent workflow.', source: 'published_design', status: 'ready', version: 3, unavailableReason: null, canRun: true, inputs: [{ id: 'featureRequest', type: 'markdown', required: true, description: 'Feature request or task to implement.' }], roles: [{ id: 'dev', label: 'Dev', description: null }, { id: 'review', label: 'Review', description: null }, { id: 'tester', label: 'Tester', description: null }], launchSummary: { firstStateId: 'dev', firstActorRoleId: 'dev', firstActorLabel: 'Dev', mayNeedHumanInput: true, mayCallWorkflows: true } },
      { id: 'design-ci-wait', title: 'Wait for GitHub CI', description: 'Push, wait for CI, then review.', source: 'published_design', status: 'ready', version: 1, unavailableReason: null, canRun: true, inputs: [{ id: 'featureRequest', type: 'markdown', required: true, description: null }], roles: [{ id: 'dev', label: 'Dev', description: null }, { id: 'review', label: 'Review', description: null }] },
      { id: 'design-draft', title: 'Planning Draft', description: 'Draft-only workflow.', source: 'published_design', status: 'unavailable', version: null, unavailableReason: 'Publish this workflow before running it.', canRun: false, inputs: [], roles: [] },
    ],
    starterTemplates: [
      { id: 'built-in/dev-review-tester', title: 'Dev / Review / Tester', description: 'Start from the three-role feature workflow.', source: 'template', status: 'ready', version: null, unavailableReason: null, canRun: false, inputs: [], roles: [] },
      { id: 'built-in/create-form-from-agent', title: 'Create form from agent', description: 'Ask an agent to draft a beads-form-compatible form.', source: 'template', status: 'ready', version: null, unavailableReason: null, canRun: false, inputs: [], roles: [] },
    ],
    needsInput: [{ attentionItemId: 'attention-plan', title: 'Approve implementation plan', description: 'Review the generated plan before Dev continues.', workflowName: 'Dev / Review / Tester', createdAt: 1_000, detailUrl: '/dashboard/workflows/run-human' }],
    recentRuns: [
      { runId: 'run-ci', workflowName: 'Wait for GitHub CI', workspaceId: 'workspace-storybook', status: 'running', startedAt: 1_000, updatedAt: 1_500, detailUrl: '/dashboard/workflows/run-ci' },
      { runId: 'run-drt', workflowName: 'Dev / Review / Tester', workspaceId: 'workspace-storybook', status: 'completed', startedAt: 500, updatedAt: 900, detailUrl: '/dashboard/workflows/run-drt' },
    ],
    recentBatches: [{ batchId: 'batch-story', workflowName: 'Dev / Review / Tester', status: 'running', counts: { total: 5, pending: 2, running: 1, completed: 1, blocked: 0, failed: 1, cancelled: 0 }, items: [{ batchItemId: 'batch-story-1', itemIndex: 1, status: 'failed', runId: null, error: { code: 'missing_input', message: 'Line 2 is missing featureRequest.', fieldErrors: { featureRequest: 'This field is required.' } } }], updatedAt: 1_600, detailUrl: '/dashboard/workflow-batches/batch-story' }],
  };
}

export function runningCiPresentationFixture(): WorkflowPresentationModel {
  return {
    instanceId: 'run-ci',
    workflowId: 'design-ci-wait',
    workflowName: 'Wait for GitHub CI',
    status: 'running',
    humanStatus: 'not_needed',
    originalTask: 'Add branch push affordance and wait for checks.',
    startedAt: 1_000,
    updatedAt: 1_500,
    completedAt: null,
    provenance: { label: 'Wait for GitHub CI workflow v1', workflowName: 'Wait for GitHub CI', workflowDesignId: 'design-ci-wait', workflowVersion: 1 },
    summary: { statusLabel: 'In progress', currentOwner: 'Dev', currentState: 'Dev', currentStep: 'Push and report ci', waitingReason: 'Waiting for GitHub CI to finish.', nextAction: 'The workflow resumes when GitHub CI finishes.' },
    attention: null,
    callTree: [],
    outputs: [],
    timeline: [
      { id: 'turn-dev', role: 'Dev', title: 'Push and report CI turn', kind: 'agent_turn', state: 'Dev', step: 'Push and report ci', status: 'Complete', session: { label: 'Dev session', workspaceId: 'workspace-storybook', sessionId: 'session-dev' }, initialMessage: { text: 'Push the branch and return the CI run id.', truncated: false, maxChars: null }, finalResponse: { text: 'Action: Wait for CI\nSummary: Pushed branch and started checks.\nCi run id: 12345', truncated: false, maxChars: null }, responseUnavailable: null, commits: [{ before: 'abc123', after: 'def456', merge: null }] },
      { id: 'ci-turn', role: 'GitHub CI', title: 'Wait for CI', kind: 'github_ci', state: 'Dev', step: 'Push and report ci', status: 'Waiting', session: null, initialMessage: { text: 'Repository: acme/repo\nCommit: def456\nRun: 12345', truncated: false, maxChars: null }, finalResponse: null, responseUnavailable: 'Waiting for GitHub CI to finish.', commits: [] },
    ],
  };
}

export function completedWorkflowPresentationFixture(): WorkflowPresentationModel {
  const model = runningCiPresentationFixture();
  return {
    ...model,
    instanceId: 'run-drt',
    workflowName: 'Dev / Review / Tester',
    status: 'completed',
    humanStatus: 'resolved',
    updatedAt: 2_500,
    completedAt: 2_500,
    summary: { statusLabel: 'Complete', currentOwner: null, currentState: 'Done', currentStep: 'Not started', waitingReason: null, nextAction: 'Workflow is complete.' },
    outputs: [{ id: 'final-summary', label: 'Final summary', value: 'Finished after Tester approval.', kind: 'summary' }],
    timeline: [
      ...model.timeline,
      { id: 'ci-complete', role: 'GitHub CI', title: 'Wait for CI', kind: 'github_ci', state: 'Dev', step: 'Push and report ci', status: 'Passed', session: null, initialMessage: { text: 'Repository: acme/repo\nCommit: def456\nRun: 12345', truncated: false, maxChars: null }, finalResponse: { text: 'All checks passed\nDetails: https://github.example/acme/repo/actions/runs/12345', truncated: false, maxChars: null }, responseUnavailable: null, commits: [] },
      { id: 'review', role: 'Review', title: 'Review turn', kind: 'agent_turn', state: 'Review', step: 'Review', status: 'Complete', session: { label: 'Review session', workspaceId: 'workspace-storybook', sessionId: 'session-review' }, initialMessage: { text: 'Review after CI passed.', truncated: false, maxChars: null }, finalResponse: { text: 'Action: Approved\nRemarks: Looks good.', truncated: false, maxChars: null }, responseUnavailable: null, commits: [] },
    ],
  };
}

export const workflowStoryMatrix = [
  { surface: 'Graph', story: 'Simple agent workflow', status: 'possible today', notes: 'Pure definition-to-graph fixture.' },
  { surface: 'Graph', story: 'Dev / Review / Tester', status: 'possible today', notes: 'Covers loops and three roles.' },
  { surface: 'Graph', story: 'Human form', status: 'possible today', notes: 'Human step is supported and visible.' },
  { surface: 'Graph', story: 'Blocking workflow call', status: 'possible today', notes: 'Blocking call step is executable.' },
  { surface: 'Graph', story: 'GitHub CI wait', status: 'possible today', notes: 'Represented as a wait action edge/action.' },
  { surface: 'Graph', story: 'Dense transition visibility', status: 'possible today', notes: 'Stress fixture for long labels and loops after M113B.' },
  { surface: 'Run presentation', story: 'Waiting on CI', status: 'possible today', notes: 'Uses read-model-shaped fixture.' },
  { surface: 'Run presentation', story: 'Completed run with CI result', status: 'possible today', notes: 'Uses read-model-shaped fixture.' },
  { surface: 'Workflows home', story: 'Workspace overview', status: 'possible today', notes: 'Pure home read-model fixture.' },
  { surface: 'Centralized workflow page', story: 'Concept IA', status: 'concept only', notes: 'M113 decides real route/actions.' },
  { surface: 'Wizard/editor interactions', story: 'Config-changing UI', status: 'needs more work', notes: 'Needs controlled edit harness and action-state fixtures, not API/MSW yet.' },
  { surface: 'Container routes', story: 'Fetch/loading/error stories', status: 'needs more work', notes: 'Would need MSW or Springboard/Hono route test harness later.' },
] as const;

function withRefs(template: string, refs: PromptWithRefs['refs']): PromptWithRefs {
  return { template, refs };
}
