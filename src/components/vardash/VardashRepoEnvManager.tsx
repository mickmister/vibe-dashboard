import React, { useMemo, useState } from 'react';

import {
  useCreateVardashSavedValue,
  useReplaceVardashSavedValue,
  useSetVardashRepoDefaultSelection,
  useSetVardashWorkspaceRepoSelection,
  useUpsertVardashRepoEnvKey,
  useVardashRepoEnvOverview,
} from '../../hooks/useVardash';
import type {
  VardashRepoEnvOverviewResponse,
  VardashRepoEnvOverviewRow,
  VardashSavedValueMetadata,
  VardashValueKind,
} from '../../lib/vardash-client';

export interface VardashRepoEnvManagerProps {
  repoId: string;
  workspaceId: string;
  repoLabel?: string;
}

export function VardashRepoEnvManager({ repoId, workspaceId, repoLabel }: VardashRepoEnvManagerProps) {
  const overview = useVardashRepoEnvOverview(repoId, workspaceId);
  const upsertKey = useUpsertVardashRepoEnvKey();
  const createSavedValue = useCreateVardashSavedValue();
  const replaceSavedValue = useReplaceVardashSavedValue();
  const setRepoDefault = useSetVardashRepoDefaultSelection();
  const setWorkspaceSelection = useSetVardashWorkspaceRepoSelection();
  const [selectedKeyId, setSelectedKeyId] = useState<string | null>(null);
  const [newKey, setNewKey] = useState('');
  const [newKind, setNewKind] = useState<VardashValueKind>('secret');
  const [newRequired, setNewRequired] = useState(true);
  const [newDescription, setNewDescription] = useState('');
  const [savedValueDraft, setSavedValueDraft] = useState<VardashSavedValueDraft | null>(null);

  const rows = overview.data?.rows ?? [];
  const selectedRow = useMemo(() => {
    if (rows.length === 0) return null;
    return rows.find((row) => row.key.id === selectedKeyId) ?? rows[0] ?? null;
  }, [rows, selectedKeyId]);

  const selectedDraftScope = selectedRow ? { keyId: selectedRow.key.id, kind: selectedRow.key.kind } : null;
  const visibleSavedValueDraft = visibleVardashSavedValueDraft(savedValueDraft, selectedDraftScope);

  if (overview.isLoading) return <section aria-label="Vardash repo env">Loading vardash env…</section>;
  if (overview.error) return <section aria-label="Vardash repo env">Unable to load vardash env metadata.</section>;
  if (!overview.data) return null;

  const busy = upsertKey.isPending || createSavedValue.isPending || replaceSavedValue.isPending || setRepoDefault.isPending || setWorkspaceSelection.isPending;

  return (
    <VardashRepoEnvOverviewView
      overview={overview.data}
      repoLabel={repoLabel ?? repoId}
      selectedKeyId={selectedRow?.key.id ?? null}
      onSelectKey={setSelectedKeyId}
      addKeyForm={{
        keyName: newKey,
        kind: newKind,
        required: newRequired,
        description: newDescription,
        busy,
        onKeyNameChange: setNewKey,
        onKindChange: setNewKind,
        onRequiredChange: setNewRequired,
        onDescriptionChange: setNewDescription,
        onSubmit: async () => {
          const trimmed = newKey.trim();
          if (!trimmed) return;
          const result = await upsertKey.mutateAsync({
            repoId,
            workspaceId,
            input: {
              key: trimmed,
              kind: newKind,
              required: newRequired,
              description: newDescription.trim() || null,
            },
          });
          setSelectedKeyId(result.key.id);
          setNewKey('');
          setNewDescription('');
        },
      }}
      savedValueForm={{
        name: visibleSavedValueDraft.name,
        value: visibleSavedValueDraft.value,
        replaceSavedValueId: visibleSavedValueDraft.replaceSavedValueId,
        busy,
        onNameChange: (value) => setSavedValueDraft(nextVardashSavedValueDraft(selectedDraftScope, visibleSavedValueDraft, { name: value })),
        onValueChange: (value) => setSavedValueDraft(nextVardashSavedValueDraft(selectedDraftScope, visibleSavedValueDraft, { value })),
        onReplaceSavedValueIdChange: (value) => setSavedValueDraft(nextVardashSavedValueDraft(selectedDraftScope, visibleSavedValueDraft, { replaceSavedValueId: value })),
        onSubmit: async (row) => {
          const draft = visibleVardashSavedValueDraft(savedValueDraft, { keyId: row.key.id, kind: row.key.kind });
          const trimmedName = draft.name.trim();
          if (!trimmedName || draft.value === '') return;
          if (draft.replaceSavedValueId) {
            await replaceSavedValue.mutateAsync({
              repoId,
              workspaceId,
              envKeyId: row.key.id,
              savedValueId: draft.replaceSavedValueId,
              input: { name: trimmedName, value: draft.value },
            });
          } else {
            await createSavedValue.mutateAsync({
              repoId,
              workspaceId,
              envKeyId: row.key.id,
              input: { name: trimmedName, value: draft.value },
            });
          }
          setSavedValueDraft(null);
        },
      }}
      onSetRepoDefault={(row, savedValueId) => setRepoDefault.mutate({ repoId, workspaceId, input: { envKeyId: row.key.id, savedValueId } })}
      onSetWorkspaceSelection={workspaceId
        ? (row, savedValueId) => setWorkspaceSelection.mutate({ workspaceId, repoId, input: { envKeyId: row.key.id, savedValueId } })
        : undefined}
    />
  );
}

