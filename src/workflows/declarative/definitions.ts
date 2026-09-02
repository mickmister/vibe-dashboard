export const DECLARATIVE_WORKFLOW_DEFINITION_VERSION = 1;

export type DeclarativeWorkflowTrigger = 'manual';
export type DeclarativeWorkflowInputType = 'string';
export type DeclarativeWorkflowStepType =
  | 'resolve_roles'
  | 'queue_prompt'
  | 'wait_for_next_completed_response'
  | 'pipe_response'
  | 'notify_overseer'
  | 'complete';

export interface DeclarativeWorkflowInputSpec {
  type: DeclarativeWorkflowInputType;
  required: boolean;
  description?: string | null;
}

export interface DeclarativeWorkflowPolicies {
  allowAutoCreateSessions: boolean;
  allowTruncatedSourceDelivery: boolean;
  blockSameSession: boolean;
  notifyOnCompletion: boolean;
  refsOnlyStorage: boolean;
  stall: {
    staleAfterMinutes: number;
    autoNudge: boolean;
    callbackAndCiWaitsStall: boolean;
  };
}

export interface DeclarativeRoleTargetSpec {
  key: string;
  roleInput?: string | null;
  sessionInput?: string | null;
  defaultRole?: string | null;
}

export interface DeclarativeResolveRolesStep {
  id: string;
  type: 'resolve_roles';
  roles: DeclarativeRoleTargetSpec[];
  workspaceInput: string;
  laneInput?: string | null;
}

export interface DeclarativeQueuePromptStep {
  id: string;
  type: 'queue_prompt';
  target: string;
  template: string;
}

export interface DeclarativeWaitForNextCompletedResponseStep {
  id: string;
  type: 'wait_for_next_completed_response';
  target: string;
  after: string;
}

export interface DeclarativePipeResponseStep {
  id: string;
  type: 'pipe_response';
  source: string;
  target: string;
  template: string;
}

export interface DeclarativeNotifyOverseerStep {
  id: string;
  type: 'notify_overseer';
  sessionInput: string;
  template: string;
}

export interface DeclarativeCompleteStep {
  id: string;
  type: 'complete';
  summaryTemplate?: string | null;
}

export type DeclarativeWorkflowStep =
  | DeclarativeResolveRolesStep
  | DeclarativeQueuePromptStep
  | DeclarativeWaitForNextCompletedResponseStep
  | DeclarativePipeResponseStep
  | DeclarativeNotifyOverseerStep
  | DeclarativeCompleteStep;

export interface DeclarativeWorkflowDefinition {
  id: string;
  version: typeof DECLARATIVE_WORKFLOW_DEFINITION_VERSION;
  name: string;
  description?: string | null;
  trigger: DeclarativeWorkflowTrigger;
  inputs: Record<string, DeclarativeWorkflowInputSpec>;
  policies: DeclarativeWorkflowPolicies;
  steps: DeclarativeWorkflowStep[];
  outputs: Record<string, string>;
}

export class DeclarativeWorkflowDefinitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DeclarativeWorkflowDefinitionError';
  }
}

export const DEFAULT_DECLARATIVE_WORKFLOW_POLICIES: DeclarativeWorkflowPolicies = {
  allowAutoCreateSessions: true,
  allowTruncatedSourceDelivery: false,
  blockSameSession: true,
  notifyOnCompletion: true,
  refsOnlyStorage: true,
  stall: {
    staleAfterMinutes: 30,
    autoNudge: false,
    callbackAndCiWaitsStall: true,
  },
};

const KNOWN_STEP_TYPES = new Set<DeclarativeWorkflowStepType>([
  'resolve_roles',
  'queue_prompt',
  'wait_for_next_completed_response',
  'pipe_response',
  'notify_overseer',
  'complete',
]);

const SAFE_TEMPLATE_VARIABLE_PREFIXES = [
  'inputs.',
  'responses.',
  'refs.',
  'instance.',
  'source.',
] as const;

export function normalizeDeclarativeWorkflowDefinition(input: unknown): DeclarativeWorkflowDefinition {
  const record = asRecord(input, 'definition');
  const definition: DeclarativeWorkflowDefinition = {
    id: requiredString(record.id, 'definition id is required'),
    version: DECLARATIVE_WORKFLOW_DEFINITION_VERSION,
    name: requiredString(record.name, 'definition name is required'),
    description: optionalString(record.description),
    trigger: normalizeTrigger(record.trigger),
    inputs: normalizeInputs(record.inputs),
    policies: normalizePolicies(record.policies),
    steps: normalizeSteps(record.steps),
    outputs: normalizeOutputs(record.outputs),
  };
  validateDeclarativeWorkflowDefinition(definition);
  return definition;
}

