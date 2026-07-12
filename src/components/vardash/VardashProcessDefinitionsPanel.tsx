import React, { useState } from 'react';

import {
  useImportLegacyDevServerProcessDefinition,
  useSetVardashRepoProcessDefinitionDefault,
  useUpsertVardashRepoProcessDefinition,
  useVardashRepoProcessDefinitions,
  useVardashWorkspaceRepoProcessDefinitions,
} from '../../hooks/useVardash';
import type { VardashProcessDefinitionMetadata } from '../../lib/vardash-client';

export interface VardashProcessDefinitionsPanelProps {
  repoId: string;
  workspaceId?: string | null;
}

export interface VardashProcessDefinitionDraft {
  id: string | null;
  name: string;
  command: string;
  cwd: string;
  isDefault: boolean;
}

const EMPTY_PROCESS_DRAFT: VardashProcessDefinitionDraft = {
  id: null,
  name: '',
  command: '',
  cwd: '',
  isDefault: false,
};

export function VardashProcessDefinitionsPanel({ repoId, workspaceId = null }: VardashProcessDefinitionsPanelProps) {
  const workspaceProcesses = useVardashWorkspaceRepoProcessDefinitions(workspaceId, repoId);
  const repoProcesses = useVardashRepoProcessDefinitions(workspaceId ? null : repoId);
  const processes = workspaceId ? workspaceProcesses : repoProcesses;
  const upsertProcess = useUpsertVardashRepoProcessDefinition();
  const importLegacy = useImportLegacyDevServerProcessDefinition();
  const setDefault = useSetVardashRepoProcessDefinitionDefault();
  const [draft, setDraft] = useState<VardashProcessDefinitionDraft>(EMPTY_PROCESS_DRAFT);
  const [legacyScript, setLegacyScript] = useState('');

  if (processes.isLoading) return <section aria-label="Vardash process definitions">Loading vardash processes…</section>;
  if (processes.error) return <section aria-label="Vardash process definitions">Unable to load vardash process definitions.</section>;

  const busy = upsertProcess.isPending || importLegacy.isPending || setDefault.isPending;

  return (
    <VardashProcessDefinitionsView
      processes={processes.data?.processes ?? []}
      draft={draft}
      legacyScript={legacyScript}
      busy={busy}
      onDraftChange={setDraft}
      onLegacyScriptChange={setLegacyScript}
      onEdit={(process) => setDraft(setDraftFromProcess(process))}
      onSubmit={async (nextDraft) => {
        await upsertProcess.mutateAsync({
          repoId,
          workspaceId,
          input: {
            name: nextDraft.name.trim(),
            command: nextDraft.command.trim(),
            cwd: nextDraft.cwd.trim() || null,
            isDefault: nextDraft.isDefault,
          },
        });
        setDraft(EMPTY_PROCESS_DRAFT);
      }}
      onSetDefault={(process) => {
        setDefault.mutate({ repoId, workspaceId, processDefinitionId: process.id });
      }}
      onImportLegacy={async (script) => {
        await importLegacy.mutateAsync({ repoId, workspaceId, devServerScript: script });
        setLegacyScript('');
      }}
    />
  );
}

export interface VardashProcessDefinitionsViewProps {
  processes: VardashProcessDefinitionMetadata[];
  draft: VardashProcessDefinitionDraft;
  legacyScript?: string;
  busy: boolean;
  onDraftChange: (draft: VardashProcessDefinitionDraft) => void;
  onEdit: (process: VardashProcessDefinitionMetadata) => void;
  onSubmit: (draft: VardashProcessDefinitionDraft) => void | Promise<void>;
  onSetDefault: (process: VardashProcessDefinitionMetadata) => void;
  onLegacyScriptChange?: (script: string) => void;
  onImportLegacy?: (script: string) => void | Promise<void>;
}

