import React, { useState } from 'react';

import {
  useLaunchVardashRepoProcess,
  useStopVardashLaunch,
  useVardashLaunchReadiness,
  useVardashLaunchStatus,
} from '../../hooks/useVardash';
import type {
  VardashApiError,
  VardashLaunchReadinessResponse,
  VardashLaunchStatus,
  VardashLaunchStatusResponse,
} from '../../lib/vardash-client';

export interface VardashLaunchPanelProps {
  workspaceId: string;
  repoId: string;
  processDefinitionId?: string;
  processName?: string;
}

export interface VardashLaunchViewProps {
  readiness: VardashLaunchReadinessResponse | null;
  status: VardashLaunchStatusResponse | null;
  runId: string | null;
  useVarlock: boolean;
  loading: boolean;
  busy: boolean;
  error?: VardashApiError | null;
  onUseVarlockChange: (value: boolean) => void;
  onLaunch: () => void | Promise<void>;
  onStop: () => void | Promise<void>;
}

export function VardashLaunchPanel({ workspaceId, repoId, processDefinitionId, processName }: VardashLaunchPanelProps) {
  const [runId, setRunId] = useState<string | null>(null);
  const [useVarlock, setUseVarlock] = useState(false);
  const readinessInput = { workspaceId, repoId, processDefinitionId, processName, useVarlock };
  const readiness = useVardashLaunchReadiness(readinessInput);
  const launch = useLaunchVardashRepoProcess();
  const status = useVardashLaunchStatus(runId);
  const stop = useStopVardashLaunch();

  return (
    <VardashLaunchView
      readiness={readiness.data ?? null}
      status={status.data ?? null}
      runId={runId}
      useVarlock={useVarlock}
      loading={readiness.isLoading || status.isLoading}
      busy={launch.isPending || stop.isPending}
      error={readiness.error ?? status.error ?? launch.error ?? stop.error ?? null}
      onUseVarlockChange={setUseVarlock}
      onLaunch={async () => {
        const result = await launch.mutateAsync(readinessInput);
        setRunId(result.runId);
      }}
      onStop={async () => {
        if (runId) await stop.mutateAsync({ runId });
      }}
    />
  );
}

