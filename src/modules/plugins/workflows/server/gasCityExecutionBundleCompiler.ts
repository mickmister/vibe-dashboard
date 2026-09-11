import { createHash } from "node:crypto";
import {
  normalizeWorkflowDefinitionV1,
  renderExpectedXmlResponseXsd,
  WORKFLOW_EXECUTOR_MODEL_OPTIONS,
  WORKFLOW_EXECUTOR_REASONING_OPTIONS,
  WORKFLOW_EXECUTOR_TYPES,
  type AgentWorkflowDefinitionV1,
  type AgentWorkflowStepV1,
  type NormalizedAgentWorkflowModel,
  type WorkflowRuntimeSnapshot,
} from "@vibe-dashboard/workflow-core";
import { generateGasCityPackFromWorkflow } from "./gasCityPackGenerator";
import {
  isVerifiedPinnedGasCityAdapter,
  type PinnedGasCityFormulaCompilerAdapter,
} from "./pinnedGasCityFormulaCompilerAdapter";

export const VD_EXECUTION_BUNDLE_SCHEMA = "vd.execution-bundle.v1" as const;
export const VD_FORMULA_COMPILER_REQUIREMENT = ">=2.0.0" as const;
export const VD_GAS_CITY_VERSION = "1.4.1" as const;
export const VD_BEADS_VERSION = "1.2.2" as const;
export const VD_GC_SESSION_BRIDGE_VERSION = "vd-gc-session-vibe.v1" as const;
export const VD_BUNDLE_COMPILER_POLICY = "vd.formulas-v2.strict.v1" as const;
const COMPILER_CAPABILITIES = new Set([
  "workflow.agent-turn",
  "workflow.action-result.xml",
  "workflow.result-note",
  "workflow.caller-callback",
  "workflow.notification",
  "workflow.task-context.latest",
]);

type PreferenceSource = "launch_override" | "team_role" | "role_default" | "workspace_default" | "system_default" | "unset";

export interface ResolvedBundleRole {
  roleId: string;
  template: null | { id: string; version: number; content: string; contentHash: string };
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

export interface CompiledGasCityExecutionBundle {
  schemaVersion: typeof VD_EXECUTION_BUNDLE_SCHEMA;
  digest: string;
  bytes: Uint8Array;
  document: Readonly<Record<string, unknown>>;
  verificationEvidence: Readonly<{
    formulaSha256: string;
    rawCompilerOutputSha256: string;
    canonicalCompilerOutputSha256: string;
    attestationSha256: string;
  }>;
}

export class GasCityExecutionBundleCompileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GasCityExecutionBundleCompileError";
  }
}

export async function compileGasCityExecutionBundle(
  rawInput: GasCityExecutionBundleCompileInput | unknown,
  previewProvider: PinnedGasCityFormulaCompilerAdapter,
): Promise<CompiledGasCityExecutionBundle> {
  const input = validateCompileInput(rawInput);
  const model = normalizeWorkflowDefinitionV1(input.workflow.definition, { workflowId: input.workflow.designId });
  validateGraph(model);
  validateInputs(model, input.inputs);
  validateRoles(model, input.roles);
  validateCapabilities(model, input);

  const canonicalDefinition = canonicalize(input.workflow.definition) as AgentWorkflowDefinitionV1;
  const intendedGraph = buildIntendedGraph(model);
  const responseSchemas = buildResponseSchemas(model);
  const semanticArtifact = canonicalize({
    workflow: { designId: input.workflow.designId, version: input.workflow.version, definition: canonicalDefinition },
    graph: intendedGraph,
    roles: [...input.roles].sort((a, b) => a.roleId.localeCompare(b.roleId)).map(canonicalRole),
    inputs: canonicalize(input.inputs),
    policies: {
      taskContext: { ...input.taskContextPolicy, beadIds: [...input.taskContextPolicy.beadIds].sort() },
      session: input.sessionPolicy,
      effects: { allowed: [...input.effects.allowed].sort(), closePolicy: input.effects.closePolicy },
      retry: input.retry,
      limits: input.limits,
    },
    capabilities: [...input.capabilities].sort(),
    responseSchemas,
    compatibility: input.compatibility,
  });
  const semanticArtifactText = JSON.stringify(semanticArtifact);
  const pack = generateGasCityPackFromWorkflow({ designId: input.workflow.designId, designVersion: input.workflow.version, definition: canonicalDefinition });
  const generatedFormula = pack.files.find((file) => file.kind === "formula.toml")?.contents;
  if (!generatedFormula || !generatedFormula.includes(`[requires]\nformula_compiler = "${VD_FORMULA_COMPILER_REQUIREMENT}"`)) fail("Generated formula does not declare the pinned formula compiler requirement.");
  const formulaToml = embedExecutionSemantics(generatedFormula, semanticArtifactText);
  if (!isVerifiedPinnedGasCityAdapter(previewProvider)) fail("A verified packaged Gas City compiler adapter is required.");
  let preview: Awaited<ReturnType<PinnedGasCityFormulaCompilerAdapter["compileFormula"]>>;
  try {
    preview = await previewProvider.compileFormula(new TextEncoder().encode(formulaToml));
  } catch {
    fail("Pinned Gas City compiler validation failed.");
  }
  validatePreview(preview, formulaToml, semanticArtifact, intendedGraph, model);

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
      taskContext: { ...input.taskContextPolicy, beadIds: [...input.taskContextPolicy.beadIds].sort() },
      session: input.sessionPolicy,
      effects: { allowed: [...input.effects.allowed].sort(), closePolicy: input.effects.closePolicy },
      retry: input.retry,
      limits: input.limits,
    },
    compatibility: {
      ...input.compatibility,
      pinnedCompiler: preview.policy,
      compilerCanonicalOutputSha256: preview.canonicalOutputSha256,
    },
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
    verificationEvidence: Object.freeze({
      formulaSha256: preview.formulaSha256,
      rawCompilerOutputSha256: preview.rawOutputSha256,
      canonicalCompilerOutputSha256: preview.canonicalOutputSha256,
      attestationSha256: hashCanonical({
        formulaSha256: preview.formulaSha256,
        rawCompilerOutputSha256: preview.rawOutputSha256,
        canonicalCompilerOutputSha256: preview.canonicalOutputSha256,
        policy: preview.policy,
      }),
    }),
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
  if (!Array.isArray(input.capabilities) || input.capabilities.some((capability) => !COMPILER_CAPABILITIES.has(capability))) fail("Capability manifest contains an unsupported capability.");
  if (new Set(input.capabilities).size !== input.capabilities.length) fail("Capability manifest contains a duplicate capability.");
  return input;
}

