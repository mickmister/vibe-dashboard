export type VardashValueKind = 'secret' | 'plain';

export interface VardashEnvKeyMetadata {
  id: string;
  repoId: string;
  key: string;
  kind: VardashValueKind;
  required: boolean;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

type VardashSavedValueBase = {
  id: string;
  repoId: string;
  envKeyId: string;
  name: string;
  hasValue: boolean;
  createdAt: string;
  updatedAt: string;
};

export type VardashSavedValueMetadata =
  | (VardashSavedValueBase & { kind: 'secret'; value?: never })
  | (VardashSavedValueBase & { kind: 'plain'; value?: string });

export type VardashProcessDefinitionSource = 'manual' | 'legacy_dev_server_script';

export interface VardashProcessDefinitionMetadata {
  id: string;
  repoId: string;
  name: string;
  command: string;
  cwd: string | null;
  source: VardashProcessDefinitionSource;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface VardashWorkspaceProcessDefinition extends VardashProcessDefinitionMetadata {
  workspaceId: string;
}

export interface VardashSelectionMetadata {
  savedValueId: string;
  savedValueName: string;
  kind: VardashValueKind;
}

export type VardashWorkspaceSelectionMetadata =
  | { mode: 'inherit' }
  | ({ mode: 'selected' } & VardashSelectionMetadata);

export interface VardashRepoEnvOverviewRow {
  key: VardashEnvKeyMetadata;
  savedValueCount: number;
  savedValues: VardashSavedValueMetadata[];
  repoDefaultSelection: VardashSelectionMetadata | null;
  workspaceSelection: VardashWorkspaceSelectionMetadata;
}

export interface VardashRepoEnvOverviewResponse {
  repoId: string;
  workspaceId: string | null;
  rows: VardashRepoEnvOverviewRow[];
  descriptionGuidance: string;
}

export interface VardashEnvKeysResponse {
  keys: VardashEnvKeyMetadata[];
  descriptionGuidance: string;
}

export interface UpsertVardashEnvKeyInput {
  key: string;
  kind: VardashValueKind;
  required?: boolean;
  description?: string | null;
}

export interface VardashEnvKeyResponse {
  key: VardashEnvKeyMetadata;
  descriptionGuidance: string;
}

export interface UpsertVardashSavedValueInput {
  name: string;
  value: string;
}

export interface VardashSavedValuesResponse {
  values: VardashSavedValueMetadata[];
}

export interface VardashSavedValueResponse {
  savedValue: VardashSavedValueMetadata;
}

export interface SetVardashSelectionInput {
  envKeyId: string;
  savedValueId: string | null;
}

export interface VardashSelectionResponse {
  ok: true;
  selectionSemantics?: 'workspace-null-inherits-repo-default';
}

export interface UpsertVardashProcessDefinitionInput {
  name: string;
  command: string;
  cwd?: string | null;
  isDefault?: boolean;
}

export interface VardashProcessDefinitionsResponse {
  processes: VardashProcessDefinitionMetadata[];
}

export interface VardashWorkspaceProcessDefinitionsResponse {
  processes: VardashWorkspaceProcessDefinition[];
}

export interface VardashProcessDefinitionResponse {
  process: VardashProcessDefinitionMetadata;
}

export type VardashImportSource = 'pasted-env' | 'sample-template';

export type VardashImportConflictReason =
  | 'duplicate_key_in_import'
  | 'saved_value_name_exists'
  | 'secret_to_plain_with_existing_values';

export interface VardashImportConflict {
  key: string;
  reason: VardashImportConflictReason;
  savedValueName?: string;
}

export interface VardashImportDiagnostic {
  line: number;
  message: string;
}

export interface VardashImportKeyPreview {
  key: string;
  kind: VardashValueKind;
  required: true;
  willCreateSavedValue: boolean;
}

export interface ImportVardashEnvInput {
  content: string;
  source: VardashImportSource;
  dryRun: boolean;
  plainKeys?: string[];
  savedValueName?: string;
}

interface VardashImportBaseResponse {
  dryRun: true;
  diagnostics: VardashImportDiagnostic[];
  conflicts: VardashImportConflict[];
}

export interface VardashImportPreviewResponse extends VardashImportBaseResponse {
  keys: VardashImportKeyPreview[];
  savedValues?: never;
}

export interface VardashImportApplyResponse extends VardashImportBaseResponse {
  keys: VardashEnvKeyMetadata[];
  savedValues: VardashSavedValueMetadata[];
}

export type VardashImportResponse = VardashImportPreviewResponse | VardashImportApplyResponse;

export type VardashLaunchStatus = 'starting' | 'running' | 'stopping' | 'stopped' | 'failed';

export interface VardashLaunchReadinessProcessMetadata {
  id: string;
  repoId: string;
  name: string;
  source: VardashProcessDefinitionSource;
  isDefault: boolean;
}

export interface VardashLaunchReadinessSelectedValue {
  key: string;
  kind: VardashValueKind;
  savedValueId: string | null;
  savedValueName: string | null;
}

export interface VardashLaunchReadinessResponse {
  eligible: boolean;
  workspaceId: string;
  repoId: string;
  process: VardashLaunchReadinessProcessMetadata | null;
  missingRequired: Array<Pick<VardashEnvKeyMetadata, 'id' | 'key' | 'kind' | 'required' | 'description'>>;
  selectedValues: VardashLaunchReadinessSelectedValue[];
  varlock: {
    enabled: boolean;
    configured: boolean;
    available: boolean | null;
    reason?: string;
  };
  launch: {
    repoRootResolved: boolean;
    reason?: 'repo_root_unresolved';
  };
  selectionSemantics: 'workspace-null-inherits-repo-default';
  normalAgentEnvIncludesVardashSecrets: false;
}

export interface GetVardashLaunchReadinessInput {
  workspaceId: string;
  repoId: string;
  processDefinitionId?: string;
  processName?: string;
  useVarlock?: boolean;
}

export interface LaunchVardashRepoProcessInput extends GetVardashLaunchReadinessInput {}

export interface VardashLaunchStartedResponse {
  runId: string;
  status: Extract<VardashLaunchStatus, 'starting' | 'running'>;
}

export interface VardashLaunchStatusResponse {
  runId: string;
  status: VardashLaunchStatus;
  startedAt: string | null;
  stoppedAt: string | null;
  exitCode: number | null;
  error?: string;
}

export interface VardashLaunchStopResponse {
  runId: string;
  status: Extract<VardashLaunchStatus, 'stopping' | 'stopped'>;
}

export type VardashApiFetch = (input: string, init?: RequestInit) => Promise<Response>;

export interface VardashClientOptions {
  baseUrl?: string;
  fetch?: VardashApiFetch;
}

export class VardashApiError extends Error {
  readonly status: number;
  readonly errorCode?: string;

