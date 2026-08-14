export type WorkflowId = string;
export type WorkflowStateId = string;
export type WorkflowRoleId = string;
export type WorkflowActionId = string;
export type WorkflowStepId = string;

export type WorkflowInputSpec = {
  type: "string" | "markdown" | "number" | "boolean";
  required?: boolean;
  description?: string;
};

export type WorkflowExecutorType =
  | "AMP"
  | "CLAUDE_CODE"
  | "CODEX"
  | "COPILOT"
  | "CURSOR_AGENT"
  | "DROID"
  | "GEMINI"
  | "OPENCODE"
  | "QWEN_CODE";

export type WorkflowRoleExecutorPreferenceV1 = {
  executorType: WorkflowExecutorType;
  model?: string;
  mode?: "preferred";
};

export type WorkflowRoleDefinition = {
  label?: string;
  description?: string;
  executorPreference?: WorkflowRoleExecutorPreferenceV1;
};

export const WORKFLOW_EXECUTOR_MODEL_OPTIONS: Record<
  WorkflowExecutorType,
  { label: string; models: string[] }
> = {
  AMP: { label: "Amp", models: ["recommended", "default"] },
  CLAUDE_CODE: {
    label: "Claude Code",
    models: [
      "recommended",
      "default",
      "claude-sonnet-4",
      "claude-opus-4",
      "claude-3-7-sonnet",
      "claude-sonnet-4-20250514",
      "claude-opus-4-1-20250805",
    ],
  },
  CODEX: {
    label: "Codex",
    models: [
      "recommended",
      "default",
      "gpt-5",
      "gpt-5-codex",
      "gpt-5-mini",
      "o3",
      "o4-mini",
    ],
  },
  COPILOT: { label: "Copilot", models: ["recommended", "default"] },
  CURSOR_AGENT: { label: "Cursor Agent", models: ["recommended", "default"] },
  DROID: { label: "Droid", models: ["recommended", "default"] },
  GEMINI: {
    label: "Gemini",
    models: ["recommended", "default", "gemini-2.5-pro", "gemini-2.5-flash"],
  },
  OPENCODE: { label: "OpenCode", models: ["recommended", "default"] },
  QWEN_CODE: { label: "Qwen Code", models: ["recommended", "default"] },
};

export const WORKFLOW_EXECUTOR_TYPES = Object.keys(
  WORKFLOW_EXECUTOR_MODEL_OPTIONS,
) as WorkflowExecutorType[];

export const WORKFLOW_ROLE_EXECUTOR_OPTIONS = WORKFLOW_EXECUTOR_TYPES;

export const WORKFLOW_ROLE_MODEL_OPTIONS = Array.from(
  new Set(
    Object.values(WORKFLOW_EXECUTOR_MODEL_OPTIONS).flatMap(
      (option) => option.models,
    ),
  ),
);

export type PromptTemplateRef = {
  template: string;
};

export type ResultFieldSpec = {
  type: "string" | "markdown" | "number" | "boolean";
  multiple?: boolean;
  description?: string;
};

export type WorkflowActionResultContractV1 = {
  fields: Record<string, ResultFieldSpec>;
  required?: string[];
  unknownFields?: "reject" | "preserve";
};

export type GitHubCiWaitActionV1 = {
  provider: "github_ci";
  runIdField?: string;
  checkRunIdField?: string;
  repoField?: string;
  shaField?: string;
};

export type WorkflowActionV1 = {
  label?: string;
  description?: string;
  targetState: WorkflowStateId;
  result?: WorkflowActionResultContractV1;
  handoff?: {
    prompt?: PromptTemplateRef;
  };
  waitFor?: GitHubCiWaitActionV1;
};

export type DecisionResponsePolicyV1 = {
  format: "xml";
  schema: {
    format: "xsd";
    source: "state_actions" | { inline: string } | { ref: string };
  };
  invalidXmlRetry: {
    maxAttempts: number;
    prompt: "engine_default_with_validation_errors";
    onExhausted: "blocked";
  };
  storeRawXml: boolean;
  rawXmlMaxChars?: number;
  storeParsedFields: boolean;
  unknownFields: "reject_unless_allowed_by_result_contract";
};

export type AgentWorkflowStepV1 = {
  id: WorkflowStepId;
  type: "agent_turn";
  turnType: "non_decision" | "decision";
  prompt: PromptTemplateRef;
  response?: DecisionResponsePolicyV1;
};

export type HumanFormWorkflowStepV1 = {
  id: WorkflowStepId;
  type: "human_form";
  title: string;
  description?: string;
  form: {
    providerType: "beads_form";
    formSchema: unknown;
    submitLabel?: string;
  };
};

export type WorkflowCallStepV1 = {
  id: WorkflowStepId;
  type: "workflow_call";
  mode: "blocking";
  workflow: {
    designId: string;
    version?: number;
  };
  args?: Record<string, unknown>;
  roleBindings?: Record<string, { fromParentRole: WorkflowRoleId }>;
};

export type WorkflowStepV1 =
  AgentWorkflowStepV1 | HumanFormWorkflowStepV1 | WorkflowCallStepV1;

export type AuthoredWorkflowStateV1 =
  | { terminal: true }
  | {
      owner: WorkflowRoleId;
      steps: WorkflowStepV1[];
      actions: Record<WorkflowActionId, WorkflowActionV1>;
    };

export type AgentWorkflowDefinitionV1 = {
  schemaVersion: 1;
  name: string;
  description?: string;
  inputs?: Record<string, WorkflowInputSpec>;
  roles: Record<WorkflowRoleId, WorkflowRoleDefinition>;
  initialState: WorkflowStateId;
  states: Record<WorkflowStateId, AuthoredWorkflowStateV1>;
};

export type NormalizedWorkflowRole = WorkflowRoleDefinition & {
  id: WorkflowRoleId;
};

export type NormalizedWorkflowAction = Omit<WorkflowActionV1, "handoff"> & {
  id: WorkflowActionId;
  handoff?: {
    prompt?: PromptTemplateRef;
  };
};

export type NormalizedWorkflowState =
  | {
      id: WorkflowStateId;
      terminal: true;
      steps: [];
      actions: {};
    }
  | {
      id: WorkflowStateId;
      terminal: false;
      owner: WorkflowRoleId;
      steps: WorkflowStepV1[];
      actions: Record<WorkflowActionId, NormalizedWorkflowAction>;
    };

export type NormalizedAgentWorkflowModel = {
  workflowId: WorkflowId;
  schemaVersion: 1;
  name: string;
  description?: string;
  inputs: Record<string, WorkflowInputSpec>;
  roles: Record<WorkflowRoleId, NormalizedWorkflowRole>;
  initialState: WorkflowStateId;
  states: Record<WorkflowStateId, NormalizedWorkflowState>;
};

export type WorkflowConfigIssue = {
  code:
    | "WORKFLOW_CONFIG_REQUIRED_FIELD"
    | "WORKFLOW_CONFIG_UNKNOWN_FIELD"
    | "WORKFLOW_CONFIG_INVALID_REFERENCE"
    | "WORKFLOW_CONFIG_INVALID_TERMINAL_STATE"
    | "WORKFLOW_CONFIG_INVALID_ACTIVE_STATE"
    | "WORKFLOW_CONFIG_INVALID_STEP";
  path: string;
  message: string;
};

export class WorkflowDefinitionError extends Error {
  readonly issues: WorkflowConfigIssue[];

  constructor(issues: WorkflowConfigIssue[]) {
    super(
      `Invalid workflow definition: ${issues.map((issue) => `${issue.path} ${issue.message}`).join("; ")}`,
    );
    this.name = "WorkflowDefinitionError";
    this.issues = issues;
  }
}

export type WorkflowSnapshotStatus =
  "running" | "completed" | "blocked" | "failed" | "cancelled";

export type WorkflowRuntimeSnapshot = {
  instanceId: string;
  workflowId: WorkflowId;
  status: WorkflowSnapshotStatus;
  currentState: WorkflowStateId;
  currentStepIndex: number;
  visitId: string;
  inputs: Record<string, unknown>;
  waitingFor?: {
    kind: "agent_turn" | "human_form" | "workflow_call" | "github_ci";
    state: WorkflowStateId;
    stepId: WorkflowStepId;
    turnId: string;
    retryAttempt?: number;
    childRunId?: string;
    action?: WorkflowActionId;
    targetState?: WorkflowStateId;
    ciRunId?: string;
    checkRunId?: string;
    repo?: string;
    sha?: string;
  };
  latestTransition?: WorkflowTransitionRecord;
  history: WorkflowHistoryEntry[];
  blockedReason?: WorkflowRuntimeIssue;
  createdAt: number;
  updatedAt: number;
};

export type WorkflowTransitionRecord = {
  visitId: string;
  fromState: WorkflowStateId;
  toState: WorkflowStateId;
  action: WorkflowActionId;
  responseRef?: string;
  rawXml?: string;
  rawXmlTruncated?: boolean;
  rawXmlOriginalChars?: number;
  parsed?: Record<string, unknown>;
  handoffText?: string;
};