function validateRole(role: ResolvedBundleRole, index: number): void {
  exactObject(role, ["roleId", "template", "promptAssets", "skillAssets", "baseInstructions", "executor", "model", "reasoningId", "preferenceSources"], `roles[${index}]`);
  requiredId(role.roleId, "role id");
  if (role.template !== null) {
    exactObject(role.template, ["id", "version", "content", "contentHash"], "role template");
    requiredId(role.template.id, "role template id"); positiveInt(role.template.version, "role template version", 1_000_000); requiredHash(role.template.contentHash);
    if (typeof role.template.content !== "string" || sha256(role.template.content) !== role.template.contentHash) fail("Role template content hash does not match resolved content.");
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
  for (const [field, value, source] of [
    ["executor", role.executor, role.preferenceSources.executor],
    ["model", role.model, role.preferenceSources.model],
    ["reasoning", role.reasoningId, role.preferenceSources.reasoningId],
  ] as const) {
    if (value === null && source !== "unset") fail(`Null ${field} preference must have unset provenance.`);
    if (value !== null && source === "unset") fail(`Resolved ${field} preference cannot have unset provenance.`);
  }
  if (role.executor !== null) {
    if (!WORKFLOW_EXECUTOR_TYPES.includes(role.executor as never)) fail("Resolved executor is unsupported.");
    const executor = role.executor as keyof typeof WORKFLOW_EXECUTOR_MODEL_OPTIONS;
    if (role.model !== null && !WORKFLOW_EXECUTOR_MODEL_OPTIONS[executor].models.includes(role.model)) fail("Resolved model is unsupported for the executor.");
    if (role.reasoningId !== null && !WORKFLOW_EXECUTOR_REASONING_OPTIONS[executor].includes(role.reasoningId)) fail("Resolved reasoning level is unsupported for the executor.");
  }
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
    if (state.steps.length !== 1 || state.steps[0]?.type !== "agent_turn") fail("The strict formulas-v2 subset requires exactly one agent turn per active state.");
    if (Object.keys(state.actions).length !== 1) fail("Conditional or branching workflow actions are unsupported by the strict formulas-v2 subset.");
  }
}