  constructor(args: { path: string; status: number; statusText: string; body: unknown }) {
    super(`Vardash API ${args.path} failed: HTTP ${args.status} ${args.statusText}`);
    this.name = 'VardashApiError';
    this.status = args.status;
    this.errorCode = readErrorCode(args.body);
  }
}

export class VardashClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: VardashApiFetch;

  constructor(options: VardashClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? '/dashboard/api/vardash').replace(/\/+$/, '');
    this.fetchImpl = options.fetch ?? fetch;
  }

  listRepoEnvOverview(workspaceId: string, repoId: string): Promise<VardashRepoEnvOverviewResponse> {
    return this.get(`${workspaceRepoApiPath(workspaceId, repoId)}/env-overview`);
  }

  listRepoEnvKeys(workspaceId: string, repoId: string): Promise<VardashEnvKeysResponse> {
    return this.get(`${workspaceRepoApiPath(workspaceId, repoId)}/env-keys`);
  }

  upsertRepoEnvKey(workspaceId: string, repoId: string, input: UpsertVardashEnvKeyInput): Promise<VardashEnvKeyResponse> {
    return this.post(`${workspaceRepoApiPath(workspaceId, repoId)}/env-keys`, input);
  }

  listSavedValues(workspaceId: string, repoId: string, envKeyId: string): Promise<VardashSavedValuesResponse> {
    return this.get(`${workspaceRepoApiPath(workspaceId, repoId)}/env-keys/${encodeURIComponent(envKeyId)}/saved-values`);
  }

  createSavedValue(
    workspaceId: string,
    repoId: string,
    envKeyId: string,
    input: UpsertVardashSavedValueInput,
  ): Promise<VardashSavedValueResponse> {
    return this.post(`${workspaceRepoApiPath(workspaceId, repoId)}/env-keys/${encodeURIComponent(envKeyId)}/saved-values`, input);
  }

  replaceSavedValue(
    workspaceId: string,
    repoId: string,
    envKeyId: string,
    savedValueId: string,
    input: UpsertVardashSavedValueInput,
  ): Promise<VardashSavedValueResponse> {
    return this.put(
      `${workspaceRepoApiPath(workspaceId, repoId)}/env-keys/${encodeURIComponent(envKeyId)}/saved-values/${encodeURIComponent(savedValueId)}`,
      input,
    );
  }

  setRepoDefaultSelection(workspaceId: string, repoId: string, input: SetVardashSelectionInput): Promise<VardashSelectionResponse> {
    return this.post(`${workspaceRepoApiPath(workspaceId, repoId)}/default-selections`, input);
  }

