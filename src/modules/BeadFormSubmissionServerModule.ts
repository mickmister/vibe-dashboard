/// <reference types="node" />

import { execFile } from 'node:child_process';
import { homedir } from 'node:os';
import { promisify } from 'node:util';

import type { Context } from 'hono';
import { serverRegistry } from 'springboard/server/register';

import type { WorkspaceState } from '../types';

const execFileAsync = promisify(execFile);

type JsonObject = Record<string, unknown>;

export type BeadFormSubmissionPayload = {
  path?: string;
  beadId?: string;
  formId?: string;
  submittedAt?: string;
  values?: JsonObject;
};

export type Bead = {
  id: string;
  title?: string;
  description?: string;
  notes?: string;
  metadata?: JsonObject;
};

type ApiEnvelope<T> = {
  success: boolean;
  data?: T;
  message?: string;
};

export type Workspace = {
  id: string;
  branch: string;
  archived: boolean;
  name?: string | null;
  created_at?: string;
};

export type RepoWithBranch = {
  id: string;
  name: string;
  display_name?: string;
  path?: string;
  target_branch?: string;
};

export type Session = {
  id: string;
  workspace_id: string;
  executor?: string | null;
  updated_at?: string;
  created_at?: string;
};

export type ExecutorConfig = JsonObject;

export type ExecutionProcess = {
  id: string;
  created_at?: string;
  executor_action?: JsonObject | null;
};

export type DraftFollowUpScratch = {
  id: string;
  payload?: {
    type?: string;
    data?: {
      message?: string;
      executor_config?: ExecutorConfig;
    };
  };
};

export type BeadFormSubmissionDeps = {
  readBead: (repoPath: string, beadId: string) => Promise<Bead>;
  vkFetch: <T>(path: string, init?: RequestInit) => Promise<T>;
  getSessionExecutionProcesses: (sessionId: string) => Promise<ExecutionProcess[]>;
  getWorkspaceState: () => WorkspaceState | undefined;
  env?: { BEAD_FORM_REPO_PATH?: string };
};

function expandHome(path: string): string {
  if (path === '~') return homedir();
  if (path.startsWith('~/')) return `${homedir()}${path.slice(1)}`;
  return path;
}

function isObject(value: unknown): value is JsonObject {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function getApiBase(): string {
  if (process.env.VK_API_BASE_URL) return process.env.VK_API_BASE_URL.replace(/\/$/, '');
  const port = process.env.BACKEND_PORT || '3007';
  return `http://localhost:${port}/api`;
}

function getWsBase(): string {
  const apiBase = getApiBase();
  if (apiBase.startsWith('https://')) return apiBase.replace(/^https:\/\//, 'wss://');
  if (apiBase.startsWith('http://')) return apiBase.replace(/^http:\/\//, 'ws://');
  return apiBase;
}

export async function defaultVkFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${getApiBase()}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  });

  const text = await response.text();
  let body: ApiEnvelope<T> | undefined;
  try {
    body = text ? JSON.parse(text) as ApiEnvelope<T> : undefined;
  } catch {
    // Keep the raw body for the error below.
  }

  if (!response.ok || body?.success === false) {
    throw new Error(body?.message || text || `${response.status} ${response.statusText}`);
  }

  return body?.data as T;
}

export async function defaultReadBead(repoPath: string, beadId: string): Promise<Bead> {
  const { stdout } = await execFileAsync('bd', ['show', beadId, '--json', '--long'], {
    cwd: repoPath,
    timeout: 30_000,
    maxBuffer: 1024 * 1024 * 5,
  });
  const output = String(stdout);
  const jsonStart = output.indexOf('[');
  const json = jsonStart >= 0 ? output.slice(jsonStart) : output;
  const beads = JSON.parse(json) as Bead[];
  const bead = beads.find((candidate) => candidate.id === beadId);
  if (!bead) throw new Error(`Bead not found: ${beadId}`);
  return bead;
}

function nestedString(value: unknown, path: string[]): string | undefined {
  let current = value;
  for (const segment of path) {
    if (!isObject(current)) return undefined;
    current = current[segment];
  }
  return typeof current === 'string' && current.trim() ? current.trim() : undefined;
}

export function extractBranch(bead: Bead): string {
  const metadata = bead.metadata;
  const metadataBranch =
    nestedString(metadata, ['branch']) ||
    nestedString(metadata, ['vkBranch']) ||
    nestedString(metadata, ['vibeKanban', 'branch']) ||
    nestedString(metadata, ['beadsWeb', 'branch']);
  if (metadataBranch) return metadataBranch;

  const text = [bead.title, bead.description, bead.notes].filter(Boolean).join('\n');
  const explicit = text.match(/\bbranch\s*[:=]\s*([A-Za-z0-9._/-]+)/i);
  if (explicit?.[1]) return explicit[1];

  const branchLike = text.match(/\b(?:vk|feature|fix|bugfix|hotfix|chore)\/[A-Za-z0-9._/-]+/);
  if (branchLike?.[0]) return branchLike[0];

  throw new Error(`Could not determine branch for bead ${bead.id}`);
}

