import type { Kysely } from 'kysely';
import type { DB } from '../../../../store/kysely_types';
import type { DbWorkflowOrchestrationStore, WorkflowAttentionItemReadModel } from '../../../../server/workflow-orchestration-store';
import { DbWorkflowDesignStore } from './workflowDesignStore';
import { BUILT_IN_WORKFLOW_TEMPLATES } from '../templates/builtInWorkflowTemplates';
import { WorkflowBatchSchedulerService, type WorkflowBatchReadModel } from './workflowBatchScheduler';

export interface WorkspaceWorkflowsHomeModel {
  workspaceId: string;
  userWorkflows: WorkspaceWorkflowSummary[];
  starterTemplates: WorkspaceWorkflowSummary[];
  recentRuns: WorkspaceWorkflowRunSummary[];
  needsInput: WorkspaceWorkflowAttentionSummary[];
  recentBatches: WorkspaceWorkflowBatchSummary[];
}

export interface WorkspaceWorkflowBatchSummary {
  batchId: string;
  workflowName: string;
  status: string;
  counts: WorkflowBatchReadModel['counts'];
  items: WorkspaceWorkflowBatchItemSummary[];
  updatedAt: number;
  detailUrl: string | null;
}

export interface WorkspaceWorkflowBatchItemSummary {
  batchItemId: string;
  itemIndex: number;
  status: string;
  runId: string | null;
  error: { code: string; message: string; fieldErrors?: Record<string, string> } | null;
}

export interface WorkspaceWorkflowSummary {
  id: string;
  title: string;
  description: string | null;
  source: 'published_design' | 'template';
  status: 'ready' | 'unavailable';
  version: number | null;
  unavailableReason: string | null;
  canRun: boolean;
  inputs: WorkspaceWorkflowInputSummary[];
  roles: WorkspaceWorkflowRoleSummary[];
  launchSummary?: WorkspaceWorkflowLaunchSummary;
}

export interface WorkspaceWorkflowLaunchSummary {
  firstStateId: string | null;
  firstActorRoleId: string | null;
  firstActorLabel: string | null;
  mayNeedHumanInput: boolean;
  mayCallWorkflows: boolean;
}

export interface WorkspaceWorkflowInputSummary {
  id: string;
  type: string;
  required: boolean;
  description: string | null;
}

export interface WorkspaceWorkflowRoleSummary {
  id: string;
  label: string;
  description: string | null;
  executorPreference?: {
    executorType: string | null;
    model: string | null;
    mode: 'preferred';
  } | null;
}

export interface WorkspaceWorkflowRunSummary {
  runId: string;
  workflowName: string;
  status: string;
  startedAt: number;
  updatedAt: number;
  detailUrl: string | null;
}

export interface WorkspaceWorkflowAttentionSummary {
  attentionItemId: string;
  title: string;
  description: string | null;
  workflowName: string;
  createdAt: number;
  detailUrl: string | null;
}

export async function buildWorkspaceWorkflowsHomeModel(args: {
  db: Kysely<DB>;
  designStore?: DbWorkflowDesignStore;
  orchestrationStore?: DbWorkflowOrchestrationStore;
  workspaceId: string;
  recentRunLimit?: number;
}): Promise<WorkspaceWorkflowsHomeModel> {
  const designStore = args.designStore ?? new DbWorkflowDesignStore({ db: args.db, templates: BUILT_IN_WORKFLOW_TEMPLATES });
  const [userWorkflows, starterTemplates, recentRuns, needsInput, recentBatches] = await Promise.all([
    listUserWorkflows(designStore),
    listStarterTemplates(designStore),
    listRecentRuns(args.db, args.workspaceId, args.recentRunLimit ?? 10),
    listNeedsInput(args.db, args.orchestrationStore, args.workspaceId),
    listRecentBatches(args.db, designStore, args.workspaceId),
  ]);
  return { workspaceId: args.workspaceId, userWorkflows, starterTemplates, recentRuns, needsInput, recentBatches };
}

