import React, { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { WORKFLOW_EXECUTOR_MODEL_OPTIONS, WORKFLOW_EXECUTOR_TYPES } from "@vibe-dashboard/workflow-core";
import { StandaloneDashboardPage } from "../../../../components/StandaloneDashboardPage";
import {
  createWorkflowPromptAsset,
  createWorkflowRoleTemplate,
  createWorkflowSkillAsset,
  fetchWorkflowAssets,
  type WorkflowAssetAttachmentRef,
  type WorkflowAssetPickerItem,
  type WorkflowAssetsModel,
  type WorkflowRoleTemplatePickerItem,
} from "../client/workflowAssetsApi";
import { workflowRouteHref } from "./workflowRouteContext";

type LibraryEditMode =
  | { kind: "none" }
  | { kind: "prompt"; source?: WorkflowAssetPickerItem }
  | { kind: "skill"; source?: WorkflowAssetPickerItem }
  | { kind: "role"; source?: WorkflowRoleTemplatePickerItem };

type LibraryAssetRequest = { promptAssetId?: string; skillAssetId?: string; version?: number; name: string; description?: string | null; bodyMarkdown: string };
type LibraryRoleRequest = { roleTemplateId?: string; version?: number; name: string; description?: string | null; promptMarkdown: string; promptRefs?: WorkflowAssetAttachmentRef[]; skillRefs?: WorkflowAssetAttachmentRef[]; executorPreference?: { executorType: string; model?: string; mode?: string } | null };

export function WorkflowLibraryPage(): React.ReactElement {
  const [searchParams] = useSearchParams();
  const [assets, setAssets] = useState<WorkflowAssetsModel>({ prompts: [], skills: [], roleTemplates: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setAssets(await fetchWorkflowAssets());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const refreshAfter = async (success: string, action: () => Promise<unknown>) => {
    setMessage(null);
    setError(null);
    try {
      await action();
      setMessage(success);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  };

  return (
    <WorkflowLibraryView
      assets={assets}
      loading={loading}
      error={error}
      message={message}
      onRefresh={load}
      backHref={workflowRouteHref("/dashboard/workflows", searchParams)}
      onCreatePrompt={(request) => refreshAfter("Published prompt asset version.", () => createWorkflowPromptAsset(request))}
      onCreateSkill={(request) => refreshAfter("Published skill snippet version.", () => createWorkflowSkillAsset(request))}
      onCreateRoleTemplate={(request) => refreshAfter("Published role template version.", () => createWorkflowRoleTemplate(request))}
    />
  );
}

export function WorkflowLibraryView({
  assets,
  loading = false,
  error = null,
  message = null,
  onRefresh,
  backHref = "/dashboard/workflows",
  initialMode = { kind: "none" },
  onCreatePrompt,
  onCreateSkill,
  onCreateRoleTemplate,
}: {
  assets: WorkflowAssetsModel;
  loading?: boolean;
  error?: string | null;
  message?: string | null;
  onRefresh?: () => void;
  backHref?: string;
  initialMode?: LibraryEditMode;
  onCreatePrompt?: (request: { promptAssetId?: string; version?: number; name: string; description?: string | null; bodyMarkdown: string }) => void | Promise<void>;
  onCreateSkill?: (request: { skillAssetId?: string; version?: number; name: string; description?: string | null; bodyMarkdown: string }) => void | Promise<void>;
  onCreateRoleTemplate?: (request: LibraryRoleRequest) => void | Promise<void>;
}): React.ReactElement {
  const [mode, setMode] = useState<LibraryEditMode>(initialMode);
  const roleTemplates = assets.roleTemplates ?? [];
  const promptGroups = groupAssetVersions(assets.prompts);
  const skillGroups = groupAssetVersions(assets.skills);
  const roleTemplateGroups = groupRoleTemplateVersions(roleTemplates);
  return (
    <StandaloneDashboardPage>
      <main className="mx-auto flex w-full max-w-7xl flex-col gap-5 p-6 text-zinc-100" aria-label="Workflow library">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-cyan-300">Workflows</p>
            <h1 className="mt-1 text-2xl font-semibold">Library</h1>
            <p className="mt-2 max-w-3xl text-sm text-zinc-400">
              Manage reusable workflow roles, prompt assets, and markdown skill snippets. Published versions are immutable and runs snapshot the resolved content they use.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <a className="rounded-md border border-zinc-700 px-3 py-2 text-sm hover:bg-zinc-800" href={backHref}>Back to Workflows</a>
            <button className="rounded-md border border-zinc-700 px-3 py-2 text-sm hover:bg-zinc-800" onClick={onRefresh} type="button">Refresh</button>
          </div>
        </header>

        {loading ? <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-4 text-sm text-zinc-300">Loading workflow library…</div> : null}
        {error ? <div className="rounded-lg border border-rose-900 bg-rose-950/30 p-4 text-sm text-rose-100">{safeText(error)}</div> : null}
        {message ? <div className="rounded-lg border border-emerald-900 bg-emerald-950/30 p-4 text-sm text-emerald-100">{message}</div> : null}

        <section className="grid gap-4 xl:grid-cols-3">
          <LibraryColumn title="Role templates" empty="No reusable role templates yet." description="Reusable role behavior: prompt assets, markdown skill refs, base instructions, and executor/model defaults." action={<button className="rounded-md bg-cyan-500 px-3 py-1.5 text-sm font-medium text-zinc-950" type="button" onClick={() => setMode({ kind: "role" })}>New Role Template</button>}>
            {roleTemplateGroups.map((group) => <RoleTemplateVersionGroup key={group.id} group={group} onEdit={(template) => setMode({ kind: "role", source: template })} />)}
          </LibraryColumn>
          <LibraryColumn title="Prompt assets" empty="No prompt assets yet." description="Reusable prompt blocks for workflow role templates and agent steps." action={<button className="rounded-md bg-cyan-500 px-3 py-1.5 text-sm font-medium text-zinc-950" type="button" onClick={() => setMode({ kind: "prompt" })}>New Prompt</button>}>
            {promptGroups.map((group) => <AssetVersionGroup key={group.id} group={group} onEdit={(asset) => setMode({ kind: "prompt", source: asset })} />)}
          </LibraryColumn>
          <LibraryColumn title="Skill snippets" empty="No markdown skill snippets yet." description="Instruction snippets only; these are not executable providers." action={<button className="rounded-md bg-cyan-500 px-3 py-1.5 text-sm font-medium text-zinc-950" type="button" onClick={() => setMode({ kind: "skill" })}>New Skill</button>}>
            {skillGroups.map((group) => <AssetVersionGroup key={group.id} group={group} onEdit={(asset) => setMode({ kind: "skill", source: asset })} />)}
          </LibraryColumn>
        </section>

        {mode.kind === "none" ? (
          <section className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 text-sm text-zinc-400" aria-label="Workflow library next action">
            Choose New or Edit as new version to change reusable workflow behavior. Existing published versions stay read-only.
          </section>
        ) : null}
        {mode.kind === "prompt" ? <PromptAssetForm source={mode.source} onCancel={() => setMode({ kind: "none" })} onSubmit={(request) => onCreatePrompt?.(request)} /> : null}
        {mode.kind === "skill" ? <SkillAssetForm source={mode.source} onCancel={() => setMode({ kind: "none" })} onSubmit={(request) => onCreateSkill?.(request)} /> : null}
        {mode.kind === "role" ? <RoleTemplateForm assets={assets} source={mode.source} onCancel={() => setMode({ kind: "none" })} onSubmit={(request) => onCreateRoleTemplate?.(request)} /> : null}
      </main>
    </StandaloneDashboardPage>
  );
}

function LibraryColumn({ title, description, empty, action, children }: { title: string; description: string; empty: string; action: React.ReactNode; children: React.ReactNode }): React.ReactElement {
  const childArray = React.Children.toArray(children);
  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4" aria-label={title}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{title}</h2>
          <p className="mt-1 text-sm text-zinc-500">{description}</p>
        </div>
        {action}
      </div>
      <div className="mt-4 space-y-3">
        {childArray.length ? childArray : <p className="rounded border border-dashed border-zinc-800 p-3 text-sm text-zinc-500">{empty}</p>}
      </div>
    </section>
  );
}

type VersionGroup<T extends { id: string; version: number }> = {
  id: string;
  latest: T;
  versions: T[];
};

function AssetVersionGroup({ group, onEdit }: { group: VersionGroup<WorkflowAssetPickerItem>; onEdit?: (asset: WorkflowAssetPickerItem) => void }): React.ReactElement {
  const asset = group.latest;
  const assetKind = asset.kind === "skill" ? "Skill snippet" : "Prompt asset";
  return (
    <article className="rounded-lg border border-zinc-800 bg-slate-950/70 p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-medium">{asset.name}</h3>
        <span className="rounded border border-cyan-800 bg-cyan-950/40 px-2 py-0.5 text-xs text-cyan-100">Latest v{asset.version}</span>
      </div>
      <p className="mt-1 text-xs text-zinc-500">{assetKind} · {sourceLabel(asset.source)}</p>
      <p className="mt-2 text-xs text-cyan-200">Use latest follows the newest published version when a new run snapshot is created. Pinned references keep the selected version.</p>
      {asset.description ? <p className="mt-2 text-sm text-zinc-400">{safeText(asset.description)}</p> : null}
      <p className="mt-2 line-clamp-4 whitespace-pre-wrap text-sm text-zinc-300">{safeText(asset.preview)}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button className="rounded-md border border-zinc-700 px-2 py-1 text-xs text-cyan-100 hover:border-cyan-500" type="button" onClick={() => onEdit?.(asset)}>Edit latest as new version</button>
      </div>
      <details className="mt-3 rounded-md border border-zinc-800 bg-zinc-950/50 p-2">
        <summary className="cursor-pointer text-xs font-medium text-zinc-300">Version history ({group.versions.length})</summary>
        <div className="mt-2 space-y-2" aria-label={`${asset.name} version history`}>
          {group.versions.map((version) => (
            <div key={`${version.id}:${version.version}`} className="rounded border border-zinc-800 bg-zinc-950 p-2 text-xs text-zinc-400">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span><strong className="text-zinc-200">v{version.version}</strong>{version.version === asset.version ? " · Latest" : ""} · {sourceLabel(version.source)}</span>
                <button className="rounded border border-zinc-700 px-2 py-1 text-cyan-100 hover:border-cyan-500" type="button" onClick={() => onEdit?.(version)}>Copy from v{version.version}</button>
              </div>
              <p className="mt-1 line-clamp-2 whitespace-pre-wrap">{safeText(version.preview)}</p>
            </div>
          ))}
        </div>
      </details>
    </article>
  );
}

function RoleTemplateVersionGroup({ group, onEdit }: { group: VersionGroup<WorkflowRoleTemplatePickerItem>; onEdit?: (template: WorkflowRoleTemplatePickerItem) => void }): React.ReactElement {
  const template = group.latest;
  return (
    <article className="rounded-lg border border-zinc-800 bg-slate-950/70 p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-medium">{template.name}</h3>
        <span className="rounded border border-cyan-800 bg-cyan-950/40 px-2 py-0.5 text-xs text-cyan-100">Latest v{template.version}</span>
      </div>
      <p className="mt-1 text-xs text-zinc-500">Role template · {sourceLabel(template.source)}{template.active ? "" : " · Inactive"}</p>
      <p className="mt-2 text-xs text-cyan-200">Role template links can use latest for future runs or pin an exact version for deterministic published workflows.</p>
      {template.description ? <p className="mt-2 text-sm text-zinc-400">{safeText(template.description)}</p> : null}
      <p className="mt-2 line-clamp-4 whitespace-pre-wrap text-sm text-zinc-300">{safeText(template.promptPreview)}</p>
      {template.promptRefs?.length ? <p className="mt-2 text-xs text-zinc-500">Prompts: {template.promptRefs.map(formatAttachmentRef).join(", ")}</p> : null}
      {template.skillRefs.length ? <p className="mt-2 text-xs text-zinc-500">Skills: {template.skillRefs.map(formatAttachmentRef).join(", ")}</p> : null}
      {template.executorPreference ? <p className="mt-1 text-xs text-zinc-500">Default executor: {template.executorPreference.executorType}{template.executorPreference.model ? ` · ${template.executorPreference.model}` : ""}</p> : <p className="mt-1 text-xs text-zinc-500">Default executor: workspace default</p>}
      <button className="mt-3 rounded-md border border-zinc-700 px-2 py-1 text-xs text-cyan-100 hover:border-cyan-500" type="button" onClick={() => onEdit?.(template)}>Edit latest as new version</button>
      <details className="mt-3 rounded-md border border-zinc-800 bg-zinc-950/50 p-2">
        <summary className="cursor-pointer text-xs font-medium text-zinc-300">Version history ({group.versions.length})</summary>
        <div className="mt-2 space-y-2" aria-label={`${template.name} version history`}>
          {group.versions.map((version) => (
            <div key={`${version.id}:${version.version}`} className="rounded border border-zinc-800 bg-zinc-950 p-2 text-xs text-zinc-400">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span><strong className="text-zinc-200">v{version.version}</strong>{version.version === template.version ? " · Latest" : ""} · {sourceLabel(version.source)}</span>
                <button className="rounded border border-zinc-700 px-2 py-1 text-cyan-100 hover:border-cyan-500" type="button" onClick={() => onEdit?.(version)}>Copy from v{version.version}</button>
              </div>
              <p className="mt-1 line-clamp-2 whitespace-pre-wrap">{safeText(version.promptPreview)}</p>
            </div>
          ))}
        </div>
      </details>
    </article>
  );
}

function PromptAssetForm({ source, onCancel, onSubmit }: { source?: WorkflowAssetPickerItem; onCancel: () => void; onSubmit?: (request: { promptAssetId?: string; version?: number; name: string; description?: string | null; bodyMarkdown: string }) => void | Promise<void> }): React.ReactElement {
  return <LibraryForm title={source ? "Edit prompt as new version" : "New prompt asset"} idLabel="Prompt id" bodyLabel="Prompt markdown" idPlaceholder="prompt.review.security" source={source} onCancel={onCancel} onSubmit={(value) => onSubmit?.({ promptAssetId: value.id, version: value.version, name: value.name, description: value.description, bodyMarkdown: value.body })} />;
}

function SkillAssetForm({ source, onCancel, onSubmit }: { source?: WorkflowAssetPickerItem; onCancel: () => void; onSubmit?: (request: { skillAssetId?: string; version?: number; name: string; description?: string | null; bodyMarkdown: string }) => void | Promise<void> }): React.ReactElement {
  return <LibraryForm title={source ? "Edit skill as new version" : "New skill snippet"} idLabel="Skill id" bodyLabel="Skill markdown" idPlaceholder="skill.review.accessibility" source={source} onCancel={onCancel} onSubmit={(value) => onSubmit?.({ skillAssetId: value.id, version: value.version, name: value.name, description: value.description, bodyMarkdown: value.body })} />;
}

function RoleTemplateForm({ assets, source, onCancel, onSubmit }: { assets: WorkflowAssetsModel; source?: WorkflowRoleTemplatePickerItem; onCancel: () => void; onSubmit?: (request: LibraryRoleRequest) => void | Promise<void> }): React.ReactElement {
  const initialPromptRefs = source?.promptRefs ?? [];
  const initialSkillRefs = source?.skillRefs ?? [];
  const [promptRefs, setPromptRefs] = useState<WorkflowAssetAttachmentRef[]>(initialPromptRefs);
  const [skillRefs, setSkillRefs] = useState<WorkflowAssetAttachmentRef[]>(initialSkillRefs);
  const [executorType, setExecutorType] = useState(source?.executorPreference?.executorType ?? "");
  const [model, setModel] = useState(source?.executorPreference?.model ?? "");
  const models = executorType ? (WORKFLOW_EXECUTOR_MODEL_OPTIONS[executorType as keyof typeof WORKFLOW_EXECUTOR_MODEL_OPTIONS]?.models ?? []) : [];
  const extra = (
    <div className="space-y-4">
      <AssetAttachmentPicker title="Prompt assets" kind="prompt" assets={assets.prompts} selected={promptRefs} onChange={setPromptRefs} />
      <AssetAttachmentPicker title="Skill snippets" kind="skill" assets={assets.skills} selected={skillRefs} onChange={setSkillRefs} />
      <div className="grid gap-3 md:grid-cols-2">
        <label className="block text-sm text-zinc-300">
          Default executor
          <select className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-950 p-2 text-sm" value={executorType} onChange={(event) => { setExecutorType(event.target.value); setModel(""); }}>
            <option value="">Workspace default</option>
            {WORKFLOW_EXECUTOR_TYPES.map((executor) => <option key={executor} value={executor}>{WORKFLOW_EXECUTOR_MODEL_OPTIONS[executor].label}</option>)}
          </select>
        </label>
        <label className="block text-sm text-zinc-300">
          Default model
          <select className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-950 p-2 text-sm" value={model} disabled={!executorType} onChange={(event) => setModel(event.target.value)}>
            <option value="">Executor default</option>
            {models.map((modelOption) => <option key={modelOption} value={modelOption}>{modelOption}</option>)}
          </select>
        </label>
      </div>
    </div>
  );
  return (
    <LibraryForm
      title={source ? "Edit role template as new version" : "New role template"}
      idLabel="Role template id"
      bodyLabel="Base role instructions"
      idPlaceholder="role.review.security"
      source={source ? { kind: "prompt", id: source.id, version: source.version, name: source.name, description: source.description, source: source.source, preview: source.promptPreview, bodyMarkdown: source.promptMarkdown ?? source.promptPreview } : undefined}
      extra={extra}
      onCancel={onCancel}
      onSubmit={(value) => onSubmit?.({
        roleTemplateId: value.id,
        version: value.version,
        name: value.name,
        description: value.description,
        promptMarkdown: value.body,
        promptRefs,
        skillRefs,
        executorPreference: executorType ? { executorType, model: model || undefined, mode: "preferred" } : null,
      })}
    />
  );
}

function AssetAttachmentPicker({ title, kind, assets, selected, onChange }: { title: string; kind: "prompt" | "skill"; assets: WorkflowAssetPickerItem[]; selected: WorkflowAssetAttachmentRef[]; onChange: (refs: WorkflowAssetAttachmentRef[]) => void }): React.ReactElement {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return assets.filter((asset) => !needle || `${asset.name} ${asset.id} ${asset.description ?? ""}`.toLowerCase().includes(needle));
  }, [assets, query]);
  const selectedKeys = new Set(selected.map((ref) => attachmentKey(ref)));
  const add = (asset: WorkflowAssetPickerItem) => {
    const ref: WorkflowAssetAttachmentRef = { kind, id: asset.id, versionMode: "latest" };
    if (selected.some((existing) => existing.kind === ref.kind && existing.id === ref.id)) return;
    onChange([...selected, ref]);
  };
  return (
    <section className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3" aria-label={`${title} picker`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium text-zinc-200">{title}</h3>
        <span className="text-xs text-zinc-500">Latest version is the default.</span>
      </div>
      <input aria-label={`Search ${title}`} className="mt-2 w-full rounded-md border border-zinc-700 bg-zinc-950 p-2 text-sm" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search available assets" />
      <div className="mt-3 space-y-2" aria-label={`Selected ${title}`}>
        {selected.length ? selected.map((ref, index) => {
          const versions = versionsForAsset(assets, ref.id);
          const latestAsset = versions[0];
          const pinnedAsset = ref.version != null ? versions.find((candidate) => candidate.version === ref.version) : undefined;
          const asset = pinnedAsset ?? latestAsset ?? assets.find((candidate) => candidate.id === ref.id);
          const mode = ref.versionMode ?? (ref.version == null ? "latest" : "pinned");
          return (
            <div key={attachmentKey(ref)} className="flex flex-wrap items-center justify-between gap-2 rounded border border-cyan-900/60 bg-cyan-950/20 p-2 text-xs">
              <span>• {asset?.name ?? ref.id} · {kind === "prompt" ? "Prompt" : "Skill"} · {asset ? sourceLabel(asset.source) : "Unavailable"} · {mode === "pinned" ? `Pinned v${ref.version ?? "?"}` : "Use latest version"}</span>
              <div className="flex items-center gap-2">
                <select aria-label={`${ref.id} version mode`} className="rounded border border-zinc-700 bg-zinc-950 p-1" value={mode} onChange={(event) => {
                  const nextMode = event.target.value === "pinned" ? "pinned" : "latest";
                  const defaultPinnedVersion = ref.version ?? latestAsset?.version;
                  onChange(selected.map((current, currentIndex) => currentIndex === index ? { ...current, versionMode: nextMode, version: nextMode === "pinned" ? defaultPinnedVersion : undefined } : current));
                }}>
                  <option value="latest">Use latest</option>
                  <option value="pinned">Pin version</option>
                </select>
                {mode === "pinned" ? (
                  <select aria-label={`${ref.id} pinned version`} className="rounded border border-zinc-700 bg-zinc-950 p-1" value={ref.version ?? ""} onChange={(event) => {
                    const nextVersion = Number(event.target.value);
                    onChange(selected.map((current, currentIndex) => currentIndex === index ? { ...current, versionMode: "pinned", version: Number.isInteger(nextVersion) ? nextVersion : undefined } : current));
                  }}>
                    <option value="">Choose version</option>
                    {versions.map((candidate) => <option key={candidate.version} value={candidate.version}>v{candidate.version}</option>)}
                  </select>
                ) : null}
                <button type="button" className="rounded border border-zinc-700 px-2 py-1 text-zinc-100" onClick={() => onChange(selected.filter((_, currentIndex) => currentIndex !== index))}>Remove</button>
              </div>
            </div>
          );
        }) : <p className="text-xs text-zinc-500">No {title.toLowerCase()} selected.</p>}
      </div>
      <div className="mt-3 max-h-44 overflow-auto space-y-2" aria-label={`Available ${title}`}>
        {filtered.length ? filtered.map((asset) => {
          const key = `${kind}:${asset.id}`;
          const alreadySelected = Array.from(selectedKeys).some((selectedKey) => selectedKey.startsWith(`${kind}:${asset.id}:`));
          return (
            <button key={`${asset.id}:${asset.version}`} type="button" disabled={alreadySelected} onClick={() => add(asset)} className="block w-full rounded border border-zinc-800 bg-zinc-950 p-2 text-left text-xs text-zinc-300 hover:border-cyan-700 disabled:cursor-not-allowed disabled:opacity-50">
              <span className="font-medium text-zinc-100">{asset.name}</span> <span className="text-zinc-500">v{asset.version} · {sourceLabel(asset.source)}</span>
              <span className="block text-zinc-500">{safeText(asset.preview)}</span>
              {alreadySelected ? <span className="mt-1 block text-cyan-200">Already selected</span> : <span className="mt-1 block text-cyan-200">Add {key}</span>}
            </button>
          );
        }) : <p className="rounded border border-dashed border-zinc-800 p-2 text-xs text-zinc-500">No matching assets.</p>}
      </div>
    </section>
  );
}

function LibraryForm({ title, idLabel, bodyLabel, idPlaceholder, source, extra, onCancel, onSubmit }: { title: string; idLabel: string; bodyLabel: string; idPlaceholder: string; source?: WorkflowAssetPickerItem; extra?: React.ReactNode; onCancel: () => void; onSubmit?: (value: { id: string; version: number; name: string; description: string | null; body: string }) => void | Promise<void> }): React.ReactElement {
  const [id, setId] = useState(source?.id ?? "");
  const [version, setVersion] = useState(String((source?.version ?? 0) + 1 || 1));
  const [name, setName] = useState(source?.name ?? "");
  const [description, setDescription] = useState(source?.description ?? "");
  const [body, setBody] = useState(source?.bodyMarkdown ?? source?.preview ?? "");
  return (
    <form className="rounded-xl border border-cyan-900/60 bg-slate-950/80 p-4" aria-label={title} onSubmit={(event) => { event.preventDefault(); void onSubmit?.({ id, version: Number(version) || 1, name, description: description || null, body }); }}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold">{title}</h2>
          <p className="mt-1 text-xs text-zinc-500">Make all changes here, then save once to publish one immutable version. Existing versions remain read-only.</p>
        </div>
        <button className="rounded-md border border-zinc-700 px-3 py-2 text-sm" type="button" onClick={onCancel}>Cancel</button>
      </div>
      <div className="mt-4 space-y-3">
        <label className="block text-sm text-zinc-300">{idLabel}<input className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-950 p-2 text-sm" value={id} onChange={(event) => setId(event.target.value)} placeholder={idPlaceholder} readOnly={Boolean(source)} /></label>
        <label className="block text-sm text-zinc-300">New version<input className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-950 p-2 text-sm" type="number" min={1} value={version} onChange={(event) => setVersion(event.target.value)} /></label>
        <label className="block text-sm text-zinc-300">Name<input className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-950 p-2 text-sm" value={name} onChange={(event) => setName(event.target.value)} /></label>
        <label className="block text-sm text-zinc-300">Description<input className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-950 p-2 text-sm" value={description} onChange={(event) => setDescription(event.target.value)} /></label>
        {extra}
        <label className="block text-sm text-zinc-300">{bodyLabel}<textarea className="mt-1 min-h-36 w-full rounded-md border border-zinc-700 bg-zinc-950 p-2 text-sm" value={body} onChange={(event) => setBody(event.target.value)} /></label>
      </div>
      <button className="mt-4 rounded-md bg-cyan-500 px-3 py-2 text-sm font-medium text-zinc-950" type="submit">Publish version</button>
    </form>
  );
}

function groupAssetVersions(assets: WorkflowAssetPickerItem[]): Array<VersionGroup<WorkflowAssetPickerItem>> {
  return groupVersions(assets);
}

function groupRoleTemplateVersions(templates: WorkflowRoleTemplatePickerItem[]): Array<VersionGroup<WorkflowRoleTemplatePickerItem>> {
  return groupVersions(templates);
}

function groupVersions<T extends { id: string; version: number; name: string }>(items: T[]): Array<VersionGroup<T>> {
  const groups = new Map<string, T[]>();
  for (const item of items) groups.set(item.id, [...(groups.get(item.id) ?? []), item]);
  return Array.from(groups.entries())
    .map(([id, versions]) => {
      const sorted = [...versions].sort((a, b) => b.version - a.version);
      return { id, latest: sorted[0]!, versions: sorted };
    })
    .sort((a, b) => a.latest.name.localeCompare(b.latest.name));
}

function versionsForAsset(assets: WorkflowAssetPickerItem[], id: string): WorkflowAssetPickerItem[] {
  return assets.filter((asset) => asset.id === id).sort((a, b) => b.version - a.version);
}

function attachmentKey(ref: WorkflowAssetAttachmentRef): string {
  return `${ref.kind}:${ref.id}:${ref.versionMode ?? (ref.version == null ? "latest" : "pinned")}:${ref.version ?? "latest"}`;
}

function formatAttachmentRef(ref: WorkflowAssetAttachmentRef): string {
  return `${ref.id} (${ref.versionMode === "pinned" || ref.version != null ? `v${ref.version ?? "?"}` : "latest"})`;
}

function sourceLabel(source: string): string {
  if (source === "built_in") return "Built-in";
  if (source === "plugin") return "Plugin";
  if (source === "user") return "User";
  return source;
}

function safeText(value: string): string {
  return value
    .replace(/\/(?:Users|tmp|private\/var)\/[^\s]+/giu, "[redacted-path]")
    .replace(/\bbd\s+[^\n]*/giu, "workflow command")
    .replace(/\bgit\s+[^\n]*/giu, "workflow action")
    .replace(/\bshell\b/giu, "workflow action")
    .replace(/\bwebhook\b/giu, "workflow update")
    .replace(/\bqueue[-_ ]?item\b/giu, "workflow item")
    .replace(/\bprovider diagnostics?\b/giu, "provider status");
}
