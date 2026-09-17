import React from "react";

export interface WorkflowProgressCount {
  label: string;
  value: number;
  tone?: "default" | "active" | "success" | "warning" | "muted";
}

export interface WorkflowProgressItem {
  id: string;
  indexLabel: string;
  title: string;
  status: string;
  summary?: string | null;
  reason?: string | null;
  href?: string | null;
  hrefLabel?: string;
  timestamps?: string[];
}

export function MultiRunProgressSummary({
  eyebrow,
  title,
  status,
  description,
  counts,
  currentItem,
}: {
  eyebrow: string;
  title: string;
  status: string;
  description?: string | null;
  counts: WorkflowProgressCount[];
  currentItem?: WorkflowProgressItem | null;
}): React.ReactElement {
  return (
    <section className="rounded-xl border border-cyan-900/50 bg-cyan-950/15 p-5" aria-label={`${eyebrow} progress overview`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-wide text-cyan-300">{safeWorkflowText(eyebrow, 80)}</div>
          <h2 className="mt-1 text-xl font-semibold text-zinc-50">{safeWorkflowText(title, 160)}</h2>
          {description ? <p className="mt-2 max-w-3xl text-sm text-zinc-300">{safeWorkflowText(description, 360)}</p> : null}
        </div>
        <WorkflowStatusPill status={status} />
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {counts.map((count) => <ProgressCountTile key={count.label} count={count} />)}
      </div>
      {currentItem ? (
        <div className="mt-4 rounded-lg border border-cyan-800/60 bg-slate-950/80 p-4">
          <div className="text-xs uppercase tracking-wide text-cyan-300">Current item</div>
          <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="font-medium text-zinc-100">{safeWorkflowText(currentItem.title, 180)}</div>
              {currentItem.summary ? <p className="mt-1 text-sm text-zinc-300">{safeWorkflowText(currentItem.summary, 360)}</p> : null}
              {currentItem.reason ? <p className="mt-1 text-sm text-amber-100">{safeWorkflowText(currentItem.reason, 360)}</p> : null}
            </div>
            <WorkflowStatusPill status={currentItem.status} />
          </div>
        </div>
      ) : null}
    </section>
  );
}

function ProgressCountTile({ count }: { count: WorkflowProgressCount }): React.ReactElement {
  const toneClass = count.tone === "success"
    ? "border-emerald-900/70 bg-emerald-950/20 text-emerald-100"
    : count.tone === "active"
      ? "border-cyan-900/70 bg-cyan-950/30 text-cyan-100"
      : count.tone === "warning"
        ? "border-amber-900/70 bg-amber-950/20 text-amber-100"
        : count.tone === "muted"
          ? "border-slate-800 bg-slate-950/60 text-slate-300"
          : "border-slate-800 bg-slate-950 text-zinc-100";
  return (
    <div className={`rounded-lg border p-3 ${toneClass}`}>
      <div className="text-xs uppercase tracking-wide opacity-75">{safeWorkflowText(count.label, 80)}</div>
      <div className="mt-1 text-2xl font-semibold">{count.value}</div>
    </div>
  );
}

export function MultiRunItemList({
  title,
  description,
  items,
  emptyText,
}: {
  title: string;
  description?: string | null;
  items: WorkflowProgressItem[];
  emptyText: string;
}): React.ReactElement {
  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900/70 p-5">
      <div>
        <h2 className="text-lg font-semibold text-zinc-50">{safeWorkflowText(title, 120)}</h2>
        {description ? <p className="mt-1 text-sm text-zinc-400">{safeWorkflowText(description, 260)}</p> : null}
      </div>
      {items.length ? (
        <ol className="mt-4 space-y-3">
          {items.map((item) => <MultiRunItemRow key={item.id} item={item} />)}
        </ol>
      ) : (
        <div className="mt-4 rounded-lg border border-dashed border-slate-800 bg-slate-950 p-6 text-sm text-zinc-400">{safeWorkflowText(emptyText, 240)}</div>
      )}
    </section>
  );
}