  setWorkspaceRepoSelection(
    workspaceId: string,
    repoId: string,
    input: SetVardashSelectionInput,
  ): Promise<VardashSelectionResponse> {
    return this.post(
      `/workspaces/${encodeURIComponent(workspaceId)}/repos/${encodeURIComponent(repoId)}/selections`,
      input,
    );
  }

  listRepoProcessDefinitions(workspaceId: string, repoId: string): Promise<VardashProcessDefinitionsResponse> {
    return this.get(`${workspaceRepoApiPath(workspaceId, repoId)}/process-definitions`);
  }

  upsertRepoProcessDefinition(
    workspaceId: string,
    repoId: string,
    input: UpsertVardashProcessDefinitionInput,
  ): Promise<VardashProcessDefinitionResponse> {
    return this.post(`${workspaceRepoApiPath(workspaceId, repoId)}/process-definitions`, input);
  }

  setRepoProcessDefinitionDefault(workspaceId: string, repoId: string, processDefinitionId: string): Promise<VardashProcessDefinitionResponse> {
    return this.post(
      `${workspaceRepoApiPath(workspaceId, repoId)}/process-definitions/${encodeURIComponent(processDefinitionId)}/default`,
      {},
    );
  }

  importLegacyDevServerProcessDefinition(workspaceId: string, repoId: string, devServerScript: string | null): Promise<VardashProcessDefinitionResponse> {
    return this.post(`${workspaceRepoApiPath(workspaceId, repoId)}/process-definitions/import-legacy-dev-server`, {
      dev_server_script: devServerScript,
    });
  }

  listWorkspaceRepoProcessDefinitions(
    workspaceId: string,
    repoId: string,
  ): Promise<VardashWorkspaceProcessDefinitionsResponse> {
    return this.get(`/workspaces/${encodeURIComponent(workspaceId)}/repos/${encodeURIComponent(repoId)}/process-definitions`);
  }

  importRepoEnv(workspaceId: string, repoId: string, input: ImportVardashEnvInput): Promise<VardashImportResponse> {
    return this.post(`${workspaceRepoApiPath(workspaceId, repoId)}/import`, input);
  }

  getLaunchReadiness(input: GetVardashLaunchReadinessInput): Promise<VardashLaunchReadinessResponse> {
    return this.get(`/workspaces/${encodeURIComponent(input.workspaceId)}/repos/${encodeURIComponent(input.repoId)}/launch/readiness${launchQuery(input)}`);
  }

  launchRepoProcess(input: LaunchVardashRepoProcessInput): Promise<VardashLaunchStartedResponse> {
    const { workspaceId, repoId, ...body } = input;
    return this.post(`/workspaces/${encodeURIComponent(workspaceId)}/repos/${encodeURIComponent(repoId)}/launch`, body);
  }

  getLaunchStatus(runId: string): Promise<VardashLaunchStatusResponse> {
    return this.get(`/launches/${encodeURIComponent(runId)}/status`);
  }

  stopLaunch(runId: string): Promise<VardashLaunchStopResponse> {
    return this.post(`/launches/${encodeURIComponent(runId)}/stop`, {});
  }

  private get<T>(path: string): Promise<T> {
    return this.request<T>(path);
  }

  private post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>(path, { method: 'POST', body: JSON.stringify(body) });
  }

  private put<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>(path, { method: 'PUT', body: JSON.stringify(body) });
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...init?.headers,
      },
    });
    const body = await parseJsonResponse(response);
    if (!response.ok) {
      throw new VardashApiError({ path, status: response.status, statusText: response.statusText, body });
    }
    return body as T;
  }
}

export const vardashClient = new VardashClient();


function workspaceRepoApiPath(workspaceId: string, repoId: string): string {
  return `/workspaces/${encodeURIComponent(workspaceId)}/repos/${encodeURIComponent(repoId)}`;
}
function launchQuery(input: GetVardashLaunchReadinessInput): string {
  const params = new URLSearchParams();
  if (input.processDefinitionId) params.set('processDefinitionId', input.processDefinitionId);
  if (input.processName) params.set('processName', input.processName);
  if (typeof input.useVarlock === 'boolean') params.set('useVarlock', String(input.useVarlock));
  const query = params.toString();
  return query ? `?${query}` : '';
}

async function parseJsonResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    return { error: 'invalid_json', detail: error instanceof Error ? error.message : String(error) };
  }
}

function readErrorCode(body: unknown): string | undefined {
  if (body && typeof body === 'object' && 'error' in body) {
    const error = (body as { error?: unknown }).error;
    if (typeof error === 'string') return error;
  }
  return undefined;
}