export function VardashLaunchView({
  readiness,
  status,
  runId,
  useVarlock,
  loading,
  busy,
  error,
  onUseVarlockChange,
  onLaunch,
  onStop,
}: VardashLaunchViewProps) {
  const canLaunch = Boolean(readiness?.eligible) && !busy;
  const canStop = Boolean(runId && status && !isTerminalStatus(status.status) && status.status !== 'stopping') && !busy;
  return (
    <section aria-label="Vardash launch" className="space-y-5 rounded border border-neutral-800 p-4 text-neutral-100">
      <header className="space-y-2">
        <p className="text-xs uppercase tracking-wide text-violet-300">Vardash launch</p>
        <h2 className="text-2xl font-semibold">Explicit repo launch</h2>
        <p className="text-sm text-neutral-300">
          Launch supplies only this repo&apos;s resolved vardash env to the selected process. Normal agent/session env is unchanged.
        </p>
        <p className="text-xs text-neutral-400">Stdout/stderr logs, tmux inspection, raw env preview, and secret reveal are out of scope for this view.</p>
      </header>

      {loading && <p className="text-sm text-neutral-400">Loading launch readiness…</p>}
      {error && <p className="rounded border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-100">{formatVardashLaunchError(error)}</p>}

      <div className="grid gap-4 md:grid-cols-2">
        <section className="space-y-3 rounded border border-neutral-800 p-3" aria-label="Launch readiness">
          <h3 className="font-semibold">Readiness</h3>
          <p className={readiness?.eligible ? 'text-emerald-200' : 'text-amber-200'}>{readinessLabel(readiness)}</p>
          {readiness?.process ? (
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
              <dt className="text-neutral-400">Process</dt>
              <dd>{readiness.process.name}</dd>
              <dt className="text-neutral-400">Source</dt>
              <dd>{readiness.process.source === 'legacy_dev_server_script' ? 'Legacy dev_server_script' : 'Manual'}</dd>
              <dt className="text-neutral-400">Default</dt>
              <dd>{readiness.process.isDefault ? 'yes' : 'no'}</dd>
            </dl>
          ) : <p className="text-sm text-neutral-400">No process selected.</p>}

          {readiness?.missingRequired.length ? (
            <div className="space-y-1">
              <p className="text-sm font-medium text-amber-100">Missing required values</p>
              <ul className="list-disc pl-5 text-sm text-neutral-300">
                {readiness.missingRequired.map((key) => <li key={key.id}>{key.key} ({key.kind})</li>)}
              </ul>
            </div>
          ) : <p className="text-sm text-neutral-400">No required values are missing.</p>}
        </section>

        <section className="space-y-3 rounded border border-neutral-800 p-3" aria-label="Launch status">
          <h3 className="font-semibold">Status</h3>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
            <dt className="text-neutral-400">Run id</dt>
            <dd className="font-mono">{runId ?? 'not launched'}</dd>
            <dt className="text-neutral-400">State</dt>
            <dd>{status?.status ?? 'idle'}</dd>
            <dt className="text-neutral-400">Exit code</dt>
            <dd>{status?.exitCode ?? 'n/a'}</dd>
          </dl>
          {status?.error && <p className="text-sm text-amber-200">{status.error}</p>}
          <p className="text-xs text-neutral-400">No stdout/stderr or live logs are exposed here.</p>
        </section>
      </div>

      <section className="space-y-3 rounded border border-neutral-800 p-3" aria-label="Vardash selected values">
        <h3 className="font-semibold">Selected env metadata</h3>
        {readiness?.selectedValues.length ? (
          <ul className="grid gap-2 md:grid-cols-2">
            {readiness.selectedValues.map((value) => (
              <li key={value.key} className="rounded bg-neutral-950 p-2 text-sm">
                <span className="font-mono">{value.key}</span> <span className="text-neutral-400">({value.kind})</span>: {value.savedValueName ?? 'unset'}
              </li>
            ))}
          </ul>
        ) : <p className="text-sm text-neutral-400">No env metadata available.</p>}
      </section>

      <section className="space-y-3 rounded border border-neutral-800 p-3" aria-label="Varlock launch status">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={useVarlock} onChange={(event) => onUseVarlockChange(event.target.checked)} />
          Use optional Varlock validation/redaction wrapper
        </label>
        <p className="text-sm text-neutral-300">{formatVarlockStatus(readiness)}</p>
      </section>

      <div className="flex flex-wrap gap-2">
        <button type="button" className="rounded bg-violet-600 px-3 py-2 text-sm font-semibold disabled:opacity-50" disabled={!canLaunch} onClick={() => { void onLaunch(); }}>
          Launch
        </button>
        <button type="button" className="rounded bg-neutral-800 px-3 py-2 text-sm font-semibold disabled:opacity-50" disabled={!canStop} onClick={() => { void onStop(); }}>
          Stop
        </button>
      </div>
    </section>
  );
}

export function formatVarlockStatus(readiness: VardashLaunchReadinessResponse | null): string {
  if (!readiness) return 'Varlock readiness unknown.';
  if (!readiness.varlock.enabled) return readiness.varlock.configured ? 'Varlock configured but not requested.' : 'Varlock disabled for this launch.';
  if (!readiness.varlock.configured) return 'Varlock requested but not configured.';
  if (readiness.varlock.available === false) return 'Varlock requested but unavailable.';
  if (readiness.varlock.available === true) return 'Varlock ready.';
  return 'Varlock requested; availability unknown.';
}

export function formatVardashLaunchError(error: VardashApiError): string {
  if (error.errorCode === 'workspace_repo_forbidden') return 'Launch is not allowed for this workspace repo.';
  if (error.errorCode === 'process_not_found') return 'Selected process was not found for this repo.';
  if (error.errorCode === 'launch_not_found') return 'Launch run was not found.';
  if (error.errorCode === 'launch_failed') return 'Launch failed. Check readiness and try again.';
  return 'Vardash launch request failed.';
}

function readinessLabel(readiness: VardashLaunchReadinessResponse | null): string {
  if (!readiness) return 'Readiness unknown.';
  return readiness.eligible ? 'Ready to launch.' : 'Not ready to launch.';
}

function isTerminalStatus(status: VardashLaunchStatus): boolean {
  return status === 'stopped' || status === 'failed';
}
