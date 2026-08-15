import type { WorkflowCommandStepV1 } from "@vibe-dashboard/workflow-core";
import type { LaneReadModel } from "../../../../server/workspace-lane-store";
import type { WorkflowExtensionIssue } from "./workflowExtensionRegistry";

export type WorkflowCommandAccess = "read" | "write";

export interface WorkflowCommandSpecV1 {
  provider: string;
  command: string;
  label: string;
  description?: string;
  access: WorkflowCommandAccess;
  defaultTimeoutMs: number;
  maxTimeoutMs: number;
  outputCaps: WorkflowCommandOutputCaps;
  resultFields: Record<string, { type: "string" | "markdown" | "number" | "boolean" }>;
  retry: "idempotent" | "not_retryable";
}

export interface WorkflowCommandOutputCaps {
  stdoutMaxChars: number;
  stderrMaxChars: number;
  combinedMaxChars: number;
}

export interface WorkflowCommandExecutionContext {
  runId: string;
  workspaceId: string;
  stateId: string;
  stepId: string;
  turnId: string;
  idempotencyKey: string;
  lane?: LaneReadModel | null;
  writeToken?: { leaseId: string; ownerId: string } | null;
}

export interface WorkflowCommandExecuteRequest {
  provider: string;
  command: string;
  args: Record<string, unknown>;
  policy: NormalizedWorkflowCommandPolicy;
  context: WorkflowCommandExecutionContext;
}

export interface WorkflowCommandResult {
  result: Record<string, unknown>;
  summary: string;
  stdoutPreview?: string;
  stderrPreview?: string;
  stdoutTruncated?: boolean;
  stderrTruncated?: boolean;
  artifactRef?: string;
  provenance: WorkflowCommandProvenance;
}

export interface WorkflowCommandProvenance {
  provider: string;
  command: string;
  access: WorkflowCommandAccess;
  idempotencyKey: string;
  laneId: string | null;
  laneLabel: string | null;
  cwdMode: "workspace_root" | "lane_root";
}

export interface WorkflowCommandProviderV1 {
  provider: string;
  label: string;
  listCommands(): WorkflowCommandSpecV1[];
  validateCommand(step: WorkflowCommandStepV1, context: { path: string }): WorkflowExtensionIssue[];
  executeCommand(request: WorkflowCommandExecuteRequest): Promise<WorkflowCommandResult>;
}

export interface NormalizedWorkflowCommandPolicy {
  access: WorkflowCommandAccess;
  cwd: { mode: "workspace_root" | "lane_root" };
  timeoutMs: number;
  output: WorkflowCommandOutputCaps;
}

export class WorkflowCommandProviderError extends Error {
  readonly code:
    | "WORKFLOW_COMMAND_UNKNOWN_PROVIDER"
    | "WORKFLOW_COMMAND_UNKNOWN_ACTION"
    | "WORKFLOW_COMMAND_DENIED"
    | "WORKFLOW_COMMAND_FAILED";
  readonly path: string;
  readonly productMessage: string;
  readonly retryable: boolean;

  constructor(input: {
    code: WorkflowCommandProviderError["code"];
    path: string;
    message: string;
    productMessage?: string;
    retryable?: boolean;
  }) {
    super(input.message);
    this.name = "WorkflowCommandProviderError";
    this.code = input.code;
    this.path = input.path;
    this.productMessage = input.productMessage ?? input.message;
    this.retryable = input.retryable ?? false;
  }
}

export class WorkflowCommandProviderRegistry {
  private readonly providers = new Map<string, WorkflowCommandProviderV1>();

  register(provider: WorkflowCommandProviderV1): void {
    if (!provider.provider || !/^[a-z][a-z0-9_.:-]*$/u.test(provider.provider)) {
      throw new WorkflowCommandProviderError({
        code: "WORKFLOW_COMMAND_UNKNOWN_PROVIDER",
        path: "provider",
        message: "command provider id must be a stable lowercase identifier",
      });
    }
    if (this.providers.has(provider.provider)) {
      throw new WorkflowCommandProviderError({
        code: "WORKFLOW_COMMAND_DENIED",
        path: `providers.${provider.provider}`,
        message: `command provider ${provider.provider} is already registered`,
      });
    }
    this.providers.set(provider.provider, provider);
  }

  get(provider: string): WorkflowCommandProviderV1 | undefined {
    return this.providers.get(provider);
  }

  list(): WorkflowCommandSpecV1[] {
    return [...this.providers.values()].flatMap((provider) =>
      provider.listCommands(),
    );
  }
}

export interface WorkflowStatusReader {
  readWorkspaceStatus(input: {
    workspaceId: string;
    laneId?: string | null;
  }): Promise<{
    summary: string;
    clean: boolean;
    changedFiles?: number;
    branch?: string | null;
    stdoutPreview?: string;
  }>;
}

export function createDefaultWorkflowCommandProviderRegistry(options: {
  statusReader?: WorkflowStatusReader;
} = {}): WorkflowCommandProviderRegistry {
  const registry = new WorkflowCommandProviderRegistry();
  registry.register(createFirstPartyCommandProvider(options));
  return registry;
}

