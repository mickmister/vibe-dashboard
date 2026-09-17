import { createHash } from "node:crypto";
import {
  normalizeWorkflowDefinitionV1,
  type AgentWorkflowDefinitionV1,
  type NormalizedAgentWorkflowModel,
  type NormalizedWorkflowState,
  type WorkflowInputSpec,
} from "@vibe-dashboard/workflow-core";
import { sanitizeGasCityProviderText, type GasCityOpaqueMetadata } from "./gasCityWorkflowProvider";

export interface GasCityPackGenerationInput {
  designId: string;
  designVersion: number;
  definition: AgentWorkflowDefinitionV1 | unknown;
  generatedAt?: number;
  packName?: string;
}

export interface GeneratedGasCityPack {
  packId: string;
  packName: string;
  source: {
    designId: string;
    designVersion: number;
    workflowName: string;
    definitionHash: string;
  };
  formula: GeneratedGasCityFormula;
  files: GeneratedGasCityPackFile[];
  readModel: GeneratedGasCityPackReadModel;
}

export interface GeneratedGasCityFormula {
  name: string;
  fileName: string;
  contract: "graph.v2";
  title: string;
  description: string;
  stepCount: number;
  metadata: GasCityOpaqueMetadata;
}

export interface GeneratedGasCityPackFile {
  relativePath: string;
  kind: "pack.toml" | "formula.toml";
  contents: string;
}

export interface GeneratedGasCityPackReadModel {
  packId: string;
  packName: string;
  formulaName: string;
  formulaFile: string;
  sourceWorkflow: {
    designId: string;
    designVersion: number;
    name: string;
  };
  summary: string;
  warnings: string[];
}

export interface GeneratedGasCityRuntimePlan {
  runtimeRoot: string;
  packRoot: string;
  files: Array<GeneratedGasCityPackFile & { absolutePath: string }>;
}

export function generateGasCityPackFromWorkflow(input: GasCityPackGenerationInput): GeneratedGasCityPack {
  const designId = cleanRequired(input.designId, "designId");
  const designVersion = input.designVersion;
  if (!Number.isInteger(designVersion) || designVersion < 1) {
    throw new Error("designVersion must be a positive integer");
  }
  const model = normalizeWorkflowDefinitionV1(input.definition, { workflowId: designId });
  const definitionHash = hashStableJson(input.definition);
  const formulaName = gasCityFormulaName(designId, designVersion, model.name);
  const packId = `vd-workflows-${shortHash(`${designId}:${designVersion}:${definitionHash}`)}`;
  const packName = sanitizeTomlText(input.packName ?? `VD Workflows ${designId} v${designVersion}`, "VD Workflows generated pack");
  const formula = renderGraphV2Formula({ model, designId, designVersion, definitionHash, formulaName });
  const packToml = renderPackToml(packName, input.generatedAt);
  const files: GeneratedGasCityPackFile[] = [
    { relativePath: "pack.toml", kind: "pack.toml", contents: packToml },
    { relativePath: `formulas/${formula.fileName}`, kind: "formula.toml", contents: formula.contents },
  ];
  const readModel = sanitizeGeneratedGasCityPackReadModel({
    packId,
    packName,
    formulaName: formula.name,
    formulaFile: `formulas/${formula.fileName}`,
    sourceWorkflow: {
      designId,
      designVersion,
      name: model.name,
    },
    summary: `Generated graph.v2 formula ${formula.name} from ${model.name}.`,
    warnings: formula.warnings,
  });
  return {
    packId,
    packName,
    source: {
      designId,
      designVersion,
      workflowName: model.name,
      definitionHash,
    },
    formula: {
      name: formula.name,
      fileName: formula.fileName,
      contract: "graph.v2",
      title: formula.title,
      description: formula.description,
      stepCount: formula.stepCount,
      metadata: formula.metadata,
    },
    files,
    readModel,
  };
}

