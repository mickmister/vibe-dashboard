import type { Kysely } from "kysely";
import type { DB } from "../../../../store/kysely_types";
import type {
  WorkflowPresentationCallTreeItem,
  WorkflowPresentationModel,
  WorkflowPresentationOutputItem,
  WorkflowPresentationTimelineItem,
} from "../../../../server/workflow-presentation-read-model";
import type {
  NormalizedAgentWorkflowModel,
  WorkflowRuntimeIssue,
  WorkflowRuntimeSnapshot,
} from "@vibe-dashboard/workflow-core";
import type { PersistedWorkflowRuntimeEvent } from "./persistedWorkflowRuntime";

export async function buildPersistedWorkflowPresentationModel(args: {
  db: Kysely<DB>;
  runId: string;
}): Promise<WorkflowPresentationModel | null> {
  const row = await args.db
    .selectFrom("WorkflowPersistedRun")
    .selectAll()
    .where("runId", "=", args.runId)
    .executeTakeFirst();
  if (!row) return null;
  const model = JSON.parse(row.coreModelJson) as NormalizedAgentWorkflowModel;
  const snapshot = JSON.parse(row.coreSnapshotJson) as WorkflowRuntimeSnapshot;
  const events = JSON.parse(row.eventsJson) as PersistedWorkflowRuntimeEvent[];
  const roleBindings = JSON.parse(row.roleBindingsJson) as Record<
    string,
    {
      sessionId?: string | null;
      executorType?: string | null;
      executor?: string | null;
      model?: string | null;
    }
  >;
  const queued = JSON.parse(row.queuedTurnsJson) as Record<
    string,
    {
      role: string;
      sessionId: string;
      executorType?: string | null;
      model?: string | null;
    }
  >;
  const timeline = buildTimeline({
    model,
    snapshot,
    events,
    queued,
    workspaceId: row.workspaceId,
  });
  const callTree = buildCallTree(snapshot);
  const outputs = buildOutputs(row.status, snapshot, events, callTree);
  return {
    instanceId: row.runId,
    workflowId: row.designId,
    workflowName: model.name,
    status: row.status === "blocked" ? "failed" : row.status,
    humanStatus: timeline.some((item) => item.status === "Waiting for you")
      ? "waiting_for_user"
      : timeline.some((item) => item.status === "Answered")
        ? "resolved"
        : "not_needed",
    originalTask: originalTask(snapshot.inputs),
    startedAt: row.createdAt,
    updatedAt: row.updatedAt,
    completedAt: row.status === "completed" ? row.updatedAt : null,
    summary: buildSummary(model, snapshot, row.status),
    timeline,
    callTree,
    outputs,
    attention: null,
    provenance: {
      label:
        model.name && row.designVersion
          ? `${model.name} workflow v${row.designVersion}`
          : "Workflow automation",
      workflowName: model.name ?? null,
      workflowDesignId: row.designId,
      workflowVersion: row.designVersion,
      roles: Object.entries(model.roles).map(([roleId, role]) => ({
        roleId,
        roleLabel: role.label ?? roleId,
        sessionId: roleBindings[roleId]?.sessionId ?? null,
        executorType:
          roleBindings[roleId]?.executorType ??
          roleBindings[roleId]?.executor ??
          role.executorPreference?.executorType ??
          null,
        model:
          roleBindings[roleId]?.model ?? role.executorPreference?.model ?? null,
      })),
    },
  };
}