function repoMatchesVktest(repo: RepoWithBranch): boolean {
  const values = [repo.name, repo.display_name, repo.path].filter(Boolean).map((value) => String(value).toLowerCase());
  return values.some((value) => value === 'vktest' || value.endsWith('/vktest'));
}

async function findWorkspace(branch: string, vkFetch: BeadFormSubmissionDeps['vkFetch']): Promise<Workspace> {
  const workspaces = await vkFetch<Workspace[]>('/workspaces');
  const candidates = workspaces.filter((workspace) => !workspace.archived && workspace.branch === branch);
  const matches: Workspace[] = [];

  for (const workspace of candidates) {
    const repos = await vkFetch<RepoWithBranch[]>(`/workspaces/${workspace.id}/repos`);
    if (repos.some(repoMatchesVktest)) {
      matches.push(workspace);
    }
  }

  if (matches.length === 0) {
    throw new Error(`No active Vktest workspace found for branch ${branch}`);
  }

  return matches.sort((a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')))[0]!;
}

async function getLatestSession(workspaceId: string, vkFetch: BeadFormSubmissionDeps['vkFetch']): Promise<Session> {
  const sessions = await vkFetch<Session[]>(`/sessions?workspace_id=${encodeURIComponent(workspaceId)}`);
  const session = sessions[0];
  if (!session) throw new Error(`No agent conversation found for workspace ${workspaceId}`);
  return session;
}

async function getDraftScratch(sessionId: string, vkFetch: BeadFormSubmissionDeps['vkFetch']): Promise<DraftFollowUpScratch | null> {
  try {
    return await vkFetch<DraftFollowUpScratch>(`/scratch/DRAFT_FOLLOW_UP/${sessionId}`);
  } catch {
    return null;
  }
}

function setJsonPointerValue(target: JsonObject, path: string, value: unknown): void {
  const segments = path
    .split('/')
    .slice(1)
    .map((segment) => segment.replace(/~1/g, '/').replace(/~0/g, '~'));
  if (segments.length === 0) return;

  let current: JsonObject = target;
  for (const segment of segments.slice(0, -1)) {
    if (!isObject(current[segment])) current[segment] = {};
    current = current[segment] as JsonObject;
  }

  const last = segments.at(-1);
  if (last) current[last] = value;
}

export async function defaultGetSessionExecutionProcesses(sessionId: string): Promise<ExecutionProcess[]> {
  const url = `${getWsBase()}/execution-processes/stream/session/ws?session_id=${encodeURIComponent(sessionId)}`;
  const state: { execution_processes: Record<string, ExecutionProcess> } = { execution_processes: {} };

  return new Promise((resolve, reject) => {
    let settled = false;
    let ws: WebSocket | undefined;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (ws && ws.readyState !== WebSocket.CLOSED) ws.close();
      callback();
    };
    const timeout = setTimeout(() => {
      finish(() => reject(new Error(`Timed out loading execution processes for session ${sessionId}`)));
    }, 3_000);
    ws = new WebSocket(url);

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(String(event.data)) as JsonObject;
        if (Array.isArray(message.JsonPatch)) {
          for (const operation of message.JsonPatch) {
            if (!isObject(operation) || typeof operation.path !== 'string') continue;
            if (operation.op === 'add' || operation.op === 'replace') {
              setJsonPointerValue(state as unknown as JsonObject, operation.path, operation.value);
            }
          }
        }
        if (message.Ready === true) {
          finish(() => resolve(Object.values(state.execution_processes)));
        }
      } catch (error) {
        finish(() => reject(error));
      }
    };

    ws.onerror = () => {
      finish(() => reject(new Error(`Failed to load execution processes for session ${sessionId}`)));
    };
  });
}

function executorConfigFromAction(action: unknown): ExecutorConfig | null {
  let current = action;
  while (isObject(current)) {
    const typ = current.typ;
    if (isObject(typ)) {
      const requestType = typ.type;
      if (
        (requestType === 'CodingAgentInitialRequest' ||
          requestType === 'CodingAgentFollowUpRequest' ||
          requestType === 'ReviewRequest') &&
        isObject(typ.executor_config)
      ) {
        return typ.executor_config;
      }
    }
    current = current.next_action;
  }
  return null;
}

