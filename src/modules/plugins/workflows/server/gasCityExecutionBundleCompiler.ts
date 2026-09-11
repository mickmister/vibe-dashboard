import { createHash } from "node:crypto";
import {
  normalizeWorkflowDefinitionV1,
  renderExpectedXmlResponseXsd,
  type AgentWorkflowDefinitionV1,
  type AgentWorkflowStepV1,
  type NormalizedAgentWorkflowModel,
  type WorkflowRuntimeSnapshot,
} from "@vibe-dashboard/workflow-core";
import { generateGasCityPackFromWorkflow } from "./gasCityPackGenerator";

export const VD_EXECUTION_BUNDLE_SCHEMA = "vd.execution-bundle.v1" as const;
export const VD_FORMULA_COMPILER_REQUIREMENT = ">=2.0.0" as const;
export const VD_GAS_CITY_VERSION = "1.4.1" as const;
export const VD_BEADS_VERSION = "1.2.2" as const;
export const VD_GC_SESSION_BRIDGE_VERSION = "vd-gc-session-vibe.v1" as const;
export const VD_BUNDLE_COMPILER_POLICY = "vd.formulas-v2.strict.v1" as const;

type PreferenceSource = "launch_override" | "team_role" | "role_default" | "workspace_default" | "system_default" | "unset";

export interface ResolvedBundleRole {
  roleId: string;
  template: null | { id: string; version: number; contentHash: string };
  promptAssets: Array<{ id: string; version: number; content: string; contentHash: string }>;
  skillAssets: Array<{ id: string; version: number; content: string; contentHash: string }>;
  baseInstructions: string;
  executor: string | null;
  model: string | null;
  reasoningId: string | null;
  preferenceSources: { executor: PreferenceSource; model: PreferenceSource; reasoningId: PreferenceSource };
}

export interface GasCityExecutionBundleCompileInput {
  schemaVersion: "vd.execution-bundle.compile-input.v1";
  workflow: { designId: string; version: number; definition: AgentWorkflowDefinitionV1 | unknown };
  roles: ResolvedBundleRole[];
  inputs: Record<string, string | number | boolean>;
  taskContextPolicy: { mode: "latest_each_turn"; beadIds: string[]; include: "minimal_summary" };
  sessionPolicy: { mode: "run_scoped_role_sessions"; incompatibleSession: "reject" | "replace" };
  effects: { allowed: Array<"result_note" | "caller_callback" | "notification">; closePolicy: "manual" };
  retry: { invalidResultAttempts: number; abruptTurnNudges: number };
  limits: { maxTurns: number; maxPromptChars: number; maxResultChars: number };
  compatibility: {
    compilerPolicy: typeof VD_BUNDLE_COMPILER_POLICY;
    formulaCompiler: typeof VD_FORMULA_COMPILER_REQUIREMENT;
    gasCity: typeof VD_GAS_CITY_VERSION;
    beads: typeof VD_BEADS_VERSION;
    bridge: typeof VD_GC_SESSION_BRIDGE_VERSION;
  };
  capabilities: string[];
}

export interface GasCityCompiledPreview {
  gasCityVersion: string;
  formulaCompiler: string;
  nodes: Array<{ id: string; role: string; needs: string[] }>;
}

export interface GasCityFormulaPreviewProvider {
  compileFormula(input: { formulaToml: string; gasCityVersion: string; formulaCompiler: string }): Promise<GasCityCompiledPreview>;
}

export interface CompiledGasCityExecutionBundle {
  schemaVersion: typeof VD_EXECUTION_BUNDLE_SCHEMA;
  digest: string;
  bytes: Uint8Array;
  document: Readonly<Record<string, unknown>>;
}

export class GasCityExecutionBundleCompileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GasCityExecutionBundleCompileError";
  }
}

