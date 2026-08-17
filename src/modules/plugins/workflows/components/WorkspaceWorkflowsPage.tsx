import React, { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { buildVkSessionUrl } from "../../../../utils/origin";
import { workflowRouteHref } from "./workflowRouteContext";
import { StandaloneDashboardPage } from "../../../../components/StandaloneDashboardPage";
import {
  batchLaunchWorkspaceWorkflow,
  createWorkspaceLane,
  fetchWorkflowLaunchOptions,
  fetchWorkspaceWorkflowsHome,
  launchWorkspaceWorkflow,
  useWorkflowTemplate,
  WorkflowApiError,
  type WorkflowLaunchOptions,
  type WorkflowLaunchRoleBindingRequest,
  type WorkspaceWorkflowInputSummary,
  type WorkspaceWorkflowRoleSummary,
  type WorkspaceWorkflowsHomeModel,
  type WorkspaceWorkflowAttentionSummary,
  type WorkspaceWorkflowBatchSummary,
  type WorkspaceWorkflowRunSummary,
  type WorkspaceLaneOverviewModel,
  type WorkspaceLaneSummary,
  type WorkspaceWorkflowSummary,
  type LaunchWorkspaceWorkflowResponse,
} from "../client/workflowsHomeApi";

export function WorkspaceWorkflowsPage({
  workspaceId: workspaceIdOverride,
  embedded = false,
  routeParams,
}: {
  workspaceId?: string;
  embedded?: boolean;
  routeParams?: URLSearchParams;
  navigate?: (routeName: string) => void;
}): React.ReactElement {
  const [params] = useSearchParams();
  const workspaceId =
    workspaceIdOverride ||
    params.get("workspaceId") ||
    params.get("workspace") ||
    "";
  const [home, setHome] = useState<WorkspaceWorkflowsHomeModel | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setHome(await fetchWorkspaceWorkflowsHome(workspaceId || null));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [workspaceId]);

  return (
    <WorkspaceWorkflowsHomeView
      home={home}
      loading={loading}
      error={error}
      onRefresh={() => void load()}
      onHomeUpdated={setHome}
      embedded={embedded}
      routeParams={params}
    />
  );
}

export function WorkspaceWorkflowsHomeView({
  home,
  loading,
  error,
  onRefresh,
  onHomeUpdated,
  embedded = false,
  routeParams,
}: {
  home: WorkspaceWorkflowsHomeModel | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  onHomeUpdated?: (home: WorkspaceWorkflowsHomeModel) => void;
  embedded?: boolean;
  routeParams?: URLSearchParams;
}): React.ReactElement {
  const [launchWorkflow, setLaunchWorkflow] =
    useState<WorkspaceWorkflowSummary | null>(null);
  const [batchWorkflow, setBatchWorkflow] =
    useState<WorkspaceWorkflowSummary | null>(null);
  const [showCreateLane, setShowCreateLane] = useState(false);
  const activeRuns = useMemo(
    () => (home?.recentRuns ?? []).filter(isActiveRun),
    [home?.recentRuns],
  );
  const summary = useMemo(
    () => workflowDashboardSummary(home, activeRuns),
    [home, activeRuns],
  );
  return (
    <StandaloneDashboardPage
      className={embedded ? "h-full" : ""}
      contentClassName="mx-auto max-w-6xl space-y-5"
    >
      <header className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-xs uppercase tracking-wide text-cyan-300">
              Workspace workflow center
            </div>
            <h1 className="mt-1 text-2xl font-semibold">Workflows</h1>
            <p className="mt-2 max-w-3xl text-sm text-zinc-300">
              Create, run, and monitor workflows for{" "}
              {home?.workspaceId ? (
                <span className="font-medium text-zinc-100">
                  {home.workspaceId}
                </span>
              ) : (
                "all workspaces"
              )}
              .
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <a
              className="rounded-md border border-zinc-700 px-3 py-2 text-sm text-zinc-100 hover:bg-zinc-800"
              href={workflowRouteHref("/dashboard/workflows/roadmap", routeParams)}
            >
              View roadmap
            </a>
            {home?.workspaceId ? (
              <a
                className="rounded-md border border-zinc-700 px-3 py-2 text-sm text-zinc-100 hover:bg-zinc-800"
                href={workflowRouteHref("/dashboard/workflows/meta-runs", routeParams, { workspaceId: home.workspaceId })}
              >
                Meta-workflows
              </a>
            ) : (
              <span
                className="rounded-md border border-zinc-800 px-3 py-2 text-sm text-zinc-500"
                title="Choose a workspace before starting meta-workflows."
              >
                Choose workspace for meta-workflows
              </span>
            )}
            <a
              className="rounded-md bg-cyan-500 px-3 py-2 text-sm font-medium text-zinc-950 hover:bg-cyan-400"
              href={workflowRouteHref("/dashboard/workflows/new", routeParams, { workspaceId: home?.workspaceId ?? null })}
            >
              Create workflow
            </a>
            <button
              className="rounded-md border border-zinc-700 px-3 py-2 text-sm hover:bg-zinc-800 disabled:opacity-50"
              onClick={onRefresh}
              disabled={loading}
            >
              {loading ? "Refreshing…" : "Refresh"}
            </button>
          </div>
        </div>
        <div
          className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
          aria-label="Workflow dashboard summary"
        >
          <SummaryTile
            label="Needs input"
            value={summary.needsInput}
            detail="Items waiting on you"
            tone={summary.needsInput > 0 ? "amber" : "zinc"}
          />
          <SummaryTile
            label="Active runs"
            value={summary.activeRuns}
            detail="Running, waiting, or blocked"
            tone={summary.activeRuns > 0 ? "cyan" : "zinc"}
          />
          <SummaryTile
            label="Your workflows"
            value={summary.userWorkflows}
            detail="Drafts and published designs"
            tone="emerald"
          />
          <SummaryTile
            label="Starter templates"
            value={summary.starterTemplates}
            detail="Copy and customize"
            tone="cyan"
          />
        </div>
      </header>

      {error ? (
        <div
          role="alert"
          className="rounded-lg border border-amber-900 bg-amber-950/30 p-4 text-sm text-amber-100"
        >
          {error}
        </div>
      ) : null}

      {loading ? (
        <div className="rounded-lg border border-cyan-900 bg-cyan-950/20 p-4 text-sm text-cyan-100">
          Loading workflow dashboard…
        </div>
      ) : null}

      <Section
        title={home?.workspaceId ? "Workspace lanes" : "Workspace lanes"}
        description="Optional isolated lanes for workflow and bead work. Host paths stay hidden; lane capacity explains when write work can start."
      >
        <div className="mb-3 flex items-center justify-between gap-3">
          <p className="text-sm text-zinc-400">
            {home?.lanes?.nextAction ??
              "Create a lane when isolated workflow work is needed."}
          </p>
          <button
            type="button"
            className="rounded-md border border-cyan-700 px-3 py-2 text-sm text-cyan-100 hover:bg-cyan-950/40"
            onClick={() => setShowCreateLane(true)}
            disabled={!home?.workspaceId}
          >
            {home?.workspaceId ? "Create lane" : "Choose workspace to create lane"}
          </button>
        </div>
        {home?.lanes?.lanes.length ? (
          <div className="grid gap-3 md:grid-cols-2">
            {home.lanes.lanes.map((lane) => (
              <LaneCard key={lane.laneId} lane={lane} />
            ))}
          </div>
        ) : (
          <EmptyState text="No isolated workflow lanes yet." />
        )}
      </Section>

      <Section title="Needs your input">
        {home?.needsInput.length ? (
          <div className="grid gap-3 md:grid-cols-2">
            {home.needsInput.map((item) => (
              <AttentionCard key={item.attentionItemId} item={item} />
            ))}
          </div>
        ) : (
          <EmptyState text="Nothing needs your input right now." />
        )}
      </Section>

      <Section
        title="Active runs"
        description={home?.workspaceId ? "Runs currently moving, waiting for someone, or needing attention in this workspace." : "Runs currently moving, waiting, or completed across all workspaces."}
      >
        {activeRuns.length ? (
          <div className="space-y-3">
            {activeRuns.map((run) => (
              <ActiveRunRow key={run.runId} run={run} />
            ))}
          </div>
        ) : (
          <EmptyState text="No active workflow runs right now. Start a workflow or open a recent run to review history." />
        )}
      </Section>

      <Section
        title="Your workflows"
        description="Designs you have created, copied, customized, or published."
      >
        {home?.userWorkflows.length ? (
          <div className="grid gap-3 md:grid-cols-2">
            {home.userWorkflows.map((workflow) => (
              <WorkflowCard
                key={`user:${workflow.id}`}
                workflow={workflow}
                workspaceId={home.workspaceId ?? ""}
                onRun={() => setLaunchWorkflow(workflow)}
                onBatch={() => setBatchWorkflow(workflow)}
                onUsed={(updated) => onHomeUpdated?.(updated)}
              />
            ))}
          </div>
        ) : (
          <EmptyState text="No workflows yet. Create a copy from a starter template to make your first workflow." />
        )}
      </Section>

      <Section
        title="Starter templates"
        description="Starting points you can copy and customize before running."
      >
        {home?.starterTemplates.length ? (
          <div className="grid gap-3 md:grid-cols-2">
            {home.starterTemplates.map((workflow) => (
              <WorkflowCard
                key={`starter:${workflow.id}`}
                workflow={workflow}
                workspaceId={home.workspaceId ?? ""}
                onRun={() => setLaunchWorkflow(workflow)}
                onBatch={() => setBatchWorkflow(workflow)}
                onUsed={(updated) => onHomeUpdated?.(updated)}
              />
            ))}
          </div>
        ) : (
          <EmptyState text="No starter templates are available right now." />
        )}
      </Section>

      <Section title="Recent batches">
        {home?.recentBatches.length ? (
          <div className="space-y-3">
            {home.recentBatches.map((batch) => (
              <BatchRow key={batch.batchId} batch={batch} />
            ))}
          </div>
        ) : (
          <EmptyState text="No workflow batches in this workspace yet." />
        )}
      </Section>

      <Section title="Recent runs">
        {home?.recentRuns.length ? (
          <div className="space-y-3">
            {home.recentRuns.map((run) => (
              <RunRow key={run.runId} run={run} />
            ))}
          </div>
        ) : (
          <EmptyState text="No workflow runs in this workspace yet." />
        )}
      </Section>
      {home && launchWorkflow ? (
        <RunWorkflowDialog
          workspaceId={home.workspaceId ?? ""}
          workflow={launchWorkflow}
          onClose={() => setLaunchWorkflow(null)}
          lanes={home.lanes}
          onLaunched={(updated) => {
            onHomeUpdated?.(updated);
          }}
        />
      ) : null}
      {home && showCreateLane ? (
        <CreateLaneDialog
          workspaceId={home.workspaceId ?? ""}
          onClose={() => setShowCreateLane(false)}
          onCreated={() => {
            setShowCreateLane(false);
            onRefresh();
          }}
        />
      ) : null}
      {home && batchWorkflow ? (
        <BatchRunWorkflowDialog
          workspaceId={home.workspaceId ?? ""}
          workflow={batchWorkflow}
          onClose={() => setBatchWorkflow(null)}
          onQueued={(updated) => {
            onHomeUpdated?.(updated);
            setBatchWorkflow(null);
          }}
        />
      ) : null}
    </StandaloneDashboardPage>
  );
}