export type WorkflowHistoryEntry =
  | {
      kind: "workflow_started";
      at: number;
      state: WorkflowStateId;
      visitId: string;
    }
  | {
      kind: "agent_turn_planned";
      at: number;
      state: WorkflowStateId;
      stepId: WorkflowStepId;
      turnId: string;
      retryAttempt?: number;
    }
  | {
      kind: "agent_turn_completed";
      at: number;
      state: WorkflowStateId;
      stepId: WorkflowStepId;
      turnId: string;
      responseRef: string;
    }
  | {
      kind: "human_form_planned";
      at: number;
      state: WorkflowStateId;
      stepId: WorkflowStepId;
      turnId: string;
      title: string;
    }
  | {
      kind: "human_form_completed";
      at: number;
      state: WorkflowStateId;
      stepId: WorkflowStepId;
      turnId: string;
      responseRef: string;
      submission: Record<string, unknown>;
    }
  | {
      kind: "workflow_call_planned";
      at: number;
      state: WorkflowStateId;
      stepId: WorkflowStepId;
      turnId: string;
      childRunId: string;
      childDesignId: string;
      childVersion?: number;
    }
  | {
      kind: "workflow_call_completed";
      at: number;
      state: WorkflowStateId;
      stepId: WorkflowStepId;
      turnId: string;
      childRunId: string;
      childStatus: WorkflowSnapshotStatus;
      responseRef: string;
      outputRef?: string;
      statusSummary: string;
    }
  | {
      kind: "github_ci_wait_planned";
      at: number;
      state: WorkflowStateId;
      stepId: WorkflowStepId;
      turnId: string;
      action: WorkflowActionId;
      targetState: WorkflowStateId;
      ciRunId?: string;
      checkRunId?: string;
      repo?: string;
      sha?: string;
    }
  | {
      kind: "github_ci_wait_completed";
      at: number;
      state: WorkflowStateId;
      stepId: WorkflowStepId;
      turnId: string;
      action: WorkflowActionId;
      targetState: WorkflowStateId;
      responseRef: string;
      status: GitHubCiCompletionStatus;
      statusSummary: string;
      detailsUrl?: string;
    }
  | {
      kind: "decision_validation_failed";
      at: number;
      state: WorkflowStateId;
      stepId: WorkflowStepId;
      turnId: string;
      responseRef: string;
      retryAttempt: number;
      errors: WorkflowRuntimeIssue[];
    }
  | {
      kind: "state_transitioned";
      at: number;
      transition: WorkflowTransitionRecord;
      nextVisitId?: string;
    }
  | {
      kind: "workflow_blocked";
      at: number;
      reason: WorkflowRuntimeIssue;
    };

export type WorkflowRuntimeIssue = {
  code:
    | "WORKFLOW_STALE_OBSERVATION"
    | "WORKFLOW_DECISION_VALIDATION_FAILED"
    | "WORKFLOW_DECISION_UNKNOWN_ACTION"
    | "WORKFLOW_DECISION_MISSING_REQUIRED_FIELD"
    | "WORKFLOW_DECISION_UNKNOWN_FIELD"
    | "WORKFLOW_DECISION_FIELD_TYPE_MISMATCH"
    | "WORKFLOW_DECISION_RETRY_EXHAUSTED"
    | "WORKFLOW_DECISION_VALIDATOR_REQUIRED"
    | "WORKFLOW_CALL_CHILD_BLOCKED"
    | "WORKFLOW_CALL_CHILD_FAILED"
    | "WORKFLOW_CALL_CHILD_CANCELLED"
    | "WORKFLOW_GITHUB_CI_INVALID_REFERENCE"
    | "WORKFLOW_GITHUB_CI_FAILED"
    | "WORKFLOW_GITHUB_CI_CANCELLED"
    | "WORKFLOW_GITHUB_CI_TIMED_OUT";
  path: string;
  message: string;
};

export interface AgentTurnObservation {
  kind: "agent_turn_completed";
  turnId: string;
  responseRef: string;
  finalResponseText?: string;
}

export interface HumanFormObservation {
  kind: "human_form_completed";
  turnId: string;
  responseRef: string;
  submission: Record<string, unknown>;
}

export interface WorkflowCallObservation {
  kind: "workflow_call_completed";
  turnId: string;
  responseRef: string;
  childRunId: string;
  childStatus: WorkflowSnapshotStatus;
  outputRef?: string;
  statusSummary?: string;
}

export type GitHubCiCompletionStatus =
  "success" | "failure" | "cancelled" | "timed_out";

export interface GitHubCiObservation {
  kind: "github_ci_completed";
  turnId: string;
  responseRef: string;
  status: GitHubCiCompletionStatus;
  statusSummary?: string;
  detailsUrl?: string;
}

export type WorkflowObservation =
  | AgentTurnObservation
  | HumanFormObservation
  | WorkflowCallObservation
  | GitHubCiObservation;

export type WorkflowPlanEffect =
  | {
      kind: "send_agent_turn";
      role: WorkflowRoleId;
      state: WorkflowStateId;
      stepId: WorkflowStepId;
      turnId: string;
      prompt: string;
    }
  | {
      kind: "create_human_form";
      state: WorkflowStateId;
      stepId: WorkflowStepId;
      turnId: string;
      title: string;
      description?: string;
      form: HumanFormWorkflowStepV1["form"];
    }
  | {
      kind: "start_workflow_call";
      state: WorkflowStateId;
      stepId: WorkflowStepId;
      turnId: string;
      childRunId: string;
      workflow: WorkflowCallStepV1["workflow"];
      args: Record<string, unknown>;
      roleBindings?: WorkflowCallStepV1["roleBindings"];
    }
  | {
      kind: "start_github_ci_watch";
      state: WorkflowStateId;
      stepId: WorkflowStepId;
      turnId: string;
      action: WorkflowActionId;
      targetState: WorkflowStateId;
      ciRunId?: string;
      checkRunId?: string;
      repo?: string;
      sha?: string;
    }
  | { kind: "none" };

export type WorkflowAdvanceResult = {
  snapshot: WorkflowRuntimeSnapshot;
  effect: WorkflowPlanEffect;
  ignored?: WorkflowRuntimeIssue;
};

export type DecisionValidationResult =
  | {
      valid: true;
      action: WorkflowActionId;
      rawXml?: string;
      parsed?: Record<string, unknown>;
      unknownFields?: string[];
    }
  | {
      valid: false;
      errors: WorkflowRuntimeIssue[];
    };

export interface DecisionResponseValidator {
  validate(args: {
    state: WorkflowStateId;
    stepId: WorkflowStepId;
    actions: Record<WorkflowActionId, NormalizedWorkflowAction>;
    responseText: string;
    rawXmlMaxChars: number;
  }): DecisionValidationResult;
}

export type WorkflowRuntimeDeps = {
  now: () => number;
  createId: () => string;
  validator?: DecisionResponseValidator;
};