function MultiRunItemRow({ item }: { item: WorkflowProgressItem }): React.ReactElement {
  const isProblem = item.status === "failed" || item.status === "blocked" || item.status === "cancelled";
  return (
    <li className={`rounded-lg border p-4 ${isProblem ? "border-amber-900/70 bg-amber-950/20" : "border-slate-800 bg-slate-950"}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs uppercase tracking-wide text-zinc-500">{safeWorkflowText(item.indexLabel, 80)}</div>
          <h3 className="mt-1 font-medium text-zinc-100">{safeWorkflowText(item.title, 220)}</h3>
          {item.summary ? <p className="mt-2 text-sm text-zinc-300">{safeWorkflowText(item.summary, 500)}</p> : null}
          {item.reason ? <p className="mt-2 text-sm text-amber-100">{safeWorkflowText(item.reason, 500)}</p> : null}
          {item.timestamps?.length ? <p className="mt-2 text-xs text-zinc-500">{item.timestamps.map((value) => safeWorkflowText(value, 80)).join(" · ")}</p> : null}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <WorkflowStatusPill status={item.status} />
          {item.href ? <a className="text-sm text-cyan-200 underline-offset-2 hover:underline" href={item.href}>{safeWorkflowText(item.hrefLabel ?? "Open run", 80)}</a> : null}
        </div>
      </div>
    </li>
  );
}

export function WorkflowStatusPill({ status }: { status: string }): React.ReactElement {
  const label = workflowStatusLabel(status);
  const statusKey = String(status ?? "").toLowerCase();
  const tone = statusKey === "completed" || statusKey === "complete"
    ? "border-emerald-700 bg-emerald-950/40 text-emerald-100"
    : statusKey === "running" || statusKey === "starting"
      ? "border-cyan-700 bg-cyan-950/40 text-cyan-100"
      : statusKey === "pending" || statusKey === "paused"
        ? "border-slate-700 bg-slate-900 text-slate-200"
        : statusKey === "failed" || statusKey === "blocked" || statusKey === "cancelled"
          ? "border-amber-700 bg-amber-950/40 text-amber-100"
          : "border-slate-700 bg-slate-900 text-slate-200";
  return <span className={`rounded-full border px-2.5 py-1 text-xs font-medium ${tone}`}>{label}</span>;
}

export function workflowStatusLabel(status: string): string {
  const normalized = String(status ?? "").toLowerCase();
  if (normalized === "completed" || normalized === "complete") return "Complete";
  if (normalized === "running") return "Running";
  if (normalized === "pending") return "Pending";
  if (normalized === "blocked") return "Blocked";
  if (normalized === "failed") return "Failed";
  if (normalized === "cancelled") return "Cancelled";
  if (normalized === "paused") return "Paused";
  if (normalized === "starting") return "Starting";
  return safeWorkflowText(status, 80);
}

export function safeWorkflowText(value: unknown, maxLength = 500): string {
  return String(value ?? "")
    .replace(/raw\s+XML/giu, "workflow details")
    .replace(/raw\s+JSON/giu, "workflow details")
    .replace(/provider diagnostics/giu, "workflow details")
    .replace(/execution process ID/giu, "workflow process")
    .replace(/delivery ID/giu, "workflow update")
    .replace(/\bbd\s+[^\n]*/giu, "workflow action")
    .replace(/\bshell\b/giu, "workflow action")
    .replace(/\bgit\s+[^\n]*/giu, "version control action")
    .replace(/\bwebhook\b/giu, "workflow update")
    .replace(/\btrigger\b/giu, "workflow update")
    .replace(/\bqueue[-_ ]?item\b/giu, "workflow item")
    .replace(/\bWorkflowStepState\b/g, "workflow step")
    .replace(/\brunReady\b/g, "workflow wakeup")
    .replace(/\bHMAC\b/g, "message signature")
    .replace(/\/Users\/[^\s<>']+/gu, "[redacted-path]")
    .replace(/\/tmp\/[^\s<>']+/gu, "[redacted-path]")
    .replace(/\/private\/var\/[^\s<>']+/gu, "[redacted-path]")
    .slice(0, maxLength);
}