export function buildGeneratedGasCityRuntimePlan(input: {
  runtimeRoot: string;
  pack: GeneratedGasCityPack;
}): GeneratedGasCityRuntimePlan {
  const runtimeRoot = normalizeRuntimeRoot(input.runtimeRoot);
  const packRoot = joinPath(runtimeRoot, "gas-city/generated-packs", input.pack.packId);
  return {
    runtimeRoot,
    packRoot,
    files: input.pack.files.map((file) => ({
      ...file,
      absolutePath: joinPath(packRoot, file.relativePath),
    })),
  };
}

export function sanitizeGeneratedGasCityPackReadModel(model: GeneratedGasCityPackReadModel): GeneratedGasCityPackReadModel {
  return {
    packId: sanitizeIdentifier(model.packId, "pack"),
    packName: sanitizeGasCityProviderText(model.packName, "Generated workflow pack"),
    formulaName: sanitizeIdentifier(model.formulaName, "workflow-formula"),
    formulaFile: sanitizeRelativePath(model.formulaFile),
    sourceWorkflow: {
      designId: sanitizeIdentifier(model.sourceWorkflow.designId, "workflow-design"),
      designVersion: model.sourceWorkflow.designVersion,
      name: sanitizeGasCityProviderText(model.sourceWorkflow.name, "Workflow"),
    },
    summary: sanitizeGasCityProviderText(model.summary, "Generated workflow pack is ready."),
    warnings: model.warnings.map((warning) => sanitizeGasCityProviderText(warning, "Generated pack warning.")),
  };
}

type RenderedFormula = {
  name: string;
  fileName: string;
  title: string;
  description: string;
  contents: string;
  stepCount: number;
  warnings: string[];
  metadata: GasCityOpaqueMetadata;
};

function renderGraphV2Formula(input: {
  model: NormalizedAgentWorkflowModel;
  designId: string;
  designVersion: number;
  definitionHash: string;
  formulaName: string;
}): RenderedFormula {
  const { model, designId, designVersion, definitionHash, formulaName } = input;
  const activeStates = Object.values(model.states).filter(isActiveState);
  const stateOrder = orderStatesForFormula(model, activeStates);
  const warnings: string[] = [];
  if (stateOrder.length === 0) {
    warnings.push("Workflow has no active states to include in the generated formula.");
  }

  const lines: string[] = [
    "# Generated by Vibe Dashboard Workflows for Gas City. Do not edit by hand.",
    `formula = ${tomlString(formulaName)}`,
    `description = ${tomlString(sanitizeTomlText(model.description ?? model.name, "Generated VD workflow formula"))}`,
    "",
    "[requires]",
    `formula_compiler = ${tomlString(">=2.0.0")}`,
    "",
    "[catalog]",
    `name = ${tomlString(sanitizeTomlText(model.name, "VD workflow"))}`,
    `description = ${tomlString(sanitizeTomlText(model.description ?? "Generated from a VD workflow definition.", "Generated from a VD workflow definition."))}`,
  ];

  const inputs = Object.entries(model.inputs).sort(([left], [right]) => left.localeCompare(right));
  if (inputs.length > 0) {
    lines.push("", "[vars]");
    for (const [inputId, spec] of inputs) {
      lines.push(...renderVar(inputId, spec));
    }
  }

  const predecessorByState = inferFormulaPredecessors(model, stateOrder);
  for (const state of stateOrder) {
    const role = model.roles[state.owner];
    const stepId = gasCityStepId(state.id);
    const title = sanitizeTomlText(stateLabel(state), stepId);
    const description = stateDescription(model, state);
    const needs = predecessorByState.get(state.id) ?? [];
    lines.push(
      "",
      "[[steps]]",
      `id = ${tomlString(stepId)}`,
      `title = ${tomlString(title)}`,
      `description = ${tomlString(description)}`,
      `assignee = ${tomlString(sanitizeIdentifier(state.owner, "worker"))}`,
    );
    if (needs.length > 0) {
      lines.push(`needs = [${needs.map((need) => tomlString(gasCityStepId(need))).join(", ")}]`);
    }
    lines.push(
      "[steps.metadata]",
      `vd_workflow_design_id = ${tomlString(sanitizeTomlText(designId, "workflow-design"))}`,
      `vd_workflow_design_version = ${tomlString(String(designVersion))}`,
      `vd_workflow_definition_hash = ${tomlString(definitionHash)}`,
      `vd_workflow_state_id = ${tomlString(sanitizeTomlText(state.id, stepId))}`,
      `vd_workflow_role_id = ${tomlString(sanitizeTomlText(state.owner, "worker"))}`,
      `vd_workflow_role_label = ${tomlString(sanitizeTomlText(role?.label ?? state.owner, state.owner))}`,
      `vd_workflow_actions = ${tomlString(JSON.stringify(actionMetadata(state)))}`,
    );
  }

  return {
    name: formulaName,
    fileName: `${formulaName}.toml`,
    title: sanitizeGasCityProviderText(model.name, "VD workflow"),
    description: sanitizeGasCityProviderText(model.description ?? model.name, "Generated VD workflow formula"),
    contents: `${lines.join("\n")}\n`,
    stepCount: stateOrder.length,
    warnings,
    metadata: {
      designId,
      designVersion,
      definitionHash,
    },
  };
}

