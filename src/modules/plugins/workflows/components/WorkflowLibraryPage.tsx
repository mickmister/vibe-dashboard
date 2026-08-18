import React, { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { StandaloneDashboardPage } from "../../../../components/StandaloneDashboardPage";
import {
  createWorkflowPromptAsset,
  createWorkflowRoleTemplate,
  createWorkflowSkillAsset,
  fetchWorkflowAssets,
  type WorkflowAssetPickerItem,
  type WorkflowAssetsModel,
  type WorkflowRoleTemplatePickerItem,
} from "../client/workflowAssetsApi";
import { workflowRouteHref } from "./workflowRouteContext";

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
  onCreatePrompt?: (request: { promptAssetId?: string; version?: number; name: string; description?: string | null; bodyMarkdown: string }) => void | Promise<void>;
  onCreateSkill?: (request: { skillAssetId?: string; version?: number; name: string; description?: string | null; bodyMarkdown: string }) => void | Promise<void>;
  onCreateRoleTemplate?: (request: { roleTemplateId?: string; version?: number; name: string; description?: string | null; promptMarkdown: string; skillRefs?: Array<{ kind: "skill"; id: string; version?: number }> }) => void | Promise<void>;
}): React.ReactElement {
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
          <LibraryColumn title="Role templates" empty="No reusable role templates yet." description="Reusable role behavior: instructions, markdown skill refs, and executor/model defaults.">
            {(assets.roleTemplates ?? []).map((template) => <RoleTemplateCard key={`${template.id}:${template.version}`} template={template} />)}
          </LibraryColumn>
          <LibraryColumn title="Prompt assets" empty="No prompt assets yet." description="Reusable prompt blocks for workflow agent steps.">
            {assets.prompts.map((asset) => <AssetCard key={`${asset.id}:${asset.version}`} asset={asset} />)}
          </LibraryColumn>
          <LibraryColumn title="Skill snippets" empty="No markdown skill snippets yet." description="Instruction snippets only; these are not executable providers.">
            {assets.skills.map((asset) => <AssetCard key={`${asset.id}:${asset.version}`} asset={asset} />)}
          </LibraryColumn>
        </section>

        <section className="grid gap-4 xl:grid-cols-3" aria-label="Create workflow library versions">
          <PromptAssetForm onSubmit={onCreatePrompt} />
          <SkillAssetForm onSubmit={onCreateSkill} />
          <RoleTemplateForm skills={assets.skills} onSubmit={onCreateRoleTemplate} />
        </section>
      </main>
    </StandaloneDashboardPage>
  );
}

function LibraryColumn({ title, description, empty, children }: { title: string; description: string; empty: string; children: React.ReactNode }): React.ReactElement {
  const childArray = React.Children.toArray(children);
  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4" aria-label={title}>
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="mt-1 text-sm text-zinc-500">{description}</p>
      <div className="mt-4 space-y-3">
        {childArray.length ? childArray : <p className="rounded border border-dashed border-zinc-800 p-3 text-sm text-zinc-500">{empty}</p>}
      </div>
    </section>
  );
}

function AssetCard({ asset }: { asset: WorkflowAssetPickerItem }): React.ReactElement {
  return (
    <article className="rounded-lg border border-zinc-800 bg-slate-950/70 p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-medium">{asset.name}</h3>
        <span className="rounded border border-zinc-700 px-2 py-0.5 text-xs text-zinc-300">v{asset.version}</span>
      </div>
      <p className="mt-1 text-xs text-zinc-500">{asset.kind === "skill" ? "Skill snippet" : "Prompt asset"} · {sourceLabel(asset.source)}</p>
      {asset.description ? <p className="mt-2 text-sm text-zinc-400">{safeText(asset.description)}</p> : null}
      <p className="mt-2 line-clamp-4 whitespace-pre-wrap text-sm text-zinc-300">{safeText(asset.preview)}</p>
    </article>
  );
}

function RoleTemplateCard({ template }: { template: WorkflowRoleTemplatePickerItem }): React.ReactElement {
  return (
    <article className="rounded-lg border border-zinc-800 bg-slate-950/70 p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-medium">{template.name}</h3>
        <span className="rounded border border-zinc-700 px-2 py-0.5 text-xs text-zinc-300">v{template.version}</span>
      </div>
      <p className="mt-1 text-xs text-zinc-500">Role template · {sourceLabel(template.source)}{template.active ? "" : " · Inactive"}</p>
      {template.description ? <p className="mt-2 text-sm text-zinc-400">{safeText(template.description)}</p> : null}
      <p className="mt-2 line-clamp-4 whitespace-pre-wrap text-sm text-zinc-300">{safeText(template.promptPreview)}</p>
      {template.skillRefs.length ? <p className="mt-2 text-xs text-zinc-500">Skills: {template.skillRefs.map((ref) => `${ref.id}${ref.version ? `@${ref.version}` : ""}`).join(", ")}</p> : null}
      {template.executorPreference ? <p className="mt-1 text-xs text-zinc-500">Default executor: {template.executorPreference.executorType}{template.executorPreference.model ? ` · ${template.executorPreference.model}` : ""}</p> : null}
    </article>
  );
}