function buildTimeline(args: {
  model: NormalizedAgentWorkflowModel;
  snapshot: WorkflowRuntimeSnapshot;
  events: PersistedWorkflowRuntimeEvent[];
  queued: Record<
    string,
    {
      role: string;
      sessionId: string;
      executorType?: string | null;
      model?: string | null;
    }
  >;
  workspaceId: string;
}): WorkflowPresentationTimelineItem[] {
  const timeline: WorkflowPresentationTimelineItem[] = [];
  for (const entry of args.snapshot.history) {
    if (entry.kind === "agent_turn_planned") {
      const complete = args.snapshot.history.find(
        (candidate) =>
          candidate.kind === "agent_turn_completed" &&
          candidate.turnId === entry.turnId,
      ) as { responseRef: string } | undefined;
      const roleId =
        args.queued[entry.turnId]?.role ??
        roleForState(args.model, entry.state);
      const queueEvent = args.events.find(
        (event) =>
          event.kind === "agent_turn_queued" &&
          event.data.turnId === entry.turnId,
      );
      const promptPreview =
        typeof queueEvent?.data.promptPreview === "string"
          ? queueEvent.data.promptPreview
          : null;
      timeline.push({
        id: entry.turnId,
        role: roleLabel(args.model, roleId),
        title: `${labelFromId(entry.stepId)} turn`,
        kind: "agent_turn",
        state: labelFromId(entry.state),
        step: labelFromId(entry.stepId),
        status: complete ? "Complete" : "Waiting",
        session: args.queued[entry.turnId]?.sessionId
          ? {
              label: sessionLabel(
                roleLabel(args.model, roleId),
                args.queued[entry.turnId]?.executorType,
                args.queued[entry.turnId]?.model,
              ),
              workspaceId: args.workspaceId,
              sessionId: args.queued[entry.turnId]!.sessionId,
            }
          : null,
        initialMessage: promptPreview
          ? {
              text: promptPreview,
              truncated: queueEvent?.data.promptTruncated === true,
              maxChars: 4096,
            }
          : null,
        finalResponse: complete
          ? responseTextFor(args.model, args.snapshot, complete.responseRef)
          : null,
        responseUnavailable: complete
          ? null
          : "This turn is still waiting for a response.",
        commits: [],
      });
    } else if (entry.kind === "state_transitioned") {
      timeline.push({
        id: `decision-${entry.at}-${entry.transition.fromState}-${entry.transition.action}`,
        role: "Workflow",
        title: `Decision: ${labelFromId(entry.transition.action)}`,
        kind: "decision",
        state: `${labelFromId(entry.transition.fromState)} → ${labelFromId(entry.transition.toState)}`,
        step: null,
        action: labelFromId(entry.transition.action),
        isLoop: entry.transition.fromState === entry.transition.toState,
        status:
          entry.transition.fromState === entry.transition.toState
            ? "Looped"
            : "Complete",
        session: null,
        initialMessage: null,
        finalResponse: transitionText(args.model, entry.transition),
        responseUnavailable: null,
        commits: [],
      });
    } else if (entry.kind === "decision_validation_failed") {
      timeline.push({
        id: `retry-${entry.turnId}-${entry.retryAttempt}`,
        role: "Workflow",
        title: "Decision retry requested",
        kind: "retry",
        state: labelFromId(entry.state),
        step: labelFromId(entry.stepId),
        status: "Needs attention",
        session: null,
        initialMessage: null,
        finalResponse: {
          text: entry.errors.map((issue) => issue.message).join("\n"),
          truncated: false,
          maxChars: null,
        },
        responseUnavailable: null,
        commits: [],
      });
    } else if (entry.kind === "workflow_blocked") {
      timeline.push({
        id: `blocked-${entry.at}`,
        role: "Workflow",
        title: "Workflow needs attention",
        kind: "blocked",
        state: null,
        step: null,
        status: "Needs attention",
        session: null,
        initialMessage: null,
        finalResponse: {
          text: entry.reason.message,
          truncated: false,
          maxChars: null,
        },
        responseUnavailable: null,
        commits: [],
      });
    } else if (entry.kind === "human_form_planned") {
      const complete = args.snapshot.history.find(
        (candidate) =>
          candidate.kind === "human_form_completed" &&
          candidate.turnId === entry.turnId,
      ) as { submission: Record<string, unknown> } | undefined;
      timeline.push({
        id: entry.turnId,
        role: "User",
        title: entry.title,
        kind: "human_form",
        state: labelFromId(entry.state),
        step: labelFromId(entry.stepId),
        status: complete ? "Answered" : "Waiting for you",
        session: null,
        initialMessage: { text: entry.title, truncated: false, maxChars: null },
        finalResponse: complete
          ? {
              text: Object.entries(complete.submission)
                .map(([key, value]) => `${key}: ${String(value)}`)
                .join("\n"),
              truncated: false,
              maxChars: null,
            }
          : null,
        responseUnavailable: complete ? null : "Waiting for your answer.",
        commits: [],
      });
    } else if (entry.kind === "command_step_planned") {
      const complete = args.snapshot.history.find(
        (candidate) =>
          candidate.kind === "command_step_completed" &&
          candidate.turnId === entry.turnId,
      ) as
        | { summary: string; artifactRef?: string; result: Record<string, unknown> }
        | undefined;
      timeline.push({
        id: entry.turnId,
        role: "Workflow",
        title: labelFromId(entry.command),
        kind: "command",
        state: labelFromId(entry.state),
        step: labelFromId(entry.stepId),
        status: complete ? "Complete" : "Waiting",
        session: null,
        initialMessage: {
          text: `${labelFromId(entry.provider)} will run ${labelFromId(entry.command)} with ${entry.access} access.`,
          truncated: false,
          maxChars: null,
        },
        finalResponse: complete
          ? {
              text: commandResultText(complete),
              truncated: false,
              maxChars: null,
            }
          : null,
        responseUnavailable: complete
          ? null
          : "Waiting for the bounded command provider to finish.",
        commits: [],
      });
    } else if (entry.kind === "workflow_call_planned") {
      const complete = args.snapshot.history.find(
        (candidate) =>
          candidate.kind === "workflow_call_completed" &&
          candidate.turnId === entry.turnId,
      ) as { statusSummary: string; outputRef?: string } | undefined;
      timeline.push({
        id: entry.turnId,
        role: "Workflow",
        title: `Call ${labelFromId(entry.childDesignId)}`,
        kind: "workflow_call",
        state: labelFromId(entry.state),
        step: labelFromId(entry.stepId),
        status: complete ? "Complete" : "Waiting",
        session: null,
        initialMessage: {
          text: `Started child workflow ${entry.childDesignId}${entry.childVersion ? ` v${entry.childVersion}` : ""}.`,
          truncated: false,
          maxChars: null,
        },
        finalResponse: complete
          ? {
              text: [
                complete.statusSummary,
                complete.outputRef ? `Output: ${complete.outputRef}` : "",
              ]
                .filter(Boolean)
                .join("\n"),
              truncated: false,
              maxChars: null,
            }
          : null,
        responseUnavailable: complete
          ? null
          : "Waiting for child workflow to finish.",
        commits: [],
      });
    } else if (entry.kind === "github_ci_wait_planned") {
      const complete = args.snapshot.history.find(
        (candidate) =>
          candidate.kind === "github_ci_wait_completed" &&
          candidate.turnId === entry.turnId,
      ) as
        | { status: string; statusSummary: string; detailsUrl?: string }
        | undefined;
      const pollError = [...args.events]
        .reverse()
        .find(
          (event) =>
            event.kind === "github_ci_watch_poll_error" &&
            event.data.turnId === entry.turnId,
        );
      const waitingCopy = pollError
        ? `Waiting for GitHub CI. Last polling problem: ${String((pollError.data.error as { message?: unknown } | undefined)?.message ?? "GitHub polling is backing off.")}`
        : "Waiting for GitHub CI to finish.";
      timeline.push({
        id: entry.turnId,
        role: "GitHub CI",
        title: "Wait for CI",
        kind: "github_ci",
        state: labelFromId(entry.state),
        step: labelFromId(entry.stepId),
        status: complete
          ? complete.status === "success"
            ? "Passed"
            : "Needs attention"
          : "Waiting",
        session: null,
        initialMessage: {
          text:
            [
              entry.repo ? `Repository: ${entry.repo}` : "",
              entry.sha ? `Commit: ${entry.sha}` : "",
              entry.ciRunId ? `Run: ${entry.ciRunId}` : "",
              entry.checkRunId ? `Check: ${entry.checkRunId}` : "",
            ]
              .filter(Boolean)
              .join("\n") || "Started GitHub CI watch.",
          truncated: false,
          maxChars: null,
        },
        finalResponse: complete
          ? {
              text: [
                complete.statusSummary,
                complete.detailsUrl ? `Details: ${complete.detailsUrl}` : "",
              ]
                .filter(Boolean)
                .join("\n"),
              truncated: false,
              maxChars: null,
            }
          : null,
        responseUnavailable: complete ? null : waitingCopy,
        commits: [],
      });
    }
  }
  for (const artifact of args.events.filter(
    (event) =>
      event.kind === "form_artifact_created" ||
      event.kind === "form_artifact_failed",
  )) {
    timeline.push({
      id: `artifact-${String(artifact.at)}`,
      role: "Workflow",
      title:
        artifact.kind === "form_artifact_created"
          ? "Form artifact"
          : "Form artifact problem",
      kind: "artifact",
      status:
        artifact.kind === "form_artifact_created"
          ? "Complete"
          : "Needs attention",
      session: null,
      initialMessage: null,
      finalResponse: {
        text:
          artifact.kind === "form_artifact_created"
            ? `Form artifact: ${String(artifact.data.artifactRef)}`
            : `Invalid form schema: ${String(artifact.data.error)}`,
        truncated: false,
        maxChars: null,
      },
      responseUnavailable: null,
      commits: [],
    });
  }
  return timeline;
}