export function createFirstPartyCommandProvider(options: {
  statusReader?: WorkflowStatusReader;
} = {}): WorkflowCommandProviderV1 {
  const statusReader =
    options.statusReader ??
    ({
      async readWorkspaceStatus(input) {
        return {
          summary: input.laneId
            ? "Lane status is available."
            : "Workspace status is available.",
          clean: true,
          changedFiles: 0,
          branch: null,
          stdoutPreview: "Workspace status collected through typed provider.",
        };
      },
    } satisfies WorkflowStatusReader);
  const spec: WorkflowCommandSpecV1 = {
    provider: "first_party.command",
    command: "workspace_status",
    label: "Workspace status",
    description: "Read a bounded workspace/lane status summary.",
    access: "read",
    defaultTimeoutMs: 10_000,
    maxTimeoutMs: 30_000,
    outputCaps: {
      stdoutMaxChars: 4_096,
      stderrMaxChars: 1_024,
      combinedMaxChars: 4_096,
    },
    resultFields: {
      summary: { type: "markdown" },
      clean: { type: "boolean" },
      changedFiles: { type: "number" },
      branch: { type: "string" },
    },
    retry: "idempotent",
  };
  return {
    provider: "first_party.command",
    label: "First-party bounded commands",
    listCommands: () => [spec],
    validateCommand(step, context) {
      const issues: WorkflowExtensionIssue[] = [];
      if (step.command !== spec.command) {
        issues.push({
          code: "WORKFLOW_EXTENSION_PROVIDER_ERROR",
          path: `${context.path}.command`,
          message: `unsupported first-party command ${step.command}`,
        });
      }
      if ((step.policy?.access ?? "read") !== "read") {
        issues.push({
          code: "WORKFLOW_EXTENSION_PROVIDER_ERROR",
          path: `${context.path}.policy.access`,
          message: "workspace_status is read-only",
        });
      }
      return issues;
    },
    async executeCommand(request) {
      if (request.command !== spec.command) {
        throw new WorkflowCommandProviderError({
          code: "WORKFLOW_COMMAND_UNKNOWN_ACTION",
          path: "command",
          message: `unsupported first-party command ${request.command}`,
        });
      }
      if (request.policy.access !== "read") {
        throw new WorkflowCommandProviderError({
          code: "WORKFLOW_COMMAND_DENIED",
          path: "policy.access",
          message: "workspace_status is read-only",
        });
      }
      const status = await statusReader.readWorkspaceStatus({
        workspaceId: request.context.workspaceId,
        laneId: request.context.lane?.laneId ?? null,
      });
      const stdout = capText(
        redact(status.stdoutPreview ?? status.summary),
        request.policy.output.stdoutMaxChars,
      );
      return {
        result: {
          summary: redact(status.summary),
          clean: status.clean,
          changedFiles: status.changedFiles ?? 0,
          branch: redact(status.branch ?? ""),
        },
        summary: redact(status.summary),
        stdoutPreview: stdout.text,
        stdoutTruncated: stdout.truncated,
        provenance: {
          provider: request.provider,
          command: request.command,
          access: request.policy.access,
          idempotencyKey: request.context.idempotencyKey,
          laneId: request.context.lane?.laneId ?? null,
          laneLabel: request.context.lane?.label ?? null,
          cwdMode: request.policy.cwd.mode,
        },
      };
    },
  };
}

export function normalizeCommandPolicy(
  step: Pick<WorkflowCommandStepV1, "policy">,
  spec: WorkflowCommandSpecV1,
): NormalizedWorkflowCommandPolicy {
  return {
    access: step.policy?.access ?? spec.access,
    cwd: step.policy?.cwd ?? { mode: spec.access === "write" ? "lane_root" : "workspace_root" },
    timeoutMs: step.policy?.timeoutMs ?? spec.defaultTimeoutMs,
    output: {
      stdoutMaxChars:
        step.policy?.output?.stdoutMaxChars ?? spec.outputCaps.stdoutMaxChars,
      stderrMaxChars:
        step.policy?.output?.stderrMaxChars ?? spec.outputCaps.stderrMaxChars,
      combinedMaxChars:
        step.policy?.output?.combinedMaxChars ?? spec.outputCaps.combinedMaxChars,
    },
  };
}

export function validateCommandPolicyAgainstSpec(args: {
  provider: string;
  command: string;
  policy: NormalizedWorkflowCommandPolicy;
  spec: WorkflowCommandSpecV1;
  path: string;
}): void {
  if (args.policy.access !== args.spec.access) {
    throw new WorkflowCommandProviderError({
      code: "WORKFLOW_COMMAND_DENIED",
      path: `${args.path}.policy.access`,
      message: `${args.provider}/${args.command} does not allow ${args.policy.access} access`,
    });
  }
  if (args.policy.timeoutMs > args.spec.maxTimeoutMs) {
    throw new WorkflowCommandProviderError({
      code: "WORKFLOW_COMMAND_DENIED",
      path: `${args.path}.policy.timeoutMs`,
      message: `${args.provider}/${args.command} timeout is over the provider limit`,
    });
  }
  if (args.policy.output.combinedMaxChars > args.spec.outputCaps.combinedMaxChars) {
    throw new WorkflowCommandProviderError({
      code: "WORKFLOW_COMMAND_DENIED",
      path: `${args.path}.policy.output.combinedMaxChars`,
      message: `${args.provider}/${args.command} output cap is over the provider limit`,
    });
  }
}

export function capText(value: string, maxChars: number): { text: string; truncated: boolean } {
  if (value.length <= maxChars) return { text: value, truncated: false };
  return { text: value.slice(0, Math.max(0, maxChars)), truncated: true };
}

export function redact(value: string): string {
  return value
    .replace(/(token|secret|password)=([^\s]+)/giu, "$1=[redacted]")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu, "[redacted-email]")
    .replace(/\/Users\/[^\s]+/gu, "[redacted-home]");
}
