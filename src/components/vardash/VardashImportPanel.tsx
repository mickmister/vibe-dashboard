import React, { useState } from 'react';

import { useImportVardashRepoEnv } from '../../hooks/useVardash';
import type {
  VardashApiError,
  VardashImportConflict,
  VardashImportResponse,
  VardashImportSource,
} from '../../lib/vardash-client';

export interface VardashImportPanelProps {
  repoId: string;
}

export interface VardashImportDraft {
  source: VardashImportSource;
  content: string;
  savedValueName: string;
  plainKeysText: string;
}

const DEFAULT_IMPORT_DRAFT: VardashImportDraft = {
  source: 'pasted-env',
  content: '',
  savedValueName: 'local',
  plainKeysText: '',
};

export function VardashImportPanel({ repoId }: VardashImportPanelProps) {
  const importMutation = useImportVardashRepoEnv();
  const [draft, setDraft] = useState<VardashImportDraft>(DEFAULT_IMPORT_DRAFT);
  const [preview, setPreview] = useState<VardashImportResponse | null>(null);

  const runImport = async (dryRun: boolean) => {
    const result = await importMutation.mutateAsync({
      repoId,
      input: {
        content: draft.content,
        source: draft.source,
        dryRun,
        savedValueName: draft.savedValueName.trim() || 'imported',
        plainKeys: parsePlainKeys(draft.plainKeysText),
      },
    });
    setPreview(result);
  };

  return (
    <VardashImportFlowView
      draft={draft}
      preview={preview}
      error={importMutation.error}
      isPreviewing={importMutation.isPending && preview == null}
      isApplying={importMutation.isPending && preview != null}
      onDraftChange={(nextDraft) => {
        setDraft(nextDraft);
        setPreview(null);
      }}
      onPreview={() => { void runImport(true); }}
      onApply={() => { if (preview && preview.conflicts.length === 0) void runImport(false); }}
    />
  );
}

export interface VardashImportFlowViewProps {
  draft: VardashImportDraft;
  preview: VardashImportResponse | null;
  error?: VardashApiError | null;
  isPreviewing: boolean;
  isApplying: boolean;
  onDraftChange: (draft: VardashImportDraft) => void;
  onPreview: () => void;
  onApply: () => void;
}

export function VardashImportFlowView({
  draft,
  preview,
  error,
  isPreviewing,
  isApplying,
  onDraftChange,
  onPreview,
  onApply,
}: VardashImportFlowViewProps) {
  const conflicts = preview?.conflicts ?? [];
  const canApply = Boolean(preview) && conflicts.length === 0 && !isApplying;
  const isPastedEnv = draft.source === 'pasted-env';

  return (
    <section aria-label="Vardash import" className="space-y-5 text-neutral-100">
      <header className="space-y-2">
        <p className="text-xs uppercase tracking-wide text-violet-300">Vardash import</p>
        <h2 className="text-2xl font-semibold">Import env configuration</h2>
        <p className="text-sm text-neutral-300">Preview is required before apply. Preview rows show keys and metadata only, never raw values.</p>
      </header>

      <fieldset className="rounded border border-neutral-800 p-3">
        <legend className="px-1 text-sm font-semibold">Import type</legend>
        <label className="block text-sm">
          <input
            type="radio"
            checked={draft.source === 'pasted-env'}
            onChange={() => onDraftChange({ ...draft, source: 'pasted-env' })}
          />{' '}
          Paste .env values <span className="text-neutral-400">Values default to Secret</span>
        </label>
        <label className="mt-2 block text-sm">
          <input
            type="radio"
            checked={draft.source === 'sample-template'}
            onChange={() => onDraftChange({ ...draft, source: 'sample-template' })}
          />{' '}
          Paste .env.sample / .env.example <span className="text-neutral-400">Creates required keys only; no values saved</span>
        </label>
      </fieldset>

      {isPastedEnv && (
        <label className="block text-sm">
          Saved value name
          <input
            className="mt-1 w-full rounded bg-neutral-950 p-2"
            value={draft.savedValueName}
            onChange={(event) => onDraftChange({ ...draft, savedValueName: event.target.value })}
            placeholder="local"
          />
        </label>
      )}

      <label className="block text-sm">
        Plain keys override
        <input
          className="mt-1 w-full rounded bg-neutral-950 p-2 font-mono"
          value={draft.plainKeysText}
          onChange={(event) => onDraftChange({ ...draft, plainKeysText: event.target.value })}
          placeholder="PORT, CLIENT_ID"
        />
        <span className="mt-1 block text-xs text-neutral-400">All pasted values default to Secret unless listed here.</span>
      </label>

      <label className="block text-sm">
        Paste content
        <textarea
          className="mt-1 min-h-40 w-full rounded bg-neutral-950 p-2 font-mono"
          value={draft.content}
          onChange={(event) => onDraftChange({ ...draft, content: event.target.value })}
          placeholder="API_TOKEN=..."
        />
      </label>

      <div className="flex gap-2">
        <button type="button" className="rounded bg-violet-600 px-3 py-2 text-sm font-semibold disabled:opacity-50" disabled={isPreviewing || draft.content.trim() === ''} onClick={onPreview}>
          {isPreviewing ? 'Previewing…' : 'Preview'}
        </button>
        <button type="button" className="rounded bg-emerald-600 px-3 py-2 text-sm font-semibold disabled:opacity-50" disabled={!canApply} onClick={onApply}>
          {isApplying ? 'Applying…' : 'Apply'}
        </button>
      </div>

      {error && <p className="rounded border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-100">{formatVardashImportError(error)}</p>}
      {preview && <VardashImportPreviewView preview={preview} savedValueName={draft.savedValueName.trim() || 'imported'} />}
    </section>
  );
}