export function normalizeWorkflowDefinitionV1(
  definition: unknown,
  options: { workflowId?: WorkflowId } = {},
): NormalizedAgentWorkflowModel {
  const issues: WorkflowConfigIssue[] = [];
  const def = definition as Partial<AgentWorkflowDefinitionV1> | null;
  if (!isRecord(def)) {
    throw new WorkflowDefinitionError([
      issue(
        "WORKFLOW_CONFIG_REQUIRED_FIELD",
        "",
        "workflow definition must be an object",
      ),
    ]);
  }

  assertKnownKeys(
    def,
    [
      "schemaVersion",
      "name",
      "description",
      "inputs",
      "roles",
      "initialState",
      "states",
    ],
    "",
    issues,
  );
  requireField(def, "schemaVersion", "schemaVersion", issues);
  requireField(def, "name", "name", issues);
  requireField(def, "roles", "roles", issues);
  requireField(def, "initialState", "initialState", issues);
  requireField(def, "states", "states", issues);

  if (def.schemaVersion !== 1) {
    issues.push(
      issue(
        "WORKFLOW_CONFIG_INVALID_ACTIVE_STATE",
        "schemaVersion",
        "must be 1",
      ),
    );
  }

  const roles: Record<string, NormalizedWorkflowRole> = {};
  if (isRecord(def.roles)) {
    for (const [roleId, role] of Object.entries(def.roles)) {
      if (!isRecord(role)) {
        issues.push(
          issue(
            "WORKFLOW_CONFIG_INVALID_ACTIVE_STATE",
            `roles.${roleId}`,
            "role must be an object",
          ),
        );
        continue;
      }
      assertKnownKeys(
        role,
        ["label", "description", "executorPreference"],
        `roles.${roleId}`,
        issues,
      );
      const executorPreference = validateRoleExecutorPreference(
        role.executorPreference,
        `roles.${roleId}.executorPreference`,
        issues,
      );
      roles[roleId] = cloneWithDefined({
        id: roleId,
        label: role.label,
        description: role.description,
        executorPreference,
      });
    }
  }

  const states: Record<string, NormalizedWorkflowState> = {};
  if (isRecord(def.states)) {
    for (const [stateId, state] of Object.entries(def.states)) {
      if (!isRecord(state)) {
        issues.push(
          issue(
            "WORKFLOW_CONFIG_INVALID_ACTIVE_STATE",
            `states.${stateId}`,
            "state must be an object",
          ),
        );
        continue;
      }
      const stateRecord = state as Record<string, unknown>;
      const terminal = stateRecord.terminal;
      if (terminal === true) {
        assertKnownKeys(
          stateRecord,
          ["terminal"],
          `states.${stateId}`,
          issues,
          "WORKFLOW_CONFIG_INVALID_TERMINAL_STATE",
        );
        states[stateId] = {
          id: stateId,
          terminal: true,
          steps: [],
          actions: {},
        };
        continue;
      }

      assertKnownKeys(
        stateRecord,
        ["owner", "steps", "actions"],
        `states.${stateId}`,
        issues,
      );
      const owner = stateRecord.owner;
      const steps = stateRecord.steps;
      const actions = stateRecord.actions;
      if (typeof owner !== "string") {
        issues.push(
          issue(
            "WORKFLOW_CONFIG_INVALID_ACTIVE_STATE",
            `states.${stateId}.owner`,
            "owner is required",
          ),
        );
      } else if (isRecord(def.roles) && !Object.hasOwn(def.roles, owner)) {
        issues.push(
          issue(
            "WORKFLOW_CONFIG_INVALID_REFERENCE",
            `states.${stateId}.owner`,
            `unknown role ${owner}`,
          ),
        );
      }
      if (!Array.isArray(steps) || steps.length === 0) {
        issues.push(
          issue(
            "WORKFLOW_CONFIG_INVALID_ACTIVE_STATE",
            `states.${stateId}.steps`,
            "steps must be non-empty",
          ),
        );
      }
      if (!isRecord(actions) || Object.keys(actions).length === 0) {
        issues.push(
          issue(
            "WORKFLOW_CONFIG_INVALID_ACTIVE_STATE",
            `states.${stateId}.actions`,
            "actions must be non-empty",
          ),
        );
      }

      const normalizedSteps: WorkflowStepV1[] = [];
      if (Array.isArray(steps)) {
        let decisionCount = 0;
        steps.forEach((step, index) => {
          const path = `states.${stateId}.steps.${index}`;
          if (!isRecord(step)) {
            issues.push(
              issue(
                "WORKFLOW_CONFIG_INVALID_STEP",
                path,
                "step must be an object",
              ),
            );
            return;
          }
          if (typeof step.id !== "string") {
            issues.push(
              issue(
                "WORKFLOW_CONFIG_INVALID_STEP",
                `${path}.id`,
                "step id is required",
              ),
            );
          }
          if (step.type === "agent_turn") {
            assertKnownKeys(
              step,
              ["id", "type", "turnType", "prompt", "response"],
              path,
              issues,
            );
            if (
              step.turnType !== "non_decision" &&
              step.turnType !== "decision"
            ) {
              issues.push(
                issue(
                  "WORKFLOW_CONFIG_INVALID_STEP",
                  `${path}.turnType`,
                  "turnType must be non_decision or decision",
                ),
              );
            }
            if (step.turnType === "decision") {
              decisionCount += 1;
              if (index !== steps.length - 1) {
                issues.push(
                  issue(
                    "WORKFLOW_CONFIG_INVALID_ACTIVE_STATE",
                    path,
                    "decision step must be final",
                  ),
                );
              }
            }
            validatePrompt(step.prompt, `${path}.prompt`, issues);
            if (step.turnType === "decision") {
              validateDecisionResponse(
                step.response,
                `${path}.response`,
                issues,
              );
            }
          } else if (step.type === "human_form") {
            assertKnownKeys(
              step,
              ["id", "type", "title", "description", "form"],
              path,
              issues,
            );
            validateHumanFormStep(step, path, issues);
            if (index === steps.length - 1) {
              issues.push(
                issue(
                  "WORKFLOW_CONFIG_INVALID_ACTIVE_STATE",
                  path,
                  "human_form step must be followed by a final decision step in V1",
                ),
              );
            }
          } else if (step.type === "workflow_call") {
            assertKnownKeys(
              step,
              ["id", "type", "mode", "workflow", "args", "roleBindings"],
              path,
              issues,
            );
            validateWorkflowCallStep(step, path, issues);
            if (index === steps.length - 1) {
              issues.push(
                issue(
                  "WORKFLOW_CONFIG_INVALID_ACTIVE_STATE",
                  path,
                  "workflow_call step must be followed by a final decision step in V1",
                ),
              );
            }
          } else {
            issues.push(
              issue(
                "WORKFLOW_CONFIG_INVALID_STEP",
                `${path}.type`,
                "only agent_turn, human_form, and workflow_call are supported in V1",
              ),
            );
          }
          normalizedSteps.push(deepClone(step as WorkflowStepV1));
        });
        if (decisionCount !== 1) {
          issues.push(
            issue(
              "WORKFLOW_CONFIG_INVALID_ACTIVE_STATE",
              `states.${stateId}.steps`,
              "active state must have exactly one final decision step",
            ),
          );
        }
      }

      const normalizedActions: Record<string, NormalizedWorkflowAction> = {};
      if (isRecord(actions)) {
        for (const [actionId, action] of Object.entries(actions)) {
          const path = `states.${stateId}.actions.${actionId}`;
          if (!isRecord(action)) {
            issues.push(
              issue(
                "WORKFLOW_CONFIG_INVALID_ACTIVE_STATE",
                path,
                "action must be an object",
              ),
            );
            continue;
          }
          assertKnownKeys(
            action,
            [
              "label",
              "description",
              "targetState",
              "result",
              "handoff",
              "waitFor",
            ],
            path,
            issues,
          );
          if (typeof action.targetState !== "string") {
            issues.push(
              issue(
                "WORKFLOW_CONFIG_REQUIRED_FIELD",
                `${path}.targetState`,
                "targetState is required",
              ),
            );
          } else if (
            isRecord(def.states) &&
            !Object.hasOwn(def.states, action.targetState)
          ) {
            issues.push(
              issue(
                "WORKFLOW_CONFIG_INVALID_REFERENCE",
                `${path}.targetState`,
                `unknown state ${action.targetState}`,
              ),
            );
          }
          validateResultContract(action.result, `${path}.result`, issues);
          if (isRecord(action.handoff)) {
            assertKnownKeys(
              action.handoff,
              ["prompt"],
              `${path}.handoff`,
              issues,
            );
            validatePrompt(
              action.handoff.prompt,
              `${path}.handoff.prompt`,
              issues,
            );
          } else if (action.handoff !== undefined) {
            issues.push(
              issue(
                "WORKFLOW_CONFIG_INVALID_ACTIVE_STATE",
                `${path}.handoff`,
                "handoff must be an object",
              ),
            );
          }
          validateWaitFor(action.waitFor, `${path}.waitFor`, issues);
          normalizedActions[actionId] = cloneWithDefined({
            id: actionId,
            label: action.label,
            description: action.description,
            targetState: action.targetState,
            result: deepClone(action.result),
            handoff: deepClone(action.handoff),
            waitFor: deepClone(action.waitFor),
          }) as NormalizedWorkflowAction;
        }
      }

      states[stateId] = {
        id: stateId,
        terminal: false,
        owner: typeof owner === "string" ? owner : "",
        steps: normalizedSteps,
        actions: normalizedActions,
      };
    }
  }

  if (
    typeof def.initialState === "string" &&
    isRecord(def.states) &&
    !Object.hasOwn(def.states, def.initialState)
  ) {
    issues.push(
      issue(
        "WORKFLOW_CONFIG_INVALID_REFERENCE",
        "initialState",
        `unknown state ${def.initialState}`,
      ),
    );
  }

  if (issues.length > 0) {
    throw new WorkflowDefinitionError(issues);
  }

  return cloneWithDefined({
    workflowId: options.workflowId ?? def.name ?? "workflow",
    schemaVersion: 1 as const,
    name: def.name as string,
    description: def.description,
    inputs: deepClone(def.inputs ?? {}),
    roles,
    initialState: def.initialState as string,
    states,
  });
}

export function createInitialWorkflowSnapshot(
  model: NormalizedAgentWorkflowModel,
  options: {
    instanceId: string;
    inputs: Record<string, unknown>;
    now: () => number;
    createId: () => string;
  },
): WorkflowRuntimeSnapshot {
  const now = options.now();
  const visitId = options.createId();
  const initialState = model.states[model.initialState];
  return {
    instanceId: options.instanceId,
    workflowId: model.workflowId,
    status: initialState?.terminal ? "completed" : "running",
    currentState: model.initialState,
    currentStepIndex: 0,
    visitId,
    inputs: deepClone(options.inputs),
    history: [
      { kind: "workflow_started", at: now, state: model.initialState, visitId },
    ],
    createdAt: now,
    updatedAt: now,
  };
}