function PromptAssetForm({ onSubmit }: { onSubmit?: (request: { promptAssetId?: string; version?: number; name: string; description?: string | null; bodyMarkdown: string }) => void | Promise<void> }): React.ReactElement {
  return <LibraryForm title="Publish prompt asset" idLabel="Prompt id" bodyLabel="Prompt markdown" idPlaceholder="prompt.review.security" onSubmit={(value) => onSubmit?.({ promptAssetId: value.id, version: value.version, name: value.name, description: value.description, bodyMarkdown: value.body })} />;
}

function SkillAssetForm({ onSubmit }: { onSubmit?: (request: { skillAssetId?: string; version?: number; name: string; description?: string | null; bodyMarkdown: string }) => void | Promise<void> }): React.ReactElement {
  return <LibraryForm title="Publish skill snippet" idLabel="Skill id" bodyLabel="Skill markdown" idPlaceholder="skill.review.accessibility" onSubmit={(value) => onSubmit?.({ skillAssetId: value.id, version: value.version, name: value.name, description: value.description, bodyMarkdown: value.body })} />;
}

function RoleTemplateForm({ skills, onSubmit }: { skills: WorkflowAssetPickerItem[]; onSubmit?: (request: { roleTemplateId?: string; version?: number; name: string; description?: string | null; promptMarkdown: string; skillRefs?: Array<{ kind: "skill"; id: string; version?: number }> }) => void | Promise<void> }): React.ReactElement {
  const [skillRefs, setSkillRefs] = useState("");
  return (
    <LibraryForm
      title="Publish role template"
      idLabel="Role template id"
      bodyLabel="Role prompt markdown"
      idPlaceholder="role.review.security"
      extra={(
        <label className="block text-sm text-zinc-300">
          Skill refs
          <input className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-950 p-2 text-sm" value={skillRefs} onChange={(event) => setSkillRefs(event.target.value)} placeholder="skill.review.security@1, skill.testing" />
          <span className="mt-1 block text-xs text-zinc-500">Available snippets: {skills.length ? skills.map((skill) => `${skill.id}@${skill.version}`).join(", ") : "none yet"}</span>
        </label>
      )}
      onSubmit={(value) => onSubmit?.({ roleTemplateId: value.id, version: value.version, name: value.name, description: value.description, promptMarkdown: value.body, skillRefs: parseSkillRefs(skillRefs) })}
    />
  );
}

function LibraryForm({ title, idLabel, bodyLabel, idPlaceholder, extra, onSubmit }: { title: string; idLabel: string; bodyLabel: string; idPlaceholder: string; extra?: React.ReactNode; onSubmit?: (value: { id: string; version: number; name: string; description: string | null; body: string }) => void | Promise<void> }): React.ReactElement {
  const [id, setId] = useState("");
  const [version, setVersion] = useState("1");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [body, setBody] = useState("");
  return (
    <form className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4" aria-label={title} onSubmit={(event) => { event.preventDefault(); void onSubmit?.({ id, version: Number(version) || 1, name, description: description || null, body }); }}>
      <h2 className="font-semibold">{title}</h2>
      <p className="mt-1 text-xs text-zinc-500">Draft in this form, then publish an immutable version. To edit later, publish the next version.</p>
      <div className="mt-4 space-y-3">
        <label className="block text-sm text-zinc-300">{idLabel}<input className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-950 p-2 text-sm" value={id} onChange={(event) => setId(event.target.value)} placeholder={idPlaceholder} /></label>
        <label className="block text-sm text-zinc-300">Version<input className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-950 p-2 text-sm" type="number" min={1} value={version} onChange={(event) => setVersion(event.target.value)} /></label>
        <label className="block text-sm text-zinc-300">Name<input className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-950 p-2 text-sm" value={name} onChange={(event) => setName(event.target.value)} /></label>
        <label className="block text-sm text-zinc-300">Description<input className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-950 p-2 text-sm" value={description} onChange={(event) => setDescription(event.target.value)} /></label>
        {extra}
        <label className="block text-sm text-zinc-300">{bodyLabel}<textarea className="mt-1 min-h-36 w-full rounded-md border border-zinc-700 bg-zinc-950 p-2 text-sm" value={body} onChange={(event) => setBody(event.target.value)} /></label>
      </div>
      <button className="mt-4 rounded-md bg-cyan-500 px-3 py-2 text-sm font-medium text-zinc-950" type="submit">Publish version</button>
    </form>
  );
}

function parseSkillRefs(value: string): Array<{ kind: "skill"; id: string; version?: number }> {
  return value.split(/[,\n]/u).map((entry) => entry.trim()).filter(Boolean).map((entry) => {
    const [id, version] = entry.split("@");
    return { kind: "skill", id: id ?? entry, version: version ? Number(version) || undefined : undefined };
  });
}

function sourceLabel(source: string): string {
  if (source === "built_in") return "Built-in";
  if (source === "plugin") return "Plugin";
  if (source === "user") return "User";
  return source;
}

function safeText(value: string): string {
  return value
    .replace(/\/Users\/[^\s]+/gu, "[redacted-home]")
    .replace(/\bbd\s+[^\n]*/giu, "workflow command")
    .replace(/\bshell\b/giu, "workflow action")
    .replace(/\bwebhook\b/giu, "workflow update")
    .replace(/\bqueue[-_ ]?item\b/giu, "workflow item");
}
