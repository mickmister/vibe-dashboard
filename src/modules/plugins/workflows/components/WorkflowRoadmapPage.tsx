import React, { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { StandaloneDashboardPage } from "../../../../components/StandaloneDashboardPage";
import {
  fetchWorkflowRoadmap,
  type WorkflowRoadmapItemStatus,
  type WorkflowRoadmapMilestone,
  type WorkflowRoadmapModel,
  type WorkflowRoadmapSubBead,
} from "../client/workflowRoadmapApi";
import { workflowRouteHref } from "./workflowRouteContext";

export function WorkflowRoadmapPage(): React.ReactElement {
  const [searchParams] = useSearchParams();
  const searchKey = searchParams.toString();
  const workspaceId = searchParams.get("workspaceId") || searchParams.get("workspace") || "";
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
      filters={roadmapFiltersFromSearch(searchParams)}
      filterHref={(next) => workflowRouteHref("/dashboard/workflows/roadmap", searchParams, next)}
      queueHref={(beadIds) => workflowRouteHref("/dashboard/workflows/meta-runs", searchParams, { workspaceId: workspaceId || null, roadmapBeads: beadIds.length ? beadIds.join(",") : null })}
      workspaceId={workspaceId || null}
    />
  );
}

export function WorkflowRoadmapView({
  roadmap,
  loading,
  error,
  onRefresh,
  backHref = "/dashboard/workflows",
  filters = defaultRoadmapFilters(),
  filterHref = () => "#",
  queueHref = () => "#",
  workspaceId = null,
  embedded = false,
}: {
  roadmap: WorkflowRoadmapModel | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  backHref?: string;
  filters?: RoadmapFilterState;
  filterHref?: (next: Record<string, string | null>) => string;
  queueHref?: (beadIds: string[]) => string;
  workspaceId?: string | null;
  embedded?: boolean;
}): React.ReactElement {
  const visibleMilestones = useMemo(
    () => filterMilestones(roadmap?.milestones ?? [], filters),
    [roadmap?.milestones, filters.status, filters.showCompleted],
  );
  const grouped = useMemo(
    () => groupMilestones(visibleMilestones),
    [visibleMilestones],
  );
  const totalMilestones = roadmap?.milestones.length ?? 0;
  const completedHidden = Boolean(roadmap && !filters.showCompleted && roadmap.statusCounts.complete > 0);
  const [selectedBeadIds, setSelectedBeadIds] = useState<string[]>([]);
  const selectableBeadIds = useMemo(() => collectSelectableBeadIds(visibleMilestones), [visibleMilestones]);
  const orderedSelectedBeadIds = useMemo(
    () => selectableBeadIds.filter((beadId) => selectedBeadIds.includes(beadId)),
    [selectableBeadIds, selectedBeadIds],
  );
  const toggleBead = (beadId: string) => {
    setSelectedBeadIds((current) => current.includes(beadId) ? current.filter((id) => id !== beadId) : [...current, beadId]);
  };
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
          <RoadmapMetric label="Complete" value={roadmap?.statusCounts.complete ?? 0} tone="emerald" href={filterHref({ roadmapStatus: "complete", showCompleted: "1" })} selected={filters.status === "complete"} />
          <RoadmapMetric label="In progress" value={roadmap?.statusCounts.in_progress ?? 0} tone="cyan" href={filterHref({ roadmapStatus: "in_progress" })} selected={filters.status === "in_progress"} />
          <RoadmapMetric label="Review" value={roadmap?.statusCounts.review ?? 0} tone="violet" href={filterHref({ roadmapStatus: "review" })} selected={filters.status === "review"} />
          <RoadmapMetric label="Tester" value={roadmap?.statusCounts.tester ?? 0} tone="amber" href={filterHref({ roadmapStatus: "tester" })} selected={filters.status === "tester"} />
          <RoadmapMetric label="Blocked" value={roadmap?.statusCounts.blocked ?? 0} tone="rose" href={filterHref({ roadmapStatus: "blocked" })} selected={filters.status === "blocked"} />
          <RoadmapMetric label="Remaining" value={roadmap?.statusCounts.remaining ?? 0} tone="zinc" href={filterHref({ roadmapStatus: "remaining" })} selected={filters.status === "remaining"} />
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

      {roadmap ? (
        <section className="rounded-xl border border-slate-800 bg-slate-900/70 p-4" aria-label="Roadmap filters">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-xs uppercase tracking-wide text-cyan-300">Filters</div>
              <p className="mt-1 text-sm text-zinc-300">Showing {visibleMilestones.length} of {totalMilestones} milestones. Counts above are total top-level milestones.</p>
              {completedHidden ? <p className="mt-1 text-xs text-zinc-500">Completed milestones are hidden by default.</p> : null}
            </div>
            <div className="flex flex-wrap gap-2">
              <a className={filterButtonClass(filters.status === "all" && !filters.showCompleted)} href={filterHref({ roadmapStatus: null, showCompleted: null })}>Active first</a>
              <a className={filterButtonClass(filters.showCompleted)} href={filterHref({ showCompleted: filters.showCompleted ? null : "1" })}>{filters.showCompleted ? "Hide completed" : "Show completed"}</a>
              {filters.status !== "all" ? <a className={filterButtonClass(false)} href={filterHref({ roadmapStatus: null })}>Reset status</a> : null}
            </div>
          </div>
        </section>
      ) : null}

      {roadmap ? (
        <section className="rounded-xl border border-slate-800 bg-slate-900/70 p-4" aria-label="Start selected roadmap beads">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-xs uppercase tracking-wide text-cyan-300">Meta-workflow start list</div>
              <p className="mt-1 text-sm text-zinc-300">Select roadmap beads below, then start them as a sequential meta-workflow.</p>
              {orderedSelectedBeadIds.length ? <p className="mt-1 text-xs text-zinc-500">Selected {orderedSelectedBeadIds.length} beads in roadmap order.</p> : <p className="mt-1 text-xs text-zinc-500">No beads selected yet.</p>}
              {!workspaceId ? <p className="mt-1 text-xs text-amber-200">Choose a workspace before starting selected roadmap beads. Creating a new sub-workspace from here is deferred.</p> : null}
            </div>
            {workspaceId && orderedSelectedBeadIds.length ? (
              <a className="rounded-md bg-cyan-500 px-3 py-2 text-sm font-medium text-zinc-950 hover:bg-cyan-400" href={queueHref(orderedSelectedBeadIds)}>Review and start selected</a>
            ) : (
              <span className="rounded-md border border-zinc-800 px-3 py-2 text-sm text-zinc-500">{workspaceId ? "Select beads to start" : "Choose workspace to start"}</span>
            )}
          </div>
        </section>
      ) : null}

      {roadmap && roadmap.milestones.length === 0 ? (
        <section className="rounded-xl border border-slate-800 bg-slate-900/70 p-5">
          <h2 className="font-semibold">{roadmap.source.freshness === "error" ? "Roadmap unavailable" : "No roadmap selected"}</h2>
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
            {visibleMilestones.length === 0 && roadmap.milestones.length > 0 ? (
              <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-5 text-sm text-zinc-300">No roadmap items match the selected filters.</div>
            ) : null}
            {visibleMilestones.map((milestone, index) => (
              <MilestoneCard
                key={milestone.beadId}
                milestone={milestone}
                index={index}
                selectedBeadIds={selectedBeadIds}
                onToggleBead={toggleBead}
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
  selectedBeadIds,
  onToggleBead,
}: {
  milestone: WorkflowRoadmapMilestone;
  index: number;
  selectedBeadIds: string[];
  onToggleBead: (beadId: string) => void;
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
            <div className="mt-1 flex items-center gap-2">
              <input aria-label={`Select ${milestone.title}`} type="checkbox" checked={selectedBeadIds.includes(milestone.beadId)} disabled={!canQueueRoadmapItem(milestone)} onChange={() => onToggleBead(milestone.beadId)} />
              <h2 className="text-lg font-semibold text-zinc-50">
                {milestone.title}
              </h2>
            </div>
            {!canQueueRoadmapItem(milestone) ? <p className="mt-1 text-xs text-zinc-500">Completed or unavailable beads are not started from the roadmap.</p> : null}
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
                    <label className="flex items-center gap-2 font-medium text-zinc-100"><input aria-label={`Select ${child.title}`} type="checkbox" checked={selectedBeadIds.includes(child.beadId)} disabled={!canQueueRoadmapItem(child)} onChange={() => onToggleBead(child.beadId)} />{child.title}</label>
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
  href,
  selected = false,
}: {
  label: string;
  value: number;
  tone: "emerald" | "cyan" | "violet" | "amber" | "rose" | "zinc";
  href?: string;
  selected?: boolean;
}): React.ReactElement {
  const body = (
    <>
      <div className="text-xs uppercase tracking-wide opacity-80">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
    </>
  );
  const classes = `block rounded-lg border p-3 ${toneClasses(tone)} ${selected ? "ring-2 ring-cyan-300" : ""}`;
  return href ? <a className={classes} href={href} aria-current={selected ? "true" : undefined}>{body}</a> : <div className={classes}>{body}</div>;
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

function collectSelectableBeadIds(milestones: WorkflowRoadmapMilestone[]): string[] {
  const ids: string[] = [];
  for (const milestone of milestones) {
    if (canQueueRoadmapItem(milestone)) ids.push(milestone.beadId);
    for (const childItem of milestone.children) {
      if (canQueueRoadmapItem(childItem)) ids.push(childItem.beadId);
    }
  }
  return ids;
}

function canQueueRoadmapItem(item: Pick<WorkflowRoadmapMilestone, "status"> | WorkflowRoadmapSubBead): boolean {
  return item.status !== "complete" && item.status !== "blocked";
}

type RoadmapStatusFilter = WorkflowRoadmapItemStatus | "all";

interface RoadmapFilterState {
  status: RoadmapStatusFilter;
  showCompleted: boolean;
}

function defaultRoadmapFilters(): RoadmapFilterState {
  return { status: "all", showCompleted: false };
}

function roadmapFiltersFromSearch(params: URLSearchParams): RoadmapFilterState {
  const status = params.get("roadmapStatus");
  return {
    status: isRoadmapStatus(status) ? status : "all",
    showCompleted: params.get("showCompleted") === "1",
  };
}

function filterMilestones(
  milestones: WorkflowRoadmapMilestone[],
  filters: RoadmapFilterState,
): WorkflowRoadmapMilestone[] {
  return milestones
    .filter((milestone) => filters.showCompleted || milestone.status !== "complete")
    .filter((milestone) => filters.status === "all" || milestone.status === filters.status)
    .sort((left, right) => roadmapSortRank(left.status) - roadmapSortRank(right.status));
}

function roadmapSortRank(status: WorkflowRoadmapItemStatus): number {
  if (status === "blocked") return 0;
  if (status === "in_progress" || status === "review" || status === "tester") return 1;
  if (status === "remaining") return 2;
  return 3;
}

function isRoadmapStatus(value: string | null): value is WorkflowRoadmapItemStatus {
  return value === "complete" || value === "in_progress" || value === "blocked" || value === "review" || value === "tester" || value === "remaining";
}

function filterButtonClass(selected: boolean): string {
  return `rounded-md border px-3 py-2 text-sm ${selected ? "border-cyan-500 bg-cyan-950/50 text-cyan-100" : "border-zinc-700 text-zinc-100 hover:bg-zinc-800"}`;
}

function freshnessLabel(value: WorkflowRoadmapModel["source"]["freshness"]): string {
  if (value === "live") return "Live";
  if (value === "partial") return "Partial live data";
  if (value === "stale") return "Stale live data";
  if (value === "error") return "Unavailable";
  return "Demo fixture";
}