export function validateDeclarativeWorkflowDefinition(definition: DeclarativeWorkflowDefinition): void {
  requiredString(definition.id, 'definition id is required');
  requiredString(definition.name, 'definition name is required');
  if (definition.version !== DECLARATIVE_WORKFLOW_DEFINITION_VERSION) {
    throw new DeclarativeWorkflowDefinitionError(`unsupported definition version: ${String(definition.version)}`);
  }
  if (definition.trigger !== 'manual') throw new DeclarativeWorkflowDefinitionError(`unsupported trigger: ${String(definition.trigger)}`);
  validateInputs(definition.inputs);
  validatePolicies(definition.policies);
  validateSteps(definition);
  validateOutputs(definition.outputs);
  assertJsonSerializable(definition);
}

export function extractTemplateVariables(template: string): string[] {
  const variables = new Set<string>();
  const pattern = /{{\s*([^{}#\/][^{}]*?)\s*}}/g;
  for (const match of template.matchAll(pattern)) {
    const variable = match[1]?.trim();
    if (variable) variables.add(variable);
  }
  return [...variables];
}

function normalizeTrigger(value: unknown): DeclarativeWorkflowTrigger {
  const trigger = optionalString(value) ?? 'manual';
  if (trigger !== 'manual') throw new DeclarativeWorkflowDefinitionError(`unsupported trigger: ${trigger}`);
  return trigger;
}

function normalizeInputs(value: unknown): Record<string, DeclarativeWorkflowInputSpec> {
  const record = asRecord(value ?? {}, 'inputs');
  const inputs: Record<string, DeclarativeWorkflowInputSpec> = {};
  for (const [key, rawSpec] of Object.entries(record)) {
    const spec = asRecord(rawSpec, `input ${key}`);
    inputs[key] = {
      type: normalizeInputType(spec.type, key),
      required: typeof spec.required === 'boolean' ? spec.required : false,
      description: optionalString(spec.description),
    };
  }
  return inputs;
}

function normalizeInputType(value: unknown, key: string): DeclarativeWorkflowInputType {
  const type = optionalString(value) ?? 'string';
  if (type !== 'string') throw new DeclarativeWorkflowDefinitionError(`unsupported input type for ${key}: ${type}`);
  return type;
}

function normalizePolicies(value: unknown): DeclarativeWorkflowPolicies {
  const record = value == null ? {} : asRecord(value, 'policies');
  const stallRecord = record.stall == null ? {} : asRecord(record.stall, 'policies.stall');
  return {
    allowAutoCreateSessions: booleanOrDefault(record.allowAutoCreateSessions, DEFAULT_DECLARATIVE_WORKFLOW_POLICIES.allowAutoCreateSessions),
    allowTruncatedSourceDelivery: booleanOrDefault(record.allowTruncatedSourceDelivery, DEFAULT_DECLARATIVE_WORKFLOW_POLICIES.allowTruncatedSourceDelivery),
    blockSameSession: booleanOrDefault(record.blockSameSession, DEFAULT_DECLARATIVE_WORKFLOW_POLICIES.blockSameSession),
    notifyOnCompletion: booleanOrDefault(record.notifyOnCompletion, DEFAULT_DECLARATIVE_WORKFLOW_POLICIES.notifyOnCompletion),
    refsOnlyStorage: booleanOrDefault(record.refsOnlyStorage, DEFAULT_DECLARATIVE_WORKFLOW_POLICIES.refsOnlyStorage),
    stall: {
      staleAfterMinutes: positiveIntegerOrDefault(stallRecord.staleAfterMinutes, DEFAULT_DECLARATIVE_WORKFLOW_POLICIES.stall.staleAfterMinutes, 'policies.stall.staleAfterMinutes'),
      autoNudge: booleanOrDefault(stallRecord.autoNudge, DEFAULT_DECLARATIVE_WORKFLOW_POLICIES.stall.autoNudge),
      callbackAndCiWaitsStall: booleanOrDefault(stallRecord.callbackAndCiWaitsStall, DEFAULT_DECLARATIVE_WORKFLOW_POLICIES.stall.callbackAndCiWaitsStall),
    },
  };
}

function normalizeSteps(value: unknown): DeclarativeWorkflowStep[] {
  if (!Array.isArray(value)) throw new DeclarativeWorkflowDefinitionError('steps must be an array');
  return value.map((entry, index) => normalizeStep(entry, index));
}

function normalizeStep(value: unknown, index: number): DeclarativeWorkflowStep {
  const record = asRecord(value, `step ${index}`);
  const id = requiredString(record.id, `step ${index} id is required`);
  const type = requiredString(record.type, `step ${id} type is required`);
  if (!KNOWN_STEP_TYPES.has(type as DeclarativeWorkflowStepType)) throw new DeclarativeWorkflowDefinitionError(`unknown step type: ${type}`);
  switch (type) {
    case 'resolve_roles': return {
      id,
      type,
      roles: normalizeRoles(record.roles, id),
      workspaceInput: requiredString(record.workspaceInput, `step ${id} workspaceInput is required`),
      laneInput: optionalString(record.laneInput),
    };
    case 'queue_prompt': return { id, type, target: requiredString(record.target, `step ${id} target is required`), template: requiredString(record.template, `step ${id} template is required`) };
    case 'wait_for_next_completed_response': return { id, type, target: requiredString(record.target, `step ${id} target is required`), after: requiredString(record.after, `step ${id} after is required`) };
    case 'pipe_response': return { id, type, source: requiredString(record.source, `step ${id} source is required`), target: requiredString(record.target, `step ${id} target is required`), template: requiredString(record.template, `step ${id} template is required`) };
    case 'notify_overseer': return { id, type, sessionInput: requiredString(record.sessionInput, `step ${id} sessionInput is required`), template: requiredString(record.template, `step ${id} template is required`) };
    case 'complete': return { id, type, summaryTemplate: optionalString(record.summaryTemplate) };
    default: throw new DeclarativeWorkflowDefinitionError(`unknown step type: ${type}`);
  }
}

function normalizeRoles(value: unknown, stepId: string): DeclarativeRoleTargetSpec[] {
  if (!Array.isArray(value) || value.length === 0) throw new DeclarativeWorkflowDefinitionError(`step ${stepId} roles must be a non-empty array`);
  return value.map((entry, index) => {
    const record = asRecord(entry, `step ${stepId} role ${index}`);
    const role: DeclarativeRoleTargetSpec = {
      key: requiredString(record.key, `step ${stepId} role ${index} key is required`),
      roleInput: optionalString(record.roleInput),
      sessionInput: optionalString(record.sessionInput),
      defaultRole: optionalString(record.defaultRole),
    };
    if (!(role.roleInput || role.sessionInput || role.defaultRole)) {
      throw new DeclarativeWorkflowDefinitionError(`step ${stepId} role ${role.key} must declare roleInput, sessionInput, or defaultRole`);
    }
    return role;
  });
}

function normalizeOutputs(value: unknown): Record<string, string> {
  const record = value == null ? {} : asRecord(value, 'outputs');
  const outputs: Record<string, string> = {};
  for (const [key, value] of Object.entries(record)) {
    outputs[key] = requiredString(value, `output ${key} must be a non-empty template string`);
  }
  return outputs;
}

function validateInputs(inputs: Record<string, DeclarativeWorkflowInputSpec>): void {
  for (const [key, spec] of Object.entries(inputs)) {
    requiredString(key, 'input key is required');
    if (spec.type !== 'string') throw new DeclarativeWorkflowDefinitionError(`unsupported input type for ${key}: ${String(spec.type)}`);
    if (typeof spec.required !== 'boolean') throw new DeclarativeWorkflowDefinitionError(`input ${key} required must be boolean`);
  }
}

function validatePolicies(policies: DeclarativeWorkflowPolicies): void {
  if (!policies.refsOnlyStorage) throw new DeclarativeWorkflowDefinitionError('refsOnlyStorage must remain true for v0 declarative workflows');
  if (!Number.isSafeInteger(policies.stall.staleAfterMinutes) || policies.stall.staleAfterMinutes <= 0) {
    throw new DeclarativeWorkflowDefinitionError('policies.stall.staleAfterMinutes must be positive');
  }
}

function validateSteps(definition: DeclarativeWorkflowDefinition): void {
  if (definition.steps.length === 0) throw new DeclarativeWorkflowDefinitionError('definition must include at least one step');
  const stepIds = new Set<string>();
  const roleKeys = new Set<string>();
  const inputKeys = new Set(Object.keys(definition.inputs));

  for (const step of definition.steps) {
    if (stepIds.has(step.id)) throw new DeclarativeWorkflowDefinitionError(`duplicate step id: ${step.id}`);
    stepIds.add(step.id);
    if (!KNOWN_STEP_TYPES.has(step.type)) throw new DeclarativeWorkflowDefinitionError(`unknown step type: ${step.type}`);

    if (step.type === 'resolve_roles') {
      assertInputExists(inputKeys, step.workspaceInput, `step ${step.id} workspaceInput`);
      if (step.laneInput) assertInputExists(inputKeys, step.laneInput, `step ${step.id} laneInput`);
      const localRoleKeys = new Set<string>();
      for (const role of step.roles) {
        if (localRoleKeys.has(role.key)) throw new DeclarativeWorkflowDefinitionError(`duplicate role key: ${role.key}`);
        localRoleKeys.add(role.key);
        roleKeys.add(role.key);
        if (role.roleInput) assertInputExists(inputKeys, role.roleInput, `role ${role.key} roleInput`);
        if (role.sessionInput) assertInputExists(inputKeys, role.sessionInput, `role ${role.key} sessionInput`);
      }
      continue;
    }

    if (step.type === 'queue_prompt') {
      assertRoleExists(roleKeys, step.target, step.id);
      validateTemplate(step.template, definition, step.id);
    } else if (step.type === 'wait_for_next_completed_response') {
      assertRoleExists(roleKeys, step.target, step.id);
      assertStepExists(stepIds, step.after, `step ${step.id} after`);
    } else if (step.type === 'pipe_response') {
      assertRoleExists(roleKeys, step.target, step.id);
      assertStepExists(stepIds, step.source, `step ${step.id} source`);
      validateTemplate(step.template, definition, step.id);
    } else if (step.type === 'notify_overseer') {
      assertInputExists(inputKeys, step.sessionInput, `step ${step.id} sessionInput`);
      validateTemplate(step.template, definition, step.id);
    } else if (step.type === 'complete' && step.summaryTemplate) {
      validateTemplate(step.summaryTemplate, definition, step.id);
    }
  }
}

function validateOutputs(outputs: Record<string, string>): void {
  for (const [key, value] of Object.entries(outputs)) {
    requiredString(key, 'output key is required');
    requiredString(value, `output ${key} must be a non-empty template string`);
  }
}

function validateTemplate(template: string, definition: DeclarativeWorkflowDefinition, label: string): void {
  requiredString(template, `template for ${label} is required`);
  for (const variable of extractTemplateVariables(template)) {
    if (!SAFE_TEMPLATE_VARIABLE_PREFIXES.some((prefix) => variable.startsWith(prefix))) {
      throw new DeclarativeWorkflowDefinitionError(`unsafe template variable in ${label}: ${variable}`);
    }
    if (variable.startsWith('inputs.')) {
      const inputName = variable.slice('inputs.'.length).split(/[.\s]/)[0];
      if (!inputName || !definition.inputs[inputName]) throw new DeclarativeWorkflowDefinitionError(`unknown input variable in ${label}: ${variable}`);
    }
  }
}

function assertInputExists(inputKeys: Set<string>, inputName: string, label: string): void {
  if (!inputKeys.has(inputName)) throw new DeclarativeWorkflowDefinitionError(`${label} references unknown input: ${inputName}`);
}

function assertRoleExists(roleKeys: Set<string>, roleKey: string, stepId: string): void {
  if (!roleKeys.has(roleKey)) throw new DeclarativeWorkflowDefinitionError(`step ${stepId} references unknown role target: ${roleKey}`);
}

function assertStepExists(stepIds: Set<string>, stepId: string, label: string): void {
  if (!stepIds.has(stepId)) throw new DeclarativeWorkflowDefinitionError(`${label} references unknown or future step: ${stepId}`);
}

function assertJsonSerializable(value: unknown): void {
  try {
    JSON.parse(JSON.stringify(value));
  } catch (error) {
    throw new DeclarativeWorkflowDefinitionError(`definition must be JSON serializable: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new DeclarativeWorkflowDefinitionError(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, message: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new DeclarativeWorkflowDefinitionError(message);
  return value.trim();
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function booleanOrDefault(value: unknown, defaultValue: boolean): boolean {
  return typeof value === 'boolean' ? value : defaultValue;
}

function positiveIntegerOrDefault(value: unknown, defaultValue: number, label: string): number {
  if (value == null) return defaultValue;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new DeclarativeWorkflowDefinitionError(`${label} must be a positive integer`);
  return parsed;
}