export function planNextWorkflowEffect(
  model: NormalizedAgentWorkflowModel,
  snapshot: WorkflowRuntimeSnapshot,
  deps: WorkflowRuntimeDeps,
): { snapshot: WorkflowRuntimeSnapshot; effect: WorkflowPlanEffect } {
  if (snapshot.status !== "running") {
    return { snapshot, effect: { kind: "none" } };
  }
  if (snapshot.waitingFor) {
    return { snapshot, effect: { kind: "none" } };
  }

  const state = getActiveState(model, snapshot.currentState);
  if (!state) {
    return {
      snapshot: { ...snapshot, status: "completed", updatedAt: deps.now() },
      effect: { kind: "none" },
    };
  }
  const step = state.steps[snapshot.currentStepIndex];
  if (!step) {
    return { snapshot, effect: { kind: "none" } };
  }

  const turnId = deps.createId();
  const at = deps.now();
  if (step.type === "human_form") {
    const planned: WorkflowRuntimeSnapshot = {
      ...snapshot,
      waitingFor: {
        kind: "human_form",
        state: state.id,
        stepId: step.id,
        turnId,
      },
      history: [
        ...snapshot.history,
        {
          kind: "human_form_planned",
          at,
          state: state.id,
          stepId: step.id,
          turnId,
          title: step.title,
        },
      ],
      updatedAt: at,
    };
    return {
      snapshot: planned,
      effect: {
        kind: "create_human_form",
        state: state.id,
        stepId: step.id,
        turnId,
        title: step.title,
        description: step.description,
        form: deepClone(step.form),
      },
    };
  }
  if (step.type === "workflow_call") {
    const childRunId = `${snapshot.instanceId}-${turnId}`;
    const planned: WorkflowRuntimeSnapshot = {
      ...snapshot,
      waitingFor: {
        kind: "workflow_call",
        state: state.id,
        stepId: step.id,
        turnId,
        childRunId,
      },
      history: [
        ...snapshot.history,
        cloneWithDefined({
          kind: "workflow_call_planned" as const,
          at,
          state: state.id,
          stepId: step.id,
          turnId,
          childRunId,
          childDesignId: step.workflow.designId,
          childVersion: step.workflow.version,
        }),
      ],
      updatedAt: at,
    };
    return {
      snapshot: planned,
      effect: {
        kind: "start_workflow_call",
        state: state.id,
        stepId: step.id,
        turnId,
        childRunId,
        workflow: deepClone(step.workflow),
        args: renderWorkflowCallArgs(snapshot, step.args ?? {}),
        roleBindings: deepClone(step.roleBindings),
      },
    };
  }
  const planned: WorkflowRuntimeSnapshot = {
    ...snapshot,
    waitingFor: cloneWithDefined({
      kind: "agent_turn" as const,
      state: state.id,
      stepId: step.id,
      turnId,
    }),
    history: [
      ...snapshot.history,
      cloneWithDefined({
        kind: "agent_turn_planned" as const,
        at,
        state: state.id,
        stepId: step.id,
        turnId,
      }),
    ],
    updatedAt: at,
  };

  return {
    snapshot: planned,
    effect: {
      kind: "send_agent_turn",
      role: state.owner,
      state: state.id,
      stepId: step.id,
      turnId,
      prompt: renderWorkflowPrompt(model, planned, step),
    },
  };
}

