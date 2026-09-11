import { createHash } from "node:crypto";
import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type { AgentWorkflowDefinitionV1 } from "@vibe-dashboard/workflow-core";
import {
  compileGasCityExecutionBundle,
  VD_BEADS_VERSION,
  VD_BUNDLE_COMPILER_POLICY,
  VD_FORMULA_COMPILER_REQUIREMENT,
  VD_GAS_CITY_VERSION,
  VD_GC_SESSION_BRIDGE_VERSION,
  type GasCityExecutionBundleCompileInput,
} from "./gasCityExecutionBundleCompiler";
import { PinnedGasCityFormulaCompilerAdapter } from "./pinnedGasCityFormulaCompilerAdapter";

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
        roleId: "dev", template: { id: "developer", version: 3, content: "template", contentHash: hash("template") }, promptAssets: [], skillAssets: [], baseInstructions: "Implement the task.",
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
    capabilities: ["workflow.agent-turn", "workflow.action-result.xml", "workflow.task-context.latest", "workflow.result-note", "workflow.caller-callback", "workflow.notification"],
  };
}

let adapter: PinnedGasCityFormulaCompilerAdapter;

beforeAll(async () => { adapter = await fixtureAdapter("normal"); });

async function fixtureAdapter(mode: "normal" | "tamper-semantics" | "tamper-graph" = "normal"): Promise<PinnedGasCityFormulaCompilerAdapter> {
  const root = await mkdtemp(join(tmpdir(), "vd-gc-fixture-"));
  const gc = join(root, "gc"); const bd = join(root, "bd");
  const gcSource = `#!/usr/bin/env node
const fs=require('fs'),crypto=require('crypto');
const a=process.argv.slice(2);
if(a[0]==='version'){console.log(JSON.stringify({version:'1.4.1',build:'fixture-build'}));process.exit(0)}
if(a[0]==='formula'&&a[1]==='show'){
 const text=fs.readFileSync('formulas/'+a[2]+'.toml','utf8');
 const raw=/vd_execution_semantics = ("(?:[^"\\\\]|\\\\.)*")/.exec(text)[1]; let semantics=JSON.parse(raw);
 if('${mode}'==='tamper-semantics') semantics=JSON.stringify({...JSON.parse(semantics),capabilities:[]});
 const vars=[]; for(const m of text.matchAll(/\\[vars\\.([^\\]]+)\\]\\ndescription = [^\\n]+\\n(required = true\\n)?type = "([^"]+)"/g)) vars.push({name:m[1],type:m[3],required:!!m[2]});
 const blocks=text.split('[[steps]]').slice(1); const steps=[]; const deps=[];
 for(const b of blocks){const id=/\\nid = "([^"]+)"/.exec('\\n'+b)[1], assignee=/\\nassignee = "([^"]+)"/.exec('\\n'+b)?.[1]||'', state=/vd_workflow_state_id = "([^"]+)"/.exec(b)?.[1]||id, role=/vd_workflow_role_id = "([^"]+)"/.exec(b)?.[1]||'', actions=JSON.parse(/vd_workflow_actions = ("(?:[^"\\\\]|\\\\.)*")/.exec(b)?.[1]||'"[]"'); steps.push({id,assignee,type:'task',metadata:{vd_workflow_state_id:state,vd_workflow_role_id:role,vd_workflow_actions:actions}}); const needs=/needs = \\[([^\\]]*)\\]/.exec(b)?.[1].match(/"([^"]+)"/g)||[]; for(const n of needs) deps.push({step_id:id,depends_on_id:n.slice(1,-1)});}
 if('${mode}'==='tamper-graph'&&steps[1]) deps.length=0;
 console.log(JSON.stringify({schema_version:'1',ok:true,name:a[2],metadata:{vd_execution_semantics:semantics},vars,steps,deps})); process.exit(0)
}
process.exit(2);`;
  const bdSource = "#!/usr/bin/env node\nif(process.argv[2]==='version'){console.log('bd version 1.2.2');process.exit(0)}process.exit(2);\n";
  await writeFile(gc, gcSource); await writeFile(bd, bdSource); await chmod(gc, 0o700); await chmod(bd, 0o700);
  return PinnedGasCityFormulaCompilerAdapter.create({ mode: "hermetic_test", gasCityExecutable: gc, gasCityExecutableSha256: hash(gcSource), gasCityArchiveSha256: hash("fixture-archive"), gasCityVersion: "1.4.1", gasCityBuild: "fixture-build", beadsExecutable: bd, beadsExecutableSha256: hash(bdSource), beadsArchiveSha256: hash("fixture-beads-archive"), beadsVersion: "1.2.2", compilerIdentity: "gas-city.formula-compiler.v2@1.4.1", invocationContract: "gc-formula-show-json.v1" });
}