async function listUserWorkflows(designStore: DbWorkflowDesignStore): Promise<WorkspaceWorkflowSummary[]> {
  const designs = await designStore.listDesigns();
  const summaries = await Promise.all(designs.map(async (design): Promise<WorkspaceWorkflowSummary> => {
    const version = design.latestPublishedVersion;
    const published = version == null ? null : await designStore.getVersion(design.designId, version);
    return {
      id: design.designId,
      title: design.name,
      description: design.description,
      source: 'published_design',
      status: published ? 'ready' : 'unavailable',
      version: published?.version ?? version ?? null,
      unavailableReason: published ? null : 'Publish this workflow before running it.',
      canRun: Boolean(published),
      inputs: published ? summarizeInputs(published.resolvedDefinition) : [],
      roles: published ? summarizeRoles(published.resolvedDefinition) : [],
      launchSummary: published ? summarizeLaunchSummary(published.resolvedDefinition) : emptyLaunchSummary(),
    };
  }));
  return summaries.sort((left, right) => left.title.localeCompare(right.title));
}

async function listStarterTemplates(designStore: DbWorkflowDesignStore): Promise<WorkspaceWorkflowSummary[]> {
  const templates = await designStore.listTemplateCatalogReadModels();
  return templates.map((template): WorkspaceWorkflowSummary => ({
    id: template.templateId,
    title: template.name,
    description: template.description ?? null,
    source: 'template',
    status: template.validationStatus === 'valid' ? 'ready' : 'unavailable',
    version: null,
    unavailableReason: template.unavailableReason,
    canRun: false,
    inputs: [],
    roles: [],
    launchSummary: emptyLaunchSummary(),
  })).sort((left, right) => left.title.localeCompare(right.title));
}

function summarizeLaunchSummary(definition: unknown): WorkspaceWorkflowLaunchSummary {
  const record = isRecord(definition) ? definition : {};
  const states = isRecord(record.states) ? record.states : {};
  const roles = isRecord(record.roles) ? record.roles : {};
  const firstStateId = typeof record.initialState === 'string' ? record.initialState : null;
  const firstState = firstStateId && isRecord(states[firstStateId]) ? states[firstStateId] : null;
  const firstActorRoleId = firstState && typeof firstState.owner === 'string' ? firstState.owner : null;
  const firstRole = firstActorRoleId && isRecord(roles[firstActorRoleId]) ? roles[firstActorRoleId] : null;
  return {
    firstStateId,
    firstActorRoleId,
    firstActorLabel: firstRole && typeof firstRole.label === 'string' ? firstRole.label : firstActorRoleId,
    mayNeedHumanInput: Object.values(states).some((state) => hasStepType(state, 'human_form')),
    mayCallWorkflows: Object.values(states).some((state) => hasStepType(state, 'workflow_call')),
  };
}

function hasStepType(state: unknown, type: string): boolean {
  if (!isRecord(state) || !Array.isArray(state.steps)) return false;
  return state.steps.some((step) => isRecord(step) && step.type === type);
}

function emptyLaunchSummary(): WorkspaceWorkflowLaunchSummary {
  return { firstStateId: null, firstActorRoleId: null, firstActorLabel: null, mayNeedHumanInput: false, mayCallWorkflows: false };
}

function summarizeInputs(definition: unknown): WorkspaceWorkflowInputSummary[] {
  const inputs = isRecord(definition) && isRecord(definition.inputs) ? definition.inputs : {};
  return Object.entries(inputs).map(([id, spec]) => {
    const record = isRecord(spec) ? spec : {};
    return {
      id,
      type: typeof record.type === 'string' ? record.type : 'string',
      required: record.required === true,
      description: typeof record.description === 'string' ? record.description : null,
    };
  });
}

function summarizeRoles(definition: unknown): WorkspaceWorkflowRoleSummary[] {
  const roles = isRecord(definition) && isRecord(definition.roles) ? definition.roles : {};
  return Object.entries(roles).map(([id, spec]) => {
    const record = isRecord(spec) ? spec : {};
    const executorPreference = summarizeRoleExecutorPreference(record.executorPreference);
    return {
      id,
      label: typeof record.label === 'string' ? record.label : id,
      description: typeof record.description === 'string' ? record.description : null,
      executorPreference,
    };
  });
}