interface VardashRepoEnvOverviewViewProps {
  overview: VardashRepoEnvOverviewResponse;
  repoLabel: string;
  selectedKeyId: string | null;
  onSelectKey?: (keyId: string) => void;
  addKeyForm?: AddKeyFormProps;
  savedValueForm?: SavedValueFormProps;
  onSetRepoDefault?: (row: VardashRepoEnvOverviewRow, savedValueId: string | null) => void;
  onSetWorkspaceSelection?: (row: VardashRepoEnvOverviewRow, savedValueId: string | null) => void;
}

interface AddKeyFormProps {
  keyName: string;
  kind: VardashValueKind;
  required: boolean;
  description: string;
  busy?: boolean;
  onKeyNameChange: (value: string) => void;
  onKindChange: (value: VardashValueKind) => void;
  onRequiredChange: (value: boolean) => void;
  onDescriptionChange: (value: string) => void;
  onSubmit: () => void | Promise<void>;
}

interface SavedValueFormProps {
  name: string;
  value: string;
  replaceSavedValueId: string | null;
  busy?: boolean;
  onNameChange: (value: string) => void;
  onValueChange: (value: string) => void;
  onReplaceSavedValueIdChange: (value: string | null) => void;
  onSubmit: (row: VardashRepoEnvOverviewRow) => void | Promise<void>;
}