function workflowDashboardSummary(
  home: WorkspaceWorkflowsHomeModel | null,
  activeRuns: WorkspaceWorkflowRunSummary[],
) {
  return {
    needsInput: home?.needsInput.length ?? 0,
    activeRuns: activeRuns.length,
    userWorkflows: home?.userWorkflows.length ?? 0,
    starterTemplates: home?.starterTemplates.length ?? 0,
  };
}

function isActiveRun(run: WorkspaceWorkflowRunSummary): boolean {
  return !["completed", "failed", "cancelled"].includes(run.status);
}

function SummaryTile({
  label,
  value,
  detail,
  tone,
}: {
  label: string;
  value: number;
  detail: string;
  tone: "emerald" | "cyan" | "amber" | "zinc";
}) {
  const classes = {
    emerald: "border-emerald-900 bg-emerald-950/20 text-emerald-100",
    cyan: "border-cyan-900 bg-cyan-950/20 text-cyan-100",
    amber: "border-amber-900 bg-amber-950/30 text-amber-100",
    zinc: "border-zinc-800 bg-zinc-950/70 text-zinc-100",
  }[tone];
  return (
    <div className={`rounded-lg border p-4 ${classes}`}>
      <div className="text-2xl font-semibold">{value}</div>
      <div className="mt-1 text-sm font-medium">{label}</div>
      <div className="mt-1 text-xs opacity-75">{detail}</div>
    </div>
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5">
      <h2 className="text-lg font-semibold">{title}</h2>
      {description ? (
        <p className="mt-1 text-sm text-zinc-400">{description}</p>
      ) : null}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function WorkflowCard({
  workflow,
  workspaceId,
  onRun,
  onBatch,
  onUsed,
}: {
  workflow: WorkspaceWorkflowSummary;
  workspaceId: string | null;
  onRun: () => void;
  onBatch: () => void;
  onUsed?: (home: WorkspaceWorkflowsHomeModel) => void;
}) {
  const [usingTemplate, setUsingTemplate] = useState(false);
  const [useError, setUseError] = useState<string | null>(null);
  const hasWorkspace = Boolean(workspaceId);
  const handleUseTemplate = async () => {
    if (!workspaceId) {
      setUseError("Choose a workspace before copying this workflow.");
      return;
    }
    setUsingTemplate(true);
    setUseError(null);
    try {
      const used = await useWorkflowTemplate({
        templateId: workflow.id,
        workspaceId,
        publish: true,
      });
      if (used.home) onUsed?.(used.home);
    } catch (caught) {
      setUseError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setUsingTemplate(false);
    }
  };
  return (
    <article className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold">{workflow.title}</h3>
          {workflow.description ? (
            <p className="mt-2 text-sm text-zinc-300">{workflow.description}</p>
          ) : null}
          <p className="mt-3 text-xs text-zinc-500">
            {workflowCaption(workflow)}
          </p>
        </div>
        <StatusPill
          label={workflowStatusLabel(workflow)}
          tone={workflowStatusTone(workflow)}
        />
      </div>
      {workflow.unavailableReason ? (
        <p className="mt-3 text-sm text-amber-200">
          {workflow.unavailableReason}
        </p>
      ) : null}
      {useError ? (
        <p role="alert" className="mt-3 text-sm text-amber-200">
          {useError}
        </p>
      ) : null}
      <div className="mt-4 flex flex-wrap gap-2">
        {workflow.canRun ? (
          <button
            className="rounded-md bg-cyan-500 px-3 py-2 text-sm font-medium text-zinc-950 hover:bg-cyan-400 disabled:opacity-50"
            onClick={onRun}
            disabled={!hasWorkspace}
            title={hasWorkspace ? undefined : "Choose a workspace before running this workflow."}
          >
            {hasWorkspace ? "Run" : "Choose workspace to run"}
          </button>
        ) : null}
        {workflow.canRun ? (
          <button
            className="rounded-md border border-cyan-700 px-3 py-2 text-sm text-cyan-100 hover:bg-cyan-950/40 disabled:opacity-50"
            onClick={onBatch}
            disabled={!hasWorkspace}
            title={hasWorkspace ? undefined : "Choose a workspace before batch running this workflow."}
          >
            Batch run
          </button>
        ) : null}
        {workflow.source === "template" && workflow.status === "ready" ? (
          <button
            className="rounded-md border border-cyan-700 px-3 py-2 text-sm text-cyan-100 hover:bg-cyan-950/40 disabled:opacity-50"
            onClick={handleUseTemplate}
            disabled={usingTemplate}
          >
            {usingTemplate ? "Creating copy…" : "Create copy"}
          </button>
        ) : null}
        {workflow.source === "published_design" ? (
          <a
            className="rounded-md border border-zinc-700 px-3 py-2 text-sm hover:bg-zinc-800"
            href={workflowRouteHref(`/dashboard/workflows/editor/${encodeURIComponent(workflow.id)}`, undefined, { workspaceId: workspaceId ?? null })}
          >
            Edit
          </a>
        ) : null}
      </div>
    </article>
  );
}

function workflowCaption(workflow: WorkspaceWorkflowSummary): string {
  if (workflow.source === "template")
    return "Copy this starter template to make an editable workflow.";
  if (workflow.version) return `Published v${workflow.version}`;
  return "Draft workflow";
}

function workflowStatusLabel(workflow: WorkspaceWorkflowSummary): string {
  if (workflow.source === "template")
    return workflow.status === "ready" ? "Starter template" : "Unavailable";
  if (workflow.version) return `Published v${workflow.version}`;
  return "Draft";
}

function workflowStatusTone(
  workflow: WorkspaceWorkflowSummary,
): "emerald" | "cyan" | "amber" | "red" {
  if (workflow.source === "template" && workflow.status === "ready")
    return "cyan";
  if (workflow.version && workflow.status === "ready") return "emerald";
  return "amber";
}

function RunWorkflowDialog({
  workspaceId,
  workflow,
  onClose,
  lanes,
  onLaunched,
}: {
  workspaceId: string;
  workflow: WorkspaceWorkflowSummary;
  lanes: WorkspaceLaneOverviewModel | null;
  onClose: () => void;
  onLaunched: (home: WorkspaceWorkflowsHomeModel) => void;
}) {
  const [options, setOptions] = useState<WorkflowLaunchOptions | null>(null);
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [additionalInstructions, setAdditionalInstructions] = useState("");
  const [roleModes, setRoleModes] = useState<
    Record<string, "existing" | "create_or_reuse">
  >({});
  const [existingSessions, setExistingSessions] = useState<
    Record<string, string>
  >({});
  const [newSessionNames, setNewSessionNames] = useState<
    Record<string, string>
  >({});
  const [roleExecutorTypes, setRoleExecutorTypes] = useState<
    Record<string, string>
  >({});
  const [roleModels, setRoleModels] = useState<Record<string, string>>({});
  const [selectedLaneId, setSelectedLaneId] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [launched, setLaunched] = useState<
    LaunchWorkspaceWorkflowResponse["run"] | null
  >(null);
  const [launchedFirstSessionId, setLaunchedFirstSessionId] = useState<
    string | null
  >(null);

  useEffect(() => {
    let active = true;
    setLoadError(null);
    fetchWorkflowLaunchOptions(workspaceId, workflow.id, workflow.version)
      .then((loaded) => {
        if (!active) return;
        setOptions(loaded);
        const modes: Record<string, "existing" | "create_or_reuse"> = {};
        const names: Record<string, string> = {};
        const existing: Record<string, string> = {};
        const executorTypes: Record<string, string> = {};
        const models: Record<string, string> = {};
        for (const role of loaded.workflow.roles) {
          executorTypes[role.id] = role.executorPreference?.executorType || "";
          models[role.id] = role.executorPreference?.model || "";
          const matchingSession = loaded.sessions.find(
            (session) =>
              normalizeName(session.name) === normalizeName(role.label) &&
              sessionMatchesRolePreference(session, role),
          );
          modes[role.id] = matchingSession ? "existing" : "create_or_reuse";
          if (matchingSession) existing[role.id] = matchingSession.sessionId;
          names[role.id] = role.label;
        }
        setRoleModes(modes);
        setExistingSessions(existing);
        setNewSessionNames(names);
        setRoleExecutorTypes(executorTypes);
        setRoleModels(models);
      })
      .catch((caught) => {
        if (active)
          setLoadError(
            caught instanceof Error ? caught.message : String(caught),
          );
      });
    return () => {
      active = false;
    };
  }, [workspaceId, workflow.id, workflow.version]);

  const launchWorkflowModel = options?.workflow ?? workflow;
  const launchInputs = useMemo(
    () => launchWorkflowModel.inputs,
    [launchWorkflowModel.inputs],
  );
  const launchRoles = useMemo(
    () => launchWorkflowModel.roles,
    [launchWorkflowModel.roles],
  );
  const selectedSessionSummaries = useMemo(
    () =>
      launchRoles.map((role) => {
        const mode = roleModes[role.id] ?? "existing";
        if (mode === "create_or_reuse")
          return {
            role,
            text: `Create or reuse “${newSessionNames[role.id]?.trim() || role.label}”`,
            executorSummary: executorSummary(
              roleExecutorTypes[role.id] ||
                role.executorPreference?.executorType,
              roleModels[role.id] || role.executorPreference?.model,
            ),
            warning: null as string | null,
          };
        const session = options?.sessions.find(
          (candidate) => candidate.sessionId === existingSessions[role.id],
        );
        const warning =
          session && session.workspaceId !== workspaceId
            ? `${role.label} session belongs to another workspace.`
            : session &&
                !sessionMatchesRolePreference(session, role, {
                  executorType: roleExecutorTypes[role.id],
                  model: roleModels[role.id],
                })
              ? `${role.label} session uses ${formatSessionExecutorModel(session)}, but the workflow prefers ${formatEffectiveRoleExecutorPreference(role, { executorType: roleExecutorTypes[role.id], model: roleModels[role.id] })}.`
              : null;
        return {
          role,
          text: session
            ? session.name || session.sessionId
            : "No session selected",
          executorSummary: session
            ? formatSessionExecutorModel(session)
            : executorSummary(roleExecutorTypes[role.id], roleModels[role.id]),
          warning,
        };
      }),
    [
      existingSessions,
      launchRoles,
      newSessionNames,
      options?.sessions,
      roleExecutorTypes,
      roleModels,
      roleModes,
      workspaceId,
    ],
  );
  const useCreateReuseForAllRoles = () => {
    setRoleModes(
      Object.fromEntries(
        launchRoles.map((role) => [role.id, "create_or_reuse"]),
      ),
    );
    setNewSessionNames((current) =>
      Object.fromEntries(
        launchRoles.map((role) => [
          role.id,
          current[role.id]?.trim() || role.label,
        ]),
      ),
    );
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const nextErrors: Record<string, string> = {};
    for (const input of launchInputs) {
      if (input.required && !inputs[input.id]?.trim())
        nextErrors[input.id] = "This field is required.";
    }
    const roleBindings: Record<string, WorkflowLaunchRoleBindingRequest> = {};
    for (const role of launchRoles) {
      const mode = roleModes[role.id] ?? "existing";
      if (mode === "existing") {
        const sessionId = existingSessions[role.id];
        if (!sessionId)
          nextErrors[`role.${role.id}`] = `Choose a session for ${role.label}.`;
        roleBindings[role.id] = buildLaunchRoleBinding({
          mode,
          sessionId: sessionId ?? "",
          executorType: roleExecutorTypes[role.id],
          model: roleModels[role.id],
        });
      } else {
        const name = newSessionNames[role.id]?.trim() || role.label;
        roleBindings[role.id] = buildLaunchRoleBinding({
          mode,
          name,
          executorType: roleExecutorTypes[role.id],
          model: roleModels[role.id],
        });
      }
    }
    setFieldErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;
    setSubmitting(true);
    try {
      setLaunchedFirstSessionId(
        Object.values(roleBindings).find(
          (binding) => binding.mode === "existing",
        )?.sessionId ?? null,
      );
      const launched = await launchWorkspaceWorkflow({
        workspaceId,
        designId: workflow.id,
        version: workflow.version,
        inputs,
        additionalInstructions: additionalInstructions.trim() || null,
        roleBindings,
        laneId: selectedLaneId || null,
      });
      setLaunched(launched.run);
      if (launched.home) onLaunched(launched.home);
    } catch (caught) {
      if (caught instanceof WorkflowApiError)
        setFieldErrors({ form: caught.message, ...caught.fieldErrors });
      else
        setFieldErrors({
          form: caught instanceof Error ? caught.message : String(caught),
        });
    } finally {
      setSubmitting(false);
    }
  };

  const firstSessionHref = launchedFirstSessionId
    ? buildVkSessionUrl({ workspaceId, sessionId: launchedFirstSessionId })
    : null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`Run ${workflow.title}`}
    >
      <form
        onSubmit={submit}
        className="max-h-[90vh] w-full max-w-3xl overflow-auto rounded-xl border border-zinc-700 bg-zinc-950 p-5 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-xs uppercase tracking-wide text-cyan-300">
              Run workflow
            </div>
            <h2 className="mt-1 text-xl font-semibold">{workflow.title}</h2>
          </div>
          <button
            type="button"
            className="rounded-md border border-zinc-700 px-3 py-2 text-sm"
            onClick={onClose}
          >
            Close
          </button>
        </div>
        {launched ? (
          <LaunchSuccess
            run={launched}
            firstSessionHref={firstSessionHref}
            onClose={onClose}
          />
        ) : null}
        {loadError ? (
          <div
            role="alert"
            className="mt-4 rounded-md border border-amber-900 bg-amber-950/30 p-3 text-sm text-amber-100"
          >
            {loadError}
          </div>
        ) : null}
        {fieldErrors.form ? (
          <div
            role="alert"
            className="mt-4 rounded-md border border-amber-900 bg-amber-950/30 p-3 text-sm text-amber-100"
          >
            {fieldErrors.form}
          </div>
        ) : null}

        {!launched ? (
          <div className="mt-5 space-y-5">
            <LaunchSummary
              workflow={launchWorkflowModel}
              inputs={launchInputs}
              selectedSessions={selectedSessionSummaries}
            />

            <div className="space-y-3">
              <h3 className="font-medium">Workflow inputs</h3>
              {launchInputs.length ? (
                launchInputs.map((input) => (
                  <WorkflowInputField
                    key={input.id}
                    input={input}
                    value={inputs[input.id] ?? ""}
                    error={fieldErrors[input.id]}
                    onChange={(value) =>
                      setInputs((current) => ({
                        ...current,
                        [input.id]: value,
                      }))
                    }
                  />
                ))
              ) : (
                <p className="text-sm text-zinc-400">
                  This workflow has no required inputs.
                </p>
              )}
            </div>

            <label className="block">
              <span className="text-sm font-medium">
                Additional instructions for this run
              </span>
              <textarea
                className="mt-2 min-h-24 w-full rounded-md border border-zinc-700 bg-zinc-900 p-3 text-sm"
                value={additionalInstructions}
                onChange={(event) =>
                  setAdditionalInstructions(event.target.value)
                }
                placeholder="Optional notes for this run only"
              />
              <p className="mt-1 text-xs text-zinc-500">
                Applies only to this run. It will not change the workflow design
                or future runs.
              </p>
            </label>

            <label className="block">
              <span className="text-sm font-medium">
                Isolated workflow lane
              </span>
              <select
                className="mt-2 w-full rounded-md border border-zinc-700 bg-zinc-950 p-2 text-sm"
                value={selectedLaneId}
                onChange={(event) => setSelectedLaneId(event.target.value)}
                aria-label="Workflow lane"
              >
                <option value="">No lane selected</option>
                {(lanes?.lanes ?? [])
                  .filter((lane) => lane.status !== "archived")
                  .map((lane) => (
                    <option key={lane.laneId} value={lane.laneId}>
                      {lane.label} · {lane.status} · write{" "}
                      {lane.capacity.write.status}
                    </option>
                  ))}
              </select>
              <p className="mt-1 text-xs text-zinc-500">
                Select a lane when this workflow will use write-capable typed
                providers. Host paths are hidden; write capacity is checked by
                the provider.
              </p>
            </label>

            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="font-medium">Role sessions</h3>
                  <p className="mt-1 text-xs text-zinc-500">
                    Only sessions from this workspace are shown. Creating by
                    role name will reuse a matching session or create one.
                  </p>
                </div>
                <button
                  type="button"
                  className="rounded-md border border-cyan-700 px-3 py-2 text-sm text-cyan-100 hover:bg-cyan-950/40"
                  onClick={useCreateReuseForAllRoles}
                >
                  Create sessions for all roles
                </button>
              </div>
              {launchRoles.map((role) => {
                const selected = selectedSessionSummaries.find(
                  (entry) => entry.role.id === role.id,
                );
                return (
                  <div
                    key={role.id}
                    className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-4"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="font-medium">{role.label}</div>
                      <span className="text-xs text-zinc-400">
                        {selected?.text}
                      </span>
                    </div>
                    <div className="mt-2 text-xs text-cyan-200">
                      Executor/model:{" "}
                      {selected?.executorSummary ?? "Workspace default"}
                    </div>
                    <p className="mt-1 text-xs text-zinc-400">
                      {formatRoleExecutorPreference(role)}
                    </p>
                    <div className="mt-3 grid gap-3 md:grid-cols-2">
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="radio"
                          checked={
                            (roleModes[role.id] ?? "existing") === "existing"
                          }
                          onChange={() =>
                            setRoleModes((current) => ({
                              ...current,
                              [role.id]: "existing",
                            }))
                          }
                        />{" "}
                        Choose existing session
                      </label>
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="radio"
                          checked={roleModes[role.id] === "create_or_reuse"}
                          onChange={() =>
                            setRoleModes((current) => ({
                              ...current,
                              [role.id]: "create_or_reuse",
                            }))
                          }
                        />{" "}
                        Create or reuse by name
                      </label>
                    </div>
                    {(roleModes[role.id] ?? "existing") === "existing" ? (
                      <select
                        aria-label={`${role.label} session`}
                        className="mt-3 w-full rounded-md border border-zinc-700 bg-zinc-950 p-2 text-sm"
                        value={existingSessions[role.id] ?? ""}
                        onChange={(event) =>
                          setExistingSessions((current) => ({
                            ...current,
                            [role.id]: event.target.value,
                          }))
                        }
                      >
                        <option value="">Select a session</option>
                        {(options?.sessions ?? []).map((session) => (
                          <option
                            key={session.sessionId}
                            value={session.sessionId}
                          >
                            {session.name || session.sessionId} ·{" "}
                            {formatSessionExecutorModel(session)}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        aria-label={`${role.label} session name`}
                        className="mt-3 w-full rounded-md border border-zinc-700 bg-zinc-950 p-2 text-sm"
                        value={newSessionNames[role.id] ?? role.label}
                        onChange={(event) =>
                          setNewSessionNames((current) => ({
                            ...current,
                            [role.id]: event.target.value,
                          }))
                        }
                      />
                    )}
                    <div className="mt-3 grid gap-3 md:grid-cols-2">
                      <label className="block text-xs text-zinc-400">
                        Executor
                        <select
                          aria-label={`${role.label} executor`}
                          className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-950 p-2 text-sm text-zinc-100"
                          value={roleExecutorTypes[role.id] ?? ""}
                          onChange={(event) => {
                            const nextExecutor = event.target.value;
                            const firstModel = nextExecutor
                              ? (options?.executorOptions?.find(
                                  (option) =>
                                    option.executorType === nextExecutor,
                                )?.models[0] ?? "recommended")
                              : "";
                            setRoleExecutorTypes((current) => ({
                              ...current,
                              [role.id]: nextExecutor,
                            }));
                            setRoleModels((current) => ({
                              ...current,
                              [role.id]: firstModel,
                            }));
                          }}
                        >
                          <option value="">Workspace default</option>
                          {(options?.executorOptions ?? []).map((option) => (
                            <option
                              key={option.executorType}
                              value={option.executorType}
                            >
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="block text-xs text-zinc-400">
                        Model
                        <select
                          aria-label={`${role.label} model`}
                          className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-950 p-2 text-sm text-zinc-100"
                          value={roleModels[role.id] ?? ""}
                          disabled={!roleExecutorTypes[role.id]}
                          onChange={(event) =>
                            setRoleModels((current) => ({
                              ...current,
                              [role.id]: event.target.value,
                            }))
                          }
                        >
                          <option value="">Workspace default</option>
                          {(
                            options?.executorOptions?.find(
                              (option) =>
                                option.executorType ===
                                roleExecutorTypes[role.id],
                            )?.models ?? []
                          ).map((model) => (
                            <option key={model} value={model}>
                              {model}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    {selected?.warning ? (
                      <p role="alert" className="mt-2 text-sm text-amber-200">
                        {selected.warning}
                      </p>
                    ) : null}
                    {fieldErrors[`role.${role.id}`] ? (
                      <p className="mt-2 text-sm text-amber-200">
                        {fieldErrors[`role.${role.id}`]}
                      </p>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}

        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            className="rounded-md border border-zinc-700 px-3 py-2 text-sm"
            onClick={onClose}
          >
            {launched ? "Done" : "Cancel"}
          </button>
          {!launched ? (
            <button
              type="submit"
              className="rounded-md bg-cyan-500 px-3 py-2 text-sm font-medium text-zinc-950 disabled:opacity-60"
              disabled={submitting || Boolean(loadError)}
            >
              {submitting ? "Launching…" : "Launch workflow"}
            </button>
          ) : null}
        </div>
      </form>
    </div>
  );
}

function BatchRunWorkflowDialog({
  workspaceId,
  workflow,
  onClose,
  onQueued,
}: {
  workspaceId: string;
  workflow: WorkspaceWorkflowSummary;
  onClose: () => void;
  onQueued: (home: WorkspaceWorkflowsHomeModel) => void;
}) {
  const [itemsText, setItemsText] = useState(
    '{"featureRequest":"First item"}\n{"featureRequest":"Second item"}',
  );
  const [options, setOptions] = useState<WorkflowLaunchOptions | null>(null);
  const [sessionId, setSessionId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let active = true;
    fetchWorkflowLaunchOptions(workspaceId, workflow.id, workflow.version)
      .then((loaded) => {
        if (!active) return;
        setOptions(loaded);
        setSessionId(loaded.sessions[0]?.sessionId ?? "");
      })
      .catch((caught) => {
        if (active)
          setError(caught instanceof Error ? caught.message : String(caught));
      });
    return () => {
      active = false;
    };
  }, [workspaceId, workflow.id, workflow.version]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    let parsedItems: Array<{ inputs: Record<string, unknown> }> = [];
    try {
      parsedItems = itemsText
        .split(/\n+/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => ({
          inputs: JSON.parse(line) as Record<string, unknown>,
        }));
    } catch {
      setError("Each batch line must be a JSON object.");
      return;
    }
    if (!parsedItems.length) {
      setError("Add at least one batch item.");
      return;
    }
    const roles = options?.workflow.roles ?? workflow.roles;
    const roleBindings = Object.fromEntries(
      roles.map((role) => [role.id, { mode: "existing" as const, sessionId }]),
    );
    if (!sessionId) {
      setError("Choose a session for this batch.");
      return;
    }
    setSubmitting(true);
    try {
      const result = await batchLaunchWorkspaceWorkflow({
        workspaceId,
        designId: workflow.id,
        version: workflow.version,
        items: parsedItems,
        roleBindings,
      });
      if (result.home) onQueued(result.home);
      else onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`Batch run ${workflow.title}`}
    >
      <form
        onSubmit={submit}
        className="w-full max-w-2xl rounded-xl border border-zinc-700 bg-zinc-950 p-5 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-xs uppercase tracking-wide text-cyan-300">
              Batch run
            </div>
            <h2 className="mt-1 text-xl font-semibold">{workflow.title}</h2>
          </div>
          <button
            type="button"
            className="rounded-md border border-zinc-700 px-3 py-2 text-sm"
            onClick={onClose}
          >
            Close
          </button>
        </div>
        {error ? (
          <div
            role="alert"
            className="mt-4 rounded-md border border-amber-900 bg-amber-950/30 p-3 text-sm text-amber-100"
          >
            {error}
          </div>
        ) : null}
        <label className="mt-5 block">
          <span className="text-sm font-medium">Batch items</span>
          <textarea
            aria-label="Batch items"
            className="mt-2 min-h-40 w-full rounded-md border border-zinc-700 bg-zinc-900 p-3 font-mono text-sm"
            value={itemsText}
            onChange={(event) => setItemsText(event.target.value)}
          />
        </label>
        <label className="mt-4 block">
          <span className="text-sm font-medium">Session for roles</span>
          <select
            aria-label="Batch session"
            className="mt-2 w-full rounded-md border border-zinc-700 bg-zinc-950 p-2 text-sm"
            value={sessionId}
            onChange={(event) => setSessionId(event.target.value)}
          >
            <option value="">Select a session</option>
            {(options?.sessions ?? []).map((session) => (
              <option key={session.sessionId} value={session.sessionId}>
                {session.name || session.sessionId}
              </option>
            ))}
          </select>
        </label>
        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            className="rounded-md border border-zinc-700 px-3 py-2 text-sm"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="rounded-md bg-cyan-500 px-3 py-2 text-sm font-medium text-zinc-950 disabled:opacity-60"
            disabled={submitting}
          >
            {submitting ? "Queueing…" : "Queue batch"}
          </button>
        </div>
      </form>
    </div>
  );
}

export function LaunchSummary({
  workflow,
  inputs,
  selectedSessions,
}: {
  workflow: WorkspaceWorkflowSummary;
  inputs: WorkspaceWorkflowInputSummary[];
  selectedSessions: Array<{
    role: { id: string; label: string };
    text: string;
    executorSummary?: string;
    warning: string | null;
  }>;
}) {
  const requiredInputs = inputs
    .filter((input) => input.required)
    .map((input) => input.id);
  const summary = workflow.launchSummary ?? emptyClientLaunchSummary();
  return (
    <section
      className="rounded-lg border border-cyan-900/60 bg-cyan-950/20 p-4"
      aria-label="Launch summary"
    >
      <div className="text-xs uppercase tracking-wide text-cyan-300">
        Launch summary
      </div>
      <h3 className="mt-1 font-semibold">
        {workflow.title}
        {workflow.version ? ` · Published v${workflow.version}` : ""}
      </h3>
      <dl className="mt-3 grid gap-3 text-sm md:grid-cols-2">
        <div>
          <dt className="text-zinc-500">Required inputs</dt>
          <dd>{requiredInputs.length ? requiredInputs.join(", ") : "None"}</dd>
        </div>
        <div>
          <dt className="text-zinc-500">First actor</dt>
          <dd>
            {summary.firstActorLabel ?? "Not specified"}
            {summary.firstStateId ? ` in ${summary.firstStateId}` : ""}
          </dd>
        </div>
        <div>
          <dt className="text-zinc-500">Human input</dt>
          <dd>
            {summary.mayNeedHumanInput
              ? "This workflow may ask you for input."
              : "No human input step is expected."}
          </dd>
        </div>
        <div>
          <dt className="text-zinc-500">Workflow calls</dt>
          <dd>
            {summary.mayCallWorkflows
              ? "This workflow may call another workflow."
              : "No child workflow call is expected."}
          </dd>
        </div>
      </dl>
      <div className="mt-3 rounded-md border border-zinc-800 bg-zinc-950/70 p-3">
        <div className="text-sm font-medium">Selected sessions</div>
        <ul className="mt-2 space-y-1 text-sm text-zinc-300">
          {selectedSessions.map((entry) => (
            <li key={entry.role.id}>
              <span className="text-zinc-500">{entry.role.label}:</span>{" "}
              {entry.text}
              {entry.executorSummary ? (
                <span className="ml-2 text-cyan-200">
                  {entry.executorSummary}
                </span>
              ) : null}
              {entry.warning ? (
                <span className="ml-2 text-amber-200">{entry.warning}</span>
              ) : null}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

export function LaunchSuccess({
  run,
  firstSessionHref,
  onClose,
}: {
  run: LaunchWorkspaceWorkflowResponse["run"];
  firstSessionHref: string | null;
  onClose: () => void;
}) {
  return (
    <section
      className="mt-5 rounded-lg border border-emerald-800 bg-emerald-950/30 p-4"
      aria-label="Launch result"
    >
      <div className="text-xs uppercase tracking-wide text-emerald-200">
        Workflow launched
      </div>
      <h3 className="mt-1 font-semibold">
        Run is {humanRunStatus(run.status).toLowerCase()}.
      </h3>
      <div className="mt-4 flex flex-wrap gap-2">
        {run.detailUrl ? (
          <a
            className="rounded-md bg-cyan-500 px-3 py-2 text-sm font-medium text-zinc-950 hover:bg-cyan-400"
            href={run.detailUrl}
          >
            Open run page
          </a>
        ) : null}
        {firstSessionHref ? (
          <a
            className="rounded-md border border-cyan-700 px-3 py-2 text-sm text-cyan-100 hover:bg-cyan-950/40"
            href={firstSessionHref}
            target="_blank"
            rel="noreferrer"
          >
            Open first session
          </a>
        ) : null}
        <button
          type="button"
          className="rounded-md border border-zinc-700 px-3 py-2 text-sm hover:bg-zinc-800"
          onClick={onClose}
        >
          Back to workflows
        </button>
      </div>
    </section>
  );
}

export function buildLaunchRoleBinding(
  args:
    | {
        mode: "existing";
        sessionId: string;
        executorType?: string | null;
        model?: string | null;
      }
    | {
        mode: "create_or_reuse";
        name: string;
        executorType?: string | null;
        model?: string | null;
      },
): WorkflowLaunchRoleBindingRequest {
  const executorType = args.executorType?.trim() || undefined;
  const model = args.model?.trim() || undefined;
  if (args.mode === "existing") {
    return {
      mode: args.mode,
      sessionId: args.sessionId,
      ...(executorType ? { executorType } : {}),
      ...(model ? { model } : {}),
    };
  }
  return {
    mode: args.mode,
    name: args.name,
    ...(executorType ? { executorType } : {}),
    ...(model ? { model } : {}),
  };
}

function executorSummary(executorType?: string | null, model?: string | null) {
  if (!executorType && !model) return "Workspace default";
  return [executorType || "Default executor", model || "default model"]
    .filter(Boolean)
    .join(" · ");
}

function emptyClientLaunchSummary() {
  return {
    firstStateId: null,
    firstActorRoleId: null,
    firstActorLabel: null,
    mayNeedHumanInput: false,
    mayCallWorkflows: false,
  };
}

function normalizeName(value: string | null): string {
  return (value ?? "").trim().toLowerCase();
}

function WorkflowInputField({
  input,
  value,
  error,
  onChange,
}: {
  input: WorkspaceWorkflowInputSummary;
  value: string;
  error?: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium">
        {input.id}
        {input.required ? " *" : ""}
      </span>
      <textarea
        className="mt-2 min-h-20 w-full rounded-md border border-zinc-700 bg-zinc-900 p-3 text-sm"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      {input.description ? (
        <p className="mt-1 text-xs text-zinc-500">{input.description}</p>
      ) : null}
      {error ? <p className="mt-1 text-sm text-amber-200">{error}</p> : null}
    </label>
  );
}

function BatchRow({ batch }: { batch: WorkspaceWorkflowBatchSummary }) {
  const classes = "rounded-lg border border-zinc-800 bg-zinc-950 p-4";
  const errorCount =
    batch.counts.failed + batch.counts.blocked + batch.counts.cancelled;
  const items = batch.items ?? [];
  return (
    <div className={classes}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold">{batch.workflowName}</h3>
          <p className="mt-1 text-sm text-zinc-400">
            {batch.counts.completed} complete · {batch.counts.running} running ·{" "}
            {batch.counts.pending} pending · {errorCount} errors
          </p>
        </div>
        <StatusPill
          label={humanBatchStatus(batch.status)}
          tone={
            batch.status === "completed"
              ? "emerald"
              : batch.status === "failed"
                ? "amber"
                : "cyan"
          }
        />
      </div>
      {batch.detailUrl ? (
        <a
          className="mt-3 inline-block rounded-md border border-cyan-900 px-3 py-2 text-sm text-cyan-200 hover:bg-cyan-950/40"
          href={batch.detailUrl}
        >
          Open batch details
        </a>
      ) : null}
      {items.length ? (
        <details className="mt-3 rounded-md border border-zinc-800 bg-zinc-900/50 p-3">
          <summary className="cursor-pointer text-sm font-medium text-zinc-200">
            Batch item details
          </summary>
          <ul className="mt-3 space-y-2">
            {items.map((item) => (
              <BatchItemRow
                key={item.batchItemId ?? `${batch.batchId}-${item.itemIndex}`}
                item={item}
              />
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

function BatchItemRow({
  item,
}: {
  item: NonNullable<WorkspaceWorkflowBatchSummary["items"]>[number];
}) {
  const lineNumber = item.itemIndex + 1;
  const fieldErrors = item.error?.fieldErrors
    ? Object.entries(item.error.fieldErrors)
    : [];
  const isError =
    item.status === "failed" ||
    item.status === "blocked" ||
    item.status === "cancelled";
  return (
    <li
      className={`rounded-md border p-3 text-sm ${isError ? "border-amber-900 bg-amber-950/20" : "border-zinc-800 bg-zinc-950/60"}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">Line {lineNumber}</span>
        <span className={isError ? "text-amber-200" : "text-zinc-300"}>
          {humanBatchItemStatus(item.status)}
        </span>
      </div>
      {item.error ? (
        <div className="mt-2 text-amber-100">
          <p>{item.error.message}</p>
          {fieldErrors.length ? (
            <ul className="mt-1 list-disc pl-5 text-amber-200">
              {fieldErrors.map(([field, message]) => (
                <li key={field}>
                  {field}: {message}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

function ActiveRunRow({ run }: { run: WorkspaceWorkflowRunSummary }) {
  const body = (
    <>
      <div>
        <h3 className="font-semibold">{run.workflowName}</h3>
        <p className="mt-1 text-sm text-zinc-300">
          {activeRunExplanation(run)}
        </p>
        <p className="mt-1 text-xs text-zinc-500">
          Updated {formatTime(run.updatedAt)}
        </p>
      </div>
      <StatusPill
        label={humanRunStatus(run.status)}
        tone={runStatusTone(run.status)}
      />
    </>
  );
  const classes =
    "flex flex-wrap items-center justify-between gap-3 rounded-lg border border-cyan-900/70 bg-cyan-950/10 p-4";
  return run.detailUrl ? (
    <a className={`${classes} hover:border-cyan-600`} href={run.detailUrl}>
      {body}
    </a>
  ) : (
    <div className={classes}>{body}</div>
  );
}

function activeRunExplanation(run: WorkspaceWorkflowRunSummary): string {
  if (run.status === "blocked")
    return "Needs attention before the workflow can continue.";
  if (run.status === "waiting")
    return "Waiting for the next response or result before continuing.";
  if (run.status === "running")
    return "Running now. Open the run page to see who has the next step.";
  return "In progress. Open the run page to see what happens next.";
}

function runStatusTone(status: string): "emerald" | "cyan" | "amber" | "red" {
  if (status === "completed") return "emerald";
  if (status === "blocked") return "amber";
  if (status === "failed") return "red";
  return "cyan";
}

function RunRow({ run }: { run: WorkspaceWorkflowRunSummary }) {
  const body = (
    <>
      <div>
        <h3 className="font-semibold">{run.workflowName}</h3>
        <p className="mt-1 text-sm text-zinc-400">
          Updated {formatTime(run.updatedAt)}
        </p>
      </div>
      <StatusPill
        label={humanRunStatus(run.status)}
        tone={runStatusTone(run.status)}
      />
    </>
  );
  const classes =
    "flex flex-wrap items-center justify-between gap-3 rounded-lg border border-zinc-800 bg-zinc-950 p-4";
  return run.detailUrl ? (
    <a className={`${classes} hover:border-cyan-800`} href={run.detailUrl}>
      {body}
    </a>
  ) : (
    <div className={classes}>{body}</div>
  );
}

function AttentionCard({ item }: { item: WorkspaceWorkflowAttentionSummary }) {
  const body = (
    <article className="rounded-lg border border-amber-900 bg-amber-950/30 p-4">
      <div className="text-xs uppercase tracking-wide text-amber-200">
        Needs your input
      </div>
      <h3 className="mt-1 font-semibold">{item.title}</h3>
      {item.description ? (
        <p className="mt-2 text-sm text-amber-50">{item.description}</p>
      ) : null}
      <p className="mt-3 text-xs text-amber-200">{item.workflowName}</p>
      <p className="mt-1 text-xs text-amber-100/80">
        The workflow resumes after you submit the requested input.
      </p>
    </article>
  );
  return item.detailUrl ? (
    <a className="block hover:opacity-90" href={item.detailUrl}>
      {body}
    </a>
  ) : (
    body
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-lg border border-dashed border-zinc-800 bg-zinc-950 p-6 text-sm text-zinc-400">
      {text}
    </div>
  );
}

function LaneCard({ lane }: { lane: WorkspaceLaneSummary }) {
  const write = lane.capacity.write;
  return (
    <article className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-wide text-cyan-300">
            Isolated lane
          </div>
          <h3 className="mt-1 font-semibold text-zinc-100">{lane.label}</h3>
          <p className="mt-1 text-sm text-zinc-400">{lane.purpose}</p>
        </div>
        <StatusPill
          label={lane.status}
          tone={
            lane.status === "blocked"
              ? "amber"
              : lane.status === "archived"
                ? "red"
                : "cyan"
          }
        />
      </div>
      <dl className="mt-4 grid gap-2 text-xs text-zinc-300 sm:grid-cols-2">
        <div>
          <dt className="text-zinc-500">Worktree</dt>
          <dd>{lane.worktree.display}</dd>
        </div>
        <div>
          <dt className="text-zinc-500">Write capacity</dt>
          <dd>
            {write.status === "held"
              ? `Held by ${write.ownerId ?? "workflow"}`
              : write.status}
          </dd>
        </div>
        <div>
          <dt className="text-zinc-500">Source branch</dt>
          <dd>{lane.sourceBranch}</dd>
        </div>
        <div>
          <dt className="text-zinc-500">Bindings</dt>
          <dd>{lane.boundRunIds.length + lane.boundBeadIds.length}</dd>
        </div>
      </dl>
      <p className="mt-3 text-xs text-zinc-500">{lane.nextAction}</p>
    </article>
  );
}

function CreateLaneDialog({
  workspaceId,
  onClose,
  onCreated,
}: {
  workspaceId: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [purpose, setPurpose] = useState("");
  const [sourceBranch, setSourceBranch] = useState("main");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await createWorkspaceLane({ workspaceId, name, purpose, sourceBranch });
      onCreated();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSubmitting(false);
    }
  };
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Create workflow lane"
    >
      <form
        onSubmit={submit}
        className="w-full max-w-lg rounded-xl border border-zinc-700 bg-zinc-950 p-5 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-xs uppercase tracking-wide text-cyan-300">
              Lane
            </div>
            <h2 className="mt-1 text-xl font-semibold">
              Create workflow lane
            </h2>
            <p className="mt-2 text-sm text-zinc-400">
              Create an isolated lane record for workflow or bead work. Host
              paths are not shown or selected here.
            </p>
          </div>
          <button
            type="button"
            className="rounded-md border border-zinc-700 px-3 py-1 text-sm"
            onClick={onClose}
          >
            Close
          </button>
        </div>
        <div className="mt-5 space-y-4">
          <label className="block text-sm">
            Lane name
            <input
              className="mt-2 w-full rounded-md border border-zinc-700 bg-zinc-900 p-2"
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
            />
          </label>
          <label className="block text-sm">
            Purpose
            <textarea
              className="mt-2 min-h-20 w-full rounded-md border border-zinc-700 bg-zinc-900 p-2"
              value={purpose}
              onChange={(event) => setPurpose(event.target.value)}
              required
            />
          </label>
          <label className="block text-sm">
            Source branch
            <input
              className="mt-2 w-full rounded-md border border-zinc-700 bg-zinc-900 p-2"
              value={sourceBranch}
              onChange={(event) => setSourceBranch(event.target.value)}
              required
            />
          </label>
        </div>
        {error ? (
          <p role="alert" className="mt-3 text-sm text-amber-200">
            {error}
          </p>
        ) : null}
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            className="rounded-md border border-zinc-700 px-3 py-2 text-sm"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="rounded-md bg-cyan-500 px-3 py-2 text-sm font-medium text-zinc-950 disabled:opacity-50"
            disabled={submitting}
          >
            {submitting ? "Creating…" : "Create lane"}
          </button>
        </div>
      </form>
    </div>
  );
}

function StatusPill({
  label,
  tone,
}: {
  label: string;
  tone: "emerald" | "cyan" | "amber" | "red";
}) {
  const classes = {
    emerald: "border-emerald-800 bg-emerald-950/40 text-emerald-200",
    cyan: "border-cyan-800 bg-cyan-950/40 text-cyan-200",
    amber: "border-amber-800 bg-amber-950/40 text-amber-200",
    red: "border-red-800 bg-red-950/40 text-red-200",
  }[tone];
  return (
    <span className={`rounded-full border px-2.5 py-1 text-xs ${classes}`}>
      {label}
    </span>
  );
}

function humanBatchStatus(status: string): string {
  if (status === "completed") return "Complete";
  if (status === "failed") return "Finished with errors";
  if (status === "cancelled") return "Cancelled";
  return "Running";
}

function humanBatchItemStatus(status: string): string {
  if (status === "completed") return "Complete";
  if (status === "running") return "Running";
  if (status === "pending") return "Pending";
  if (status === "blocked") return "Needs attention";
  if (status === "cancelled") return "Cancelled";
  if (status === "failed") return "Failed";
  return status;
}

function humanRunStatus(status: string): string {
  if (status === "completed") return "Complete";
  if (status === "blocked") return "Needs attention";
  if (status === "failed") return "Failed";
  if (status === "cancelled") return "Cancelled";
  return "Running";
}

function formatRoleExecutorPreference(
  role: WorkspaceWorkflowRoleSummary,
): string {
  const preference = role.executorPreference;
  if (!preference?.executorType && !preference?.model) {
    return "Executor/model: workspace default";
  }
  const parts = [
    preference.executorType
      ? `Executor ${preference.executorType}`
      : "Default executor",
    preference.model ? `Model ${preference.model}` : "default model",
  ];
  return parts.join(" · ");
}

function formatSessionExecutorModel(session: {
  executor: string;
  model?: string | null;
}): string {
  return session.model
    ? `${session.executor} · ${session.model}`
    : session.executor;
}

function formatEffectiveRoleExecutorPreference(
  role: WorkspaceWorkflowRoleSummary,
  override: { executorType?: string | null; model?: string | null } = {},
): string {
  const executorType =
    override.executorType || role.executorPreference?.executorType;
  const model = override.model || role.executorPreference?.model;
  if (!executorType && !model) return "workspace default";
  return executorSummary(executorType, model);
}

function sessionMatchesRolePreference(
  session: { executor: string; model?: string | null },
  role: WorkspaceWorkflowRoleSummary,
  override: { executorType?: string | null; model?: string | null } = {},
): boolean {
  const preferred = (
    override.executorType || role.executorPreference?.executorType
  )
    ?.trim()
    .toUpperCase()
    .replace(/[-\s]+/g, "_");
  const preferredModel = (
    override.model || role.executorPreference?.model
  )?.trim();
  return (
    (!preferred || session.executor === preferred) &&
    (!preferredModel || !session.model || session.model === preferredModel)
  );
}

function formatTime(value: number): string {
  if (!Number.isFinite(value)) return "recently";
  return new Date(value).toLocaleString();
}