async function getLatestConversationExecutorConfig(
  sessionId: string,
  getSessionExecutionProcesses: BeadFormSubmissionDeps['getSessionExecutionProcesses'],
): Promise<ExecutorConfig | null> {
  try {
    const processes = await getSessionExecutionProcesses(sessionId);
    return processes
      .sort((a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')))
      .map((process) => executorConfigFromAction(process.executor_action))
      .find((config): config is ExecutorConfig => config !== null) ?? null;
  } catch {
    return null;
  }
}

async function getExecutorConfig(
  session: Session,
  existingScratch: DraftFollowUpScratch | null,
  deps: Pick<BeadFormSubmissionDeps, 'getSessionExecutionProcesses' | 'vkFetch'>,
): Promise<ExecutorConfig> {
  const scratchConfig = existingScratch?.payload?.data?.executor_config;
  if (scratchConfig) return scratchConfig;

  const latestConversationConfig = await getLatestConversationExecutorConfig(session.id, deps.getSessionExecutionProcesses);
  if (latestConversationConfig) return latestConversationConfig;

  if (!session.executor) {
    throw new Error(`No draft or executor found for session ${session.id}`);
  }

  return deps.vkFetch<ExecutorConfig>(`/agents/preset-options?executor=${encodeURIComponent(session.executor)}`);
}

function appendSubmittedFormMessage(existing: string | undefined, beadId: string, values: JsonObject | undefined): string {
  const valueLines = values && Object.keys(values).length > 0
    ? ['', 'Submitted values:', ...Object.entries(values).map(([key, value]) => `- ${key}: ${JSON.stringify(value)}`)]
    : [];
  const addition = [`Submitted form for bead ${beadId}.`, ...valueLines].join('\n');
  return existing?.trim() ? `${existing.trim()}\n\n${addition}` : addition;
}

async function upsertDraftFollowUp(session: Session, beadId: string, values: JsonObject | undefined, deps: BeadFormSubmissionDeps): Promise<void> {
  const scratch = await getDraftScratch(session.id, deps.vkFetch);
  const executorConfig = await getExecutorConfig(session, scratch, deps);
  const message = appendSubmittedFormMessage(scratch?.payload?.data?.message, beadId, values);

  await deps.vkFetch(`/scratch/DRAFT_FOLLOW_UP/${session.id}`, {
    method: 'PUT',
    body: JSON.stringify({
      payload: {
        type: 'DRAFT_FOLLOW_UP',
        data: {
          message,
          executor_config: executorConfig,
        },
      },
    }),
  });
}

export function findCraftLink(workspaceState: WorkspaceState | undefined, workspaceId: string): string | null {
  if (!workspaceState) return null;

  for (const space of workspaceState.spaces) {
    for (const tabGroupId of space.tabGroupIds) {
      const tabGroup = workspaceState.tabGroups.find((candidate) => candidate.id === tabGroupId);
      if (!tabGroup) continue;
      for (const tab of tabGroup.tabs) {
        const match = tab.url.match(/\/workspaces\/([^/?#]+)/);
        if (match?.[1] === workspaceId) {
          return `/dashboard/spaces/${space.id}/${tabGroup.id}/${tab.id}`;
        }
      }
    }
  }

  return null;
}

function getWorkspaceStateFromEngine(getEngine: () => unknown): WorkspaceState | undefined {
  const engine = getEngine() as {
    moduleRegistry?: {
      getCustomModule?: (moduleId: string) => unknown;
    };
  };
  const module = engine.moduleRegistry?.getCustomModule?.('workspace') as {
    states?: {
      workspace?: {
        getState?: () => WorkspaceState;
      };
    };
  } | undefined;

  return module?.states?.workspace?.getState?.();
}

export function createBeadFormSubmissionHandler(deps: BeadFormSubmissionDeps) {
  return async (c: Context) => {
    try {
      const payload = await c.req.json<BeadFormSubmissionPayload>();
      const beadId = payload.beadId?.trim();
      if (!beadId) return c.text('Missing beadId', 400);

      const requestedPath = payload.path?.startsWith('dolt://') ? undefined : payload.path;
      const repoPath = expandHome(requestedPath || deps.env?.BEAD_FORM_REPO_PATH || '~/repos/Vktest');
      const bead = await deps.readBead(repoPath, beadId);
      const branch = extractBranch(bead);
      const workspace = await findWorkspace(branch, deps.vkFetch);
      const session = await getLatestSession(workspace.id, deps.vkFetch);
      await upsertDraftFollowUp(session, beadId, payload.values, deps);

      const craftLink = findCraftLink(deps.getWorkspaceState(), workspace.id);
      const link = craftLink || `/workspaces/${workspace.id}`;
      const linkText = craftLink ? 'Open the Craft' : 'Open the workspace';

      return c.text([
        `Submitted form for bead \`${beadId}\` and added it to the current follow-up draft.`,
        '',
        `[${linkText}](${link})`,
      ].join('\n'));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return c.text(`Failed to process bead form submission: ${message}`, 500);
    }
  };
}

serverRegistry.registerServerModule(({ hono, getEngine }) => {
  hono.post('/api/bead-form-submissions', createBeadFormSubmissionHandler({
    readBead: defaultReadBead,
    vkFetch: defaultVkFetch,
    getSessionExecutionProcesses: defaultGetSessionExecutionProcesses,
    getWorkspaceState: () => getWorkspaceStateFromEngine(getEngine),
    env: { BEAD_FORM_REPO_PATH: process.env.BEAD_FORM_REPO_PATH },
  }));
});
