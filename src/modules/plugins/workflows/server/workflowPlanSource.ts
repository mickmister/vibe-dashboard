import { createHash } from "node:crypto";
import type { AgentWorkflowDefinitionV1 } from "@vibe-dashboard/workflow-core";
import type { DbWorkflowDesignStore } from "./workflowDesignStore";
import {
  VD_BEADS_VERSION, VD_BUNDLE_COMPILER_POLICY, VD_FORMULA_COMPILER_REQUIREMENT,
  VD_GAS_CITY_VERSION, VD_GC_SESSION_BRIDGE_VERSION,
  type GasCityExecutionBundleCompileInput, type ResolvedBundleRole,
} from "./gasCityExecutionBundleCompiler";
import type { WorkflowPlanRequest, WorkflowPlanSource } from "./workflowPlanLaunchService";

export interface WorkflowPlanTaskReader { getBeadsByIds(workspaceId: string, ids: string[]): Promise<Array<{ id: string; title: string; status?: string; updatedAt?: number; dependencies?: string[] }>>; }

export class DbWorkflowPlanSource implements WorkflowPlanSource {
  constructor(private readonly options: { designStore: DbWorkflowDesignStore; tasks: WorkflowPlanTaskReader; repositories: (workspaceId: string) => Promise<Array<{ id: string; name: string; targetRevision?: string }>> }) {}

  async resolve(request: WorkflowPlanRequest) {
    const design = await this.options.designStore.getDesign(request.designId);
    if (!design) throw new Error("Workflow was not found.");
    const version = await this.options.designStore.getVersion(request.designId, request.version ?? undefined);
    if (!version) throw new Error("A published workflow version is required.");
    const definition = version.resolvedDefinition;
    const roles: ResolvedBundleRole[] = [];
    for (const [roleId, role] of Object.entries(definition.roles)) {
      const binding = (request.roleBindings[roleId] ?? {}) as Record<string, unknown>;
      const template = role.templateRef ? await this.options.designStore.getRoleTemplate(role.templateRef.templateId, role.templateRef.version) : null;
      if (role.templateRef && !template) throw new Error("A linked role template is unavailable.");
      const roleAssetIds = new Set(version.resolvedPromptSnapshot.prompts.filter((prompt) => prompt.path.startsWith("states.") && stateOwnerForPath(definition, prompt.path) === roleId).flatMap((prompt) => prompt.assetRefs.map((ref) => `${ref.kind}:${ref.id}:${ref.version ?? "latest"}`)));
      const assets = version.resolvedPromptSnapshot.assets.filter((asset) => [...roleAssetIds].some((key) => key.startsWith(`${asset.kind}:${asset.id}:`)));
      const executor = stringOrNull(binding.executorType) ?? role.executorPreference?.executorType ?? null;
      const model = stringOrNull(binding.model) ?? role.executorPreference?.model ?? null;
      const reasoningId = stringOrNull(binding.reasoningId) ?? role.executorPreference?.reasoningId ?? null;
      roles.push({ roleId, template: template ? { id: template.roleTemplateId, version: template.version, content: template.promptMarkdown, contentHash: template.contentHash } : null,
        promptAssets: assets.filter((asset) => asset.kind === "prompt").map((asset) => ({ id: asset.id, version: asset.version, content: asset.bodyMarkdown, contentHash: asset.contentHash })), skillAssets: assets.filter((asset) => asset.kind === "skill").map((asset) => ({ id: asset.id, version: asset.version, content: asset.bodyMarkdown, contentHash: asset.contentHash })), baseInstructions: "",
        executor, model, reasoningId, preferenceSources: {
          executor: stringOrNull(binding.executorType) ? "launch_override" : role.executorPreference?.executorType ? "role_default" : "unset",
          model: stringOrNull(binding.model) ? "launch_override" : role.executorPreference?.model ? "role_default" : "unset",
          reasoningId: stringOrNull(binding.reasoningId) ? "launch_override" : role.executorPreference?.reasoningId ? "role_default" : "unset",
        } });
    }
    const taskRows = await this.options.tasks.getBeadsByIds(request.workspaceId, request.beadIds);
    const taskMap = new Map(taskRows.map((item) => [item.id, item]));
    const tasks = request.beadIds.map((id) => { const item = taskMap.get(id); if (!item) throw new Error("A selected task is unavailable."); return { id, title: item.title, structuralRevision: digest(item) }; });
    const repositories = (await this.options.repositories(request.workspaceId)).map((repo) => ({ id: repo.id, accessRevision: digest(repo), mode: "write" as const }));
    const compileInput: GasCityExecutionBundleCompileInput = {
      schemaVersion: "vd.execution-bundle.compile-input.v1", workflow: { designId: request.designId, version: version.version, definition }, roles,
      inputs: request.inputs as Record<string, string | number | boolean>, taskContextPolicy: { mode: "latest_each_turn", beadIds: request.beadIds, include: "minimal_summary" },
      sessionPolicy: { mode: "run_scoped_role_sessions", incompatibleSession: "reject" }, effects: { allowed: ["result_note", "caller_callback", "notification"], closePolicy: "manual" },
      retry: { invalidResultAttempts: 1, abruptTurnNudges: 2 }, limits: { maxTurns: 20, maxPromptChars: 100_000, maxResultChars: 50_000 },
      compatibility: { compilerPolicy: VD_BUNDLE_COMPILER_POLICY, formulaCompiler: VD_FORMULA_COMPILER_REQUIREMENT, gasCity: VD_GAS_CITY_VERSION, beads: VD_BEADS_VERSION, bridge: VD_GC_SESSION_BRIDGE_VERSION },
      capabilities: ["workflow.agent-turn", "workflow.action-result.xml", "workflow.result-note", "workflow.caller-callback", "workflow.notification", "workflow.task-context.latest"],
    };
    return { compileInput, workflowLabel: design.name, tasks, repositories, securityPolicyRevision: "vd.workflow-plan-security.v1" };
  }
}
function stateOwnerForPath(definition: AgentWorkflowDefinitionV1, path: string): string | null { const stateId = path.split(".")[1]; const state = stateId ? definition.states[stateId] : undefined; return state && !("terminal" in state) ? state.owner : null; }
function stringOrNull(value: unknown): string | null { return typeof value === "string" && value.trim() ? value.trim() : null; }
function digest(value: unknown): string { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
