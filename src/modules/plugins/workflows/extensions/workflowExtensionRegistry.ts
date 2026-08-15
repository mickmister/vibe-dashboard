import { createBeadsFormWorkflowArtifactRef } from '@vibe-dashboard/beads-form';
import { createDefaultWorkflowCommandProviderRegistry } from './workflowCommandProviders';

export type WorkflowExtensionIssueCode =
  | 'WORKFLOW_EXTENSION_DUPLICATE_PROVIDER'
  | 'WORKFLOW_EXTENSION_UNKNOWN_STEP_PROVIDER'
  | 'WORKFLOW_EXTENSION_UNKNOWN_ARTIFACT_PROVIDER'
  | 'WORKFLOW_EXTENSION_PROVIDER_ERROR';

export interface WorkflowExtensionIssue {
  code: WorkflowExtensionIssueCode;
  path: string;
  message: string;
  retryable?: boolean;
}

export class WorkflowExtensionRegistryError extends Error {
  readonly issues: WorkflowExtensionIssue[];

  constructor(issues: WorkflowExtensionIssue[]) {
    super(`Workflow extension registry error with ${issues.length} issue(s)`);
    this.name = 'WorkflowExtensionRegistryError';
    this.issues = issues;
  }
}

export interface WorkflowStepProvider {
  type: string;
  label: string;
  description?: string;
  /**
   * Design-time validation hook only. Runtime state transitions remain owned by
   * the workflow runtime, not by step providers.
   */
  validateStep?: (step: unknown, context: WorkflowStepValidationContext) => WorkflowExtensionIssue[];
}

export interface WorkflowStepValidationContext {
  path: string;
  stateId: string;
  stepIndex: number;
}

export interface WorkflowArtifactProvider {
  providerType: string;
  label: string;
  description?: string;
  createArtifact: (request: WorkflowArtifactCreateRequest, context: WorkflowArtifactProviderContext) => Promise<WorkflowArtifactCreateResult>;
}

export interface WorkflowArtifactCreateRequest {
  providerType: string;
  artifactKind: string;
  idempotencyKey: string;
  input: unknown;
}

export interface WorkflowArtifactProviderContext {
  readonly run: Readonly<{
    runId: string;
    workspaceId: string;
    stateId: string;
    visitId: string;
  }>;
}

export interface WorkflowArtifactRef {
  providerType: string;
  artifactKind: string;
  artifactId: string;
  durableRef: string;
  metadata?: Record<string, unknown>;
}

export interface WorkflowArtifactCreateResult {
  artifactRef: WorkflowArtifactRef;
  metadata?: Record<string, unknown>;
}

export interface WorkflowArtifactProviderError extends Error {
  retryable?: boolean;
}

export interface BeadsFormArtifactRequest {
  providerType: 'beads_form';
  artifactKind: 'form';
  idempotencyKey: string;
  input: {
    title: string;
    descriptionMarkdown?: string;
    formSchema: unknown;
    submitLabel?: string;
  };
}

export interface NotificationAdapterProvider {
  providerType: string;
  label: string;
  notify: (request: { durableAttentionRef: string; messageMarkdown: string }) => Promise<{ deliveredRef?: string }>;
}

export interface PromptAssetProvider {
  providerType: string;
  label: string;
  resolvePromptAsset: (ref: { id: string; version?: number }) => Promise<{ bodyMarkdown: string; contentHash: string }>;
}

export class WorkflowExtensionRegistry {
  private readonly stepProviders = new Map<string, WorkflowStepProvider>();
  private readonly artifactProviders = new Map<string, WorkflowArtifactProvider>();

  registerStepProvider(provider: WorkflowStepProvider): void {
    assertProviderType(provider.type, 'step provider type');
    if (this.stepProviders.has(provider.type)) {
      throw new WorkflowExtensionRegistryError([
        {
          code: 'WORKFLOW_EXTENSION_DUPLICATE_PROVIDER',
          path: `stepProviders.${provider.type}`,
          message: `step provider ${provider.type} is already registered`,
        },
      ]);
    }
    this.stepProviders.set(provider.type, { ...provider });
  }

