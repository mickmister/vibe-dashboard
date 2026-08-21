import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  PreviewSlot,
  RunConfig,
  RunConfigKind,
  WorkspaceRunConfigsResponse,
} from '../server/vk-client';

type RepoOption = { id: string; label: string };

export function PreviewRunConfigsPanel({
  workspaceId,
}: {
  workspaceId: string;
}) {
  const [data, setData] = useState<WorkspaceRunConfigsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [customerSlug, setCustomerSlug] = useState('preview');
  const [runForm, setRunForm] = useState({
    repoId: '',
    slug: 'web',
    name: 'Web',
    command: 'npm run dev',
    kind: 'long_running' as RunConfigKind,
  });
  const [slotForm, setSlotForm] = useState({
    repoId: '',
    runConfigId: '',
    slotSlug: 'web',
    title: 'Web',
  });

  const refresh = useCallback(async () => {
    setError(null);
    const response = await fetch(`/internal/preview/workspaces/${encodeURIComponent(workspaceId)}/run-configs`);
    if (!response.ok) throw new Error(await response.text());
    const next = await response.json() as WorkspaceRunConfigsResponse;
    setData(next);
  }, [workspaceId]);

  useEffect(() => {
    void refresh().catch((err) => setError(errorMessage(err)));
  }, [refresh]);

  useEffect(() => {
    const firstRunConfig = data?.run_configs[0];
    const firstSlot = data?.preview_slots[0];
    setRunForm((current) => ({
      ...current,
      repoId: current.repoId || firstRunConfig?.repo_id || firstSlot?.repo_id || '',
    }));
    setSlotForm((current) => ({
      ...current,
      repoId: current.repoId || firstSlot?.repo_id || firstRunConfig?.repo_id || '',
      runConfigId: current.runConfigId || firstSlot?.run_config_id || firstRunConfig?.id || '',
    }));
  }, [data]);

  const repos = useMemo<RepoOption[]>(() => {
    const labels = new Map<string, string>();
    for (const runConfig of data?.run_configs ?? []) labels.set(runConfig.repo_id, runConfig.repo_id);
    for (const slot of data?.preview_slots ?? []) labels.set(slot.repo_id, slot.repo_id);
    return Array.from(labels, ([id, label]) => ({ id, label }));
  }, [data]);

  async function upsertRunConfig() {
    setMessage(null);
    setError(null);
    const response = await fetch(`/internal/preview/workspaces/${encodeURIComponent(workspaceId)}/run-configs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        repo_id: runForm.repoId,
        slug: runForm.slug,
        name: runForm.name,
        command: runForm.command,
        kind: runForm.kind,
        enabled: true,
      }),
    });
    if (!response.ok) throw new Error(await response.text());
    const created = await response.json() as RunConfig;
    setMessage(`Saved run config ${created.slug}`);
    setSlotForm((current) => ({
      ...current,
      repoId: created.repo_id,
      runConfigId: created.id,
      slotSlug: current.slotSlug || created.slug.slice(0, 10),
      title: current.title || created.name,
    }));
    await refresh();
  }

  async function upsertPreviewSlot() {
    setMessage(null);
    setError(null);
    const response = await fetch(`/internal/preview/workspaces/${encodeURIComponent(workspaceId)}/preview-slots`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        repo_id: slotForm.repoId,
        run_config_id: slotForm.runConfigId,
        slot_slug: slotForm.slotSlug,
        title: slotForm.title,
        enabled: true,
      }),
    });
    if (!response.ok) throw new Error(await response.text());
    const created = await response.json() as PreviewSlot;
    setMessage(`Saved preview slot ${created.slot_slug}`);
    await refresh();
  }

  async function startRunConfig(runConfigId: string) {
    await action(`/internal/preview/workspaces/${encodeURIComponent(workspaceId)}/run-configs/${encodeURIComponent(runConfigId)}/start`, 'Started run config');
  }

  async function startPreviewSlot(previewSlotId: string) {
    await action(`/internal/preview/workspaces/${encodeURIComponent(workspaceId)}/preview-slots/${encodeURIComponent(previewSlotId)}/start`, 'Started preview slot');
  }

  async function action(url: string, successMessage: string) {
    setMessage(null);
    setError(null);
    const response = await fetch(url, { method: 'POST' });
    if (!response.ok) throw new Error(await response.text());
    setMessage(successMessage);
    await refresh();
  }

  async function openPreviewSlot(previewSlotId: string) {
    setMessage(null);
    setError(null);
    const params = new URLSearchParams({ customerSlug });
    if (
      typeof window !== 'undefined' &&
      window.location.protocol === 'http:' &&
      window.location.hostname === 'localhost' &&
      new URLSearchParams(window.location.search).get('previewLocalCaddy') === '1'
    ) {
      params.set('baseDomain', 'localhost');
      params.set('localOrigin', window.location.origin);
    }
    const response = await fetch(
      `/internal/preview/workspaces/${encodeURIComponent(workspaceId)}/preview-slots/${encodeURIComponent(previewSlotId)}/url?${params}`,
    );
    if (!response.ok) throw new Error(await response.text());
    const result = await response.json() as { url: string };
    window.open(result.url, '_blank', 'noopener,noreferrer');
    setMessage(result.url);
  }

  const runConfigs = data?.run_configs ?? [];
  const previewSlots = data?.preview_slots ?? [];

  return (
    <div className="h-full overflow-auto bg-neutral-950 text-neutral-100 p-6">
      <div className="mx-auto max-w-5xl space-y-6">
        <header>
          <h1 className="text-2xl font-semibold">PreviewServer</h1>
          <p className="text-sm text-neutral-400">
            Minimal V1 controls for stored run configs, preview slots, and canonical Preview URLs.
          </p>
        </header>

        {error ? <Notice tone="error">{error}</Notice> : null}
        {message ? <Notice tone="info">{message}</Notice> : null}

        <section className="rounded-lg border border-neutral-800 bg-neutral-900/70 p-4">
          <h2 className="font-medium">Create stored run config</h2>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <TextInput label="Repo ID" value={runForm.repoId} onChange={(repoId) => setRunForm((current) => ({ ...current, repoId }))} />
            <TextInput label="Slug" value={runForm.slug} onChange={(slug) => setRunForm((current) => ({ ...current, slug }))} />
            <TextInput label="Name" value={runForm.name} onChange={(name) => setRunForm((current) => ({ ...current, name }))} />
            <label className="text-sm">
              <span className="block text-neutral-300">Kind</span>
              <select
                className="mt-1 w-full rounded border border-neutral-700 bg-neutral-950 p-2 text-neutral-100"
                value={runForm.kind}
                onChange={(event) => setRunForm((current) => ({ ...current, kind: event.target.value as RunConfigKind }))}
              >
                <option value="long_running">Long running</option>
                <option value="one_shot">One-shot</option>
                <option value="test">Test</option>
              </select>
            </label>
          </div>
          <TextArea label="Command" value={runForm.command} onChange={(command) => setRunForm((current) => ({ ...current, command }))} />
          <button className="mt-3 rounded bg-blue-600 px-3 py-2 text-sm font-medium hover:bg-blue-500" onClick={() => void upsertRunConfig().catch((err) => setError(errorMessage(err)))}>
            Save run config
          </button>
        </section>

        <section className="rounded-lg border border-neutral-800 bg-neutral-900/70 p-4">
          <h2 className="font-medium">Create preview slot</h2>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <TextInput label="Repo ID" value={slotForm.repoId} onChange={(repoId) => setSlotForm((current) => ({ ...current, repoId }))} />
            <SelectInput label="Run config" value={slotForm.runConfigId} options={runConfigs.map((item) => ({ id: item.id, label: `${item.name} (${item.slug})` }))} onChange={(runConfigId) => setSlotForm((current) => ({ ...current, runConfigId }))} />
            <TextInput label="Slot slug" value={slotForm.slotSlug} onChange={(slotSlug) => setSlotForm((current) => ({ ...current, slotSlug }))} />
            <TextInput label="Title" value={slotForm.title} onChange={(title) => setSlotForm((current) => ({ ...current, title }))} />
          </div>
          <button className="mt-3 rounded bg-blue-600 px-3 py-2 text-sm font-medium hover:bg-blue-500" onClick={() => void upsertPreviewSlot().catch((err) => setError(errorMessage(err)))}>
            Save preview slot
          </button>
        </section>

        <section className="rounded-lg border border-neutral-800 bg-neutral-900/70 p-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="font-medium">Preview slots</h2>
              <p className="text-sm text-neutral-400">Generate a named Preview URL or start the stored config.</p>
            </div>
            <TextInput label="Customer slug" value={customerSlug} onChange={setCustomerSlug} />
          </div>
          <ListEmpty items={previewSlots} label="No preview slots yet." />
          <div className="mt-3 space-y-2">
            {previewSlots.map((slot) => (
              <div key={slot.id} className="flex flex-wrap items-center justify-between gap-3 rounded border border-neutral-800 p-3">
                <div>
                  <div className="font-medium">{slot.title} <span className="text-neutral-500">/{slot.slot_slug}</span></div>
                  <div className="text-xs text-neutral-500">repo {slot.repo_id} · run config {slot.run_config_id}</div>
                </div>
                <div className="flex gap-2">
                  <button className="rounded border border-neutral-700 px-3 py-1 text-sm" onClick={() => void startPreviewSlot(slot.id).catch((err) => setError(errorMessage(err)))}>Start</button>
                  <button className="rounded border border-neutral-700 px-3 py-1 text-sm" onClick={() => void openPreviewSlot(slot.id).catch((err) => setError(errorMessage(err)))}>Open URL</button>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-lg border border-neutral-800 bg-neutral-900/70 p-4">
          <h2 className="font-medium">Run configs</h2>
          <ListEmpty items={runConfigs} label="No run configs yet." />
          <div className="mt-3 space-y-2">
            {runConfigs.map((runConfig) => (
              <div key={runConfig.id} className="flex flex-wrap items-center justify-between gap-3 rounded border border-neutral-800 p-3">
                <div>
                  <div className="font-medium">{runConfig.name} <span className="text-neutral-500">/{runConfig.slug}</span></div>
                  <code className="text-xs text-neutral-400">{runConfig.command}</code>
                </div>
                <button className="rounded border border-neutral-700 px-3 py-1 text-sm" onClick={() => void startRunConfig(runConfig.id).catch((err) => setError(errorMessage(err)))}>
                  Run on demand
                </button>
              </div>
            ))}
          </div>
        </section>

        {repos.length === 0 ? (
          <p className="text-xs text-neutral-500">
            Tip: repo IDs appear after at least one run config or preview slot exists. Agents can also call the HTTP API directly.
          </p>
        ) : null}
      </div>
    </div>
  );
}

function TextInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="text-sm">
      <span className="block text-neutral-300">{label}</span>
      <input className="mt-1 w-full rounded border border-neutral-700 bg-neutral-950 p-2 text-neutral-100" value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function SelectInput({ label, value, options, onChange }: { label: string; value: string; options: RepoOption[]; onChange: (value: string) => void }) {
  return (
    <label className="text-sm">
      <span className="block text-neutral-300">{label}</span>
      <select className="mt-1 w-full rounded border border-neutral-700 bg-neutral-950 p-2 text-neutral-100" value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">Select…</option>
        {options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
      </select>
    </label>
  );
}

function TextArea({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="mt-3 block text-sm">
      <span className="block text-neutral-300">{label}</span>
      <textarea className="mt-1 min-h-20 w-full rounded border border-neutral-700 bg-neutral-950 p-2 font-mono text-neutral-100" value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function Notice({ tone, children }: { tone: 'error' | 'info'; children: React.ReactNode }) {
  return (
    <div className={tone === 'error' ? 'rounded border border-red-800 bg-red-950/50 p-3 text-sm text-red-100' : 'rounded border border-blue-800 bg-blue-950/50 p-3 text-sm text-blue-100'}>
      {children}
    </div>
  );
}

function ListEmpty<T>({ items, label }: { items: T[]; label: string }) {
  return items.length === 0 ? <p className="mt-3 text-sm text-neutral-500">{label}</p> : null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