export async function compileGasCityExecutionBundle(
  rawInput: GasCityExecutionBundleCompileInput | unknown,
  previewProvider: GasCityFormulaPreviewProvider,
): Promise<CompiledGasCityExecutionBundle> {
  const input = validateCompileInput(rawInput);
  const model = normalizeWorkflowDefinitionV1(input.workflow.definition, { workflowId: input.workflow.designId });
  validateGraph(model);
  validateInputs(model, input.inputs);
  validateRoles(model, input.roles);

  const canonicalDefinition = canonicalize(input.workflow.definition) as AgentWorkflowDefinitionV1;
  const pack = generateGasCityPackFromWorkflow({
    designId: input.workflow.designId,
    designVersion: input.workflow.version,
    definition: canonicalDefinition,
  });
  const formulaToml = pack.files.find((file) => file.kind === "formula.toml")?.contents;
  if (!formulaToml || !formulaToml.includes(`[requires]\nformula_compiler = "${VD_FORMULA_COMPILER_REQUIREMENT}"`)) {
    fail("Generated formula does not declare the pinned formula compiler requirement.");
  }
  const intendedGraph = buildIntendedGraph(model);
  const preview = await previewProvider.compileFormula({
    formulaToml,
    gasCityVersion: input.compatibility.gasCity,
    formulaCompiler: input.compatibility.formulaCompiler,
  });
  validatePreview(preview, intendedGraph);

  const responseSchemas = buildResponseSchemas(model);
  const document = canonicalize({
    schemaVersion: VD_EXECUTION_BUNDLE_SCHEMA,
    compilerPolicy: input.compatibility.compilerPolicy,
    workflow: {
      designId: input.workflow.designId,
      version: input.workflow.version,
      definitionHash: hashCanonical(canonicalDefinition),
      definition: canonicalDefinition,
    },
    roles: [...input.roles].sort((a, b) => a.roleId.localeCompare(b.roleId)).map(canonicalRole),
    inputs: canonicalize(input.inputs),
    policies: {
      taskContext: canonicalize(input.taskContextPolicy),
      session: input.sessionPolicy,
      effects: { allowed: [...input.effects.allowed].sort(), closePolicy: input.effects.closePolicy },
      retry: input.retry,
      limits: input.limits,
    },
    compatibility: input.compatibility,
    capabilities: [...new Set(input.capabilities)].sort(),
    responseSchemas,
    formula: { requirement: input.compatibility.formulaCompiler, contents: formulaToml, intendedGraph },
  }) as Record<string, unknown>;
  const encoded = `${JSON.stringify(document)}\n`;
  return {
    schemaVersion: VD_EXECUTION_BUNDLE_SCHEMA,
    digest: sha256(encoded),
    bytes: new TextEncoder().encode(encoded),
    document: Object.freeze(document),
  };
}

function validateCompileInput(value: unknown): GasCityExecutionBundleCompileInput {
  exactObject(value, ["schemaVersion", "workflow", "roles", "inputs", "taskContextPolicy", "sessionPolicy", "effects", "retry", "limits", "compatibility", "capabilities"], "bundle input");
  const input = value as unknown as GasCityExecutionBundleCompileInput;
  if (input.schemaVersion !== "vd.execution-bundle.compile-input.v1") fail("Unsupported bundle compiler input version.");
  exactObject(input.workflow, ["designId", "version", "definition"], "workflow");
  requiredId(input.workflow.designId, "workflow design id");
  positiveInt(input.workflow.version, "workflow version", 1_000_000);
  if (!Array.isArray(input.roles)) fail("Resolved roles must be an array.");
  input.roles.forEach((role, index) => validateRole(role, index));
  exactObject(input.inputs, Object.keys(input.inputs ?? {}), "inputs");
  exactObject(input.taskContextPolicy, ["mode", "beadIds", "include"], "task context policy");
  if (input.taskContextPolicy.mode !== "latest_each_turn" || input.taskContextPolicy.include !== "minimal_summary" || !Array.isArray(input.taskContextPolicy.beadIds)) fail("Unsupported task context policy.");
  input.taskContextPolicy.beadIds.forEach((id) => requiredId(id, "bead id"));
  exactObject(input.sessionPolicy, ["mode", "incompatibleSession"], "session policy");
  if (input.sessionPolicy.mode !== "run_scoped_role_sessions" || !["reject", "replace"].includes(input.sessionPolicy.incompatibleSession)) fail("Unsupported session policy.");
  exactObject(input.effects, ["allowed", "closePolicy"], "effects policy");
  if (input.effects.closePolicy !== "manual" || !Array.isArray(input.effects.allowed) || input.effects.allowed.some((effect) => !["result_note", "caller_callback", "notification"].includes(effect))) fail("Unsupported workflow effect.");
  exactObject(input.retry, ["invalidResultAttempts", "abruptTurnNudges"], "retry policy");
  boundedInt(input.retry.invalidResultAttempts, "invalid result attempts", 0, 3);
  boundedInt(input.retry.abruptTurnNudges, "abrupt turn nudges", 0, 3);
  exactObject(input.limits, ["maxTurns", "maxPromptChars", "maxResultChars"], "limits");
  boundedInt(input.limits.maxTurns, "max turns", 1, 1_000);
  boundedInt(input.limits.maxPromptChars, "max prompt characters", 1, 1_000_000);
  boundedInt(input.limits.maxResultChars, "max result characters", 1, 1_000_000);
  exactObject(input.compatibility, ["compilerPolicy", "formulaCompiler", "gasCity", "beads", "bridge"], "compatibility");
  const expected = { compilerPolicy: VD_BUNDLE_COMPILER_POLICY, formulaCompiler: VD_FORMULA_COMPILER_REQUIREMENT, gasCity: VD_GAS_CITY_VERSION, beads: VD_BEADS_VERSION, bridge: VD_GC_SESSION_BRIDGE_VERSION };
  for (const [key, expectedValue] of Object.entries(expected)) if (input.compatibility[key as keyof typeof input.compatibility] !== expectedValue) fail(`Unsupported pinned ${key} compatibility.`);
  if (!Array.isArray(input.capabilities) || input.capabilities.some((capability) => !/^[a-z][a-z0-9_.-]{0,127}$/.test(capability))) fail("Capability manifest contains an unsupported capability.");
  return input;
}

