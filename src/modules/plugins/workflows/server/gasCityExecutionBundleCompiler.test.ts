import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { AgentWorkflowDefinitionV1 } from "@vibe-dashboard/workflow-core";
import {
  compileGasCityExecutionBundle,
  VD_BEADS_VERSION,
  VD_BUNDLE_COMPILER_POLICY,
  VD_FORMULA_COMPILER_REQUIREMENT,
  VD_GAS_CITY_VERSION,
  VD_GC_SESSION_BRIDGE_VERSION,
  type GasCityExecutionBundleCompileInput,
  type GasCityFormulaPreviewProvider,
} from "./gasCityExecutionBundleCompiler";

const response = {
  format: "xml" as const,
  schema: { format: "xsd" as const, source: "state_actions" as const },
  invalidXmlRetry: { maxAttempts: 1, prompt: "engine_default_with_validation_errors" as const, onExhausted: "blocked" as const },
  storeRawXml: false,
  storeParsedFields: true,
  unknownFields: "reject_unless_allowed_by_result_contract" as const,
};

const definition: AgentWorkflowDefinitionV1 = {
  schemaVersion: 1,
  name: "Implementation review",
  inputs: { task: { type: "markdown", required: true } },
  roles: { dev: { label: "Developer" }, review: { label: "Reviewer" } },
  initialState: "build",
  states: {
    build: {
      owner: "dev",
      steps: [{ id: "implement", type: "agent_turn", turnType: "decision", prompt: { template: "Implement {{inputs.task}}" }, response }],
      actions: { ready: { targetState: "review", result: { fields: { summary: { type: "markdown" } }, required: ["summary"] } } },
    },
    review: {
      owner: "review",
      steps: [{ id: "review", type: "agent_turn", turnType: "decision", prompt: { template: "Review" }, response }],
      actions: { approved: { targetState: "done" } },
    },
    done: { terminal: true },
  },
};

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const prompt = "Review carefully.";

function input(): GasCityExecutionBundleCompileInput {
  return {
    schemaVersion: "vd.execution-bundle.compile-input.v1",
    workflow: { designId: "design.drt", version: 4, definition: structuredClone(definition) },
    roles: [
      {
        roleId: "review", template: null, promptAssets: [{ id: "review.prompt", version: 2, content: prompt, contentHash: hash(prompt) }], skillAssets: [], baseInstructions: "Return a decision.",
        executor: "CLAUDE_CODE", model: "claude-sonnet-4", reasoningId: "high", preferenceSources: { executor: "role_default", model: "role_default", reasoningId: "team_role" },
      },
      {
        roleId: "dev", template: { id: "developer", version: 3, contentHash: hash("template") }, promptAssets: [], skillAssets: [], baseInstructions: "Implement the task.",
        executor: "CODEX", model: "gpt-5-codex", reasoningId: "high", preferenceSources: { executor: "workspace_default", model: "system_default", reasoningId: "launch_override" },
      },
    ],
    inputs: { task: "Build it" },
    taskContextPolicy: { mode: "latest_each_turn", beadIds: ["bead-1"], include: "minimal_summary" },
    sessionPolicy: { mode: "run_scoped_role_sessions", incompatibleSession: "reject" },
    effects: { allowed: ["notification", "result_note", "caller_callback"], closePolicy: "manual" },
    retry: { invalidResultAttempts: 1, abruptTurnNudges: 2 },
    limits: { maxTurns: 20, maxPromptChars: 100_000, maxResultChars: 50_000 },
    compatibility: { compilerPolicy: VD_BUNDLE_COMPILER_POLICY, formulaCompiler: VD_FORMULA_COMPILER_REQUIREMENT, gasCity: VD_GAS_CITY_VERSION, beads: VD_BEADS_VERSION, bridge: VD_GC_SESSION_BRIDGE_VERSION },
    capabilities: ["workflow.action-result.xml", "workflow.callback"],
  };
}

function preview(overrides: Partial<{ gasCityVersion: string; formulaCompiler: string; nodes: Array<{ id: string; role: string; needs: string[] }> }> = {}): GasCityFormulaPreviewProvider {
  return {
    compileFormula: vi.fn(async () => ({
      gasCityVersion: VD_GAS_CITY_VERSION,
      formulaCompiler: VD_FORMULA_COMPILER_REQUIREMENT,
      nodes: [
        { id: "state-build", role: "dev", needs: [] },
        { id: "state-review", role: "review", needs: ["state-build"] },
      ],
      ...overrides,
    })),
  };
}