export function advanceWorkflow(
  model: NormalizedAgentWorkflowModel,
  snapshot: WorkflowRuntimeSnapshot,
  observation: WorkflowObservation,
  deps: WorkflowRuntimeDeps,
): WorkflowAdvanceResult {
  if (snapshot.status !== "running") {
    return { snapshot, effect: { kind: "none" } };
  }

  const waitingFor = snapshot.waitingFor;
  if (
    !waitingFor ||
    waitingFor.turnId !== observation.turnId ||
    waitingFor.kind !== observation.kind.replace("_completed", "")
  ) {
    return {
      snapshot,
      effect: { kind: "none" },
      ignored: {
        code: "WORKFLOW_STALE_OBSERVATION",
        path: "observation.turnId",
        message: "observation does not match the active workflow turn",
      },
    };
  }
  if (
    waitingFor.kind === "workflow_call" &&
    observation.kind === "workflow_call_completed" &&
    waitingFor.childRunId !== observation.childRunId
  ) {
    return {
      snapshot,
      effect: { kind: "none" },
      ignored: {
        code: "WORKFLOW_STALE_OBSERVATION",
        path: "observation.childRunId",
        message:
          "workflow call completion does not match the active child workflow run",
      },
    };
  }

  const state = getActiveState(model, snapshot.currentState);
  const step = state?.steps[snapshot.currentStepIndex];
  if (!state || !step) {
    return { snapshot, effect: { kind: "none" } };
  }

  if (
    waitingFor.kind === "github_ci" &&
    observation.kind === "github_ci_completed"
  ) {
    const at = deps.now();
    const statusSummary = observation.statusSummary ?? observation.status;
    const actionId = waitingFor.action ?? "";
    const targetState = waitingFor.targetState ?? "";
    const completedEntry: WorkflowHistoryEntry = cloneWithDefined({
      kind: "github_ci_wait_completed" as const,
      at,
      state: waitingFor.state,
      stepId: waitingFor.stepId,
      turnId: observation.turnId,
      action: actionId,
      targetState,
      responseRef: observation.responseRef,
      status: observation.status,
      statusSummary,
      detailsUrl: observation.detailsUrl,
    });
    if (observation.status !== "success") {
      const code =
        observation.status === "failure"
          ? "WORKFLOW_GITHUB_CI_FAILED"
          : observation.status === "cancelled"
            ? "WORKFLOW_GITHUB_CI_CANCELLED"
            : "WORKFLOW_GITHUB_CI_TIMED_OUT";
      const reason: WorkflowRuntimeIssue = {
        code,
        path: `states.${waitingFor.state}.actions.${actionId}.waitFor`,
        message: `GitHub CI ${observation.status}: ${statusSummary}`,
      };
      return {
        snapshot: {
          ...snapshot,
          status: "blocked",
          waitingFor: undefined,
          blockedReason: reason,
          history: [
            ...snapshot.history,
            completedEntry,
            { kind: "workflow_blocked", at, reason },
          ],
          updatedAt: at,
        },
        effect: { kind: "none" },
      };
    }
    const action = state.actions[actionId];
    const target = targetState ? model.states[targetState] : undefined;
    if (!action || !target) {
      return {
        snapshot,
        effect: { kind: "none" },
        ignored: {
          code: "WORKFLOW_STALE_OBSERVATION",
          path: "observation.turnId",
          message:
            "GitHub CI completion does not match an active workflow action",
        },
      };
    }
    const transition: WorkflowTransitionRecord = {
      visitId: snapshot.visitId,
      fromState: snapshot.currentState,
      toState: target.id,
      action: action.id,
      responseRef: observation.responseRef,
      parsed: cloneWithDefined({
        ciStatus: observation.status,
        ciSummary: statusSummary,
        detailsUrl: observation.detailsUrl,
      }),
    };
    const history: WorkflowHistoryEntry[] = [
      ...snapshot.history,
      completedEntry,
      { kind: "state_transitioned", at, transition },
    ];
    if (target.terminal) {
      return {
        snapshot: {
          ...snapshot,
          status: "completed",
          currentState: target.id,
          currentStepIndex: 0,
          waitingFor: undefined,
          latestTransition: transition,
          history,
          updatedAt: at,
        },
        effect: { kind: "none" },
      };
    }
    const nextVisitId = deps.createId();
    const transitioned: WorkflowRuntimeSnapshot = {
      ...snapshot,
      currentState: target.id,
      currentStepIndex: 0,
      visitId: nextVisitId,
      waitingFor: undefined,
      latestTransition: transition,
      history: [
        ...history.slice(0, -1),
        { kind: "state_transitioned", at, transition, nextVisitId },
      ],
      updatedAt: at,
    };
    const { snapshot: plannedSnapshot, effect } = planNextWorkflowEffect(
      model,
      transitioned,
      deps,
    );
    return { snapshot: plannedSnapshot, effect };
  }

  if (
    step.type === "human_form" &&
    observation.kind === "human_form_completed"
  ) {
    const at = deps.now();
    const advanced: WorkflowRuntimeSnapshot = {
      ...snapshot,
      waitingFor: undefined,
      currentStepIndex: snapshot.currentStepIndex + 1,
      history: [
        ...snapshot.history,
        {
          kind: "human_form_completed",
          at,
          state: state.id,
          stepId: step.id,
          turnId: observation.turnId,
          responseRef: observation.responseRef,
          submission: deepClone(observation.submission),
        },
      ],
      updatedAt: at,
    };
    const { snapshot: plannedSnapshot, effect } = planNextWorkflowEffect(
      model,
      advanced,
      deps,
    );
    return { snapshot: plannedSnapshot, effect };
  }

  if (
    step.type === "workflow_call" &&
    observation.kind === "workflow_call_completed"
  ) {
    const at = deps.now();
    const statusSummary = observation.statusSummary ?? observation.childStatus;
    const completedEntry: WorkflowHistoryEntry = cloneWithDefined({
      kind: "workflow_call_completed" as const,
      at,
      state: state.id,
      stepId: step.id,
      turnId: observation.turnId,
      childRunId: observation.childRunId,
      childStatus: observation.childStatus,
      responseRef: observation.responseRef,
      outputRef: observation.outputRef,
      statusSummary,
    });

    if (observation.childStatus !== "completed") {
      const code =
        observation.childStatus === "failed"
          ? "WORKFLOW_CALL_CHILD_FAILED"
          : observation.childStatus === "cancelled"
            ? "WORKFLOW_CALL_CHILD_CANCELLED"
            : "WORKFLOW_CALL_CHILD_BLOCKED";
      const issue: WorkflowRuntimeIssue = {
        code,
        path: `states.${state.id}.steps.${step.id}`,
        message: `child workflow ${observation.childRunId} ended with status ${observation.childStatus}`,
      };
      return {
        snapshot: {
          ...snapshot,
          status: observation.childStatus === "failed" ? "failed" : "blocked",
          waitingFor: undefined,
          blockedReason: issue,
          history: [
            ...snapshot.history,
            completedEntry,
            { kind: "workflow_blocked", at, reason: issue },
          ],
          updatedAt: at,
        },
        effect: { kind: "none" },
      };
    }

    const advanced: WorkflowRuntimeSnapshot = {
      ...snapshot,
      waitingFor: undefined,
      currentStepIndex: snapshot.currentStepIndex + 1,
      history: [...snapshot.history, completedEntry],
      updatedAt: at,
    };
    const { snapshot: plannedSnapshot, effect } = planNextWorkflowEffect(
      model,
      advanced,
      deps,
    );
    return { snapshot: plannedSnapshot, effect };
  }

  if (
    step.type !== "agent_turn" ||
    observation.kind !== "agent_turn_completed"
  ) {
    return {
      snapshot,
      effect: { kind: "none" },
      ignored: {
        code: "WORKFLOW_STALE_OBSERVATION",
        path: "observation.kind",
        message: "observation kind does not match the active workflow step",
      },
    };
  }

  const at = deps.now();
  const completedEntry: WorkflowHistoryEntry = {
    kind: "agent_turn_completed",
    at,
    state: state.id,
    stepId: step.id,
    turnId: observation.turnId,
    responseRef: observation.responseRef,
  };

  if (step.turnType === "non_decision") {
    const advanced: WorkflowRuntimeSnapshot = {
      ...snapshot,
      waitingFor: undefined,
      currentStepIndex: snapshot.currentStepIndex + 1,
      history: [...snapshot.history, completedEntry],
      updatedAt: at,
    };
    const { snapshot: plannedSnapshot, effect } = planNextWorkflowEffect(
      model,
      advanced,
      deps,
    );
    return { snapshot: plannedSnapshot, effect };
  }

  const validation = validateDecision(model, state, step, observation, deps);
  if (!validation.valid) {
    return handleInvalidDecision(
      snapshot,
      state,
      step,
      observation,
      validation.errors,
      at,
      completedEntry,
      deps,
    );
  }

  const action = state.actions[validation.action];
  if (!action) {
    return handleInvalidDecision(
      snapshot,
      state,
      step,
      observation,
      [
        {
          code: "WORKFLOW_DECISION_UNKNOWN_ACTION",
          path: `states.${state.id}.actions.${validation.action}`,
          message: `decision selected unknown action ${validation.action}`,
        },
      ],
      at,
      completedEntry,
      deps,
    );
  }
  const target = model.states[action.targetState];
  if (!target) {
    return handleInvalidDecision(
      snapshot,
      state,
      step,
      observation,
      [
        {
          code: "WORKFLOW_DECISION_UNKNOWN_ACTION",
          path: `states.${state.id}.actions.${validation.action}.targetState`,
          message: `decision action ${validation.action} targets a missing state`,
        },
      ],
      at,
      completedEntry,
      deps,
    );
  }
  const transition = buildTransition(
    snapshot,
    observation,
    action,
    validation,
    step,
  );
  if (action.waitFor?.provider === "github_ci") {
    const wait = extractGithubCiWait(action, validation.parsed ?? {});
    if (!wait.ciRunId && !wait.checkRunId) {
      return handleInvalidDecision(
        snapshot,
        state,
        step,
        observation,
        [
          {
            code: "WORKFLOW_GITHUB_CI_INVALID_REFERENCE",
            path: `states.${state.id}.actions.${action.id}.waitFor`,
            message:
              "GitHub CI wait action requires a CI run id or check run id in the decision result",
          },
        ],
        at,
        completedEntry,
        deps,
      );
    }
    const waitTurnId = deps.createId();
    const waitEntry: WorkflowHistoryEntry = cloneWithDefined({
      kind: "github_ci_wait_planned" as const,
      at,
      state: state.id,
      stepId: step.id,
      turnId: waitTurnId,
      action: action.id,
      targetState: action.targetState,
      ciRunId: wait.ciRunId,
      checkRunId: wait.checkRunId,
      repo: wait.repo,
      sha: wait.sha,
    });
    const planned: WorkflowRuntimeSnapshot = {
      ...snapshot,
      waitingFor: cloneWithDefined({
        kind: "github_ci" as const,
        state: state.id,
        stepId: step.id,
        turnId: waitTurnId,
        action: action.id,
        targetState: action.targetState,
        ciRunId: wait.ciRunId,
        checkRunId: wait.checkRunId,
        repo: wait.repo,
        sha: wait.sha,
      }),
      latestTransition: transition,
      history: [...snapshot.history, completedEntry, waitEntry],
      updatedAt: at,
    };
    return {
      snapshot: planned,
      effect: cloneWithDefined({
        kind: "start_github_ci_watch" as const,
        state: state.id,
        stepId: step.id,
        turnId: waitTurnId,
        action: action.id,
        targetState: action.targetState,
        ciRunId: wait.ciRunId,
        checkRunId: wait.checkRunId,
        repo: wait.repo,
        sha: wait.sha,
      }),
    };
  }
  const transitionedAt = at;
  const history: WorkflowHistoryEntry[] = [
    ...snapshot.history,
    completedEntry,
    { kind: "state_transitioned", at: transitionedAt, transition },
  ];

  if (target.terminal) {
    const completed: WorkflowRuntimeSnapshot = {
      ...snapshot,
      status: "completed",
      currentState: target.id,
      currentStepIndex: 0,
      waitingFor: undefined,
      latestTransition: transition,
      history,
      updatedAt: transitionedAt,
    };
    return { snapshot: completed, effect: { kind: "none" } };
  }

  const nextVisitId = deps.createId();
  const transitioned: WorkflowRuntimeSnapshot = {
    ...snapshot,
    currentState: target.id,
    currentStepIndex: 0,
    visitId: nextVisitId,
    waitingFor: undefined,
    latestTransition: transition,
    history: [
      ...history.slice(0, -1),
      {
        kind: "state_transitioned",
        at: transitionedAt,
        transition,
        nextVisitId,
      },
    ],
    updatedAt: transitionedAt,
  };
  const { snapshot: plannedSnapshot, effect } = planNextWorkflowEffect(
    model,
    transitioned,
    deps,
  );
  return { snapshot: plannedSnapshot, effect };
}

export function renderWorkflowPrompt(
  _model: NormalizedAgentWorkflowModel,
  snapshot: WorkflowRuntimeSnapshot,
  step: AgentWorkflowStepV1,
  extra: { validationErrors?: WorkflowRuntimeIssue[] } = {},
): string {
  let rendered = step.prompt.template.replace(
    /\{\{\s*([^}]+?)\s*\}\}/g,
    (_match, expression: string) => {
      const value = readContextValue(snapshot, expression.trim());
      return value === undefined || value === null ? "" : String(value);
    },
  );

  if (extra.validationErrors?.length) {
    rendered += `\n\nYour previous XML response did not match the workflow contract. Fix these validation errors and return the XML again:\n${extra.validationErrors
      .map((error) => `- ${error.code} at ${error.path}: ${error.message}`)
      .join("\n")}`;
  }

  return rendered;
}

function validateDecision(
  model: NormalizedAgentWorkflowModel,
  state: Extract<NormalizedWorkflowState, { terminal: false }>,
  step: AgentWorkflowStepV1,
  observation: AgentTurnObservation,
  deps: WorkflowRuntimeDeps,
): DecisionValidationResult {
  const policy = step.response;
  if (!deps.validator) {
    return {
      valid: false,
      errors: [
        {
          code: "WORKFLOW_DECISION_VALIDATOR_REQUIRED",
          path: `states.${state.id}.steps.${step.id}.response`,
          message: "decision validator is required for decision turns",
        },
      ],
    };
  }
  const rawXmlMaxChars = policy?.rawXmlMaxChars ?? 20000;
  const validation = deps.validator.validate({
    state: state.id,
    stepId: step.id,
    actions: state.actions,
    responseText: observation.finalResponseText ?? "",
    rawXmlMaxChars,
  });
  if (!validation.valid) {
    return validation;
  }
  const action = state.actions[validation.action];
  if (!action) {
    return {
      valid: false,
      errors: [
        {
          code: "WORKFLOW_DECISION_UNKNOWN_ACTION",
          path: `states.${state.id}.actions.${validation.action}`,
          message: `decision selected unknown action ${validation.action}`,
        },
      ],
    };
  }
  const resultIssues = validateDecisionResultFields(
    state.id,
    action,
    validation.parsed ?? {},
    validation.unknownFields ?? [],
  );
  if (resultIssues.length > 0) {
    return { valid: false, errors: resultIssues };
  }
  return validation;
}

