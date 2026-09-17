import { describe, expect, it } from "vitest";
import type { AgentWorkflowDefinitionV1 } from "@vibe-dashboard/workflow-core";
import {
  buildGeneratedGasCityRuntimePlan,
  generateGasCityPackFromWorkflow,
  sanitizeGeneratedGasCityPackReadModel,
} from "./gasCityPackGenerator";

const simpleWorkflow: AgentWorkflowDefinitionV1 = {
  schemaVersion: 1,
  name: "Feature Review Workflow",
  description: "Implement and review a feature.",
  inputs: {
    featureRequest: { type: "markdown", required: true, description: "Feature request or task." },
  },
  roles: {
    dev: { label: "Dev", description: "Implements the requested change." },
    review: { label: "Review", description: "Reviews the work." },
  },
  initialState: "dev",
  states: {
    dev: {
      owner: "dev",
      steps: [
        { id: "implement", type: "agent_turn", turnType: "non_decision", prompt: { template: "Implement {{inputs.featureRequest}}" } },
        { id: "decide", type: "agent_turn", turnType: "decision", prompt: { template: "Decide if implementation is ready" }, response: decisionResponsePolicy() },
      ],
      actions: { ready: { label: "Ready for review", targetState: "review" } },
    },
    review: {
      owner: "review",
      steps: [{ id: "review", type: "agent_turn", turnType: "decision", prompt: { template: "Review the work" }, response: decisionResponsePolicy() }],
      actions: {
        approved: { label: "Approved", targetState: "done" },
        changes_requested: { label: "Request changes", targetState: "dev" },
      },
    },
    done: { terminal: true },
  },
};

function decisionResponsePolicy() {
  return {
    format: "xml" as const,
    schema: { format: "xsd" as const, source: "state_actions" as const },
    invalidXmlRetry: { maxAttempts: 1, prompt: "engine_default_with_validation_errors" as const, onExhausted: "blocked" as const },
    storeRawXml: true,
    storeParsedFields: true,
    unknownFields: "reject_unless_allowed_by_result_contract" as const,
  };
}

describe("generateGasCityPackFromWorkflow GCW-4", () => {
  it("renders a released graph.v2-compatible pack and formula from a VD workflow", () => {
    const pack = generateGasCityPackFromWorkflow({
      designId: "design.drt",
      designVersion: 3,
      definition: simpleWorkflow,
      generatedAt: Date.UTC(2026, 8, 1, 12),
    });

    expect(pack.packId).toMatch(/^vd-workflows-[a-f0-9]{10}$/);
    expect(pack.formula).toMatchObject({ contract: "graph.v2", stepCount: 2 });
    expect(pack.files.map((file) => file.relativePath)).toEqual(["pack.toml", `formulas/${pack.formula.fileName}`]);
    expect(pack.files[0]?.contents).toContain("[pack]");
    expect(pack.files[0]?.contents).toContain("schema = 2");

    const formulaToml = pack.files.find((file) => file.kind === "formula.toml")?.contents ?? "";
    expect(formulaToml).toContain("[requires]");
    expect(formulaToml).toContain('formula_compiler = ">=2.0.0"');
    expect(formulaToml).toContain("[[steps]]");
    expect(formulaToml).toContain('id = "state-dev"');
    expect(formulaToml).toContain('id = "state-review"');
    expect(formulaToml).toContain('needs = ["state-dev"]');
    expect(formulaToml).toContain('vd_workflow_design_id = "design.drt"');
    expect(formulaToml).toContain('vd_workflow_design_version = "3"');
    expect(formulaToml).toContain('vd_workflow_actions = "[{\\"id\\":\\"approved\\"');
    expect(formulaToml).not.toContain("gc convoy expand-ready");
  });

  it("keeps generated file paths under a VD runtime/generated root", () => {
    const pack = generateGasCityPackFromWorkflow({ designId: "design-a", designVersion: 1, definition: simpleWorkflow });
    const plan = buildGeneratedGasCityRuntimePlan({ runtimeRoot: "/var/tmp/vibe-dashboard/runtime", pack });

    expect(plan.packRoot).toBe(`/var/tmp/vibe-dashboard/runtime/gas-city/generated-packs/${pack.packId}`);
    expect(plan.files.map((file) => file.absolutePath)).toEqual([
      `${plan.packRoot}/pack.toml`,
      `${plan.packRoot}/formulas/${pack.formula.fileName}`,
    ]);
  });

  it("refuses source checkout-looking runtime roots", () => {
    const pack = generateGasCityPackFromWorkflow({ designId: "design-a", designVersion: 1, definition: simpleWorkflow });
    expect(() => buildGeneratedGasCityRuntimePlan({ runtimeRoot: "/workspace/gascity", pack })).toThrow(/runtime\/generated path/i);
    expect(() => buildGeneratedGasCityRuntimePlan({ runtimeRoot: "/repo/.git", pack })).toThrow(/runtime\/generated path/i);
  });

  it("scrubs product read-model strings without mutating formula TOML diagnostics", () => {
    const workflow = {
      ...simpleWorkflow,
      name: "Run gc sling and bd show /Users/me/secret",
      description: "raw XML provider diagnostics from /tmp/private webhook queue item",
    } satisfies AgentWorkflowDefinitionV1;
    const pack = generateGasCityPackFromWorkflow({ designId: "design-unsafe", designVersion: 1, definition: workflow, packName: "git status /private/var/db" });
    const rendered = JSON.stringify(pack.readModel);

    expect(rendered).not.toMatch(/gc sling|bd show|git status|\/Users|\/tmp|\/private\/var|raw XML|provider diagnostics|webhook|queue item/i);
    expect(pack.files.find((file) => file.kind === "formula.toml")?.contents).toContain("response details");
  });

  it("normalizes names deterministically and avoids workflow-core GC-specific changes", () => {
    const first = generateGasCityPackFromWorkflow({ designId: "Design With Spaces", designVersion: 2, definition: simpleWorkflow });
    const second = generateGasCityPackFromWorkflow({ designId: "Design With Spaces", designVersion: 2, definition: simpleWorkflow });

    expect(first.formula.name).toEqual(second.formula.name);
    expect(first.source.definitionHash).toEqual(second.source.definitionHash);
    expect(first.formula.name).toMatch(/^vd-feature-review-workflow-design-with-spaces-v2-[a-f0-9]{10}$/);
  });

  it("sanitizes generated pack read-model independently for provider/cache consumers", () => {
    const safe = sanitizeGeneratedGasCityPackReadModel({
      packId: "pack-one",
      packName: "Pack with /Users/me/path",
      formulaName: "formula one",
      formulaFile: "formulas/formula one.toml",
      sourceWorkflow: { designId: "design one", designVersion: 1, name: "raw JSON workflow" },
      summary: "provider diagnostics via webhook trigger",
      warnings: ["queue item from git status"],
    });

    expect(safe).toMatchObject({
      packId: "pack-one",
      formulaName: "formula-one",
      formulaFile: "formulas/formula-one.toml",
      sourceWorkflow: { designId: "design-one", designVersion: 1 },
    });
    expect(JSON.stringify(safe)).not.toMatch(/\/Users|raw JSON|provider diagnostics|webhook|queue item|git status/i);
  });
});