function renderPackToml(packName: string, generatedAt?: number): string {
  const lines = [
    "# Generated by Vibe Dashboard Workflows for Gas City. Do not edit by hand.",
    "[pack]",
    `name = ${tomlString(packName)}`,
    "schema = 2",
  ];
  if (typeof generatedAt === "number" && Number.isFinite(generatedAt)) {
    lines.push("", "[metadata]", `generated_at = ${tomlString(new Date(generatedAt).toISOString())}`);
  }
  return `${lines.join("\n")}\n`;
}

function renderVar(inputId: string, spec: WorkflowInputSpec): string[] {
  const key = tomlKey(inputId);
  const lines = [`[vars.${key}]`];
  const description = sanitizeTomlText(spec.description ?? `${inputId} input`, `${inputId} input`);
  lines.push(`description = ${tomlString(description)}`);
  if (spec.required) lines.push("required = true");
  lines.push(`type = ${tomlString(spec.type)}`);
  return lines;
}

function orderStatesForFormula(model: NormalizedAgentWorkflowModel, activeStates: Extract<NormalizedWorkflowState, { terminal: false }>[]): Extract<NormalizedWorkflowState, { terminal: false }>[] {
  const byId = new Map(activeStates.map((state) => [state.id, state]));
  const visited = new Set<string>();
  const ordered: Extract<NormalizedWorkflowState, { terminal: false }>[] = [];
  const visit = (stateId: string) => {
    if (visited.has(stateId)) return;
    visited.add(stateId);
    const state = byId.get(stateId);
    if (!state) return;
    ordered.push(state);
    for (const action of Object.values(state.actions).sort((left, right) => left.id.localeCompare(right.id))) {
      const target = byId.get(action.targetState);
      if (target) visit(target.id);
    }
  };
  visit(model.initialState);
  for (const state of activeStates.sort((left, right) => left.id.localeCompare(right.id))) visit(state.id);
  return ordered;
}

function inferFormulaPredecessors(model: NormalizedAgentWorkflowModel, orderedStates: Extract<NormalizedWorkflowState, { terminal: false }>[]): Map<string, string[]> {
  const indexByState = new Map(orderedStates.map((state, index) => [state.id, index]));
  const predecessors = new Map<string, Set<string>>();
  for (const state of orderedStates) {
    const stateIndex = indexByState.get(state.id) ?? 0;
    for (const action of Object.values(state.actions)) {
      const targetIndex = indexByState.get(action.targetState);
      if (targetIndex === undefined || targetIndex <= stateIndex) continue;
      const existing = predecessors.get(action.targetState) ?? new Set<string>();
      existing.add(state.id);
      predecessors.set(action.targetState, existing);
    }
  }
  return new Map([...predecessors.entries()].map(([stateId, values]) => [stateId, [...values].sort()]));
}

