import React, { useEffect, useState } from "react";
import { useParams } from "react-router";
import {
  fetchWorkflowPresentation,
  type WorkflowPresentationModel,
  type WorkflowPresentationTimelineItem,
} from "../lib/workflowPresentationApi";
import { buildVkSessionUrl } from "../utils/origin";
import { StandaloneDashboardPage } from "./StandaloneDashboardPage";

export function WorkflowPresentationPage(): React.ReactElement {
  const params = useParams();
  return <WorkflowPresentationById instanceId={params.instanceId ?? ""} />;
}

export function WorkflowPresentationById({
  instanceId,
}: {
  instanceId: string;
}): React.ReactElement {
  const [presentation, setPresentation] =
    useState<WorkflowPresentationModel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    if (!instanceId) {
      setError("Workflow not found");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setPresentation(await fetchWorkflowPresentation(instanceId));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [instanceId]);

  return (
    <WorkflowPresentationView
      presentation={presentation}
      error={error}
      loading={loading}
      onRefresh={() => void load()}
    />
  );
}

export function WorkflowPresentationView({
  presentation,
  error,
  loading,
  onRefresh,
}: {
  presentation: WorkflowPresentationModel | null;
  error: string | null;
  loading: boolean;
  onRefresh: () => void;
}): React.ReactElement {
  if (loading && !presentation) {
    return (
      <StandaloneDashboardPage contentClassName="mx-auto max-w-5xl text-sm text-zinc-400">
        Loading workflow…
      </StandaloneDashboardPage>
    );
  }
  if (error && !presentation) {
    return (
      <StandaloneDashboardPage contentClassName="mx-auto max-w-5xl">
        <div className="rounded-lg border border-red-900 bg-red-950/30 p-5">
          <h1 className="text-xl font-semibold">Workflow not found</h1>
          <p className="mt-2 text-sm text-red-100">{error}</p>
        </div>
      </StandaloneDashboardPage>
    );
  }
  if (!presentation) {
    return (
      <StandaloneDashboardPage contentClassName="mx-auto max-w-5xl">
        Workflow not found
      </StandaloneDashboardPage>
    );
  }

  return (
    <StandaloneDashboardPage contentClassName="mx-auto max-w-5xl space-y-5">
      <header className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-xs uppercase tracking-wide text-cyan-300">
              Workflow
            </div>
            <h1 className="mt-1 text-2xl font-semibold">
              {presentation.workflowName}
            </h1>
            <div className="mt-2 flex flex-wrap gap-2 text-xs">
              <StatusPill
                label={statusLabel(presentation.status)}
                tone={statusTone(presentation.status)}
              />
              <StatusPill
                label={humanStatusLabel(presentation.humanStatus)}
                tone={
                  presentation.humanStatus === "waiting_for_user"
                    ? "amber"
                    : "zinc"
                }
              />
            </div>
          </div>
          <button
            className="rounded-md border border-zinc-700 px-3 py-2 text-sm hover:bg-zinc-800 disabled:opacity-50"
            onClick={onRefresh}
            disabled={loading}
          >
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
        {presentation.provenance ? (
          <ProvenanceBanner provenance={presentation.provenance} />
        ) : null}
        {presentation.summary ? (
          <RunSummary summary={presentation.summary} />
        ) : null}
        {presentation.originalTask ? (
          <section className="mt-5 rounded-lg border border-zinc-800 bg-zinc-950 p-4">
            <h2 className="text-sm font-medium text-zinc-200">Original task</h2>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-zinc-100">
              {presentation.originalTask}
            </p>
          </section>
        ) : null}
        {error ? (
          <div
            role="alert"
            className="mt-4 rounded border border-amber-900 bg-amber-950/30 p-3 text-sm text-amber-100"
          >
            {error}
          </div>
        ) : null}
      </header>

      {presentation.attention?.status === "active" ? (
        <section className="rounded-xl border border-amber-900 bg-amber-950/30 p-5">
          <div className="text-xs uppercase tracking-wide text-amber-200">
            Needs your input
          </div>
          <h2 className="mt-1 text-lg font-semibold">
            {presentation.attention.title}
          </h2>
          {presentation.attention.description ? (
            <p className="mt-2 whitespace-pre-wrap text-sm text-amber-50">
              {presentation.attention.description}
            </p>
          ) : null}
          {presentation.attention.formRef ? (
            <div className="mt-3 text-sm text-amber-100">
              Open the linked form to continue.
            </div>
          ) : null}
        </section>
      ) : null}

      {presentation.callTree?.length ? (
        <CallTree items={presentation.callTree} />
      ) : null}

      {presentation.outputs?.length ? (
        <OutputsSection outputs={presentation.outputs} />
      ) : null}

      <section className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5">
        <h2 className="text-lg font-semibold">Timeline</h2>
        <div className="mt-4 space-y-4">
          {presentation.timeline.length ? (
            presentation.timeline.map((item) => (
              <TurnCard key={item.id} item={item} />
            ))
          ) : (
            <p className="text-sm text-zinc-400">No timeline entries yet.</p>
          )}
        </div>
      </section>
    </StandaloneDashboardPage>
  );
}