describe("compileGasCityExecutionBundle", () => {
  it("emits a deterministic immutable bundle with pinned assets, settings, XSD, policies, and formula compiler", async () => {
    const firstInput = input();
    const first = await compileGasCityExecutionBundle(firstInput, adapter);
    const secondInput = input();
    secondInput.roles.reverse();
    secondInput.capabilities.reverse();
    secondInput.effects.allowed.reverse();
    const second = await compileGasCityExecutionBundle(secondInput, adapter);

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
    const baseline = await compileGasCityExecutionBundle(input(), adapter);
    const variants = [
      (value: GasCityExecutionBundleCompileInput) => { value.inputs.task = "Different"; },
      (value: GasCityExecutionBundleCompileInput) => { value.roles[0]!.reasoningId = "xhigh"; },
      (value: GasCityExecutionBundleCompileInput) => { value.roles[0]!.promptAssets[0]!.content = "Changed"; value.roles[0]!.promptAssets[0]!.contentHash = hash("Changed"); },
      (value: GasCityExecutionBundleCompileInput) => { value.retry.abruptTurnNudges = 1; },
      (value: GasCityExecutionBundleCompileInput) => { value.effects.allowed = value.effects.allowed.filter((item) => item !== "notification"); value.capabilities = value.capabilities.filter((item) => item !== "workflow.notification"); },
    ];
    for (const mutate of variants) {
      const value = input(); mutate(value);
      expect((await compileGasCityExecutionBundle(value, adapter)).digest).not.toBe(baseline.digest);
    }
  });

  it("changes digest across each execution-semantic category", async () => {
    const baseline = (await compileGasCityExecutionBundle(input(), adapter)).digest;
    const mutations: Array<(value: GasCityExecutionBundleCompileInput) => void> = [
      (value) => { value.workflow.version += 1; },
      (value) => { (value.workflow.definition as AgentWorkflowDefinitionV1).name = "Another workflow"; },
      (value) => { ((value.workflow.definition as AgentWorkflowDefinitionV1).states.build as any).steps[0].prompt.template = "Changed authored prompt"; },
      (value) => { ((value.workflow.definition as AgentWorkflowDefinitionV1).states.build as any).actions.ready.result.fields.summary.description = "Changed contract"; },
      (value) => { value.roles[1]!.template!.version += 1; },
      (value) => { value.roles[1]!.template!.content = "new template"; value.roles[1]!.template!.contentHash = hash("new template"); },
      (value) => { value.roles[0]!.baseInstructions = "Different base"; },
      (value) => { value.roles[0]!.promptAssets[0]!.version += 1; },
      (value) => { value.roles[0]!.skillAssets.push({ id: "review.skill", version: 1, content: "Skill", contentHash: hash("Skill") }); },
      (value) => { value.roles[0]!.model = "claude-opus-4"; },
      (value) => { value.roles[0]!.reasoningId = "xhigh"; },
      (value) => { value.roles[0]!.preferenceSources.reasoningId = "launch_override"; },
      (value) => { value.inputs.task = "Other task"; },
      (value) => { value.taskContextPolicy.beadIds = ["bead-2"]; },
      (value) => { value.sessionPolicy.incompatibleSession = "replace"; },
      (value) => { value.retry.invalidResultAttempts = 2; },
      (value) => { value.retry.abruptTurnNudges = 1; },
      (value) => { value.limits.maxTurns += 1; },
      (value) => { value.limits.maxPromptChars += 1; },
      (value) => { value.limits.maxResultChars += 1; },
      (value) => { value.effects.allowed = value.effects.allowed.filter((effect) => effect !== "caller_callback"); value.capabilities = value.capabilities.filter((capability) => capability !== "workflow.caller-callback"); },
    ];
    for (const mutate of mutations) {
      const value = input(); mutate(value);
      expect((await compileGasCityExecutionBundle(value, adapter)).digest).not.toBe(baseline);
    }
  });

  it("canonicalizes all declared set and map ordering without changing bytes", async () => {
    const first = input();
    first.taskContextPolicy.beadIds.push("bead-2");
    first.roles[0]!.promptAssets.push({ id: "a.prompt", version: 1, content: "A", contentHash: hash("A") });
    first.roles[0]!.skillAssets.push(
      { id: "z.skill", version: 1, content: "Z", contentHash: hash("Z") },
      { id: "a.skill", version: 1, content: "A", contentHash: hash("A") },
    );
    const second = structuredClone(first);
    second.roles.reverse();
    second.roles.find((role) => role.roleId === "review")!.promptAssets.reverse();
    second.roles.find((role) => role.roleId === "review")!.skillAssets.reverse();
    second.effects.allowed.reverse(); second.capabilities.reverse(); second.taskContextPolicy.beadIds.reverse();
    const firstBundle = await compileGasCityExecutionBundle(first, adapter);
    const secondBundle = await compileGasCityExecutionBundle(second, adapter);
    expect(Buffer.from(secondBundle.bytes)).toEqual(Buffer.from(firstBundle.bytes));
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
      await expect(compileGasCityExecutionBundle(value, adapter)).rejects.toThrow();
    }
  });

  it("rejects cyclic and unreachable workflow graphs", async () => {
    const cyclic = input();
    (cyclic.workflow.definition as AgentWorkflowDefinitionV1).states.review = { ...(cyclic.workflow.definition as AgentWorkflowDefinitionV1).states.review as any, actions: { revise: { targetState: "build" } } };
    await expect(compileGasCityExecutionBundle(cyclic, adapter)).rejects.toThrow(/cycle/i);

    const unreachable = input();
    (unreachable.workflow.definition as AgentWorkflowDefinitionV1).states.orphan = { terminal: true };
    await expect(compileGasCityExecutionBundle(unreachable, adapter)).rejects.toThrow(/unreachable/i);
  });

  it("is independent of authored map order and preserves the exact linear dependency chain", async () => {
    const ordered = input();
    const reordered = input();
    const source = reordered.workflow.definition as AgentWorkflowDefinitionV1;
    source.states = { done: source.states.done!, review: source.states.review!, build: source.states.build! };
    source.roles = { review: source.roles.review!, dev: source.roles.dev! };
    source.inputs = { task: source.inputs!.task! };
    const first = await compileGasCityExecutionBundle(ordered, adapter);
    const second = await compileGasCityExecutionBundle(reordered, adapter);
    expect(Buffer.from(second.bytes)).toEqual(Buffer.from(first.bytes));
    expect((first.document.formula as any).intendedGraph.map((node: any) => ({ id: node.id, needs: node.needs }))).toEqual([
      { id: "state-build", needs: [] },
      { id: "state-review", needs: ["state-build"] },
    ]);
  });

  it("rejects branch, diamond/multi-predecessor, multi-step, human-form, and workflow-call lowering", async () => {
    const branch = input();
    const branchDefinition = branch.workflow.definition as AgentWorkflowDefinitionV1;
    (branchDefinition.states.build as any).actions.alternate = { targetState: "done" };
    await expect(compileGasCityExecutionBundle(branch, adapter)).rejects.toThrow(/branching/i);

    const diamond = input();
    const diamondDefinition = diamond.workflow.definition as AgentWorkflowDefinitionV1;
    diamondDefinition.roles.ops = { label: "Ops" };
    diamond.roles.push({ ...diamond.roles[0]!, roleId: "ops", promptAssets: [] });
    (diamondDefinition.states.build as any).actions = { left: { targetState: "review" }, right: { targetState: "ops" } };
    diamondDefinition.states.ops = { owner: "ops", steps: [{ id: "ops", type: "agent_turn", turnType: "decision", prompt: { template: "Ops" }, response }], actions: { join: { targetState: "done" } } };
    await expect(compileGasCityExecutionBundle(diamond, adapter)).rejects.toThrow(/branching/i);

    const multiStep = input();
    (multiStep.workflow.definition as AgentWorkflowDefinitionV1).states.build = { ...(multiStep.workflow.definition as AgentWorkflowDefinitionV1).states.build as any, steps: [...((multiStep.workflow.definition as AgentWorkflowDefinitionV1).states.build as any).steps, { id: "again", type: "agent_turn", turnType: "non_decision", prompt: { template: "Again" } }] };
    await expect(compileGasCityExecutionBundle(multiStep, adapter)).rejects.toThrow(/decision step|exactly one agent turn/i);

    for (const step of [
      { id: "form", type: "human_form", title: "Input", form: { providerType: "beads_form", formSchema: {} } },
      { id: "child", type: "workflow_call", mode: "blocking", workflow: { designId: "child", version: 1 } },
      { id: "command", type: "command", provider: "unsafe", command: "run" },
    ]) {
      const unsupported = input();
      (unsupported.workflow.definition as any).states.build.steps = [step];
      await expect(compileGasCityExecutionBundle(unsupported, adapter)).rejects.toThrow();
    }
  });

  it("allows an exact terminal edge and rejects inconsistent role content, tuple, and provenance", async () => {
    const valid = await compileGasCityExecutionBundle(input(), adapter);
    expect(((valid.document.formula as any).intendedGraph.at(-1) as any).route.targetState).toBe("done");
    const badTemplate = input(); badTemplate.roles[1]!.template!.content = "changed";
    await expect(compileGasCityExecutionBundle(badTemplate, adapter)).rejects.toThrow(/template content hash/i);
    const badTuple = input(); badTuple.roles[0]!.executor = "CODEX"; badTuple.roles[0]!.model = "claude-sonnet-4";
    await expect(compileGasCityExecutionBundle(badTuple, adapter)).rejects.toThrow(/model is unsupported/i);
    const badReasoning = input(); badReasoning.roles[0]!.reasoningId = "extreme";
    await expect(compileGasCityExecutionBundle(badReasoning, adapter)).rejects.toThrow(/reasoning level/i);
    const badNullSource = input(); badNullSource.roles[0]!.model = null;
    await expect(compileGasCityExecutionBundle(badNullSource, adapter)).rejects.toThrow(/null model.*unset/i);
    const badSetSource = input(); badSetSource.roles[0]!.preferenceSources.model = "unset";
    await expect(compileGasCityExecutionBundle(badSetSource, adapter)).rejects.toThrow(/cannot have unset/i);
  });

  it("rejects unneeded, unsafe, removed, and missing capabilities", async () => {
    for (const capability of ["shell.exec", "workflow.ask-user", "workflow.graph-v2", "workflow.removed"]) {
      const value = input(); value.capabilities.push(capability);
      await expect(compileGasCityExecutionBundle(value, adapter)).rejects.toThrow(/unsupported capability/i);
    }
    const missing = input(); missing.capabilities = missing.capabilities.filter((value) => value !== "workflow.action-result.xml");
    await expect(compileGasCityExecutionBundle(missing, adapter)).rejects.toThrow(/exactly match/i);
  });

  it("rejects echo providers and semantically changed real compiler output", async () => {
    const echo = { compileFormula: async () => ({}) };
    await expect(compileGasCityExecutionBundle(input(), echo as any)).rejects.toThrow(/verified packaged/i);
    await expect(compileGasCityExecutionBundle(input(), await fixtureAdapter("tamper-semantics"))).rejects.toThrow(/complete execution semantics/i);
    await expect(compileGasCityExecutionBundle(input(), await fixtureAdapter("tamper-graph"))).rejects.toThrow(/graph differs/i);
  });

  it("rejects changed packaged executable and archive/compiler policy identity", async () => {
    const root = await mkdtemp(join(tmpdir(), "vd-gc-bad-")); const gc = join(root, "gc"); const bd = join(root, "bd");
    await writeFile(gc, "#!/bin/sh\necho changed\n"); await writeFile(bd, "#!/bin/sh\necho 'bd version 1.2.2'\n"); await chmod(gc, 0o700); await chmod(bd, 0o700);
    await expect(PinnedGasCityFormulaCompilerAdapter.create({ mode: "hermetic_test", gasCityExecutable: gc, gasCityExecutableSha256: hash("different"), gasCityArchiveSha256: hash("archive"), gasCityVersion: "1.4.1", gasCityBuild: "build", beadsExecutable: bd, beadsExecutableSha256: hash("#!/bin/sh\necho 'bd version 1.2.2'\n"), beadsArchiveSha256: hash("beads-archive"), beadsVersion: "1.2.2", compilerIdentity: "gas-city.formula-compiler.v2@1.4.1", invocationContract: "gc-formula-show-json.v1" })).rejects.toThrow(/digest/i);
    await expect(PinnedGasCityFormulaCompilerAdapter.create({ mode: "hermetic_test", gasCityExecutable: gc, gasCityExecutableSha256: hash("#!/bin/sh\necho changed\n"), gasCityArchiveSha256: "missing", gasCityVersion: "1.4.1", gasCityBuild: "build", beadsExecutable: bd, beadsExecutableSha256: hash("#!/bin/sh\necho 'bd version 1.2.2'\n"), beadsArchiveSha256: hash("beads-archive"), beadsVersion: "1.2.2", compilerIdentity: "gas-city.formula-compiler.v2@1.4.1", invocationContract: "gc-formula-show-json.v1" })).rejects.toThrow(/SHA-256/i);
    await expect(PinnedGasCityFormulaCompilerAdapter.create({ mode: "production_packaged", gasCityExecutable: gc, gasCityExecutableSha256: hash("#!/bin/sh\necho changed\n"), gasCityArchiveSha256: hash("changed-archive"), gasCityVersion: "1.4.1", gasCityBuild: "build", beadsExecutable: bd, beadsExecutableSha256: hash("#!/bin/sh\necho 'bd version 1.2.2'\n"), beadsArchiveSha256: hash("changed-beads-archive"), beadsVersion: "1.2.2", compilerIdentity: "gas-city.formula-compiler.v2@1.4.1", invocationContract: "gc-formula-show-json.v1" })).rejects.toThrow(/release allowlist/i);
  });

  it("has a stable golden digest for the supported formulas-v2 fixture", async () => {
    const bundle = await compileGasCityExecutionBundle(input(), adapter);
    expect(bundle.digest).toBe("0cb8b8aea6285d4f35aeb9db7a18336dfa1489a4ed929b4db3a4b10cc9933100");
    expect(Buffer.from(bundle.bytes).toString().endsWith("\n")).toBe(true);
  });
});