function buildSummary(
  model: NormalizedAgentWorkflowModel,
  snapshot: WorkflowRuntimeSnapshot,
  status: string,
) {
  const waiting = snapshot.waitingFor;
  const state = model.states[snapshot.currentState];
  const currentStep =
    state && !state.terminal ? state.steps[snapshot.currentStepIndex] : null;
  const ownerId = waiting
    ? roleForState(model, waiting.state)
    : state && !state.terminal
      ? state.owner
      : null;
  const blocked = snapshot.blockedReason;
  return {
    statusLabel: status === "blocked" ? "Needs attention" : statusLabel(status),
    currentOwner: ownerId ? roleLabel(model, ownerId) : null,
    currentState: labelFromId(snapshot.currentState),
    currentStep: waiting
      ? labelFromId(waiting.stepId)
      : currentStep
        ? labelFromId(currentStep.id)
        : null,
    waitingReason: blocked
      ? blocked.message
      : waiting
        ? waitingReason(waiting.kind)
        : status === "completed"
          ? null
          : "Planning the next workflow step.",
    nextAction: blocked
      ? nextActionForIssue(blocked)
      : waiting
        ? nextActionForWait(waiting.kind)
        : status === "completed"
          ? "Workflow is complete."
          : "The workflow will continue automatically.",
  };
}