  registerArtifactProvider(provider: WorkflowArtifactProvider): void {
    assertProviderType(provider.providerType, 'artifact provider type');
    if (this.artifactProviders.has(provider.providerType)) {
      throw new WorkflowExtensionRegistryError([
        {
          code: 'WORKFLOW_EXTENSION_DUPLICATE_PROVIDER',
          path: `artifactProviders.${provider.providerType}`,
          message: `artifact provider ${provider.providerType} is already registered`,
        },
      ]);
    }
    this.artifactProviders.set(provider.providerType, { ...provider });
  }

  getStepProvider(type: string): WorkflowStepProvider | undefined {
    return this.stepProviders.get(type);
  }

  getArtifactProvider(providerType: string): WorkflowArtifactProvider | undefined {
    return this.artifactProviders.get(providerType);
  }

  validateWorkflowConfig(definition: unknown): WorkflowExtensionIssue[] {
    const issues: WorkflowExtensionIssue[] = [];
    if (!isRecord(definition) || !isRecord(definition.states)) return issues;

    for (const [stateId, state] of Object.entries(definition.states)) {
      if (!isRecord(state) || state.terminal === true || !Array.isArray(state.steps)) continue;
      state.steps.forEach((step, stepIndex) => {
        const stepPath = `states.${stateId}.steps.${stepIndex}`;
        if (!isRecord(step)) return;
        const type = step.type;
        if (typeof type === 'string') {
          const provider = this.stepProviders.get(type);
          if (!provider) {
            issues.push({
              code: 'WORKFLOW_EXTENSION_UNKNOWN_STEP_PROVIDER',
              path: `${stepPath}.type`,
              message: `unknown workflow step provider ${type}`,
            });
          } else {
            issues.push(...(provider.validateStep?.(step, { path: stepPath, stateId, stepIndex }) ?? []));
          }
        }
        issues.push(...this.validateArtifactRefs(step.artifacts, `${stepPath}.artifacts`));
      });
    }

    return issues;
  }

  async createArtifact(
    request: WorkflowArtifactCreateRequest,
    context: WorkflowArtifactProviderContext,
  ): Promise<WorkflowArtifactCreateResult> {
    const provider = this.artifactProviders.get(request.providerType);
    if (!provider) {
      throw new WorkflowExtensionRegistryError([
        {
          code: 'WORKFLOW_EXTENSION_UNKNOWN_ARTIFACT_PROVIDER',
          path: 'artifact.providerType',
          message: `unknown workflow artifact provider ${request.providerType}`,
        },
      ]);
    }

    try {
      return await provider.createArtifact(deepFreeze({ ...request }), deepFreeze({ run: { ...context.run } }));
    } catch (error) {
      if (error instanceof WorkflowExtensionRegistryError) throw error;
      const retryable = isRecord(error) && typeof error.retryable === 'boolean' ? error.retryable : undefined;
      throw new WorkflowExtensionRegistryError([
        {
          code: 'WORKFLOW_EXTENSION_PROVIDER_ERROR',
          path: `artifactProviders.${request.providerType}`,
          message: error instanceof Error ? error.message : `artifact provider ${request.providerType} failed`,
          retryable,
        },
      ]);
    }
  }

  private validateArtifactRefs(value: unknown, path: string): WorkflowExtensionIssue[] {
    if (value === undefined) return [];
    if (!Array.isArray(value)) {
      return [{ code: 'WORKFLOW_EXTENSION_UNKNOWN_ARTIFACT_PROVIDER', path, message: 'artifacts must be an array' }];
    }
    const issues: WorkflowExtensionIssue[] = [];
    value.forEach((artifact, index) => {
      const providerType = isRecord(artifact) ? artifact.providerType : undefined;
      if (typeof providerType !== 'string' || !this.artifactProviders.has(providerType)) {
        issues.push({
          code: 'WORKFLOW_EXTENSION_UNKNOWN_ARTIFACT_PROVIDER',
          path: `${path}.${index}.providerType`,
          message: typeof providerType === 'string'
            ? `unknown workflow artifact provider ${providerType}`
            : 'artifact providerType is required',
        });
      }
    });
    return issues;
  }
}

