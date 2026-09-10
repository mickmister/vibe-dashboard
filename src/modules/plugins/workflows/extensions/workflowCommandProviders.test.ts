import { describe, expect, it } from "vitest";
import type { WorkflowCommandStepV1 } from "@vibe-dashboard/workflow-core";
import {
  WorkflowCommandProviderError,
  WorkflowCommandProviderRegistry,
  createFirstPartyCommandProvider,
  normalizeCommandPolicy,
  redact,
  validateCommandPolicyAgainstSpec,
} from "./workflowCommandProviders";

describe("workflow command providers", () => {
  it("TEST_CASE_M117_1A validates and executes supported commands through typed provider", async () => {
    const provider = createFirstPartyCommandProvider({
      statusReader: {
        async readWorkspaceStatus() {
          return {
            summary: "Workspace clean token=secret-value /Users/mick/private",
            clean: true,
            changedFiles: 0,
            branch: "feature/command",
            stdoutPreview: "status output token=abc /Users/mick/private",
          };
        },
      },
    });
    const step = commandStep();
    expect(provider.validateCommand(step, { path: "states.inspect.steps.0" })).toEqual([]);

    const spec = provider.listCommands()[0]!;
    const policy = normalizeCommandPolicy(step, spec);
    const result = await provider.executeCommand({
      provider: step.provider,
      command: step.command,
      args: step.args ?? {},
      policy: { ...policy, output: { ...policy.output, stdoutMaxChars: 20 } },
      context: {
        runId: "run-1",
        workspaceId: "workspace-1",
        stateId: "inspect",
        stepId: step.id,
        turnId: "turn-1",
        idempotencyKey: "run-1:inspect:turn-1",
      },
    });

    expect(result.result).toMatchObject({ clean: true, changedFiles: 0 });
    expect(result.summary).toContain("[redacted]");
    expect(result.summary).toContain("[redacted-home]");
    expect(result.stdoutPreview).toHaveLength(20);
    expect(result.stdoutTruncated).toBe(true);
    expect(result.provenance).toMatchObject({
      provider: "first_party.command",
      command: "workspace_status",
      access: "read",
      cwdMode: "workspace_root",
    });
  });

  it("TEST_CASE_M117_1B denies unknown providers/actions and over-limit policy before execution", () => {
    const registry = new WorkflowCommandProviderRegistry();
    registry.register(createFirstPartyCommandProvider());
    expect(registry.get("missing.provider")).toBeUndefined();

    const provider = registry.get("first_party.command")!;
    expect(
      provider.validateCommand(
        { ...commandStep(), command: "shell" },
        { path: "states.inspect.steps.0" },
      ),
    ).toEqual([
      expect.objectContaining({
        path: "states.inspect.steps.0.command",
        message: "unsupported first-party command shell",
      }),
    ]);

    const spec = provider.listCommands()[0]!;
    for (const policy of [
      { timeoutMs: spec.maxTimeoutMs + 1, output: spec.outputCaps },
      { timeoutMs: spec.maxTimeoutMs, output: { ...spec.outputCaps, stdoutMaxChars: spec.outputCaps.stdoutMaxChars + 1 } },
      { timeoutMs: spec.maxTimeoutMs, output: { ...spec.outputCaps, stderrMaxChars: spec.outputCaps.stderrMaxChars + 1 } },
      { timeoutMs: spec.maxTimeoutMs, output: { ...spec.outputCaps, combinedMaxChars: spec.outputCaps.combinedMaxChars + 1 } },
    ]) {
      expect(() =>
        validateCommandPolicyAgainstSpec({
          provider: spec.provider,
          command: spec.command,
          spec,
          policy: {
            access: "read",
            cwd: { mode: "workspace_root" },
            ...policy,
          },
          path: "states.inspect.steps.0",
        }),
      ).toThrow(WorkflowCommandProviderError);
    }
  });

  it("TEST_CASE_M117_1C redacts common secret and host-path patterns", () => {
    expect(redact("token=abc password=hunter2 /Users/mick/private a@example.com")).toBe(
      "token=[redacted] password=[redacted] [redacted-home] [redacted-email]",
    );
  });
});

function commandStep(): WorkflowCommandStepV1 {
  return {
    id: "collect_status",
    type: "command",
    provider: "first_party.command",
    command: "workspace_status",
    args: { includeDiffSummary: true },
    policy: {
      access: "read",
      cwd: { mode: "workspace_root" },
      timeoutMs: 10_000,
      output: { combinedMaxChars: 4_096 },
    },
  };
}