function ProvenanceBanner({
  provenance,
}: {
  provenance: NonNullable<WorkflowPresentationModel["provenance"]>;
}) {
  const detail = [
    provenance.workflowName,
    provenance.workflowVersion ? `v${provenance.workflowVersion}` : null,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <section
      className="mt-5 rounded-lg border border-cyan-900/60 bg-cyan-950/20 p-4"
      aria-label="Automation provenance"
    >
      <div className="text-xs uppercase tracking-wide text-cyan-300">
        Started by automation
      </div>
      <p className="mt-1 text-sm text-cyan-50">{provenance.label}</p>
      {detail ? (
        <p className="mt-1 text-xs text-cyan-200">Workflow: {detail}</p>
      ) : null}
    </section>
  );
}

function RunSummary({
  summary,
}: {
  summary: NonNullable<WorkflowPresentationModel["summary"]>;
}) {
  return (
    <section
      className="mt-5 rounded-lg border border-cyan-900/60 bg-cyan-950/20 p-4"
      aria-label="Run summary"
    >
      <div className="grid gap-3 text-sm md:grid-cols-2">
        <SummaryField label="Status" value={summary.statusLabel} />
        <SummaryField
          label="Who has the ball"
          value={summary.currentOwner ?? "Workflow"}
        />
        <SummaryField
          label="Current state"
          value={summary.currentState ?? "Not started"}
        />
        <SummaryField
          label="Current step"
          value={summary.currentStep ?? "Not started"}
        />
      </div>
      {summary.waitingReason ? (
        <p className="mt-3 rounded-md border border-amber-900 bg-amber-950/30 p-3 text-sm text-amber-100">
          {summary.waitingReason}
        </p>
      ) : null}
      {summary.nextAction ? (
        <p className="mt-3 text-sm text-cyan-100">Next: {summary.nextAction}</p>
      ) : null}
    </section>
  );
}

function SummaryField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-zinc-500">
        {label}
      </div>
      <div className="mt-1 font-medium text-zinc-100">{value}</div>
    </div>
  );
}