export function VardashImportPreviewView({ preview, savedValueName }: { preview: VardashImportResponse; savedValueName: string }) {
  return (
    <section aria-label="Vardash import preview" className="space-y-4 rounded border border-neutral-800 p-4">
      <header>
        <h3 className="font-semibold">Preview import</h3>
        <p className="text-sm text-neutral-400">No changes are applied until conflicts are resolved and Apply is clicked.</p>
      </header>

      <table className="min-w-full text-sm">
        <thead className="text-left text-xs uppercase tracking-wide text-neutral-400">
          <tr>
            <th className="py-2">Key</th>
            <th className="py-2">Kind</th>
            <th className="py-2">Required</th>
            <th className="py-2">Action</th>
          </tr>
        </thead>
        <tbody>
          {preview.keys.map((key) => (
            <tr key={key.key}>
              <td className="py-2 font-mono">{key.key}</td>
              <td className="py-2">{key.kind === 'secret' ? 'Secret' : 'Plain'}</td>
              <td className="py-2">{key.required ? 'Yes' : 'No'}</td>
              <td className="py-2">{importActionLabel('willCreateSavedValue' in key ? key.willCreateSavedValue : false, savedValueName)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {preview.diagnostics.length > 0 && (
        <section>
          <h4 className="font-semibold">Diagnostics</h4>
          <ul className="list-disc pl-5 text-sm text-amber-100">
            {preview.diagnostics.map((diagnostic) => (
              <li key={`${diagnostic.line}-${diagnostic.message}`}>Line {diagnostic.line}: {diagnostic.message}</li>
            ))}
          </ul>
        </section>
      )}

      {preview.conflicts.length > 0 && (
        <section>
          <h4 className="font-semibold">Conflicts</h4>
          <ul className="list-disc pl-5 text-sm text-red-100">
            {preview.conflicts.map((conflict) => (
              <li key={`${conflict.key}-${conflict.reason}-${conflict.savedValueName ?? ''}`}>{formatVardashImportConflict(conflict)}</li>
            ))}
          </ul>
        </section>
      )}
    </section>
  );
}

export function formatVardashImportConflict(conflict: VardashImportConflict): string {
  switch (conflict.reason) {
    case 'duplicate_key_in_import':
      return `${conflict.key}: duplicate key in import.`;
    case 'saved_value_name_exists':
      return `${conflict.key}: saved value name "${conflict.savedValueName ?? 'imported'}" already exists.`;
    case 'secret_to_plain_with_existing_values':
      return `${conflict.key}: cannot change existing Secret key with saved values to Plain.`;
  }
}

function importActionLabel(willCreateSavedValue: boolean, savedValueName: string): string {
  return willCreateSavedValue ? `Create key + saved value "${savedValueName}"` : 'Create/update required key only';
}

function parsePlainKeys(value: string): string[] {
  return value.split(/[\n,]/).map((entry) => entry.trim()).filter(Boolean);
}

function formatVardashImportError(error: VardashApiError): string {
  return error.errorCode ? `Import failed: ${error.errorCode}` : 'Import failed. Review the preview and try again.';
}
