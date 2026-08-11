import type { Kysely } from 'kysely';
import type { DB } from '../../../../store/kysely_types';
import type { WorkflowPresentationModel, WorkflowPresentationTimelineItem } from '../../../../server/workflow-presentation-read-model';
import type { NormalizedAgentWorkflowModel, WorkflowRuntimeSnapshot } from '@vibe-dashboard/workflow-core';
import type { PersistedWorkflowRuntimeEvent } from './persistedWorkflowRuntime';

export async function buildPersistedWorkflowPresentationModel(args: { db: Kysely<DB>; runId: string }): Promise<WorkflowPresentationModel | null> {
  const row = await args.db.selectFrom('WorkflowPersistedRun').selectAll().where('runId', '=', args.runId).executeTakeFirst();
  if (!row) return null;
  const model = JSON.parse(row.coreModelJson) as NormalizedAgentWorkflowModel;
  const snapshot = JSON.parse(row.coreSnapshotJson) as WorkflowRuntimeSnapshot;
  const events = JSON.parse(row.eventsJson) as PersistedWorkflowRuntimeEvent[];
  const queued = JSON.parse(row.queuedTurnsJson) as Record<string, { role: string; sessionId: string }>;
  const timeline: WorkflowPresentationTimelineItem[] = [];
  for (const entry of snapshot.history) {
    if (entry.kind === 'agent_turn_planned') {
      const complete = snapshot.history.find((candidate) => candidate.kind === 'agent_turn_completed' && candidate.turnId === entry.turnId) as { responseRef: string } | undefined;
      const roleId = queued[entry.turnId]?.role ?? roleForState(model, entry.state);
      const queueEvent = events.find((event) => event.kind === 'agent_turn_queued' && event.data.turnId === entry.turnId);
      const promptPreview = typeof queueEvent?.data.promptPreview === 'string' ? queueEvent.data.promptPreview : null;
      timeline.push({
        id: entry.turnId,
        role: roleLabel(model, roleId),
        title: `${labelFromId(entry.stepId)} turn`,
        status: complete ? 'Complete' : 'Waiting',
        session: queued[entry.turnId]?.sessionId ? { label: `${roleLabel(model, roleId)} session`, workspaceId: row.workspaceId, sessionId: queued[entry.turnId]!.sessionId } : null,
        initialMessage: promptPreview ? { text: promptPreview, truncated: queueEvent?.data.promptTruncated === true, maxChars: 4096 } : null,
        finalResponse: complete ? responseTextFor(snapshot, complete.responseRef) : null,
        responseUnavailable: complete ? null : 'This turn is still waiting for a response.',
        commits: [],
      });
    } else if (entry.kind === 'human_form_planned') {
      const complete = snapshot.history.find((candidate) => candidate.kind === 'human_form_completed' && candidate.turnId === entry.turnId) as { submission: Record<string, unknown> } | undefined;
      timeline.push({
        id: entry.turnId,
        role: 'User',
        title: entry.title,
        status: complete ? 'Answered' : 'Waiting for you',
        session: null,
        initialMessage: { text: entry.title, truncated: false, maxChars: null },
        finalResponse: complete ? { text: Object.entries(complete.submission).map(([key, value]) => `${key}: ${String(value)}`).join('\n'), truncated: false, maxChars: null } : null,
        responseUnavailable: complete ? null : 'Waiting for your answer.',
        commits: [],
      });
    }
  }
  const formArtifactEvents = events.filter((event) => event.kind === 'form_artifact_created' || event.kind === 'form_artifact_failed');
  for (const artifact of formArtifactEvents) {
    timeline.push({
      id: `artifact-${String(artifact.at)}`,
      role: 'Workflow',
      title: artifact.kind === 'form_artifact_created' ? 'Form artifact' : 'Form artifact problem',
      status: artifact.kind === 'form_artifact_created' ? 'Complete' : 'Needs attention',
      session: null,
      initialMessage: null,
      finalResponse: { text: artifact.kind === 'form_artifact_created' ? `Form artifact: ${String(artifact.data.artifactRef)}` : `Invalid form schema: ${String(artifact.data.error)}`, truncated: false, maxChars: null },
      responseUnavailable: null,
      commits: [],
    });
  }
  return {
    instanceId: row.runId,
    workflowId: row.designId,
    workflowName: model.name,
    status: row.status === 'blocked' ? 'failed' : row.status,
    humanStatus: timeline.some((item) => item.status === 'Waiting for you') ? 'waiting_for_user' : timeline.some((item) => item.status === 'Answered') ? 'resolved' : 'not_needed',
    originalTask: originalTask(snapshot.inputs),
    startedAt: row.createdAt,
    updatedAt: row.updatedAt,
    completedAt: row.status === 'completed' ? row.updatedAt : null,
    timeline,
    attention: null,
  };
}

function responseTextFor(snapshot: WorkflowRuntimeSnapshot, responseRef: string) {
  const transition = snapshot.history.find((entry) => entry.kind === 'state_transitioned' && entry.transition.responseRef === responseRef) as { transition: { rawXml?: string; parsed?: Record<string, unknown> } } | undefined;
  if (transition?.transition.rawXml) return { text: transition.transition.rawXml, truncated: false, maxChars: null };
  if (transition?.transition.parsed) return { text: JSON.stringify(transition.transition.parsed, null, 2), truncated: false, maxChars: null };
  return { text: `Response recorded: ${responseRef}`, truncated: false, maxChars: null };
}

function roleForState(model: NormalizedAgentWorkflowModel, stateId: string): string {
  const state = model.states[stateId];
  return state && !state.terminal ? state.owner : 'workflow';
}

function roleLabel(model: NormalizedAgentWorkflowModel, roleId: string): string {
  return model.roles[roleId]?.label ?? labelFromId(roleId);
}

function labelFromId(id: string): string {
  return id.replace(/[_-]+/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

function originalTask(inputs: Record<string, unknown>): string | null {
  for (const key of ['featureRequest', 'formRequest', 'task']) {
    if (typeof inputs[key] === 'string' && inputs[key].trim()) return inputs[key];
  }
  return null;
}