function handleInvalidDecision(
  snapshot: WorkflowRuntimeSnapshot,
  state: Extract<NormalizedWorkflowState, { terminal: false }>,
  step: AgentWorkflowStepV1,
  observation: AgentTurnObservation,
  errors: WorkflowRuntimeIssue[],
  at: number,
  completedEntry: WorkflowHistoryEntry,
  deps: WorkflowRuntimeDeps,
): WorkflowAdvanceResult {
  const previousRetries = snapshot.waitingFor?.retryAttempt ?? 0;
  const nextRetryAttempt = previousRetries + 1;
  const maxAttempts = step.response?.invalidXmlRetry.maxAttempts ?? 0;
  const validationFailed: WorkflowHistoryEntry = {
    kind: "decision_validation_failed",
    at,
    state: state.id,
    stepId: step.id,
    turnId: observation.turnId,
    responseRef: observation.responseRef,
    retryAttempt: nextRetryAttempt,
    errors,
  };

  if (nextRetryAttempt > maxAttempts) {
    const reason: WorkflowRuntimeIssue = {
      code: "WORKFLOW_DECISION_RETRY_EXHAUSTED",
      path: `states.${state.id}.steps.${step.id}`,
      message: `decision response failed validation after ${maxAttempts} retry attempts`,
    };
    const blockedAt = deps.now();
    return {
      snapshot: {
        ...snapshot,
        status: "blocked",
        waitingFor: undefined,
        blockedReason: reason,
        history: [
          ...snapshot.history,
          completedEntry,
          validationFailed,
          { kind: "workflow_blocked", at: blockedAt, reason },
        ],
        updatedAt: blockedAt,
      },
      effect: { kind: "none" },
    };
  }

  const retryTurnId = deps.createId();
  const retryAt = deps.now();
  const retrySnapshot: WorkflowRuntimeSnapshot = {
    ...snapshot,
    waitingFor: {
      kind: "agent_turn",
      state: state.id,
      stepId: step.id,
      turnId: retryTurnId,
      retryAttempt: nextRetryAttempt,
    },
    history: [
      ...snapshot.history,
      completedEntry,
      validationFailed,
      {
        kind: "agent_turn_planned",
        at: retryAt,
        state: state.id,
        stepId: step.id,
        turnId: retryTurnId,
        retryAttempt: nextRetryAttempt,
      },
    ],
    updatedAt: retryAt,
  };

  return {
    snapshot: retrySnapshot,
    effect: {
      kind: "send_agent_turn",
      role: state.owner,
      state: state.id,
      stepId: step.id,
      turnId: retryTurnId,
      prompt: renderWorkflowPrompt(
        {} as NormalizedAgentWorkflowModel,
        retrySnapshot,
        step,
        { validationErrors: errors },
      ),
    },
  };
}

function buildTransition(
  snapshot: WorkflowRuntimeSnapshot,
  observation: AgentTurnObservation,
  action: NormalizedWorkflowAction,
  validation: Extract<DecisionValidationResult, { valid: true }>,
  step: AgentWorkflowStepV1,
): WorkflowTransitionRecord {
  const rawPolicy = step.response;
  const rawXml = validation.rawXml;
  const rawCap = rawPolicy?.rawXmlMaxChars ?? 20000;
  const rawXmlOriginalChars = rawXml?.length;
  const rawXmlTruncated =
    rawXmlOriginalChars !== undefined && rawXmlOriginalChars > rawCap;
  const transitionBase: WorkflowTransitionRecord = cloneWithDefined({
    visitId: snapshot.visitId,
    fromState: snapshot.currentState,
    toState: action.targetState,
    action: action.id,
    responseRef: observation.responseRef,
    rawXml:
      rawPolicy?.storeRawXml && rawXml !== undefined
        ? rawXml.slice(0, rawCap)
        : undefined,
    rawXmlTruncated: rawPolicy?.storeRawXml && rawXmlTruncated ? true : false,
    rawXmlOriginalChars:
      rawPolicy?.storeRawXml && rawXmlOriginalChars !== undefined
        ? rawXmlOriginalChars
        : undefined,
    parsed: rawPolicy?.storeParsedFields
      ? deepClone(validation.parsed ?? {})
      : undefined,
  });
  if (action.handoff?.prompt) {
    transitionBase.handoffText = renderTemplate(
      action.handoff.prompt.template,
      {
        ...snapshot,
        latestTransition: transitionBase,
      },
    );
  }
  return transitionBase;
}

function extractGithubCiWait(
  action: NormalizedWorkflowAction,
  parsed: Record<string, unknown>,
): { ciRunId?: string; checkRunId?: string; repo?: string; sha?: string } {
  const waitFor = action.waitFor;
  const readString = (
    fieldName: string | undefined,
    fallback: string,
  ): string | undefined => {
    const value = parsed[fieldName ?? fallback];
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
  };
  return cloneWithDefined({
    ciRunId: readString(waitFor?.runIdField, "ciRunId"),
    checkRunId: readString(waitFor?.checkRunIdField, "checkRunId"),
    repo: readString(waitFor?.repoField, "repo"),
    sha: readString(waitFor?.shaField, "sha"),
  });
}

function validateDecisionResultFields(
  stateId: string,
  action: NormalizedWorkflowAction,
  parsed: Record<string, unknown>,
  unknownFields: string[],
): WorkflowRuntimeIssue[] {
  const result = action.result ?? {
    fields: {},
    unknownFields: "reject" as const,
  };
  const fields = result.fields ?? {};
  const issues: WorkflowRuntimeIssue[] = [];

  for (const required of result.required ?? []) {
    if (parsed[required] === undefined) {
      issues.push({
        code: "WORKFLOW_DECISION_MISSING_REQUIRED_FIELD",
        path: `states.${stateId}.actions.${action.id}.result.${required}`,
        message: `required result field ${required} is missing`,
      });
    }
  }

  for (const [fieldName, value] of Object.entries(parsed)) {
    const spec = fields[fieldName];
    if (!spec) {
      if ((result.unknownFields ?? "reject") === "reject") {
        issues.push({
          code: "WORKFLOW_DECISION_UNKNOWN_FIELD",
          path: `states.${stateId}.actions.${action.id}.result.${fieldName}`,
          message: `unknown result field ${fieldName}`,
        });
      }
      continue;
    }
    if (!matchesResultFieldSpec(value, spec)) {
      issues.push({
        code: "WORKFLOW_DECISION_FIELD_TYPE_MISMATCH",
        path: `states.${stateId}.actions.${action.id}.result.${fieldName}`,
        message: `result field ${fieldName} does not match type ${spec.type}${spec.multiple ? "[]" : ""}`,
      });
    }
  }

  if ((result.unknownFields ?? "reject") === "reject") {
    for (const field of unknownFields) {
      if (!Object.hasOwn(fields, field)) {
        issues.push({
          code: "WORKFLOW_DECISION_UNKNOWN_FIELD",
          path: `states.${stateId}.actions.${action.id}.result.${field}`,
          message: `unknown result field ${field}`,
        });
      }
    }
  }

  return issues;
}

function matchesResultFieldSpec(
  value: unknown,
  spec: ResultFieldSpec,
): boolean {
  if (spec.multiple) {
    return (
      Array.isArray(value) &&
      value.every((item) => matchesResultBaseType(item, spec.type))
    );
  }
  return matchesResultBaseType(value, spec.type);
}

function matchesResultBaseType(
  value: unknown,
  type: ResultFieldSpec["type"],
): boolean {
  switch (type) {
    case "string":
    case "markdown":
      return typeof value === "string";
    case "number":
      return typeof value === "number";
    case "boolean":
      return typeof value === "boolean";
  }
}

function isSupportedResultFieldType(
  value: unknown,
): value is ResultFieldSpec["type"] {
  return (
    value === "string" ||
    value === "markdown" ||
    value === "number" ||
    value === "boolean"
  );
}

function renderTemplate(
  template: string,
  snapshot: WorkflowRuntimeSnapshot,
): string {
  return template.replace(
    /\{\{\s*([^}]+?)\s*\}\}/g,
    (_match, expression: string) => {
      const value = readContextValue(snapshot, expression.trim());
      return value === undefined || value === null ? "" : String(value);
    },
  );
}

function readContextValue(
  snapshot: WorkflowRuntimeSnapshot,
  expression: string,
): unknown {
  const parts = expression.split(".");
  if (parts[0] === "inputs") {
    return readPath(snapshot.inputs, parts.slice(1));
  }
  if (parts[0] === "transition") {
    return readPath(snapshot.latestTransition, parts.slice(1));
  }
  if (parts[0] === "human") {
    return readPath(readHumanSubmissions(snapshot), parts.slice(1));
  }
  if (parts[0] === "child") {
    return readPath(readWorkflowCallResults(snapshot), parts.slice(1));
  }
  return undefined;
}

function renderWorkflowCallArgs(
  snapshot: WorkflowRuntimeSnapshot,
  args: Record<string, unknown>,
): Record<string, unknown> {
  const rendered: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    rendered[key] = renderWorkflowCallArgValue(snapshot, value);
  }
  return rendered;
}

function renderWorkflowCallArgValue(
  snapshot: WorkflowRuntimeSnapshot,
  value: unknown,
): unknown {
  if (typeof value === "string") return renderTemplate(value, snapshot);
  if (Array.isArray(value))
    return value.map((item) => renderWorkflowCallArgValue(snapshot, item));
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [
        key,
        renderWorkflowCallArgValue(snapshot, nested),
      ]),
    );
  }
  return deepClone(value);
}