function buildCallTree(
  snapshot: WorkflowRuntimeSnapshot,
): WorkflowPresentationCallTreeItem[] {
  return snapshot.history
    .filter((entry) => entry.kind === "workflow_call_planned")
    .map((entry) => {
      const complete = snapshot.history.find(
        (candidate) =>
          candidate.kind === "workflow_call_completed" &&
          candidate.turnId === entry.turnId,
      ) as
        | { childStatus: string; outputRef?: string; statusSummary: string }
        | undefined;
      return {
        turnId: entry.turnId,
        label: labelFromId(entry.childDesignId),
        status: complete?.childStatus ?? "running",
        childRunId: entry.childRunId,
        childUrl: `/dashboard/workflows/${encodeURIComponent(entry.childRunId)}`,
        waitingReason: complete
          ? null
          : "Parent is waiting for this child workflow to finish.",
        outputRef: complete?.outputRef ?? null,
      };
    });
}

function buildOutputs(
  status: string,
  snapshot: WorkflowRuntimeSnapshot,
  events: PersistedWorkflowRuntimeEvent[],
  calls: WorkflowPresentationCallTreeItem[],
): WorkflowPresentationOutputItem[] {
  const outputs: WorkflowPresentationOutputItem[] = [];
  if (status === "completed")
    outputs.push({
      id: "final-summary",
      label: "Final summary",
      value: snapshot.latestTransition
        ? `Finished after ${labelFromId(snapshot.latestTransition.action)}.`
        : "Workflow completed.",
      kind: "summary",
    });
  if (snapshot.blockedReason)
    outputs.push({
      id: "blocked",
      label: "Needs attention",
      value: snapshot.blockedReason.message,
      kind: "error",
    });
  for (const event of events.filter(
    (entry) =>
      entry.kind === "form_artifact_created" ||
      entry.kind === "form_artifact_failed",
  ))
    outputs.push({
      id: `form-${event.at}`,
      label:
        event.kind === "form_artifact_created"
          ? "Form artifact"
          : "Form artifact problem",
      value:
        event.kind === "form_artifact_created"
          ? String(event.data.artifactRef)
          : String(event.data.error),
      kind: event.kind === "form_artifact_created" ? "form_artifact" : "error",
    });
  for (const entry of snapshot.history.filter(
    (candidate) => candidate.kind === "command_step_completed",
  )) {
    outputs.push({
      id: `command-${entry.turnId}`,
      label: `${labelFromId(entry.command)} result`,
      value: commandResultText(entry),
      kind: "summary",
    });
  }
  for (const call of calls.filter((entry) => entry.outputRef))
    outputs.push({
      id: `call-${call.turnId}`,
      label: `${call.label} output`,
      value: call.outputRef!,
      kind: "workflow_call_output",
    });
  return outputs;
}

