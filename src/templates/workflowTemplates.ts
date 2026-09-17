export const WORKFLOW_TEMPLATE_STATE_VERSION = 1;

export interface WorkflowTemplatePolicyOverrides {
  maxConcurrentAgents?: number | null;
  maxNudgesPerRun?: number | null;
  fanInMode?: 'all_at_once' | 'handle_as_they_come' | string | null;
}

export interface WorkflowTemplate {
  id: string;
  version: typeof WORKFLOW_TEMPLATE_STATE_VERSION;
  name: string;
  description?: string | null;
  teamId?: string | null;
  body: string;
  targetRoles: string[];
  defaultWorkflowId?: string | null;
  policyOverrides?: WorkflowTemplatePolicyOverrides;
  skillRefs?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowTemplateState {
  version: typeof WORKFLOW_TEMPLATE_STATE_VERSION;
  templates: WorkflowTemplate[];
  selectedTemplateId: string | null;
}

export interface CreateWorkflowTemplateInput {
  id?: string;
  name: string;
  description?: string | null;
  teamId?: string | null;
  body: string;
  targetRoles?: string[];
  defaultWorkflowId?: string | null;
  policyOverrides?: WorkflowTemplatePolicyOverrides;
  skillRefs?: string[];
}

export interface UpdateWorkflowTemplateInput {
  name?: string;
  description?: string | null;
  teamId?: string | null;
  body?: string;
  targetRoles?: string[];
  defaultWorkflowId?: string | null;
  policyOverrides?: WorkflowTemplatePolicyOverrides;
  skillRefs?: string[];
}

export interface WorkflowTemplateIdFactory {
  templateId?: () => string;
}

export type WorkflowTemplateStateInput = Partial<WorkflowTemplateState> | { templates?: unknown; version?: unknown; selectedTemplateId?: unknown } | null | undefined;

export function createDefaultWorkflowTemplateState(): WorkflowTemplateState {
  return { version: WORKFLOW_TEMPLATE_STATE_VERSION, templates: [], selectedTemplateId: null };
}

export function migrateWorkflowTemplateState(input: WorkflowTemplateStateInput): WorkflowTemplateState {
  const state = input && typeof input === 'object' ? input as Partial<WorkflowTemplateState> : {};
  const templates = Array.isArray(state.templates)
    ? state.templates.map((template) => normalizeWorkflowTemplate(template)).filter((template): template is WorkflowTemplate => template !== null)
    : [];
  const selectedTemplateId = typeof state.selectedTemplateId === 'string' && templates.some((template) => template.id === state.selectedTemplateId)
    ? state.selectedTemplateId
    : templates[0]?.id ?? null;
  return { version: WORKFLOW_TEMPLATE_STATE_VERSION, templates, selectedTemplateId };
}

export function createWorkflowTemplate(input: CreateWorkflowTemplateInput, options: { now?: string; ids?: WorkflowTemplateIdFactory } = {}): WorkflowTemplate {
  const now = options.now ?? new Date().toISOString();
  const template: WorkflowTemplate = {
    id: nonEmpty(input.id) ?? options.ids?.templateId?.() ?? createRandomId('template'),
    version: WORKFLOW_TEMPLATE_STATE_VERSION,
    name: requireNonEmpty(input.name, 'Template name is required'),
    description: input.description ?? null,
    teamId: input.teamId ?? null,
    body: requireNonEmpty(input.body, 'Template body is required'),
    targetRoles: normalizeStringList(input.targetRoles),
    defaultWorkflowId: nonEmpty(input.defaultWorkflowId) ?? 'manual-agent-team-runner',
    policyOverrides: normalizePolicyOverrides(input.policyOverrides),
    skillRefs: normalizeStringList(input.skillRefs),
    createdAt: now,
    updatedAt: now,
  };
  validateWorkflowTemplate(template);
  return template;
}

export function addWorkflowTemplate(state: WorkflowTemplateStateInput, input: CreateWorkflowTemplateInput, options: { now?: string; ids?: WorkflowTemplateIdFactory } = {}): WorkflowTemplateState {
  const current = migrateWorkflowTemplateState(state);
  const template = createWorkflowTemplate(input, options);
  if (current.templates.some((existing) => existing.id === template.id)) throw new Error(`Workflow template already exists: ${template.id}`);
  return { ...current, templates: [...current.templates, template], selectedTemplateId: current.selectedTemplateId ?? template.id };
}

export function updateWorkflowTemplate(state: WorkflowTemplateStateInput, templateId: string, input: UpdateWorkflowTemplateInput, now = new Date().toISOString()): WorkflowTemplateState {
  const current = migrateWorkflowTemplateState(state);
  let found = false;
  const templates = current.templates.map((template) => {
    if (template.id !== templateId) return template;
    found = true;
    const next: WorkflowTemplate = {
      ...template,
      name: input.name === undefined ? template.name : requireNonEmpty(input.name, 'Template name is required'),
      description: input.description === undefined ? template.description ?? null : input.description ?? null,
      teamId: input.teamId === undefined ? template.teamId ?? null : input.teamId ?? null,
      body: input.body === undefined ? template.body : requireNonEmpty(input.body, 'Template body is required'),
      targetRoles: input.targetRoles === undefined ? template.targetRoles : normalizeStringList(input.targetRoles),
      defaultWorkflowId: input.defaultWorkflowId === undefined ? template.defaultWorkflowId ?? null : nonEmpty(input.defaultWorkflowId),
      policyOverrides: input.policyOverrides === undefined ? template.policyOverrides : normalizePolicyOverrides(input.policyOverrides),
      skillRefs: input.skillRefs === undefined ? template.skillRefs ?? [] : normalizeStringList(input.skillRefs),
      updatedAt: now,
    };
    validateWorkflowTemplate(next);
    return next;
  });
  if (!found) throw new Error(`Workflow template not found: ${templateId}`);
  return { ...current, templates };
}

export function deleteWorkflowTemplate(state: WorkflowTemplateStateInput, templateId: string): WorkflowTemplateState {
  const current = migrateWorkflowTemplateState(state);
  const templates = current.templates.filter((template) => template.id !== templateId);
  return { ...current, templates, selectedTemplateId: current.selectedTemplateId === templateId ? templates[0]?.id ?? null : current.selectedTemplateId };
}

export function duplicateWorkflowTemplate(state: WorkflowTemplateStateInput, templateId: string, options: { now?: string; ids?: WorkflowTemplateIdFactory } = {}): WorkflowTemplateState {
  const current = migrateWorkflowTemplateState(state);
  const source = current.templates.find((template) => template.id === templateId);
  if (!source) throw new Error(`Workflow template not found: ${templateId}`);
  return addWorkflowTemplate(current, {
    name: `${source.name} copy`,
    description: source.description ?? null,
    teamId: source.teamId ?? null,
    body: source.body,
    targetRoles: source.targetRoles,
    defaultWorkflowId: source.defaultWorkflowId ?? null,
    policyOverrides: source.policyOverrides,
    skillRefs: source.skillRefs ?? [],
  }, options);
}

export function selectWorkflowTemplate(state: WorkflowTemplateStateInput, templateId: string | null): WorkflowTemplateState {
  const current = migrateWorkflowTemplateState(state);
  if (templateId !== null && !current.templates.some((template) => template.id === templateId)) throw new Error(`Workflow template not found: ${templateId}`);
  return { ...current, selectedTemplateId: templateId };
}

export function createBuiltInWorkflowTemplates(options: { now?: string; ids?: WorkflowTemplateIdFactory } = {}): WorkflowTemplate[] {
  return [
    createWorkflowTemplate({
      name: 'Research → plan → review',
      description: 'Have an implementer research and plan, then route to reviewer for critique.',
      body: 'Research this task, summarize findings, and produce an implementation plan for review:\n\n{{task}}',
      targetRoles: ['implementer', 'reviewer'],
      defaultWorkflowId: 'manual-agent-team-runner',
      policyOverrides: { fanInMode: 'handle_as_they_come' },
    }, options),
  ];
}

export function validateWorkflowTemplate(template: WorkflowTemplate): void {
  requireNonEmpty(template.id, 'Template id is required');
  requireNonEmpty(template.name, 'Template name is required');
  requireNonEmpty(template.body, 'Template body is required');
  if (!Array.isArray(template.targetRoles)) throw new Error('Template targetRoles must be an array');
  if (template.policyOverrides?.maxConcurrentAgents != null && template.policyOverrides.maxConcurrentAgents <= 0) throw new Error('maxConcurrentAgents override must be positive');
  if (template.policyOverrides?.maxNudgesPerRun != null && template.policyOverrides.maxNudgesPerRun < 0) throw new Error('maxNudgesPerRun override must be non-negative');
}

function normalizeWorkflowTemplate(input: unknown): WorkflowTemplate | null {
  if (!input || typeof input !== 'object') return null;
  const record = input as Partial<WorkflowTemplate>;
  try {
    const now = typeof record.createdAt === 'string' ? record.createdAt : new Date().toISOString();
    const template: WorkflowTemplate = {
      id: requireNonEmpty(record.id, 'Template id is required'),
      version: WORKFLOW_TEMPLATE_STATE_VERSION,
      name: requireNonEmpty(record.name, 'Template name is required'),
      description: record.description ?? null,
      teamId: record.teamId ?? null,
      body: requireNonEmpty(record.body, 'Template body is required'),
      targetRoles: normalizeStringList(record.targetRoles),
      defaultWorkflowId: nonEmpty(record.defaultWorkflowId) ?? 'manual-agent-team-runner',
      policyOverrides: normalizePolicyOverrides(record.policyOverrides),
      skillRefs: normalizeStringList(record.skillRefs),
      createdAt: now,
      updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : now,
    };
    validateWorkflowTemplate(template);
    return template;
  } catch {
    return null;
  }
}

function normalizePolicyOverrides(input: unknown): WorkflowTemplatePolicyOverrides {
  const record = input && typeof input === 'object' ? input as WorkflowTemplatePolicyOverrides : {};
  return {
    maxConcurrentAgents: record.maxConcurrentAgents == null ? null : positiveInteger(record.maxConcurrentAgents, 'maxConcurrentAgents'),
    maxNudgesPerRun: record.maxNudgesPerRun == null ? null : nonNegativeInteger(record.maxNudgesPerRun, 'maxNudgesPerRun'),
    fanInMode: nonEmpty(record.fanInMode) ?? null,
  };
}

function normalizeStringList(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return [...new Set(input.map((value) => nonEmpty(value)).filter((value): value is string => value !== null))];
}

function requireNonEmpty(value: unknown, message: string): string {
  const string = nonEmpty(value);
  if (!string) throw new Error(message);
  return string;
}

function nonEmpty(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function positiveInteger(value: unknown, label: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${label} must be a positive integer`);
  return parsed;
}

function nonNegativeInteger(value: unknown, label: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`${label} must be a non-negative integer`);
  return parsed;
}

function createRandomId(prefix: string): string {
  const random = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}_${random}`;
}