function readHumanSubmissions(
  snapshot: WorkflowRuntimeSnapshot,
): Record<string, Record<string, unknown>> {
  const submissions: Record<string, Record<string, unknown>> = {};
  for (const entry of snapshot.history) {
    if (entry.kind === "human_form_completed")
      submissions[entry.stepId] = entry.submission;
  }
  return submissions;
}

function readWorkflowCallResults(
  snapshot: WorkflowRuntimeSnapshot,
): Record<string, Record<string, unknown>> {
  const calls: Record<string, Record<string, unknown>> = {};
  for (const entry of snapshot.history) {
    if (entry.kind === "workflow_call_completed") {
      calls[entry.stepId] = cloneWithDefined({
        childRunId: entry.childRunId,
        childStatus: entry.childStatus,
        outputRef: entry.outputRef,
        statusSummary: entry.statusSummary,
      });
    }
  }
  return calls;
}

function readPath(source: unknown, parts: string[]): unknown {
  let current = source;
  for (const part of parts) {
    if (!isRecord(current)) {
      return undefined;
    }
    current = current[part];
  }
  return current;
}

function getActiveState(
  model: NormalizedAgentWorkflowModel,
  stateId: string,
): Extract<NormalizedWorkflowState, { terminal: false }> | undefined {
  const state = model.states[stateId];
  return state && !state.terminal ? state : undefined;
}

function validateRoleExecutorPreference(
  value: unknown,
  path: string,
  issues: WorkflowConfigIssue[],
): WorkflowRoleExecutorPreferenceV1 | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    issues.push(
      issue(
        "WORKFLOW_CONFIG_INVALID_ACTIVE_STATE",
        path,
        "executorPreference must be an object",
      ),
    );
    return undefined;
  }
  assertKnownKeys(value, ["executorType", "model", "mode"], path, issues);
  const executorType = value.executorType;
  if (
    typeof executorType !== "string" ||
    !Object.hasOwn(WORKFLOW_EXECUTOR_MODEL_OPTIONS, executorType)
  ) {
    issues.push(
      issue(
        "WORKFLOW_CONFIG_INVALID_ACTIVE_STATE",
        `${path}.executorType`,
        "must be a supported VK executor type",
      ),
    );
  }
  const mode = typeof value.mode === "string" ? value.mode : "preferred";
  if (mode !== "preferred") {
    issues.push(
      issue(
        "WORKFLOW_CONFIG_INVALID_ACTIVE_STATE",
        `${path}.mode`,
        "mode must be preferred",
      ),
    );
  }
  const model = value.model;
  if (model !== undefined) {
    if (typeof model !== "string" || !model.trim()) {
      issues.push(
        issue(
          "WORKFLOW_CONFIG_INVALID_ACTIVE_STATE",
          `${path}.model`,
          "must be a supported model id or alias",
        ),
      );
    } else if (
      typeof executorType === "string" &&
      Object.hasOwn(WORKFLOW_EXECUTOR_MODEL_OPTIONS, executorType) &&
      !WORKFLOW_EXECUTOR_MODEL_OPTIONS[
        executorType as WorkflowExecutorType
      ].models.includes(model)
    ) {
      issues.push(
        issue(
          "WORKFLOW_CONFIG_INVALID_ACTIVE_STATE",
          `${path}.model`,
          `must be supported for ${executorType}`,
        ),
      );
    }
  }
  if (
    typeof executorType !== "string" ||
    !Object.hasOwn(WORKFLOW_EXECUTOR_MODEL_OPTIONS, executorType) ||
    mode !== "preferred" ||
    (model !== undefined && typeof model !== "string")
  ) {
    return undefined;
  }
  return cloneWithDefined({
    executorType: executorType as WorkflowExecutorType,
    model,
    mode: "preferred" as const,
  });
}

function validatePrompt(
  value: unknown,
  path: string,
  issues: WorkflowConfigIssue[],
) {
  if (!isRecord(value)) {
    issues.push(
      issue("WORKFLOW_CONFIG_REQUIRED_FIELD", path, "prompt is required"),
    );
    return;
  }
  assertKnownKeys(value, ["template"], path, issues);
  if (typeof value.template !== "string") {
    issues.push(
      issue(
        "WORKFLOW_CONFIG_REQUIRED_FIELD",
        `${path}.template`,
        "template is required",
      ),
    );
  }
}

function validateHumanFormStep(
  value: Record<string, unknown>,
  path: string,
  issues: WorkflowConfigIssue[],
) {
  if (typeof value.title !== "string" || !value.title.trim()) {
    issues.push(
      issue(
        "WORKFLOW_CONFIG_REQUIRED_FIELD",
        `${path}.title`,
        "human form title is required",
      ),
    );
  }
  if (
    value.description !== undefined &&
    typeof value.description !== "string"
  ) {
    issues.push(
      issue(
        "WORKFLOW_CONFIG_INVALID_STEP",
        `${path}.description`,
        "human form description must be a string",
      ),
    );
  }
  if (!isRecord(value.form)) {
    issues.push(
      issue(
        "WORKFLOW_CONFIG_REQUIRED_FIELD",
        `${path}.form`,
        "human form provider config is required",
      ),
    );
    return;
  }
  assertKnownKeys(
    value.form,
    ["providerType", "formSchema", "submitLabel"],
    `${path}.form`,
    issues,
  );
  if (value.form.providerType !== "beads_form") {
    issues.push(
      issue(
        "WORKFLOW_CONFIG_INVALID_STEP",
        `${path}.form.providerType`,
        "human form providerType must be beads_form",
      ),
    );
  }
  if (value.form.formSchema === undefined) {
    issues.push(
      issue(
        "WORKFLOW_CONFIG_REQUIRED_FIELD",
        `${path}.form.formSchema`,
        "human form formSchema is required",
      ),
    );
  }
  if (
    value.form.submitLabel !== undefined &&
    typeof value.form.submitLabel !== "string"
  ) {
    issues.push(
      issue(
        "WORKFLOW_CONFIG_INVALID_STEP",
        `${path}.form.submitLabel`,
        "human form submitLabel must be a string",
      ),
    );
  }
}

function validateWorkflowCallStep(
  value: Record<string, unknown>,
  path: string,
  issues: WorkflowConfigIssue[],
) {
  if (value.mode !== "blocking") {
    issues.push(
      issue(
        "WORKFLOW_CONFIG_INVALID_STEP",
        `${path}.mode`,
        "workflow_call mode must be blocking",
      ),
    );
  }
  if (!isRecord(value.workflow)) {
    issues.push(
      issue(
        "WORKFLOW_CONFIG_REQUIRED_FIELD",
        `${path}.workflow`,
        "workflow call target is required",
      ),
    );
  } else {
    assertKnownKeys(
      value.workflow,
      ["designId", "version"],
      `${path}.workflow`,
      issues,
    );
    if (
      typeof value.workflow.designId !== "string" ||
      !value.workflow.designId.trim()
    ) {
      issues.push(
        issue(
          "WORKFLOW_CONFIG_REQUIRED_FIELD",
          `${path}.workflow.designId`,
          "workflow designId is required",
        ),
      );
    }
    if (
      value.workflow.version !== undefined &&
      (!Number.isInteger(value.workflow.version) ||
        typeof value.workflow.version !== "number" ||
        value.workflow.version <= 0)
    ) {
      issues.push(
        issue(
          "WORKFLOW_CONFIG_INVALID_STEP",
          `${path}.workflow.version`,
          "workflow version must be a positive integer",
        ),
      );
    }
  }
  if (value.args !== undefined && !isRecord(value.args)) {
    issues.push(
      issue(
        "WORKFLOW_CONFIG_INVALID_STEP",
        `${path}.args`,
        "workflow call args must be an object",
      ),
    );
  }
  if (value.roleBindings !== undefined) {
    if (!isRecord(value.roleBindings)) {
      issues.push(
        issue(
          "WORKFLOW_CONFIG_INVALID_STEP",
          `${path}.roleBindings`,
          "workflow call roleBindings must be an object",
        ),
      );
    } else {
      for (const [roleId, binding] of Object.entries(value.roleBindings)) {
        const bindingPath = `${path}.roleBindings.${roleId}`;
        if (!isRecord(binding)) {
          issues.push(
            issue(
              "WORKFLOW_CONFIG_INVALID_STEP",
              bindingPath,
              "workflow call role binding must be an object",
            ),
          );
          continue;
        }
        assertKnownKeys(binding, ["fromParentRole"], bindingPath, issues);
        if (
          typeof binding.fromParentRole !== "string" ||
          !binding.fromParentRole.trim()
        ) {
          issues.push(
            issue(
              "WORKFLOW_CONFIG_REQUIRED_FIELD",
              `${bindingPath}.fromParentRole`,
              "fromParentRole is required",
            ),
          );
        }
      }
    }
  }
}