export function createDefaultWorkflowExtensionRegistry(): WorkflowExtensionRegistry {
  const registry = new WorkflowExtensionRegistry();
  registry.registerStepProvider({
    type: 'agent_turn',
    label: 'Agent turn',
    description: 'Built-in workflow-core agent turn step provider.',
  });
  registry.registerStepProvider({
    type: 'human_form',
    label: 'Human form',
    description: 'Beads-form-backed human attention workflow step.',
    validateStep(step, context) {
      const record = isRecord(step) ? step : {};
      const issues: WorkflowExtensionIssue[] = [];
      if (typeof record.title !== 'string' || !record.title.trim()) {
        issues.push({ code: 'WORKFLOW_EXTENSION_PROVIDER_ERROR', path: `${context.path}.title`, message: 'human_form title is required' });
      }
      const form = isRecord(record.form) ? record.form : null;
      if (!form || form.providerType !== 'beads_form') {
        issues.push({ code: 'WORKFLOW_EXTENSION_UNKNOWN_ARTIFACT_PROVIDER', path: `${context.path}.form.providerType`, message: 'human_form providerType must be beads_form' });
      }
      return issues;
    },
  });
  registry.registerStepProvider({
    type: 'command',
    label: 'Command',
    description: 'Provider-mediated bounded workflow command step.',
    validateStep(step, context) {
      const record = isRecord(step) ? step : {};
      const providerId = typeof record.provider === 'string' ? record.provider : '';
      const provider = createDefaultWorkflowCommandProviderRegistry().get(providerId);
      if (!provider) {
        return [{ code: 'WORKFLOW_EXTENSION_UNKNOWN_STEP_PROVIDER', path: `${context.path}.provider`, message: providerId ? `unknown command provider ${providerId}` : 'command provider is required' }];
      }
      return provider.validateCommand(record as never, context);
    },
  });
  registry.registerStepProvider({
    type: 'workflow_call',
    label: 'Workflow call',
    description: 'Executable blocking child workflow call step.',
    validateStep(step, context) {
      const record = isRecord(step) ? step : {};
      const issues: WorkflowExtensionIssue[] = [];
      if (record.mode !== 'blocking') {
        issues.push({ code: 'WORKFLOW_EXTENSION_PROVIDER_ERROR', path: `${context.path}.mode`, message: 'workflow_call mode must be blocking' });
      }
      const workflow = isRecord(record.workflow) ? record.workflow : null;
      if (!workflow || typeof workflow.designId !== 'string' || !workflow.designId.trim()) {
        issues.push({ code: 'WORKFLOW_EXTENSION_PROVIDER_ERROR', path: `${context.path}.workflow.designId`, message: 'workflow_call workflow designId is required' });
      }
      return issues;
    },
  });
  registry.registerArtifactProvider(createBeadsFormArtifactProvider());
  return registry;
}

export function createBeadsFormArtifactProvider(): WorkflowArtifactProvider {
  return {
    providerType: 'beads_form',
    label: 'Beads form',
    description: 'First-party beads-form workflow artifact provider.',
    async createArtifact(request) {
      const input = isRecord(request.input) ? request.input : {};
      const title = typeof input.title === 'string' && input.title.trim() ? input.title : 'Workflow form';
      const artifactRef = createBeadsFormWorkflowArtifactRef({
        idempotencyKey: request.idempotencyKey,
        title,
        formSchema: input.formSchema,
        submitLabel: typeof input.submitLabel === 'string' ? input.submitLabel : undefined,
      });
      return {
        artifactRef: {
          ...artifactRef,
          metadata: artifactRef.metadata,
        },
      };
    },
  };
}

function assertProviderType(type: string, label: string): void {
  if (!type || !/^[a-z][a-z0-9_:-]*$/u.test(type)) {
    throw new WorkflowExtensionRegistryError([
      {
        code: 'WORKFLOW_EXTENSION_UNKNOWN_STEP_PROVIDER',
        path: label,
        message: `${label} must be a stable lowercase identifier`,
      },
    ]);
  }
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const nested of Object.values(value)) deepFreeze(nested);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