function commandResultText(input: {
  summary: string;
  artifactRef?: string;
  result: Record<string, unknown>;
}): string {
  const lines = [input.summary];
  for (const [key, value] of Object.entries(input.result)) {
    if (key === "summary") continue;
    if (value === undefined || value === null || value === "") continue;
    lines.push(`${labelFromId(key)}: ${String(value)}`);
  }
  if (input.artifactRef) lines.push(`Artifact: ${input.artifactRef}`);
  return lines.join("\n");
}

function waitingReason(kind: string): string {
  if (kind === "agent_turn")
    return "Waiting for the assigned agent to respond.";
  if (kind === "human_form")
    return "Waiting for you to submit the requested form.";
  if (kind === "workflow_call")
    return "Waiting for a child workflow to finish.";
  if (kind === "command")
    return "Waiting for a bounded command provider to finish.";
  if (kind === "github_ci") return "Waiting for GitHub CI to finish.";
  return "Waiting to continue.";
}

function nextActionForWait(kind: string): string {
  if (kind === "human_form") return "Answer the form to resume the workflow.";
  if (kind === "workflow_call")
    return "The parent workflow resumes when the child workflow completes.";
  if (kind === "command")
    return "The workflow resumes when the bounded command provider returns a typed result.";
  if (kind === "github_ci")
    return "The workflow resumes when GitHub CI finishes.";
  return "The workflow resumes when the agent turn completes.";
}

function nextActionForIssue(issue: WorkflowRuntimeIssue): string {
  if (issue.code === "WORKFLOW_DECISION_RETRY_EXHAUSTED")
    return "Review the invalid response and choose how to continue.";
  return "Review the problem and update the workflow or run inputs.";
}

function responseTextFor(
  model: NormalizedAgentWorkflowModel,
  snapshot: WorkflowRuntimeSnapshot,
  responseRef: string,
) {
  const transition = snapshot.history.find(
    (entry) =>
      entry.kind === "state_transitioned" &&
      entry.transition.responseRef === responseRef,
  ) as { transition: WorkflowTransitionSummary } | undefined;
  return transition
    ? transitionText(model, transition.transition)
    : { text: "Turn completed.", truncated: false, maxChars: null };
}

type WorkflowTransitionSummary = {
  fromState: string;
  action: string;
  handoffText?: string;
  parsed?: Record<string, unknown>;
};

function transitionText(
  model: NormalizedAgentWorkflowModel,
  transition: WorkflowTransitionSummary,
) {
  const lines: string[] = [];
  if (transition.handoffText?.trim()) lines.push(transition.handoffText.trim());
  lines.push(
    `Action: ${actionLabel(model, transition.fromState, transition.action)}`,
  );
  for (const [key, value] of Object.entries(transition.parsed ?? {})) {
    if (key === "action" || key === "rawXml" || key === "responseRef") continue;
    lines.push(`${labelFromId(key)}: ${formatResultValue(value)}`);
  }
  return { text: lines.join("\n"), truncated: false, maxChars: null };
}

function roleForState(
  model: NormalizedAgentWorkflowModel,
  stateId: string,
): string {
  const state = model.states[stateId];
  return state && !state.terminal ? state.owner : "workflow";
}

function roleLabel(
  model: NormalizedAgentWorkflowModel,
  roleId: string,
): string {
  return model.roles[roleId]?.label ?? labelFromId(roleId);
}

function sessionLabel(
  role: string,
  executorType?: string | null,
  model?: string | null,
): string {
  const details = [executorType, model].filter(Boolean);
  return details.length
    ? `${role} session · ${details.join(" · ")}`
    : `${role} session`;
}

function actionLabel(
  model: NormalizedAgentWorkflowModel,
  stateId: string,
  actionId: string,
): string {
  const state = model.states[stateId];
  return state && !state.terminal
    ? (state.actions[actionId]?.label ?? labelFromId(actionId))
    : labelFromId(actionId);
}

function formatResultValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  if (Array.isArray(value)) return value.map(formatResultValue).join(", ");
  if (value === null || value === undefined) return "";
  return JSON.stringify(value);
}

function labelFromId(id: string): string {
  return id
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function originalTask(inputs: Record<string, unknown>): string | null {
  for (const key of ["featureRequest", "formRequest", "task"]) {
    if (typeof inputs[key] === "string" && inputs[key].trim())
      return inputs[key];
  }
  return null;
}

function statusLabel(status: string): string {
  if (status === "completed") return "Complete";
  if (status === "running") return "In progress";
  if (status === "failed") return "Failed";
  if (status === "cancelled") return "Cancelled";
  return labelFromId(status);
}