function validateDecisionResponse(
  value: unknown,
  path: string,
  issues: WorkflowConfigIssue[],
) {
  if (!isRecord(value)) {
    issues.push(
      issue(
        "WORKFLOW_CONFIG_REQUIRED_FIELD",
        path,
        "decision response policy is required",
      ),
    );
    return;
  }
  assertKnownKeys(
    value,
    [
      "format",
      "schema",
      "invalidXmlRetry",
      "storeRawXml",
      "rawXmlMaxChars",
      "storeParsedFields",
      "unknownFields",
    ],
    path,
    issues,
  );
  if (value.format !== "xml") {
    issues.push(
      issue(
        "WORKFLOW_CONFIG_INVALID_STEP",
        `${path}.format`,
        "decision response format must be xml",
      ),
    );
  }
  if (!isRecord(value.schema)) {
    issues.push(
      issue(
        "WORKFLOW_CONFIG_REQUIRED_FIELD",
        `${path}.schema`,
        "schema is required",
      ),
    );
  } else {
    assertKnownKeys(
      value.schema,
      ["format", "source"],
      `${path}.schema`,
      issues,
    );
    if (value.schema.format !== "xsd") {
      issues.push(
        issue(
          "WORKFLOW_CONFIG_INVALID_STEP",
          `${path}.schema.format`,
          "schema format must be xsd",
        ),
      );
    }
    if (value.schema.source !== "state_actions") {
      issues.push(
        issue(
          "WORKFLOW_CONFIG_INVALID_STEP",
          `${path}.schema.source`,
          "schema source must be state_actions",
        ),
      );
    }
  }
  if (!isRecord(value.invalidXmlRetry)) {
    issues.push(
      issue(
        "WORKFLOW_CONFIG_REQUIRED_FIELD",
        `${path}.invalidXmlRetry`,
        "invalidXmlRetry is required",
      ),
    );
  } else {
    assertKnownKeys(
      value.invalidXmlRetry,
      ["maxAttempts", "prompt", "onExhausted"],
      `${path}.invalidXmlRetry`,
      issues,
    );
    const maxAttempts = value.invalidXmlRetry.maxAttempts;
    if (
      !Number.isInteger(maxAttempts) ||
      typeof maxAttempts !== "number" ||
      maxAttempts < 0
    ) {
      issues.push(
        issue(
          "WORKFLOW_CONFIG_INVALID_STEP",
          `${path}.invalidXmlRetry.maxAttempts`,
          "maxAttempts must be a nonnegative integer",
        ),
      );
    }
    if (
      value.invalidXmlRetry.prompt !== "engine_default_with_validation_errors"
    ) {
      issues.push(
        issue(
          "WORKFLOW_CONFIG_INVALID_STEP",
          `${path}.invalidXmlRetry.prompt`,
          "retry prompt must be engine_default_with_validation_errors",
        ),
      );
    }
    if (value.invalidXmlRetry.onExhausted !== "blocked") {
      issues.push(
        issue(
          "WORKFLOW_CONFIG_INVALID_STEP",
          `${path}.invalidXmlRetry.onExhausted`,
          "retry exhaustion must be blocked",
        ),
      );
    }
  }
  if (typeof value.storeRawXml !== "boolean") {
    issues.push(
      issue(
        "WORKFLOW_CONFIG_INVALID_STEP",
        `${path}.storeRawXml`,
        "storeRawXml must be boolean",
      ),
    );
  }
  const rawXmlMaxChars = value.rawXmlMaxChars;
  if (
    rawXmlMaxChars !== undefined &&
    (!Number.isInteger(rawXmlMaxChars) ||
      typeof rawXmlMaxChars !== "number" ||
      rawXmlMaxChars <= 0)
  ) {
    issues.push(
      issue(
        "WORKFLOW_CONFIG_INVALID_STEP",
        `${path}.rawXmlMaxChars`,
        "rawXmlMaxChars must be a positive integer",
      ),
    );
  }
  if (typeof value.storeParsedFields !== "boolean") {
    issues.push(
      issue(
        "WORKFLOW_CONFIG_INVALID_STEP",
        `${path}.storeParsedFields`,
        "storeParsedFields must be boolean",
      ),
    );
  }
  if (value.unknownFields !== "reject_unless_allowed_by_result_contract") {
    issues.push(
      issue(
        "WORKFLOW_CONFIG_INVALID_STEP",
        `${path}.unknownFields`,
        "unknownFields must be reject_unless_allowed_by_result_contract",
      ),
    );
  }
}

function validateResultContract(
  value: unknown,
  path: string,
  issues: WorkflowConfigIssue[],
) {
  if (value === undefined) {
    return;
  }
  if (!isRecord(value)) {
    issues.push(
      issue(
        "WORKFLOW_CONFIG_INVALID_ACTIVE_STATE",
        path,
        "result must be an object",
      ),
    );
    return;
  }
  assertKnownKeys(value, ["fields", "required", "unknownFields"], path, issues);
  if (!isRecord(value.fields)) {
    issues.push(
      issue(
        "WORKFLOW_CONFIG_REQUIRED_FIELD",
        `${path}.fields`,
        "result fields are required",
      ),
    );
    return;
  }
  for (const [fieldName, field] of Object.entries(value.fields)) {
    const fieldPath = `${path}.fields.${fieldName}`;
    if (!isRecord(field)) {
      issues.push(
        issue(
          "WORKFLOW_CONFIG_INVALID_ACTIVE_STATE",
          fieldPath,
          "field must be an object",
        ),
      );
      continue;
    }
    assertKnownKeys(
      field,
      ["type", "multiple", "description"],
      fieldPath,
      issues,
    );
    if (!isSupportedResultFieldType(field.type)) {
      issues.push(
        issue(
          "WORKFLOW_CONFIG_INVALID_ACTIVE_STATE",
          `${fieldPath}.type`,
          "field type must be string, markdown, number, or boolean",
        ),
      );
    }
    if (field.multiple !== undefined && typeof field.multiple !== "boolean") {
      issues.push(
        issue(
          "WORKFLOW_CONFIG_INVALID_ACTIVE_STATE",
          `${fieldPath}.multiple`,
          "multiple must be boolean",
        ),
      );
    }
  }
  if (
    value.unknownFields !== undefined &&
    value.unknownFields !== "reject" &&
    value.unknownFields !== "preserve"
  ) {
    issues.push(
      issue(
        "WORKFLOW_CONFIG_INVALID_ACTIVE_STATE",
        `${path}.unknownFields`,
        "unknownFields must be reject or preserve",
      ),
    );
  }
  if (value.required !== undefined) {
    if (!Array.isArray(value.required)) {
      issues.push(
        issue(
          "WORKFLOW_CONFIG_INVALID_ACTIVE_STATE",
          `${path}.required`,
          "required must be an array",
        ),
      );
    } else {
      for (const [index, required] of value.required.entries()) {
        if (
          typeof required !== "string" ||
          !Object.hasOwn(value.fields, required)
        ) {
          issues.push(
            issue(
              "WORKFLOW_CONFIG_INVALID_REFERENCE",
              `${path}.required.${index}`,
              "required field must reference result.fields",
            ),
          );
        }
      }
    }
  }
}

function validateWaitFor(
  value: unknown,
  path: string,
  issues: WorkflowConfigIssue[],
) {
  if (value === undefined) return;
  if (!isRecord(value)) {
    issues.push(
      issue(
        "WORKFLOW_CONFIG_INVALID_ACTIVE_STATE",
        path,
        "waitFor must be an object",
      ),
    );
    return;
  }
  assertKnownKeys(
    value,
    ["provider", "runIdField", "checkRunIdField", "repoField", "shaField"],
    path,
    issues,
  );
  if (value.provider !== "github_ci") {
    issues.push(
      issue(
        "WORKFLOW_CONFIG_INVALID_ACTIVE_STATE",
        `${path}.provider`,
        "waitFor provider must be github_ci",
      ),
    );
  }
  for (const field of [
    "runIdField",
    "checkRunIdField",
    "repoField",
    "shaField",
  ] as const) {
    if (
      value[field] !== undefined &&
      (typeof value[field] !== "string" || !value[field].trim())
    ) {
      issues.push(
        issue(
          "WORKFLOW_CONFIG_INVALID_ACTIVE_STATE",
          `${path}.${field}`,
          `${field} must be a non-empty string`,
        ),
      );
    }
  }
}

function requireField(
  record: Record<string, unknown>,
  key: string,
  path: string,
  issues: WorkflowConfigIssue[],
) {
  if (record[key] === undefined) {
    issues.push(issue("WORKFLOW_CONFIG_REQUIRED_FIELD", path, "is required"));
  }
}

function assertKnownKeys(
  record: Record<string, unknown>,
  knownKeys: string[],
  path: string,
  issues: WorkflowConfigIssue[],
  code: WorkflowConfigIssue["code"] = "WORKFLOW_CONFIG_UNKNOWN_FIELD",
) {
  const known = new Set(knownKeys);
  for (const key of Object.keys(record)) {
    if (!known.has(key)) {
      issues.push(issue(code, path ? `${path}.${key}` : key, "unknown field"));
    }
  }
}

function issue(
  code: WorkflowConfigIssue["code"],
  path: string,
  message: string,
): WorkflowConfigIssue {
  return { code, path, message };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function deepClone<T>(value: T): T {
  return value === undefined ? value : structuredClone(value);
}

function cloneWithDefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as T;
}