function validateRole(role: ResolvedBundleRole, index: number): void {
  exactObject(role, ["roleId", "template", "promptAssets", "skillAssets", "baseInstructions", "executor", "model", "reasoningId", "preferenceSources"], `roles[${index}]`);
  requiredId(role.roleId, "role id");
  if (role.template !== null) {
    exactObject(role.template, ["id", "version", "contentHash"], "role template");
    requiredId(role.template.id, "role template id"); positiveInt(role.template.version, "role template version", 1_000_000); requiredHash(role.template.contentHash);
  }
  for (const [kind, assets] of [["prompt", role.promptAssets], ["skill", role.skillAssets]] as const) {
    if (!Array.isArray(assets)) fail(`${kind} assets must be an array.`);
    const seen = new Set<string>();
    assets.forEach((asset) => {
      exactObject(asset, ["id", "version", "content", "contentHash"], `${kind} asset`);
      requiredId(asset.id, `${kind} asset id`); positiveInt(asset.version, `${kind} asset version`, 1_000_000); requiredHash(asset.contentHash);
      if (sha256(asset.content) !== asset.contentHash) fail(`${kind} asset content hash does not match resolved content.`);
      const key = `${asset.id}@${asset.version}`; if (seen.has(key)) fail(`Duplicate ${kind} asset version.`); seen.add(key);
    });
  }
  if (typeof role.baseInstructions !== "string") fail("Role base instructions must be text.");
  exactObject(role.preferenceSources, ["executor", "model", "reasoningId"], "role preference sources");
  const sources = new Set(["launch_override", "team_role", "role_default", "workspace_default", "system_default", "unset"]);
  if (Object.values(role.preferenceSources).some((source) => !sources.has(source))) fail("Role preference provenance is unsupported.");
  if (role.executor === null && role.model !== null) fail("A model cannot be resolved without an executor.");
  if (role.executor === null && role.reasoningId !== null) fail("A reasoning level cannot be resolved without an executor.");
}

function validateGraph(model: NormalizedAgentWorkflowModel): void {
  const visiting = new Set<string>(); const visited = new Set<string>();
  const visit = (id: string) => {
    if (visiting.has(id)) fail("Workflow graph contains a cycle unsupported by formulas-v2.");
    if (visited.has(id)) return;
    visiting.add(id);
    const state = model.states[id];
    if (!state) fail("Workflow graph references a missing state.");
    if (!state.terminal) for (const action of Object.values(state.actions)) visit(action.targetState);
    visiting.delete(id); visited.add(id);
  };
  visit(model.initialState);
  if (visited.size !== Object.keys(model.states).length) fail("Workflow graph contains an unreachable state.");
  const formulaIds = new Set<string>();
  for (const state of Object.values(model.states)) if (!state.terminal) {
    const id = formulaNodeId(state.id); if (formulaIds.has(id)) fail("Workflow states collide after formula identifier normalization."); formulaIds.add(id);
    if (!model.roles[state.owner]) fail("Workflow state references a missing role.");
    if (state.steps.some((step) => !["agent_turn", "human_form", "workflow_call"].includes(step.type))) fail("Workflow contains a step unsupported by formulas-v2.");
  }
}

function validateInputs(model: NormalizedAgentWorkflowModel, values: Record<string, string | number | boolean>): void {
  if (!values || typeof values !== "object" || Array.isArray(values)) fail("Typed inputs must be an object.");
  for (const key of Object.keys(values)) if (!model.inputs[key]) fail(`Unknown workflow input: ${key}.`);
  for (const [key, spec] of Object.entries(model.inputs)) {
    const value = values[key];
    if (spec.required && value === undefined) fail(`Required workflow input is missing: ${key}.`);
    if (value !== undefined && typeof value !== (spec.type === "markdown" ? "string" : spec.type)) fail(`Workflow input has the wrong type: ${key}.`);
  }
}

function validateRoles(model: NormalizedAgentWorkflowModel, roles: ResolvedBundleRole[]): void {
  const ids = new Set<string>();
  for (const role of roles) { if (ids.has(role.roleId)) fail("Resolved roles contain a duplicate role."); ids.add(role.roleId); }
  const expected = Object.keys(model.roles).sort(); const actual = [...ids].sort();
  if (JSON.stringify(expected) !== JSON.stringify(actual)) fail("Resolved roles do not exactly match workflow roles.");
}