function CallTree({
  items,
}: {
  items: NonNullable<WorkflowPresentationModel["callTree"]>;
}) {
  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5">
      <h2 className="text-lg font-semibold">Child workflows</h2>
      <div className="mt-4 space-y-3">
        {items.map((item) => (
          <div
            key={item.turnId}
            className="rounded-lg border border-zinc-800 bg-zinc-950 p-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="font-semibold">{item.label}</h3>
                {item.waitingReason ? (
                  <p className="mt-1 text-sm text-amber-100">
                    {item.waitingReason}
                  </p>
                ) : null}
              </div>
              <StatusPill
                label={callStatusLabel(item.status)}
                tone={
                  item.status === "completed"
                    ? "emerald"
                    : item.status === "failed" || item.status === "blocked"
                      ? "red"
                      : "cyan"
                }
              />
            </div>
            {item.outputRef ? (
              <p className="mt-2 text-sm text-zinc-300">Output recorded.</p>
            ) : null}
            {item.childUrl ? (
              <a
                className="mt-3 inline-block rounded-md border border-cyan-900 px-3 py-2 text-sm text-cyan-200 hover:bg-cyan-950/40"
                href={item.childUrl}
              >
                Open child run
              </a>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
}

function OutputsSection({
  outputs,
}: {
  outputs: NonNullable<WorkflowPresentationModel["outputs"]>;
}) {
  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5">
      <h2 className="text-lg font-semibold">Outputs and artifacts</h2>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {outputs.map((output) => (
          <article
            key={output.id}
            className="rounded-lg border border-zinc-800 bg-zinc-950 p-4"
          >
            <div className="text-xs uppercase tracking-wide text-zinc-500">
              {output.kind.replace(/_/g, " ")}
            </div>
            <h3 className="mt-1 font-semibold">{output.label}</h3>
            <p className="mt-2 whitespace-pre-wrap text-sm text-zinc-200">
              {output.value}
            </p>
          </article>
        ))}
      </div>
    </section>
  );
}

function TurnCard({ item }: { item: WorkflowPresentationTimelineItem }) {
  const sessionHref = item.session
    ? buildVkSessionUrl({
        workspaceId: item.session.workspaceId,
        sessionId: item.session.sessionId,
      })
    : null;
  return (
    <article className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs uppercase tracking-wide text-zinc-500">
              {item.role}
            </span>
            {item.kind ? (
              <span className="rounded border border-zinc-700 px-2 py-0.5 text-xs text-zinc-400">
                {item.kind.replace(/_/g, " ")}
              </span>
            ) : null}
            {item.isLoop ? (
              <span className="rounded border border-amber-800 px-2 py-0.5 text-xs text-amber-200">
                Loop
              </span>
            ) : null}
          </div>
          <h3 className="mt-1 font-semibold text-zinc-100">{item.title}</h3>
          {item.state || item.step ? (
            <p className="mt-1 text-xs text-zinc-500">
              {[item.state, item.step].filter(Boolean).join(" · ")}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill
            label={item.status}
            tone={
              item.status === "Complete" || item.status === "Answered"
                ? "emerald"
                : item.status === "Waiting" || item.status === "Waiting for you"
                  ? "amber"
                  : "zinc"
            }
          />
          {sessionHref ? (
            <a
              className="rounded-md border border-cyan-900 px-2 py-1 text-xs text-cyan-200 hover:bg-cyan-950/40"
              href={sessionHref}
              target="_blank"
              rel="noreferrer"
            >
              Open {item.role} session
            </a>
          ) : null}
        </div>
      </div>
      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <TextBlock
          title="Initial message"
          text={item.initialMessage}
          empty="Initial message unavailable."
        />
        <TextBlock
          title="Final response"
          text={item.finalResponse}
          empty={item.responseUnavailable ?? "Final response unavailable."}
        />
      </div>
      {item.commits.length ? (
        <div className="mt-4 rounded-md border border-zinc-800 bg-zinc-900/60 p-3">
          <h4 className="text-sm font-medium">Commits</h4>
          <ul className="mt-2 space-y-1 text-xs text-zinc-300">
            {item.commits.map((commit, index) => (
              <li key={index}>
                {commit.before ?? "start"} →{" "}
                {commit.after ?? commit.merge ?? "latest"}
                {commit.merge ? ` · merge ${commit.merge}` : ""}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </article>
  );
}

function TextBlock({
  title,
  text,
  empty,
}: {
  title: string;
  text: { text: string; truncated: boolean; maxChars: number | null } | null;
  empty: string;
}) {
  return (
    <section className="rounded-md border border-zinc-800 bg-zinc-900/60 p-3">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-sm font-medium text-zinc-200">{title}</h4>
        {text?.truncated ? (
          <span className="rounded border border-amber-800 px-2 py-0.5 text-xs text-amber-200">
            Truncated
          </span>
        ) : null}
      </div>
      {text ? (
        <p className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap text-sm leading-6 text-zinc-100">
          {text.text}
        </p>
      ) : (
        <p className="mt-2 text-sm text-zinc-400">{empty}</p>
      )}
      {text?.truncated && text.maxChars ? (
        <p className="mt-2 text-xs text-amber-200">
          Showing the first {text.maxChars} characters.
        </p>
      ) : null}
    </section>
  );
}

function StatusPill({
  label,
  tone,
}: {
  label: string;
  tone: "emerald" | "cyan" | "amber" | "red" | "zinc";
}) {
  const classes = {
    emerald: "border-emerald-800 bg-emerald-950/40 text-emerald-200",
    cyan: "border-cyan-800 bg-cyan-950/40 text-cyan-200",
    amber: "border-amber-800 bg-amber-950/40 text-amber-200",
    red: "border-red-800 bg-red-950/40 text-red-200",
    zinc: "border-zinc-700 bg-zinc-900 text-zinc-300",
  }[tone];
  return (
    <span className={`rounded-full border px-2.5 py-1 text-xs ${classes}`}>
      {label}
    </span>
  );
}

function statusLabel(status: WorkflowPresentationModel["status"]): string {
  switch (status) {
    case "completed":
      return "Complete";
    case "waiting":
      return "Waiting";
    case "running":
      return "In progress";
    case "failed":
      return "Needs attention";
    case "cancelled":
      return "Closed";
    case "paused":
      return "Paused";
    default:
      return "Starting";
  }
}

function callStatusLabel(status: string): string {
  if (status === "completed") return "Complete";
  if (status === "running") return "In progress";
  if (status === "blocked" || status === "failed") return "Needs attention";
  if (status === "cancelled") return "Closed";
  return status.replace(/[_-]+/g, " ");
}

function statusTone(
  status: WorkflowPresentationModel["status"],
): "emerald" | "cyan" | "amber" | "red" | "zinc" {
  if (status === "completed") return "emerald";
  if (status === "running") return "cyan";
  if (status === "waiting" || status === "paused") return "amber";
  if (status === "failed") return "red";
  return "zinc";
}

function humanStatusLabel(
  status: WorkflowPresentationModel["humanStatus"],
): string {
  switch (status) {
    case "waiting_for_user":
      return "Waiting for you";
    case "resolved":
      return "User answered";
    case "cancelled":
      return "No user action";
    default:
      return "No user action";
  }
}
