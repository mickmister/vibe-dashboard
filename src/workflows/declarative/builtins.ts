import type { DeclarativeWorkflowDefinition } from './definitions';
import { normalizeDeclarativeWorkflowDefinition } from './definitions';

export const TWO_AGENT_REVIEW_ROUND_DEFINITION = {
  id: 'two-agent-review-round',
  version: 1,
  name: 'Two agent review round',
  description: 'Ask a source agent for one turn, pipe that response to a reviewer for one turn, then stop and notify the overseer.',
  trigger: 'manual',
  inputs: {
    task: { type: 'string', required: true, description: 'Task or question for the source agent.' },
    workspaceId: { type: 'string', required: true, description: 'VK workspace id used to safely reuse or create role sessions.' },
    sourceRole: { type: 'string', required: false, description: 'Team role/name for the source agent when sourceSessionId is not supplied.' },
    reviewRole: { type: 'string', required: false, description: 'Team role/name for the reviewer when reviewSessionId is not supplied.' },
    sourceSessionId: { type: 'string', required: false, description: 'Explicit VK session id for the source agent.' },
    reviewSessionId: { type: 'string', required: false, description: 'Explicit VK session id for the reviewer.' },
    overseerSessionId: { type: 'string', required: false, description: 'VK session to notify when the round completes.' },
    laneId: { type: 'string', required: false, description: 'Optional lane namespace for role/session reuse.' },
  },
  policies: {
    allowAutoCreateSessions: true,
    allowTruncatedSourceDelivery: false,
    blockSameSession: true,
    notifyOnCompletion: true,
    refsOnlyStorage: true,
    stall: {
      staleAfterMinutes: 30,
      autoNudge: true,
      callbackAndCiWaitsStall: true,
    },
  },
  steps: [
    {
      id: 'resolve_sessions',
      type: 'resolve_roles',
      workspaceInput: 'workspaceId',
      laneInput: 'laneId',
      roles: [
        { key: 'source', roleInput: 'sourceRole', sessionInput: 'sourceSessionId', defaultRole: 'implementer' },
        { key: 'review', roleInput: 'reviewRole', sessionInput: 'reviewSessionId', defaultRole: 'reviewer' },
      ],
    },
    {
      id: 'ask_source',
      type: 'queue_prompt',
      target: 'source',
      template: 'Please work on this task and provide a clear final response.\n\nTask:\n{{inputs.task}}',
    },
    {
      id: 'wait_source',
      type: 'wait_for_next_completed_response',
      target: 'source',
      after: 'ask_source',
    },
    {
      id: 'ask_review',
      type: 'pipe_response',
      source: 'wait_source',
      target: 'review',
      template: [
        'Please review the source agent response below.',
        'Identify correctness issues, missing context, risks, and concrete requested changes.',
        '',
        'Task:',
        '{{inputs.task}}',
        '',
        'Source response:',
        '{{source.response}}',
      ].join('\n'),
    },
    {
      id: 'wait_review',
      type: 'wait_for_next_completed_response',
      target: 'review',
      after: 'ask_review',
    },
    {
      id: 'notify_overseer',
      type: 'notify_overseer',
      sessionInput: 'overseerSessionId',
      template: [
        'Two-agent review round complete.',
        '',
        'Task:',
        '{{inputs.task}}',
        '',
        'Source response:',
        '{{responses.wait_source}}',
        '',
        'Review response:',
        '{{responses.wait_review}}',
        '',
        'Workflow instance: {{instance.id}}',
      ].join('\n'),
    },
    {
      id: 'complete',
      type: 'complete',
      summaryTemplate: 'Completed two-agent review round for {{inputs.task}}.',
    },
  ],
  outputs: {
    sourceResponse: '{{responses.wait_source}}',
    reviewResponse: '{{responses.wait_review}}',
    sourceExecutionProcessId: '{{refs.wait_source.executionProcessId}}',
    reviewExecutionProcessId: '{{refs.wait_review.executionProcessId}}',
  },
} as const;

export const BUILT_IN_DECLARATIVE_WORKFLOW_DEFINITIONS: DeclarativeWorkflowDefinition[] = [
  normalizeDeclarativeWorkflowDefinition(TWO_AGENT_REVIEW_ROUND_DEFINITION),
];

export function getBuiltInDeclarativeWorkflowDefinition(id: string): DeclarativeWorkflowDefinition | null {
  return BUILT_IN_DECLARATIVE_WORKFLOW_DEFINITIONS.find((definition) => definition.id === id) ?? null;
}