function validateCapabilities(model: NormalizedAgentWorkflowModel, input: GasCityExecutionBundleCompileInput): void {
  const required = new Set<string>(["workflow.agent-turn"]);
  if (Object.values(model.states).some((state) => !state.terminal && state.steps[0]?.type === "agent_turn" && state.steps[0].turnType === "decision")) required.add("workflow.action-result.xml");
  if (input.taskContextPolicy.beadIds.length) required.add("workflow.task-context.latest");
  for (const effect of input.effects.allowed) required.add(`workflow.${effect.replaceAll("_", "-")}`);
  const actual = new Set(input.capabilities);
  if (required.size !== actual.size || [...required].some((value) => !actual.has(value))) fail("Capability manifest must exactly match compiled workflow behavior.");
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

type IntendedNode = {
  id: string;
  stateId: string;
  role: string;
  needs: string[];
  step: unknown;
  route: unknown;
};

function buildIntendedGraph(model: NormalizedAgentWorkflowModel): IntendedNode[] {
  const nodes: IntendedNode[] = [];
  let stateId = model.initialState;
  let predecessor: string | null = null;
  const seen = new Set<string>();
  while (true) {
    const state = model.states[stateId];
    if (!state) fail("Workflow graph references a missing state.");
    if (state.terminal) break;
    if (seen.has(stateId)) fail("Workflow graph contains a cycle unsupported by formulas-v2.");
    seen.add(stateId);
    const action = Object.values(state.actions)[0]!;
    const nodeId = formulaNodeId(state.id);
    nodes.push({
      id: nodeId,
      stateId: state.id,
      role: formulaRoleId(state.owner),
      needs: predecessor ? [predecessor] : [],
      step: canonicalize(state.steps[0]),
      route: canonicalize(action),
    });
    predecessor = nodeId;
    stateId = action.targetState;
  }
  return nodes;
}

function validatePreview(
  preview: Awaited<ReturnType<PinnedGasCityFormulaCompilerAdapter["compileFormula"]>>,
  formulaToml: string,
  semanticArtifact: unknown,
  intendedGraph: IntendedNode[],
  model: NormalizedAgentWorkflowModel,
): void {
  if (preview.formulaSha256 !== sha256(formulaToml)) fail("Pinned compiler preview is not bound to the exact emitted formula bytes.");
  if (JSON.stringify(canonicalize(preview.canonicalOutput.semantics)) !== JSON.stringify(semanticArtifact)) fail("Pinned Gas City output does not preserve the complete execution semantics.");
  const expectedNodes = intendedGraph.map(({ id, stateId, role, needs, route }) => {
    const action = route as { id: string; label?: string; targetState: string };
    return { id, role, needs, type: "task", stateId, roleId: (model.states[stateId] as { owner: string }).owner, actions: [{ id: action.id, label: action.label ?? labelFromId(action.id), targetState: action.targetState }] };
  }).sort((a, b) => a.id.localeCompare(b.id));
  if (JSON.stringify(canonicalize(preview.canonicalOutput.nodes)) !== JSON.stringify(canonicalize(expectedNodes))) fail("Pinned Gas City output graph differs from VD intent.");
  const expectedVars = Object.entries(model.inputs).map(([name, spec]) => ({ name, type: spec.type, required: spec.required === true })).sort((a, b) => a.name.localeCompare(b.name));
  if (JSON.stringify(canonicalize(preview.canonicalOutput.vars)) !== JSON.stringify(canonicalize(expectedVars))) fail("Pinned Gas City output inputs differ from VD intent.");
}

function embedExecutionSemantics(formulaToml: string, semanticArtifact: string): string {
  const marker = "\n[requires]\n";
  if (!formulaToml.includes(marker)) fail("Generated formula is missing its compiler requirement.");
  return formulaToml.replace(marker, `\n[metadata]\nvd_execution_semantics = ${JSON.stringify(semanticArtifact)}\n${marker}`);
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
function labelFromId(value: string): string { return value.split(/[-_.]+/u).filter(Boolean).map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`).join(" ") || value; }
function requiredId(value: unknown, label: string): asserts value is string { if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(value)) fail(`Invalid ${label}.`); }
function requiredHash(value: unknown): void { if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) fail("Content hash must be a SHA-256 digest."); }
function positiveInt(value: unknown, label: string, max: number): void { boundedInt(value, label, 1, max); }
function boundedInt(value: unknown, label: string, min: number, max: number): void { if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) fail(`${label} is outside supported bounds.`); }
function exactObject(value: unknown, keys: string[], label: string): asserts value is Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object.`); const allowed = new Set(keys); const unknown = Object.keys(value).filter((key) => !allowed.has(key)); if (unknown.length) fail(`${label} contains unsupported fields.`); }
function canonicalize(value: unknown): unknown { if (Array.isArray(value)) return value.map(canonicalize); if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonicalize(item)])); return value; }
function hashCanonical(value: unknown): string { return sha256(JSON.stringify(canonicalize(value))); }
function sha256(value: string): string { return createHash("sha256").update(value).digest("hex"); }
function fail(message: string): never { throw new GasCityExecutionBundleCompileError(message); }