function buildIntendedGraph(model: NormalizedAgentWorkflowModel): GasCityCompiledPreview["nodes"] {
  const active = Object.values(model.states).filter((state) => !state.terminal);
  const order = new Map(active.map((state, index) => [state.id, index]));
  return active.map((state) => {
    const needs = active.filter((candidate) => Object.values(candidate.actions).some((action) => action.targetState === state.id) && (order.get(candidate.id) ?? 0) < (order.get(state.id) ?? 0)).map((candidate) => formulaNodeId(candidate.id)).sort();
    return { id: formulaNodeId(state.id), role: formulaRoleId(state.owner), needs };
  }).sort((a, b) => a.id.localeCompare(b.id));
}

function validatePreview(preview: GasCityCompiledPreview, intended: GasCityCompiledPreview["nodes"]): void {
  exactObject(preview, ["gasCityVersion", "formulaCompiler", "nodes"], "compiled preview");
  if (preview.gasCityVersion !== VD_GAS_CITY_VERSION || preview.formulaCompiler !== VD_FORMULA_COMPILER_REQUIREMENT) fail("Compiled preview did not use the pinned compatibility contract.");
  if (!Array.isArray(preview.nodes)) fail("Compiled preview nodes are unavailable.");
  preview.nodes.forEach((node) => {
    exactObject(node, ["id", "role", "needs"], "compiled preview node");
    requiredId(node.id, "compiled node id");
    requiredId(node.role, "compiled node role");
    if (!Array.isArray(node.needs) || node.needs.some((dependency) => typeof dependency !== "string")) fail("Compiled preview dependencies are invalid.");
  });
  const actual = preview.nodes.map((node) => ({ id: node.id, role: node.role, needs: [...node.needs].sort() })).sort((a, b) => a.id.localeCompare(b.id));
  if (JSON.stringify(actual) !== JSON.stringify(intended)) fail("Pinned Gas City compiled preview does not match the intended workflow graph.");
}

function buildResponseSchemas(model: NormalizedAgentWorkflowModel): Array<{ stateId: string; stepId: string; xsd: string }> {
  const result: Array<{ stateId: string; stepId: string; xsd: string }> = [];
  for (const state of Object.values(model.states).sort((a, b) => a.id.localeCompare(b.id))) {
    if (state.terminal) continue;
    for (const step of state.steps) if (step.type === "agent_turn" && step.turnType === "decision") {
      const snapshot = { currentState: state.id, currentStepIndex: 0, inputs: {}, history: [], createdAt: 0, updatedAt: 0, instanceId: "bundle", workflowId: model.workflowId, status: "running", visitId: "bundle" } satisfies WorkflowRuntimeSnapshot;
      const xsd = renderExpectedXmlResponseXsd(model, snapshot, step as AgentWorkflowStepV1);
      if (!xsd) fail("Decision step does not produce a response schema.");
      result.push({ stateId: state.id, stepId: step.id, xsd });
    }
  }
  return result;
}

function canonicalRole(role: ResolvedBundleRole): unknown {
  const asset = (value: ResolvedBundleRole["promptAssets"][number]) => ({ ...value });
  return { ...role, promptAssets: [...role.promptAssets].sort(assetOrder).map(asset), skillAssets: [...role.skillAssets].sort(assetOrder).map(asset) };
}
function assetOrder(a: { id: string; version: number }, b: { id: string; version: number }): number { return a.id.localeCompare(b.id) || a.version - b.version; }
function formulaNodeId(id: string): string { return `state-${slug(id).slice(0, 50) || "step"}`; }
function formulaRoleId(id: string): string { return slug(id).slice(0, 120) || "worker"; }
function slug(value: string): string { return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); }
function requiredId(value: unknown, label: string): asserts value is string { if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(value)) fail(`Invalid ${label}.`); }
function requiredHash(value: unknown): void { if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) fail("Content hash must be a SHA-256 digest."); }
function positiveInt(value: unknown, label: string, max: number): void { boundedInt(value, label, 1, max); }
function boundedInt(value: unknown, label: string, min: number, max: number): void { if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) fail(`${label} is outside supported bounds.`); }
function exactObject(value: unknown, keys: string[], label: string): asserts value is Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object.`); const allowed = new Set(keys); const unknown = Object.keys(value).filter((key) => !allowed.has(key)); if (unknown.length) fail(`${label} contains unsupported fields.`); }
function canonicalize(value: unknown): unknown { if (Array.isArray(value)) return value.map(canonicalize); if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonicalize(item)])); return value; }
function hashCanonical(value: unknown): string { return sha256(JSON.stringify(canonicalize(value))); }
function sha256(value: string): string { return createHash("sha256").update(value).digest("hex"); }
function fail(message: string): never { throw new GasCityExecutionBundleCompileError(message); }
