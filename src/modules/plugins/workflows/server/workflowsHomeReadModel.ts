import type { Kysely } from 'kysely';
import type { DB } from '../../../../store/kysely_types';
import type { DbWorkflowOrchestrationStore, WorkflowAttentionItemReadModel } from '../../../../server/workflow-orchestration-store';
import { DbWorkflowDesignStore } from './workflowDesignStore';

export interface WorkspaceWorkflowsHomeModel {
  workspaceId: string;
  availableWorkflows: WorkspaceWorkflowSummary[];
  recentRuns: WorkspaceWorkflowRunSummary[];
  needsInput: WorkspaceWorkflowAttentionSummary[];
}

export interface WorkspaceWorkflowSummary {
  id: string;
  title: string;
  description: string | null;
  source: 'published_design' | 'template';
  status: 'ready' | 'unavailable';
  version: number | null;
  unavailableReason: string | null;
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
  const designStore = args.designStore ?? new DbWorkflowDesignStore({ db: args.db });
  const [availableWorkflows, recentRuns, needsInput] = await Promise.all([
    listAvailableWorkflows(designStore),
    listRecentRuns(args.db, args.workspaceId, args.recentRunLimit ?? 10),
    listNeedsInput(args.orchestrationStore, args.workspaceId),
  ]);
  return { workspaceId: args.workspaceId, availableWorkflows, recentRuns, needsInput };
}

async function listAvailableWorkflows(designStore: DbWorkflowDesignStore): Promise<WorkspaceWorkflowSummary[]> {
  const [designs, templates] = await Promise.all([
    designStore.listDesigns(),
    designStore.listTemplateCatalogReadModels(),
  ]);
  return [
    ...designs.map((design): WorkspaceWorkflowSummary => ({
      id: design.designId,
      title: design.name,
      description: design.description,
      source: 'published_design',
      status: design.latestPublishedVersion == null ? 'unavailable' : 'ready',
      version: design.latestPublishedVersion,
      unavailableReason: design.latestPublishedVersion == null ? 'Publish this workflow before running it.' : null,
    })),
    ...templates.map((template): WorkspaceWorkflowSummary => ({
      id: template.templateId,
      title: template.name,
      description: template.description ?? null,
      source: 'template',
      status: template.validationStatus === 'valid' ? 'ready' : 'unavailable',
      version: null,
      unavailableReason: template.unavailableReason,
    })),
  ].sort((left, right) => left.title.localeCompare(right.title));
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
      detailUrl: null,
    };
  });
}

async function listNeedsInput(
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
        workflowName: item.workflowId,
        createdAt: item.createdAt,
        detailUrl: item.presentationUrl,
      });
    }
  }
  return scoped.sort((left, right) => right.createdAt - left.createdAt);
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