function summarizeRoleExecutorPreference(value: unknown): WorkspaceWorkflowRoleSummary['executorPreference'] {
  if (!isRecord(value)) return null;
  return {
    executorType: typeof value.executorType === 'string' && value.executorType.trim() ? value.executorType.trim() : null,
    model: typeof value.model === 'string' && value.model.trim() ? value.model.trim() : null,
    mode: 'preferred',
  };
}


async function listRecentBatches(db: Kysely<DB>, designStore: DbWorkflowDesignStore, workspaceId: string): Promise<WorkspaceWorkflowBatchSummary[]> {
  const scheduler = new WorkflowBatchSchedulerService({
    db,
    designStore,
    runtime: { async launch() { throw new Error('batch read model cannot launch runs'); } },
  });
  const batches = await scheduler.listBatches(workspaceId, 5);
  return Promise.all(batches.map(async (batch) => {
    const design = await designStore.getDesign(batch.designId);
    return {
      batchId: batch.batchId,
      workflowName: design?.name ?? 'Workflow batch',
      status: batch.status,
      counts: batch.counts,
      items: batch.items.map((item) => ({
        batchItemId: item.batchItemId,
        itemIndex: item.itemIndex,
        status: item.status,
        runId: item.runId,
        error: item.error,
      })),
      updatedAt: batch.updatedAt,
      detailUrl: `/dashboard/workflow-batches/${batch.batchId}`,
    };
  }));
}

async function listRecentRuns(db: Kysely<DB>, workspaceId: string, limit: number): Promise<WorkspaceWorkflowRunSummary[]> {
  const rows = await db.selectFrom('WorkflowPersistedRun')
    .select(['runId', 'coreModelJson', 'status', 'createdAt', 'updatedAt'])
    .where('workspaceId', '=', workspaceId)
    .orderBy('updatedAt', 'desc')
    .limit(limit)
    .execute();
  return rows.map((row) => {
    const model = parseRecord(row.coreModelJson);
    return {
      runId: row.runId,
      workflowName: typeof model.name === 'string' ? model.name : 'Workflow run',
      status: row.status,
      startedAt: row.createdAt,
      updatedAt: row.updatedAt,
      detailUrl: `/dashboard/workflows/${row.runId}`,
    };
  });
}

async function listNeedsInput(
  db: Kysely<DB>,
  orchestrationStore: DbWorkflowOrchestrationStore | undefined,
  workspaceId: string,
): Promise<WorkspaceWorkflowAttentionSummary[]> {
  if (!orchestrationStore) return [];
  const result = await orchestrationStore.listAttentionItems({ status: 'active', limit: 50 });
  const scoped: WorkspaceWorkflowAttentionSummary[] = [];
  for (const item of result.items) {
    if (await attentionBelongsToWorkspace(orchestrationStore, item, workspaceId)) {
      scoped.push({
        attentionItemId: item.attentionItemId,
        title: item.title,
        description: item.description,
        workflowName: await attentionWorkflowName(db, item),
        createdAt: item.createdAt,
        detailUrl: item.presentationUrl,
      });
    }
  }
  return scoped.sort((left, right) => right.createdAt - left.createdAt);
}

async function attentionWorkflowName(
  db: Kysely<DB>,
  item: WorkflowAttentionItemReadModel,
): Promise<string> {
  const run = await db.selectFrom('WorkflowPersistedRun')
    .select(['coreModelJson'])
    .where('runId', '=', item.instanceId)
    .executeTakeFirst();
  if (run) {
    const model = parseRecord(run.coreModelJson);
    if (typeof model.name === 'string' && model.name.trim()) return model.name;
  }
  return item.workflowId;
}

async function attentionBelongsToWorkspace(
  orchestrationStore: DbWorkflowOrchestrationStore,
  item: WorkflowAttentionItemReadModel,
  workspaceId: string,
): Promise<boolean> {
  const instance = await orchestrationStore.getInstance(item.instanceId);
  const input = isRecord(instance?.input) ? instance.input : {};
  const state = isRecord(instance?.state) ? instance.state : {};
  return input.workspaceId === workspaceId || state.workspaceId === workspaceId;
}

function parseRecord(json: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(json) as unknown;
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