function stateDescription(model: NormalizedAgentWorkflowModel, state: Extract<NormalizedWorkflowState, { terminal: false }>): string {
  const role = model.roles[state.owner];
  const stepLabels = state.steps.map((step) => labelFromId(step.id)).join(", ") || "workflow step";
  const actionLabels = Object.values(state.actions).map((action) => action.label ?? labelFromId(action.id)).join(", ") || "continue";
  return sanitizeTomlText([
    role?.description ?? `${role?.label ?? state.owner} works this stage.`,
    `VD workflow state: ${stateLabel(state)}.`,
    `Steps: ${stepLabels}.`,
    `Decisions: ${actionLabels}.`,
  ].join("\n\n"), "Workflow stage generated from VD.");
}

function actionMetadata(state: Extract<NormalizedWorkflowState, { terminal: false }>): Array<{ id: string; label: string; targetState: string }> {
  return Object.values(state.actions)
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((action) => ({
      id: sanitizeTomlText(action.id, "action"),
      label: sanitizeTomlText(action.label ?? labelFromId(action.id), action.id),
      targetState: sanitizeTomlText(action.targetState, "done"),
    }));
}

function stateLabel(state: Extract<NormalizedWorkflowState, { terminal: false }>): string {
  return labelFromId(state.id);
}

function isActiveState(state: NormalizedWorkflowState): state is Extract<NormalizedWorkflowState, { terminal: false }> {
  return state.terminal === false;
}

function gasCityFormulaName(designId: string, version: number, workflowName: string): string {
  const base = slug(`${workflowName}-${designId}`).slice(0, 48) || "workflow";
  return `vd-${base}-v${version}-${shortHash(`${designId}:${version}`)}`;
}

function gasCityStepId(stateId: string): string {
  return `state-${slug(stateId).slice(0, 50) || "step"}`;
}

function sanitizeIdentifier(value: string, fallback: string): string {
  return slug(value).slice(0, 120) || fallback;
}

function sanitizeRelativePath(path: string): string {
  const safe = path.split("/").map((part) => sanitizeIdentifier(part.replace(/\.toml$/u, ""), "file")).join("/");
  return safe.endsWith(".toml") ? safe : `${safe}.toml`;
}

function sanitizeTomlText(value: string, fallback: string): string {
  return sanitizeGasCityProviderText(value, fallback).replace(/\u0000/g, "");
}

function cleanRequired(value: string, field: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${field} is required`);
  return trimmed;
}

function normalizeRuntimeRoot(root: string): string {
  const trimmed = root.trim();
  if (!trimmed) throw new Error("runtimeRoot is required");
  if (/\bgascity\b(?:\/|$)/i.test(trimmed) || /\/\.git(?:\/|$)/i.test(trimmed)) {
    throw new Error("Generated Gas City packs must use a VD runtime/generated path, not a source checkout.");
  }
  return trimmed.replace(/\/+$/u, "");
}

function joinPath(...parts: string[]): string {
  return parts.map((part, index) => index === 0 ? part.replace(/\/+$/u, "") : part.replace(/^\/+|\/+$/gu, "")).filter(Boolean).join("/");
}

function tomlString(value: string): string {
  return JSON.stringify(value);
}

function tomlKey(value: string): string {
  const trimmed = value.trim();
  if (/^[A-Za-z_][A-Za-z0-9_-]*$/u.test(trimmed)) return trimmed;
  return tomlString(trimmed);
}

function slug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .replace(/-{2,}/gu, "-");
}

function labelFromId(value: string): string {
  const spaced = value.replace(/[_-]+/gu, " ").trim();
  return spaced ? spaced.replace(/\b\w/g, (char) => char.toUpperCase()) : value;
}

function hashStableJson(value: unknown): string {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function shortHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 10);
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
