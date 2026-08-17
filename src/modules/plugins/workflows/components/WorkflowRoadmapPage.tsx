import React, { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { StandaloneDashboardPage } from "../../../../components/StandaloneDashboardPage";
import {
  fetchWorkflowRoadmap,
  type WorkflowRoadmapItemStatus,
  type WorkflowRoadmapMilestone,
  type WorkflowRoadmapModel,
} from "../client/workflowRoadmapApi";
import { workflowRouteHref } from "./workflowRouteContext";

export function WorkflowRoadmapPage(): React.ReactElement {
  const [searchParams] = useSearchParams();
  const searchKey = searchParams.toString();
  const [roadmap, setRoadmap] = useState<WorkflowRoadmapModel | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setRoadmap(await fetchWorkflowRoadmap(searchParams));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [searchKey]);

  return (
    <WorkflowRoadmapView
      roadmap={roadmap}
      loading={loading}
      error={error}
      onRefresh={() => void load()}
      backHref={workflowRouteHref("/dashboard/workflows", searchParams)}
    />
  );
}

export function WorkflowRoadmapView({
  roadmap,
  loading,
  error,
  onRefresh,
  backHref = "/dashboard/workflows",
  embedded = false,
}: {
  roadmap: WorkflowRoadmapModel | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  backHref?: string;
  embedded?: boolean;
}): React.ReactElement {
  const grouped = useMemo(
    () => groupMilestones(roadmap?.milestones ?? []),
    [roadmap?.milestones],
  );
  return (
    <StandaloneDashboardPage
      className={embedded ? "h-full" : ""}
      contentClassName="mx-auto max-w-7xl space-y-5"
    >
      <header className="rounded-xl border border-slate-800 bg-slate-900/70 p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-xs uppercase tracking-wide text-cyan-300">
              Workflow roadmap
            </div>
            <h1 className="mt-1 text-2xl font-semibold">
              {roadmap?.title ?? "Workflow roadmap"}
            </h1>
            <p className="mt-2 max-w-3xl text-sm text-zinc-300">
              {roadmap?.description ?? "Loading workflow milestone progress."}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <a
              className="rounded-md border border-zinc-700 px-3 py-2 text-sm text-zinc-100 hover:bg-zinc-800"
              href={backHref}
            >
              Back to Workflows
            </a>
            <button
              type="button"
              onClick={onRefresh}
              disabled={loading}
              className="rounded-md border border-cyan-800 px-3 py-2 text-sm text-cyan-100 hover:bg-cyan-950/40 disabled:opacity-60"
            >
              {loading ? "Refreshing…" : "Refresh"}
            </button>
          </div>
        </div>
        <div
          className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-6"
          aria-label="Roadmap status summary"
        >
          <RoadmapMetric
            label="Complete"
            value={roadmap?.statusCounts.complete ?? 0}
            tone="emerald"
          />
          <RoadmapMetric
            label="In progress"
            value={roadmap?.statusCounts.in_progress ?? 0}
            tone="cyan"
          />
          <RoadmapMetric
            label="Review"
            value={roadmap?.statusCounts.review ?? 0}
            tone="violet"
          />
          <RoadmapMetric
            label="Tester"
            value={roadmap?.statusCounts.tester ?? 0}
            tone="amber"
          />
          <RoadmapMetric
            label="Blocked"
            value={roadmap?.statusCounts.blocked ?? 0}
            tone="rose"
          />
          <RoadmapMetric
            label="Remaining"
            value={roadmap?.statusCounts.remaining ?? 0}
            tone="zinc"
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
      {loading && !roadmap ? (
        <div className="rounded-lg border border-cyan-900 bg-cyan-950/20 p-4 text-sm text-cyan-100">
          Loading workflow roadmap…
        </div>
      ) : null}

      {roadmap && roadmap.milestones.length === 0 ? (
        <section className="rounded-xl border border-slate-800 bg-slate-900/70 p-5">
          <h2 className="font-semibold">No roadmap selected</h2>
          <p className="mt-2 text-sm text-zinc-400">
            {roadmap.nextAction ??
              "Choose a workflow spike to see milestone progress."}
          </p>
        </section>
      ) : null}

      {roadmap?.nextAction ? (
        <section
          className="rounded-xl border border-cyan-900/60 bg-cyan-950/20 p-4"
          aria-label="Recommended next action"
        >
          <div className="text-xs uppercase tracking-wide text-cyan-300">
            Recommended next action
          </div>
          <p className="mt-1 text-sm text-cyan-50">{roadmap.nextAction}</p>
        </section>
      ) : null}

      {roadmap ? (
        <section className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_18rem]">
          <div className="space-y-3" aria-label="Workflow milestone list">
            {roadmap.milestones.map((milestone, index) => (
              <MilestoneCard
                key={milestone.beadId}
                milestone={milestone}
                index={index}
              />
            ))}
          </div>
          <aside className="space-y-4">
            <section className="rounded-xl border border-slate-800 bg-slate-900/70 p-4">
              <div className="text-xs uppercase tracking-wide text-cyan-300">
                Source
              </div>
              <h2 className="mt-1 font-semibold">{roadmap.source.label}</h2>
              <p className="mt-2 text-sm text-zinc-400">
                {roadmap.source.description}
              </p>
              <p className="mt-3 text-xs text-zinc-500">
                Generated {formatTime(roadmap.generatedAt)}
                {roadmap.stale ? " · may be stale" : ""}
              </p>
              <dl className="mt-3 space-y-1 text-xs text-zinc-400">
                <div className="flex justify-between gap-3">
                  <dt>Freshness</dt>
                  <dd className="text-zinc-200">{freshnessLabel(roadmap.source.freshness)}</dd>
                </div>
                {roadmap.source.providerId ? (
                  <div className="flex justify-between gap-3">
                    <dt>Provider</dt>
                    <dd className="break-all text-zinc-200">{roadmap.source.providerId}</dd>
                  </div>
                ) : null}
                <div className="flex justify-between gap-3">
                  <dt>Counts</dt>
                  <dd className="text-zinc-200">Top-level milestones</dd>
                </div>
                {roadmap.source.updatedAt ? (
                  <div className="flex justify-between gap-3">
                    <dt>Updated</dt>
                    <dd className="text-zinc-200">{formatTime(roadmap.source.updatedAt)}</dd>
                  </div>
                ) : null}
              </dl>
              {roadmap.source.warnings.length ? (
                <ul className="mt-3 space-y-1 text-xs text-amber-200">
                  {roadmap.source.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              ) : null}
            </section>
            <section className="rounded-xl border border-slate-800 bg-slate-900/70 p-4">
              <div className="text-xs uppercase tracking-wide text-zinc-500">
                Status groups
              </div>
              <ul className="mt-3 space-y-2 text-sm">
                {Object.entries(grouped).map(([status, items]) => (
                  <li
                    key={status}
                    className="flex items-center justify-between gap-2"
                  >
                    <span className="text-zinc-300">
                      {statusLabel(status as WorkflowRoadmapItemStatus)}
                    </span>
                    <span className="rounded-full border border-zinc-700 px-2 py-0.5 text-xs text-zinc-200">
                      {items.length}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          </aside>
        </section>
      ) : null}
    </StandaloneDashboardPage>
  );
}

function MilestoneCard({
  milestone,
  index,
}: {
  milestone: WorkflowRoadmapMilestone;
  index: number;
}): React.ReactElement {
  return (
    <details
      className="rounded-xl border border-slate-800 bg-slate-900/70 p-4"
      open={milestone.status !== "complete"}
    >
      <summary className="cursor-pointer list-none">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs uppercase tracking-wide text-zinc-500">
              {String(index + 1).padStart(2, "0")} · {milestone.milestone}
            </div>
            <h2 className="mt-1 text-lg font-semibold text-zinc-50">
              {milestone.title}
            </h2>
            <p className="mt-1 text-sm text-zinc-300">{milestone.summary}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill status={milestone.status} />
            <span className="rounded-full border border-slate-700 px-2 py-1 text-xs text-zinc-300">
              {milestone.priority}
            </span>
          </div>
        </div>
      </summary>
      <div className="mt-4 grid gap-4 md:grid-cols-[minmax(0,1fr)_16rem]">
        <div>
          <div className="grid gap-3 sm:grid-cols-2">
            <InfoBlock
              label="Review/tester state"
              value={reviewStateLabel(milestone.reviewState)}
            />
            <InfoBlock
              label="Next action"
              value={milestone.nextAction ?? "No next action."}
            />
          </div>
          {milestone.dependencies.length ? (
            <div className="mt-3 rounded-lg border border-slate-800 bg-slate-950 p-3 text-sm text-zinc-300">
              Depends on {milestone.dependencies.join(", ")}
            </div>
          ) : null}
          <div className="mt-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
              Sub-beads
            </div>
            <div className="mt-2 space-y-2">
              {milestone.children.map((child) => (
                <article
                  key={child.beadId}
                  className="rounded-lg border border-slate-800 bg-slate-950 p-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="font-medium text-zinc-100">{child.title}</h3>
                    <StatusPill status={child.status} compact />
                  </div>
                  <p className="mt-1 text-sm text-zinc-400">{child.summary}</p>
                  {child.nextAction ? (
                    <p className="mt-2 text-xs text-cyan-200">
                      Next: {child.nextAction}
                    </p>
                  ) : null}
                  <LinkList links={child.links} />
                </article>
              ))}
            </div>
          </div>
        </div>
        <aside className="rounded-lg border border-slate-800 bg-slate-950 p-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
            Links
          </div>
          <LinkList links={milestone.links} />
          <div className="mt-4 text-xs text-zinc-500">
            Bead id is shown only as secondary context.
          </div>
          <div className="mt-1 break-all text-xs text-zinc-400">
            {milestone.beadId}
          </div>
        </aside>
      </div>
    </details>
  );
}

function LinkList({
  links,
}: {
  links: Array<{ label: string; href: string; kind: string }>;
}): React.ReactElement {
  return (
    <ul className="mt-2 space-y-1 text-sm">
      {links.map((link) => (
        <li key={`${link.kind}:${link.href}`}>
          <a className="text-cyan-200 hover:text-cyan-100" href={link.href}>
            {link.label}
          </a>
        </li>
      ))}
    </ul>
  );
}

function InfoBlock({
  label,
  value,
}: {
  label: string;
  value: string;
}): React.ReactElement {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950 p-3">
      <div className="text-xs uppercase tracking-wide text-zinc-500">
        {label}
      </div>
      <p className="mt-1 text-sm text-zinc-100">{value}</p>
    </div>
  );
}

function RoadmapMetric({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "emerald" | "cyan" | "violet" | "amber" | "rose" | "zinc";
}): React.ReactElement {
  return (
    <div className={`rounded-lg border p-3 ${toneClasses(tone)}`}>
      <div className="text-xs uppercase tracking-wide opacity-80">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
    </div>
  );
}

function StatusPill({
  status,
  compact = false,
}: {
  status: WorkflowRoadmapItemStatus;
  compact?: boolean;
}): React.ReactElement {
  return (
    <span
      className={`rounded-full border px-2 py-1 text-xs ${statusClasses(status)}`}
    >
      {compact ? shortStatusLabel(status) : statusLabel(status)}
    </span>
  );
}

function groupMilestones(
  milestones: WorkflowRoadmapMilestone[],
): Record<WorkflowRoadmapItemStatus, WorkflowRoadmapMilestone[]> {
  return {
    complete: milestones.filter((item) => item.status === "complete"),
    in_progress: milestones.filter((item) => item.status === "in_progress"),
    blocked: milestones.filter((item) => item.status === "blocked"),
    review: milestones.filter((item) => item.status === "review"),
    tester: milestones.filter((item) => item.status === "tester"),
    remaining: milestones.filter((item) => item.status === "remaining"),
  };
}

function statusLabel(status: WorkflowRoadmapItemStatus): string {
  return status === "in_progress"
    ? "In progress"
    : status[0]!.toUpperCase() + status.slice(1);
}

function shortStatusLabel(status: WorkflowRoadmapItemStatus): string {
  if (status === "in_progress") return "Doing";
  return statusLabel(status);
}

function reviewStateLabel(
  state: WorkflowRoadmapMilestone["reviewState"],
): string {
  if (state === "not_started") return "Not started";
  if (state === "passed") return "Review and tester passed";
  if (state === "implementation") return "Implementation in progress";
  if (state === "review") return "Review pending";
  if (state === "tester") return "Tester running";
  return "Blocked";
}

function statusClasses(status: WorkflowRoadmapItemStatus): string {
  if (status === "complete")
    return "border-emerald-800 bg-emerald-950/30 text-emerald-200";
  if (status === "in_progress")
    return "border-cyan-800 bg-cyan-950/30 text-cyan-200";
  if (status === "review")
    return "border-violet-800 bg-violet-950/30 text-violet-200";
  if (status === "tester")
    return "border-amber-800 bg-amber-950/30 text-amber-200";
  if (status === "blocked")
    return "border-rose-800 bg-rose-950/30 text-rose-200";
  return "border-zinc-700 bg-zinc-900/70 text-zinc-300";
}

function toneClasses(
  tone: "emerald" | "cyan" | "violet" | "amber" | "rose" | "zinc",
): string {
  if (tone === "emerald")
    return "border-emerald-900 bg-emerald-950/20 text-emerald-200";
  if (tone === "cyan") return "border-cyan-900 bg-cyan-950/20 text-cyan-200";
  if (tone === "violet")
    return "border-violet-900 bg-violet-950/20 text-violet-200";
  if (tone === "amber")
    return "border-amber-900 bg-amber-950/20 text-amber-200";
  if (tone === "rose") return "border-rose-900 bg-rose-950/20 text-rose-200";
  return "border-zinc-800 bg-zinc-900/60 text-zinc-300";
}

function formatTime(value: number): string {
  if (!Number.isFinite(value)) return "recently";
  return new Date(value).toLocaleString();
}

function freshnessLabel(value: WorkflowRoadmapModel["source"]["freshness"]): string {
  if (value === "live") return "Live";
  if (value === "partial") return "Partial live data";
  if (value === "stale") return "Stale live data";
  if (value === "error") return "Unavailable";
  return "Demo fixture";
}