describe("compileGasCityExecutionBundle", () => {
  it("emits a deterministic immutable bundle with pinned assets, settings, XSD, policies, and formula compiler", async () => {
    const firstInput = input();
    const first = await compileGasCityExecutionBundle(firstInput, preview());
    const secondInput = input();
    secondInput.roles.reverse();
    secondInput.capabilities.reverse();
    secondInput.effects.allowed.reverse();
    const second = await compileGasCityExecutionBundle(secondInput, preview());

    expect(Buffer.from(first.bytes).toString()).toEqual(Buffer.from(second.bytes).toString());
    expect(first.digest).toEqual(second.digest);
    const text = Buffer.from(first.bytes).toString();
    expect(text).toContain('"schemaVersion":"vd.execution-bundle.v1"');
    expect(text).toContain('formula_compiler = \\\">=2.0.0\\\"');
    expect(text).toContain("<xs:schema");
    expect(text).toContain('"reasoningId":"high"');
    expect(text).toContain('"reasoningId":"team_role"');
    expect(text).not.toContain("graph.v2");
  });

  it("changes the digest for every sampled execution-relevant change", async () => {
    const baseline = await compileGasCityExecutionBundle(input(), preview());
    const variants = [
      (value: GasCityExecutionBundleCompileInput) => { value.inputs.task = "Different"; },
      (value: GasCityExecutionBundleCompileInput) => { value.roles[0]!.reasoningId = "xhigh"; },
      (value: GasCityExecutionBundleCompileInput) => { value.roles[0]!.promptAssets[0]!.content = "Changed"; value.roles[0]!.promptAssets[0]!.contentHash = hash("Changed"); },
      (value: GasCityExecutionBundleCompileInput) => { value.retry.abruptTurnNudges = 1; },
      (value: GasCityExecutionBundleCompileInput) => { value.capabilities.push("workflow.ask-user"); },
    ];
    for (const mutate of variants) {
      const value = input(); mutate(value);
      expect((await compileGasCityExecutionBundle(value, preview())).digest).not.toBe(baseline.digest);
    }
  });

  it("rejects unknown, inert, unsafe, unpinned, and inconsistent inputs", async () => {
    const cases: Array<[string, (value: any) => void]> = [
      ["unknown", (value) => { value.command = "run"; }],
      ["nested unknown", (value) => { value.sessionPolicy.cwd = "/tmp/private"; }],
      ["unpinned", (value) => { value.compatibility.gasCity = "edge"; }],
      ["hash", (value) => { value.roles[0].promptAssets[0].content = "tampered"; }],
      ["input", (value) => { value.inputs.extra = "ignored"; }],
      ["bounds", (value) => { value.limits.maxTurns = 0; }],
      ["capability", (value) => { value.capabilities.push("raw shell"); }],
    ];
    for (const [, mutate] of cases) {
      const value: any = input(); mutate(value);
      await expect(compileGasCityExecutionBundle(value, preview())).rejects.toThrow();
    }
  });

  it("rejects cyclic and unreachable workflow graphs", async () => {
    const cyclic = input();
    (cyclic.workflow.definition as AgentWorkflowDefinitionV1).states.review = { ...(cyclic.workflow.definition as AgentWorkflowDefinitionV1).states.review as any, actions: { revise: { targetState: "build" } } };
    await expect(compileGasCityExecutionBundle(cyclic, preview())).rejects.toThrow(/cycle/i);

    const unreachable = input();
    (unreachable.workflow.definition as AgentWorkflowDefinitionV1).states.orphan = { terminal: true };
    await expect(compileGasCityExecutionBundle(unreachable, preview())).rejects.toThrow(/unreachable/i);
  });

  it("fails closed when the pinned compiled preview differs or reports another compatibility", async () => {
    await expect(compileGasCityExecutionBundle(input(), preview({ nodes: [{ id: "state-build", role: "dev", needs: [] }] }))).rejects.toThrow(/does not match/i);
    await expect(compileGasCityExecutionBundle(input(), preview({ gasCityVersion: "1.5.0" }))).rejects.toThrow(/pinned compatibility/i);
  });

  it("has a stable golden digest for the supported formulas-v2 fixture", async () => {
    const bundle = await compileGasCityExecutionBundle(input(), preview());
    expect(bundle.digest).toBe("336b529f6caf62577e8530543f6855f6597d50fe8ff578597cde8d01b2754f8d");
    expect(Buffer.from(bundle.bytes).toString().endsWith("\n")).toBe(true);
  });
});