export function VardashRepoEnvOverviewView({
  overview,
  repoLabel,
  selectedKeyId,
  onSelectKey,
  addKeyForm,
  savedValueForm,
  onSetRepoDefault,
  onSetWorkspaceSelection,
}: VardashRepoEnvOverviewViewProps) {
  const selectedRow = overview.rows.find((row) => row.key.id === selectedKeyId) ?? overview.rows[0] ?? null;

  return (
    <section aria-label="Vardash repo env" className="space-y-6 text-neutral-100">
      <header className="space-y-2">
        <p className="text-xs uppercase tracking-wide text-violet-300">Vardash / Repo: {repoLabel}</p>
        <h2 className="text-2xl font-semibold">Repo env values</h2>
        <p className="text-sm text-neutral-300">
          Scope: repo values{overview.workspaceId ? ` · Workspace: ${overview.workspaceId}` : ''}
        </p>
        <p className="rounded border border-amber-400/40 bg-amber-400/10 p-3 text-sm text-amber-100">
          Secrets are write-only. Saved secret values cannot be revealed, copied, or previewed after saving.
        </p>
        <p className="text-xs text-neutral-400">{overview.descriptionGuidance}</p>
      </header>

      {addKeyForm && <AddEnvKeyForm form={addKeyForm} />}

      <div className="overflow-x-auto rounded border border-neutral-800">
        <table className="min-w-full divide-y divide-neutral-800 text-sm">
          <thead className="bg-neutral-950 text-left text-xs uppercase tracking-wide text-neutral-400">
            <tr>
              <th className="px-3 py-2">Key</th>
              <th className="px-3 py-2">Kind</th>
              <th className="px-3 py-2">Required</th>
              <th className="px-3 py-2">Saved values</th>
              <th className="px-3 py-2">Repo default</th>
              {overview.workspaceId && <th className="px-3 py-2">This workspace</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-900">
            {overview.rows.map((row) => {
              const missingRequired = row.key.required && row.repoDefaultSelection == null && row.workspaceSelection.mode === 'inherit';
              return (
                <tr key={row.key.id} className={row.key.id === selectedRow?.key.id ? 'bg-violet-950/30' : undefined}>
                  <td className="px-3 py-2">
                    <button type="button" className="font-mono text-left text-violet-200" onClick={() => onSelectKey?.(row.key.id)}>
                      {row.key.key}
                    </button>
                    {missingRequired && <span className="ml-2 rounded bg-red-500/20 px-2 py-0.5 text-xs text-red-200">Required · no value selected</span>}
                  </td>
                  <td className="px-3 py-2"><KindBadge kind={row.key.kind} /></td>
                  <td className="px-3 py-2">{row.key.required ? 'Yes' : 'No'}</td>
                  <td className="px-3 py-2">{row.savedValueCount}</td>
                  <td className="px-3 py-2">{row.repoDefaultSelection?.savedValueName ?? 'unset'}</td>
                  {overview.workspaceId && (
                    <td className="px-3 py-2">
                      {row.workspaceSelection.mode === 'selected' ? row.workspaceSelection.savedValueName : 'inherit repo default'}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {selectedRow && (
        <SavedValuesPanel
          row={selectedRow}
          workspaceId={overview.workspaceId}
          form={savedValueForm}
          onSetRepoDefault={onSetRepoDefault}
          onSetWorkspaceSelection={onSetWorkspaceSelection}
        />
      )}
    </section>
  );
}

function AddEnvKeyForm({ form }: { form: AddKeyFormProps }) {
  return (
    <form className="grid gap-3 rounded border border-neutral-800 p-3 md:grid-cols-5" onSubmit={(event) => { event.preventDefault(); void form.onSubmit(); }}>
      <label className="text-sm">
        Key
        <input className="mt-1 w-full rounded bg-neutral-950 p-2 font-mono" value={form.keyName} onChange={(event) => form.onKeyNameChange(event.target.value)} placeholder="API_TOKEN" />
      </label>
      <label className="text-sm">
        Kind
        <select className="mt-1 w-full rounded bg-neutral-950 p-2" value={form.kind} onChange={(event) => form.onKindChange(event.target.value as VardashValueKind)}>
          <option value="secret">Secret</option>
          <option value="plain">Plain</option>
        </select>
      </label>
      <label className="text-sm">
        Required
        <input className="ml-2" type="checkbox" checked={form.required} onChange={(event) => form.onRequiredChange(event.target.checked)} />
      </label>
      <label className="text-sm md:col-span-2">
        Description
        <input className="mt-1 w-full rounded bg-neutral-950 p-2" value={form.description} onChange={(event) => form.onDescriptionChange(event.target.value)} placeholder="Optional metadata. Do not include secrets." />
      </label>
      <button className="rounded bg-violet-600 px-3 py-2 text-sm font-semibold disabled:opacity-50" type="submit" disabled={form.busy}>Add key</button>
    </form>
  );
}

function SavedValuesPanel({
  row,
  workspaceId,
  form,
  onSetRepoDefault,
  onSetWorkspaceSelection,
}: {
  row: VardashRepoEnvOverviewRow;
  workspaceId: string | null;
  form?: SavedValueFormProps;
  onSetRepoDefault?: (row: VardashRepoEnvOverviewRow, savedValueId: string | null) => void;
  onSetWorkspaceSelection?: (row: VardashRepoEnvOverviewRow, savedValueId: string | null) => void;
}) {
  return (
    <section className="rounded border border-neutral-800 p-4" aria-label={`Saved values for ${row.key.key}`}>
      <header className="mb-4 flex flex-wrap items-center gap-2">
        <h3 className="font-mono text-lg font-semibold">{row.key.key}</h3>
        <KindBadge kind={row.key.kind} />
        <span className="rounded bg-neutral-800 px-2 py-0.5 text-xs">{row.key.required ? 'Required' : 'Optional'}</span>
      </header>
      {row.key.description && <p className="mb-3 text-sm text-neutral-300">{row.key.description}</p>}
      {row.key.kind === 'secret' && (
        <p className="mb-3 rounded bg-neutral-900 p-3 text-sm text-neutral-300">
          Secret values are not recallable. Replacing a value overwrites it without showing its previous content.
        </p>
      )}
      <table className="min-w-full text-sm">
        <thead className="text-left text-xs uppercase tracking-wide text-neutral-400">
          <tr>
            <th className="py-2">Name</th>
            <th className="py-2">{row.key.kind === 'secret' ? 'Value status' : 'Value'}</th>
            <th className="py-2">Repo default</th>
            {workspaceId && <th className="py-2">Workspace {workspaceId}</th>}
          </tr>
        </thead>
        <tbody>
          {row.savedValues.map((savedValue) => (
            <tr key={savedValue.id}>
              <td className="py-2">{savedValue.name}</td>
              <td className="py-2">{valueLabel(savedValue)}</td>
              <td className="py-2">
                {row.repoDefaultSelection?.savedValueId === savedValue.id ? 'selected' : (
                  <button type="button" onClick={() => onSetRepoDefault?.(row, savedValue.id)}>Set default</button>
                )}
              </td>
              {workspaceId && (
                <td className="py-2">
                  {row.workspaceSelection.mode === 'selected' && row.workspaceSelection.savedValueId === savedValue.id ? 'selected' : (
                    <button type="button" onClick={() => onSetWorkspaceSelection?.(row, savedValue.id)}>Use in workspace</button>
                  )}
                </td>
              )}
            </tr>
          ))}
          {row.savedValues.length === 0 && (
            <tr><td colSpan={workspaceId ? 4 : 3} className="py-3 text-neutral-400">No saved values yet.</td></tr>
          )}
        </tbody>
      </table>
      {workspaceId && (
        <button className="mt-2 text-sm text-neutral-300" type="button" onClick={() => onSetWorkspaceSelection?.(row, null)}>
          Inherit repo default
        </button>
      )}
      {form && <SavedValueForm row={row} form={form} />}
    </section>
  );
}

function SavedValueForm({ row, form }: { row: VardashRepoEnvOverviewRow; form: SavedValueFormProps }) {
  const replacingSecret = row.key.kind === 'secret' && form.replaceSavedValueId;
  return (
    <form className="mt-4 grid gap-3 rounded bg-neutral-950 p-3 md:grid-cols-4" onSubmit={(event) => { event.preventDefault(); void form.onSubmit(row); }}>
      <label className="text-sm">
        Name
        <input className="mt-1 w-full rounded bg-neutral-900 p-2" value={form.name} onChange={(event) => form.onNameChange(event.target.value)} placeholder="local-dev" />
      </label>
      <label className="text-sm">
        Replace existing
        <select className="mt-1 w-full rounded bg-neutral-900 p-2" value={form.replaceSavedValueId ?? ''} onChange={(event) => form.onReplaceSavedValueIdChange(event.target.value || null)}>
          <option value="">Add new saved value</option>
          {row.savedValues.map((savedValue) => <option key={savedValue.id} value={savedValue.id}>{savedValue.name}</option>)}
        </select>
      </label>
      <label className="text-sm md:col-span-2">
        {row.key.kind === 'secret' ? 'Secret value' : 'Plain value'}
        <input
          className="mt-1 w-full rounded bg-neutral-900 p-2"
          type={row.key.kind === 'secret' ? 'password' : 'text'}
          value={form.value}
          onChange={(event) => form.onValueChange(event.target.value)}
          placeholder={replacingSecret ? 'Existing value cannot be displayed. Paste a replacement.' : undefined}
        />
      </label>
      <button className="rounded bg-violet-600 px-3 py-2 text-sm font-semibold disabled:opacity-50" type="submit" disabled={form.busy}>
        {form.replaceSavedValueId ? 'Replace saved value' : 'Add saved value'}
      </button>
    </form>
  );
}

function KindBadge({ kind }: { kind: VardashValueKind }) {
  return <span className="rounded bg-neutral-800 px-2 py-0.5 text-xs">{kind === 'secret' ? 'Secret' : 'Plain'}</span>;
}

function valueLabel(savedValue: VardashSavedValueMetadata): string {
  if (savedValue.kind === 'secret') return savedValue.hasValue ? 'Secret saved' : 'No value';
  return savedValue.value ?? '';
}

export interface VardashSavedValueDraftScope {
  keyId: string;
  kind: VardashValueKind;
}

export interface VardashSavedValueDraft extends VardashSavedValueDraftScope {
  name: string;
  value: string;
  replaceSavedValueId: string | null;
}

const EMPTY_SAVED_VALUE_DRAFT = { name: '', value: '', replaceSavedValueId: null } as const;

export function visibleVardashSavedValueDraft(
  draft: VardashSavedValueDraft | null,
  scope: VardashSavedValueDraftScope | null,
): Pick<VardashSavedValueDraft, 'name' | 'value' | 'replaceSavedValueId'> {
  if (!draft || !scope) return EMPTY_SAVED_VALUE_DRAFT;
  if (draft.keyId !== scope.keyId || draft.kind !== scope.kind) return EMPTY_SAVED_VALUE_DRAFT;
  return { name: draft.name, value: draft.value, replaceSavedValueId: draft.replaceSavedValueId };
}

function nextVardashSavedValueDraft(
  scope: VardashSavedValueDraftScope | null,
  current: Pick<VardashSavedValueDraft, 'name' | 'value' | 'replaceSavedValueId'>,
  patch: Partial<Pick<VardashSavedValueDraft, 'name' | 'value' | 'replaceSavedValueId'>>,
): VardashSavedValueDraft | null {
  if (!scope) return null;
  return { ...scope, ...current, ...patch };
}