const realCompilerConfigured = Boolean(process.env.VD_PINNED_GC_SHA256 && process.env.VD_PINNED_BD_SHA256 && process.env.VD_PINNED_GC_ARCHIVE_SHA256 && process.env.VD_PINNED_BD_ARCHIVE_SHA256);

describe("packaged Gas City compiler integration", () => {
  it.skipIf(!realCompilerConfigured)("executes and verifies the actual pinned packaged compiler", async () => {
    const realAdapter = await PinnedGasCityFormulaCompilerAdapter.create({
      mode: "production_packaged",
      gasCityExecutable: process.env.VD_PINNED_GC_BIN ?? "/usr/local/bin/gc",
      gasCityExecutableSha256: process.env.VD_PINNED_GC_SHA256!,
      gasCityArchiveSha256: process.env.VD_PINNED_GC_ARCHIVE_SHA256!,
      gasCityVersion: "1.4.1",
      gasCityBuild: "58ef17e3bd685fd5cf7f21286277b208d3324590",
      beadsExecutable: process.env.VD_PINNED_BD_BIN ?? "/usr/local/bin/bd",
      beadsExecutableSha256: process.env.VD_PINNED_BD_SHA256!,
      beadsArchiveSha256: process.env.VD_PINNED_BD_ARCHIVE_SHA256!,
      beadsVersion: "1.2.2",
      compilerIdentity: "gas-city.formula-compiler.v2@1.4.1",
      invocationContract: "gc-formula-show-json.v1",
    });
    await expect(compileGasCityExecutionBundle(input(), realAdapter)).resolves.toMatchObject({ schemaVersion: "vd.execution-bundle.v1" });
  });
});