export function VardashProcessDefinitionsView({
  processes,
  draft,
  legacyScript = '',
  busy,
  onDraftChange,
  onEdit,
  onSubmit,
  onSetDefault,
  onLegacyScriptChange,
  onImportLegacy,
}: VardashProcessDefinitionsViewProps) {
  const canSubmit = draft.name.trim() !== '' && draft.command.trim() !== '' && !busy;
  return (
    <section aria-label="Vardash process definitions" className="space-y-5 text-neutral-100">
      <header className="space-y-2">
        <p className="text-xs uppercase tracking-wide text-violet-300">Vardash processes</p>
        <h2 className="text-2xl font-semibold">Repo process definitions</h2>
        <p className="text-sm text-neutral-300">
          Define commands that can later be used by explicit vardash launches. This screen does not execute commands, stream output, or manage terminal sessions.
        </p>
      </header>

      <div className="overflow-x-auto rounded border border-neutral-800">
        <table className="min-w-full divide-y divide-neutral-800 text-sm">
          <thead className="bg-neutral-950 text-left text-xs uppercase tracking-wide text-neutral-400">
            <tr>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Command</th>
              <th className="px-3 py-2">Working dir</th>
              <th className="px-3 py-2">Source</th>
              <th className="px-3 py-2">Default</th>
              <th className="px-3 py-2">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-900">
            {processes.map((process) => (
              <tr key={process.id}>
                <td className="px-3 py-2 font-medium">{process.name}</td>
                <td className="px-3 py-2 font-mono">{process.command}</td>
                <td className="px-3 py-2 font-mono">{process.cwd ?? 'repo root'}</td>
                <td className="px-3 py-2"><ProcessSourceBadge source={process.source} /></td>
                <td className="px-3 py-2">{process.isDefault ? <span className="rounded bg-emerald-500/20 px-2 py-0.5 text-xs text-emerald-100">Default</span> : <button type="button" onClick={() => onSetDefault(process)}>Set default</button>}</td>
                <td className="px-3 py-2"><button type="button" onClick={() => onEdit(process)}>Edit</button></td>
              </tr>
            ))}
            {processes.length === 0 && (
              <tr><td className="px-3 py-4 text-neutral-400" colSpan={6}>No process definitions yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <form className="grid gap-3 rounded border border-neutral-800 p-3 md:grid-cols-5" onSubmit={(event) => { event.preventDefault(); if (canSubmit) void onSubmit(draft); }}>
        <label className="text-sm">
          Name
          <input className="mt-1 w-full rounded bg-neutral-950 p-2 disabled:opacity-70" value={draft.name} onChange={(event) => onDraftChange({ ...draft, name: event.target.value })} placeholder="Dev server" readOnly={draft.id != null} aria-readonly={draft.id != null} />
        </label>
        <label className="text-sm md:col-span-2">
          Command
          <input className="mt-1 w-full rounded bg-neutral-950 p-2 font-mono" value={draft.command} onChange={(event) => onDraftChange({ ...draft, command: event.target.value })} placeholder="npm run dev" />
        </label>
        <label className="text-sm">
          Working dir
          <input className="mt-1 w-full rounded bg-neutral-950 p-2 font-mono" value={draft.cwd} onChange={(event) => onDraftChange({ ...draft, cwd: event.target.value })} placeholder="repo root" />
        </label>
        <label className="text-sm">
          Default
          <input className="ml-2" type="checkbox" checked={draft.isDefault} onChange={(event) => onDraftChange({ ...draft, isDefault: event.target.checked })} />
        </label>
        <div className="md:col-span-5 flex gap-2">
          <button className="rounded bg-violet-600 px-3 py-2 text-sm font-semibold disabled:opacity-50" type="submit" disabled={!canSubmit}>
            {draft.id ? 'Save process' : 'Add process'}
          </button>
          {draft.id && (
            <button className="rounded bg-neutral-800 px-3 py-2 text-sm" type="button" onClick={() => onDraftChange(EMPTY_PROCESS_DRAFT)}>
              Cancel edit
            </button>
          )}
        </div>
        <p className="md:col-span-5 text-xs text-neutral-400">Generic creates/edits are saved as Manual source. Legacy provenance is reserved for imported dev_server_script definitions. Name is read-only while editing so edits target the selected process name.</p>
      </form>

      {onImportLegacy && onLegacyScriptChange && (
        <form className="grid gap-3 rounded border border-neutral-800 p-3 md:grid-cols-[1fr_auto]" onSubmit={(event) => { event.preventDefault(); if (legacyScript.trim()) void onImportLegacy(legacyScript); }}>
          <label className="text-sm">
            Import legacy dev_server_script
            <input className="mt-1 w-full rounded bg-neutral-950 p-2 font-mono" value={legacyScript} onChange={(event) => onLegacyScriptChange(event.target.value)} placeholder="npm run dev" />
          </label>
          <button className="self-end rounded bg-neutral-800 px-3 py-2 text-sm disabled:opacity-50" type="submit" disabled={!legacyScript.trim() || busy}>Import legacy</button>
        </form>
      )}
    </section>
  );
}

export function setDraftFromProcess(process: VardashProcessDefinitionMetadata): VardashProcessDefinitionDraft {
  return {
    id: process.id,
    name: process.name,
    command: process.command,
    cwd: process.cwd ?? '',
    isDefault: process.isDefault,
  };
}

function ProcessSourceBadge({ source }: { source: VardashProcessDefinitionMetadata['source'] }) {
  if (source === 'legacy_dev_server_script') {
    return <span className="rounded bg-amber-500/20 px-2 py-0.5 text-xs text-amber-100">Legacy dev_server_script</span>;
  }
  return <span className="rounded bg-neutral-800 px-2 py-0.5 text-xs text-neutral-200">Manual</span>;
}
