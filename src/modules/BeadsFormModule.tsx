import React, { useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import springboard from 'springboard';

import {
  buildAgentResultMessage,
  getBeadsForms,
  normalizeFormData,
  normalizeSubmittedValues,
  sanitizeBeadsFormHtml,
  validateSubmittedValues,
  type BeadLike,
  type BeadsFormDefinition,
  type JsonObject,
} from '../lib/beadsFormCore';
import {
  applyValuesToForm,
  beadFormStorageKey,
  formValuesFromDom,
  previewStorageKey,
  readPreviewStorage,
  setFormFieldsReadOnly,
  setSubmitButtonsDisabled,
  startPreviewEdit,
  stripCompiledFormHeader,
  writePreviewDraft,
  writePreviewSubmission,
} from '../lib/beadsFormPreviewState';
import { rewriteFolderPreviewMediaRefs } from '../lib/beadsFormPreviewMedia';
import { initializeSingleQuestionMode } from '../lib/beadsFormSingleQuestion';

// @platform "node"
import { serverRegistry } from 'springboard/server/register';
import { createNodeBeadsClient, type ListWorkspaceBeadsResult } from '../lib/beadsClient.node';
import { loadBeadsFormsFromFolder, tryAppendBeadsFormPreviewResponse } from '../lib/beadsFormFolder.node';
import { registerBeadsFormMediaRoutes } from '../server/beads-form-media-routes';
import { VibeKanbanServerClient } from '../server/vk-client';
// @platform end

type PreviewBeadsForm = BeadsFormDefinition & {
  sourceFile: string;
};

type LoadFormsInput = {
  dir: string;
  beadId: string;
  formId?: string;
};

type LoadWorkspaceFormsInput = {
  workspaceId: string;
  beadId?: string;
  formId?: string;
  includeOtherWorkspaces?: boolean;
};

type LoadFormsResult = {
  bead: BeadLike;
  forms: BeadsFormDefinition[];
  selectedForm?: BeadsFormDefinition;
  beadRepoDir: string;
};

type LoadWorkspaceFormsResult = {
  workspaceId: string;
  workspaceBeads: ListWorkspaceBeadsResult;
  selected?: LoadFormsResult;
};

type SubmitFormInput = {
  dir: string;
  beadId: string;
  formId: string;
  values: JsonObject;
};

type SubmitFormResult = {
  beadId: string;
  formId: string;
  values: JsonObject;
  prettySummary: string;
  agentMessage: string;
  reviewLabel: string;
  warnings: string[];
};

type LoadPreviewFormsInput = {
  folder: string;
  formId?: string;
};

type LoadPreviewFormsResult = {
  folder: string;
  forms: PreviewBeadsForm[];
  selectedForm?: PreviewBeadsForm;
};

type SubmitPreviewFormInput = {
  folder: string;
  formId: string;
  values: JsonObject;
};

type SubmitPreviewFormResult = {
  formId: string;
  values: JsonObject;
  submittedAt: string;
  sidecarPath?: string;
  warnings: string[];
};

function nodeClient() {
  if (typeof createNodeBeadsClient !== 'function') {
    throw new Error('Beads client is only available on the node side of the BeadsForm module');
  }
  return createNodeBeadsClient();
}

function vkClient() {
  if (typeof VibeKanbanServerClient !== 'function') {
    throw new Error('VK client is only available on the node side of the BeadsForm module');
  }
  return new VibeKanbanServerClient();
}

// @platform "node"
serverRegistry.registerServerModule((api) => {
  registerBeadsFormMediaRoutes(api.hono);
});
// @platform end

function formViewUrl(args: { workspaceId?: string; dir?: string; beadId?: string; formId?: string; includeOtherWorkspaces?: boolean }): string {
  const params = new URLSearchParams();
  if (args.workspaceId) params.set('workspace', args.workspaceId);
  if (args.dir) params.set('dir', args.dir);
  if (args.beadId) params.set('bead', args.beadId);
  if (args.formId) params.set('form', args.formId);
  if (args.includeOtherWorkspaces) params.set('scope', 'all');
  return `/dashboard/forms?${params.toString()}`;
}

function previewFormUrl(args: { folder: string; formId?: string }): string {
  const params = new URLSearchParams();
  params.set('folder', args.folder);
  if (args.formId) params.set('form', args.formId);
  return `/dashboard/forms/preview?${params.toString()}`;
}

type MaybeNestedPromise<T> = Promise<T> | Promise<Promise<T>>;

function normalizeSubmittedFormEvent(
  event: React.FormEvent<HTMLDivElement>,
  target: HTMLFormElement,
  form: BeadsFormDefinition,
): JsonObject {
  const values = normalizeFormData(new FormData(target));
  const submitter = (event.nativeEvent as SubmitEvent).submitter;
  if (
    submitter instanceof HTMLElement
    && (submitter instanceof HTMLButtonElement || submitter instanceof HTMLInputElement)
    && submitter.name
  ) {
    values[submitter.name] = submitter.value;
  }
  return normalizeSubmittedValues(form, values);
}

function preserveSubmittedFormDom(
  host: HTMLDivElement | null,
  values: JsonObject,
  options: { lock: boolean; singleQuestionMode: boolean },
): void {
  const apply = () => {
    if (!host) return;
    if (options.singleQuestionMode) initializeSingleQuestionMode(host);
    const form = host.querySelector('form');
    if (!form) return;
    applyValuesToForm(form, values);
    setSubmitButtonsDisabled(form, options.lock);
    setFormFieldsReadOnly(form, options.lock);
  };

  apply();
  if (typeof window !== 'undefined') {
    window.setTimeout(apply, 0);
  }
}

function BeadsFormPreviewRoute({ actions }: { actions: {
  loadPreviewForms: (input: LoadPreviewFormsInput) => MaybeNestedPromise<LoadPreviewFormsResult>;
  submitPreviewForm: (input: SubmitPreviewFormInput) => MaybeNestedPromise<SubmitPreviewFormResult>;
} }) {
  const [params] = useSearchParams();
  const folder = params.get('folder') ?? '';
  const formId = params.get('form') ?? undefined;
  const [loaded, setLoaded] = useState<LoadPreviewFormsResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitResult, setSubmitResult] = useState<SubmitPreviewFormResult | null>(null);
  const [submittedLocked, setSubmittedLocked] = useState(false);
  const submitInFlightRef = useRef(false);
  const formHostRef = useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    setLoaded(null);
    setError(null);
    setSubmitResult(null);
    setSubmittedLocked(false);
    if (!folder) {
      setError('Preview requires a folder query parameter.');
      return;
    }

    void (async () => {
      try {
        const result = await (await actions.loadPreviewForms({ folder, formId }));
        if (!cancelled) setLoaded(result);
      } catch (reason) {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [actions, folder, formId]);

  const selectedHtml = useMemo(() => {
    if (!loaded?.selectedForm) return '';
    const sanitized = sanitizeBeadsFormHtml(rewriteFolderPreviewMediaRefs(loaded.selectedForm.html, loaded.folder));
    return loaded.selectedForm.format === 'standard' ? stripCompiledFormHeader(sanitized) : sanitized;
  }, [loaded?.folder, loaded?.selectedForm]);

  const previewStateKey = useMemo(() => {
    if (!loaded?.selectedForm) return '';
    return previewStorageKey({ folder: loaded.folder, formId: loaded.selectedForm.id });
  }, [loaded?.folder, loaded?.selectedForm]);

  React.useEffect(() => {
    const host = formHostRef.current;
    const form = host?.querySelector('form');
    if (!host || !form || !loaded?.selectedForm || !previewStateKey) return;

    const snapshot = readPreviewStorage(typeof window === 'undefined' ? undefined : window.localStorage, previewStateKey);
    const restoredValues = snapshot.editing ? (snapshot.draft ?? snapshot.latest) : (snapshot.latest ?? snapshot.draft);
    if (restoredValues) {
      applyValuesToForm(form, restoredValues);
    }

    const locked = !!snapshot.latest && !snapshot.editing;
    setSubmittedLocked(locked);
    setSubmitButtonsDisabled(form, locked);
    setFormFieldsReadOnly(form, locked);
    setSubmitResult(snapshot.latest ? {
      formId: loaded.selectedForm.id,
      values: snapshot.latest,
      submittedAt: snapshot.history.at(-1)?.submittedAt ?? '',
      warnings: [],
    } : null);
  }, [loaded?.selectedForm, previewStateKey, selectedHtml]);

  React.useEffect(() => {
    if (loaded?.selectedForm?.format !== 'standard') return undefined;
    const host = formHostRef.current;
    if (!host) return undefined;
    return initializeSingleQuestionMode(host);
  }, [loaded?.selectedForm?.format, previewStateKey, selectedHtml]);

  const handleDraftChange = () => {
    if (submittedLocked || !previewStateKey || typeof window === 'undefined') return;
    const form = formHostRef.current?.querySelector('form');
    if (!form) return;
    writePreviewDraft(window.localStorage, previewStateKey, formValuesFromDom(form));
  };

  const handleEditResponse = () => {
    setSubmittedLocked(false);
    if (previewStateKey && typeof window !== 'undefined') {
      startPreviewEdit(window.localStorage, previewStateKey);
    }
    const form = formHostRef.current?.querySelector('form');
    if (form) {
      setSubmitButtonsDisabled(form, false);
      setFormFieldsReadOnly(form, false);
    }
  };

  const handleSubmit = async (event: React.FormEvent<HTMLDivElement>) => {
    const target = event.target;
    if (!(target instanceof HTMLFormElement) || !loaded?.selectedForm) return;
    event.preventDefault();
    if (submitInFlightRef.current) return;
    if (submittedLocked) return;
    if (!target.reportValidity()) return;

    const values = normalizeSubmittedFormEvent(event, target, loaded.selectedForm);
    submitInFlightRef.current = true;
    setSubmitting(true);
    setError(null);
    try {
      const result = await (await actions.submitPreviewForm({
        folder: loaded.folder,
        formId: loaded.selectedForm.id,
        values,
      }));
      if (typeof window !== 'undefined' && previewStateKey) {
        writePreviewSubmission(window.localStorage, previewStateKey, result.values, result.submittedAt);
      }
      preserveSubmittedFormDom(formHostRef.current, result.values, {
        lock: true,
        singleQuestionMode: loaded.selectedForm.format === 'standard',
      });
      setSubmittedLocked(true);
      setSubmitResult(result);
      await navigator.clipboard?.writeText(JSON.stringify(result.values, null, 2)).catch(() => undefined);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      submitInFlightRef.current = false;
      setSubmitting(false);
    }
  };

  return (
    <div className="beadsform-root beadsform-page">
      {!loaded?.selectedForm ? <header>
        <p className="beadsform-eyebrow">Forms preview</p>
        <h1>Folder forms</h1>
        <p>Load forms from a local folder, submit them without touching beads, and copy normalized JSON only.</p>
      </header> : null}
      {error ? <p role="alert" className="beadsform-error">{error}</p> : null}
      {loaded && !loaded.selectedForm ? (
        <section>
          <h2>Forms in <code>{loaded.folder}</code></h2>
          {loaded.forms.length === 0 ? <p>No .json forms found in this folder.</p> : (
            <ul>
              {loaded.forms.map((form) => (
                <li key={`${form.sourceFile}:${form.id}`}>
                  <a href={previewFormUrl({ folder: loaded.folder, formId: form.id })}>{form.title}</a>
                  <p><code>{form.sourceFile}</code></p>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
      {loaded?.selectedForm ? (
        <section>
          <header className="beadsform-heading-row">
            <div>
              <p className="beadsform-eyebrow">Forms preview</p>
              <h1>{loaded.selectedForm.title}</h1>
              {loaded.selectedForm.description ? <p>{loaded.selectedForm.description}</p> : null}
            </div>
            <a href={previewFormUrl({ folder: loaded.folder })}>All forms</a>
          </header>
          <div
            ref={formHostRef}
            onInput={handleDraftChange}
            onChange={handleDraftChange}
            onSubmit={handleSubmit}
            dangerouslySetInnerHTML={{ __html: selectedHtml }}
          />
        </section>
      ) : null}
      {submitting ? <p>Submitting…</p> : null}
      {submitResult ? (
        <section className="beadsform-submit-result">
          <h2>JSON copied</h2>
          <p>Copied normalized JSON to your clipboard.</p>
          {submitResult.sidecarPath ? <p>Saved preview response to <code>{submitResult.sidecarPath}</code>.</p> : null}
          {submitResult.warnings.length > 0 ? (
            <div className="beadsform-warning" role="status">
              <h3>Warnings</h3>
              <ul>{submitResult.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
            </div>
          ) : null}
          {submittedLocked ? <p>The visual form is locked to this submitted response until you edit it.</p> : null}
          <button type="button" onClick={handleEditResponse}>Edit response</button>
          <pre><code>{JSON.stringify(submitResult.values, null, 2)}</code></pre>
        </section>
      ) : null}
    </div>
  );
}

function BeadsFormRoute({ actions }: { actions: {
  loadBeadForms: (input: LoadFormsInput) => MaybeNestedPromise<LoadFormsResult>;
  loadWorkspaceForms: (input: LoadWorkspaceFormsInput) => MaybeNestedPromise<LoadWorkspaceFormsResult>;
  submitBeadForm: (input: SubmitFormInput) => MaybeNestedPromise<SubmitFormResult>;
} }) {
  const [params] = useSearchParams();
  const workspaceId = params.get('workspace') ?? '';
  const dir = params.get('dir') ?? '';
  const beadId = params.get('bead') ?? '';
  const formId = params.get('form') ?? undefined;
  const includeOtherWorkspaces = params.get('scope') === 'all';
  const returnTo = params.get('returnTo') ?? '';
  const [loaded, setLoaded] = useState<LoadWorkspaceFormsResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitResult, setSubmitResult] = useState<SubmitFormResult | null>(null);
  const [submittedLocked, setSubmittedLocked] = useState(false);
  const submitInFlightRef = useRef(false);
  const formHostRef = useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    setLoaded(null);
    setError(null);
    setSubmitResult(null);
    setSubmittedLocked(false);

    if (!workspaceId && (!dir || !beadId)) {
      setError('Forms require a workspace query parameter, or dir and bead query parameters.');
      return;
    }

    void (async () => {
      try {
        const result = workspaceId
          ? await (await actions.loadWorkspaceForms({
            workspaceId,
            ...(beadId ? { beadId } : {}),
            ...(formId ? { formId } : {}),
            includeOtherWorkspaces,
          }))
          : {
            workspaceId: '',
            workspaceBeads: {
              workspaceId: '',
              repos: [{
                repo: { id: 'direct', name: dir },
                dir,
                initialized: true,
                beads: [],
                unscopedCount: 0,
                otherWorkspaceCount: 0,
              }],
            },
            selected: await (await actions.loadBeadForms({ dir, beadId, formId })),
          };
        if (!cancelled) setLoaded(result);
      } catch (reason) {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [actions, beadId, dir, formId, includeOtherWorkspaces, workspaceId]);

  const selectedHtml = useMemo(() => {
    if (!loaded?.selected?.selectedForm) return '';
    return sanitizeBeadsFormHtml(loaded.selected.selectedForm.html);
  }, [loaded?.selected?.selectedForm]);

  const beadDraftStorageKey = useMemo(() => {
    if (!loaded?.selected?.selectedForm || !beadId) return '';
    return beadFormStorageKey({
      ...(workspaceId ? { workspaceId } : {}),
      dir: loaded.selected.beadRepoDir,
      beadId,
      formId: loaded.selected.selectedForm.id,
    });
  }, [beadId, loaded?.selected?.beadRepoDir, loaded?.selected?.selectedForm, workspaceId]);

  React.useEffect(() => {
    const form = formHostRef.current?.querySelector('form');
    if (!form || !beadDraftStorageKey) return;
    const snapshot = readPreviewStorage(typeof window === 'undefined' ? undefined : window.localStorage, beadDraftStorageKey);
    const restoredValues = snapshot.draft ?? snapshot.latest;
    if (restoredValues) {
      applyValuesToForm(form, restoredValues);
    }
    const locked = !!snapshot.latest && !snapshot.editing;
    setSubmittedLocked(locked);
    setSubmitButtonsDisabled(form, locked);
    setFormFieldsReadOnly(form, locked);
  }, [beadDraftStorageKey, selectedHtml]);

  React.useEffect(() => {
    if (loaded?.selected?.selectedForm?.format !== 'standard') return undefined;
    const host = formHostRef.current;
    if (!host) return undefined;
    return initializeSingleQuestionMode(host);
  }, [beadDraftStorageKey, loaded?.selected?.selectedForm?.format, selectedHtml]);

  const handleBeadDraftChange = () => {
    if (submittedLocked || !beadDraftStorageKey || typeof window === 'undefined') return;
    const form = formHostRef.current?.querySelector('form');
    if (!form) return;
    writePreviewDraft(window.localStorage, beadDraftStorageKey, formValuesFromDom(form));
  };

  const handleEditBeadResponse = () => {
    setSubmittedLocked(false);
    if (beadDraftStorageKey && typeof window !== 'undefined') {
      startPreviewEdit(window.localStorage, beadDraftStorageKey);
    }
    const form = formHostRef.current?.querySelector('form');
    if (form) {
      setSubmitButtonsDisabled(form, false);
      setFormFieldsReadOnly(form, false);
    }
  };

  const handleSubmit = async (event: React.FormEvent<HTMLDivElement>) => {
    const target = event.target;
    if (!(target instanceof HTMLFormElement) || !loaded?.selected?.selectedForm) return;
    event.preventDefault();
    if (submitInFlightRef.current) return;
    if (submittedLocked) return;
    if (!target.reportValidity()) return;

    const values = normalizeSubmittedFormEvent(event, target, loaded.selected.selectedForm);
    submitInFlightRef.current = true;
    setSubmitting(true);
    setError(null);
    try {
      const result = await (await actions.submitBeadForm({
        dir: loaded.selected.beadRepoDir,
        beadId,
        formId: loaded.selected.selectedForm.id,
        values,
      }));
      if (typeof window !== 'undefined' && beadDraftStorageKey) {
        writePreviewSubmission(window.localStorage, beadDraftStorageKey, result.values);
      }
      preserveSubmittedFormDom(formHostRef.current, result.values, {
        lock: true,
        singleQuestionMode: loaded.selected.selectedForm.format === 'standard',
      });
      setSubmittedLocked(true);
      setSubmitResult(result);
      await navigator.clipboard?.writeText(result.agentMessage).catch(() => undefined);
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({ type: 'vk:bead-form-submitted' }, window.location.origin);
      }
      if (returnTo) {
        window.location.assign(returnTo);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      submitInFlightRef.current = false;
      setSubmitting(false);
    }
  };

  if (error && !loaded) {
    return <div className="beadsform-root beadsform-page"><h1>Forms</h1><p role="alert">{error}</p></div>;
  }

  if (!loaded) {
    return <div className="beadsform-root beadsform-page"><h1>Forms</h1><p>Loading bead form…</p></div>;
  }

  const selected = loaded.selected;
  const bead = selected?.bead;
  const forms = selected?.forms ?? [];
  const selectedForm = selected?.selectedForm;

  return (
    <div className="beadsform-root beadsform-page">
      <header>
        <p className="beadsform-eyebrow">Forms</p>
        <h1>{bead ? `${bead.id}: ${bead.title ?? 'Untitled bead'}` : 'Workspace forms'}</h1>
        {bead?.description ? <p>{bead.description}</p> : null}
      </header>

      {!selected ? (
        <section>
          <div className="beadsform-heading-row">
            <div>
              <h2>Workspace beads</h2>
              <p>Select a bead to view its forms. By default this only shows beads created for this workspace.</p>
            </div>
            {workspaceId ? (
              <a href={formViewUrl({ workspaceId, includeOtherWorkspaces: !includeOtherWorkspaces })}>
                {includeOtherWorkspaces ? 'Show workspace beads only' : 'Show all beads'}
              </a>
            ) : null}
          </div>
          {loaded.workspaceBeads.repos.map((repo) => (
            <section key={repo.dir}>
              <h3>{repo.repo.display_name ?? repo.repo.name}</h3>
              <p><code>{repo.dir}</code></p>
              {repo.error ? (
                <p role="alert" className="beadsform-error">{repo.error}</p>
              ) : !repo.initialized ? (
                <p>This repo is not initialized for beads yet. Run <code>bd init</code> in this repo to track beads here.</p>
              ) : repo.beads.length === 0 ? (
                <p>No matching beads. {repo.unscopedCount + repo.otherWorkspaceCount > 0 && !includeOtherWorkspaces ? 'Use “Show all beads” to include unscoped and other-workspace beads.' : null}</p>
              ) : (
                <ul>
                  {repo.beads.map((repoBead) => (
                    <li key={`${repo.dir}:${repoBead.id}`}>
                      <a href={formViewUrl({ workspaceId, beadId: repoBead.id, includeOtherWorkspaces })}>
                        {repoBead.id}: {repoBead.title ?? 'Untitled bead'}
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </section>
      ) : forms.length === 0 ? (
        <p>This bead has no attached forms.</p>
      ) : !selectedForm ? (
        <section>
          <h2>Forms</h2>
          <ul>
            {forms.map((form) => (
              <li key={form.id}>
                <a href={formViewUrl({ workspaceId, dir: selected.beadRepoDir, beadId, formId: form.id, includeOtherWorkspaces })}>{form.title}</a>
                {form.description ? <p>{form.description}</p> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <section>
          <div className="beadsform-heading-row">
            <div>
              <h2>{selectedForm.title}</h2>
              {selectedForm.description ? <p>{selectedForm.description}</p> : null}
            </div>
            {forms.length > 1 ? <a href={formViewUrl({ workspaceId, dir: selected.beadRepoDir, beadId, includeOtherWorkspaces })}>All forms</a> : null}
          </div>
          {submittedLocked && !submitResult ? (
            <div className="beadsform-warning" role="status">
              <p>The visual form is showing the latest submitted response and is locked until you edit it.</p>
              <button type="button" onClick={handleEditBeadResponse}>Edit response</button>
            </div>
          ) : null}
          <div
            ref={formHostRef}
            onInput={handleBeadDraftChange}
            onChange={handleBeadDraftChange}
            onSubmit={handleSubmit}
            dangerouslySetInnerHTML={{ __html: selectedHtml }}
          />
        </section>
      )}

      {error ? <p role="alert" className="beadsform-error">{error}</p> : null}
      {submitting ? <p>Submitting…</p> : null}
      {submitResult ? (
        <section className="beadsform-submit-result">
          <h2>Submitted</h2>
          <p>Copied the agent-facing response text to your clipboard. Paste it into the Agent tab to continue.</p>
          {submitResult.warnings.length > 0 ? (
            <div className="beadsform-warning" role="status">
              <h3>Warnings</h3>
              <ul>{submitResult.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
            </div>
          ) : null}
          {submittedLocked ? <p>The visual form is locked to this submitted response until you edit it.</p> : null}
          <button type="button" onClick={handleEditBeadResponse}>Edit response</button>
          <h3>Pretty summary</h3>
          <pre>{submitResult.prettySummary}</pre>
          <h3>Normalized JSON</h3>
          <pre>{JSON.stringify(submitResult.values, null, 2)}</pre>
          <h3>Agent message</h3>
          <pre>{submitResult.agentMessage}</pre>
        </section>
      ) : null}
    </div>
  );
}

springboard.registerModule(
  'BeadsForm',
  { rpcMode: 'remote' },
  async (moduleAPI) => {
    const actions = moduleAPI.createActions({
      loadPreviewForms: async (input: LoadPreviewFormsInput): Promise<LoadPreviewFormsResult> => {
        const forms = await loadBeadsFormsFromFolder(input.folder);
        return {
          folder: input.folder,
          forms,
          selectedForm: input.formId ? forms.find((form) => form.id === input.formId) : undefined,
        };
      },
      submitPreviewForm: async (input: SubmitPreviewFormInput): Promise<SubmitPreviewFormResult> => {
        const forms = await loadBeadsFormsFromFolder(input.folder);
        const form = forms.find((candidate) => candidate.id === input.formId);
        if (!form) throw new Error(`Form not found in folder: ${input.formId}`);
        const values = normalizeSubmittedValues(form, input.values);
        const validationErrors = validateSubmittedValues(form, values);
        if (validationErrors.length > 0) throw new Error(validationErrors.join('\n'));
        const submittedAt = new Date().toISOString();
        const sidecar = await tryAppendBeadsFormPreviewResponse(input.folder, form.id, values, submittedAt);
        return {
          formId: form.id,
          values,
          submittedAt,
          ...(sidecar.sidecarPath ? { sidecarPath: sidecar.sidecarPath } : {}),
          warnings: sidecar.warnings,
        };
      },
      loadBeadForms: async (input: LoadFormsInput): Promise<LoadFormsResult> => {
        if (!input.dir.trim()) throw new Error('dir is required');
        if (!input.beadId.trim()) throw new Error('beadId is required');
        const bead = await nodeClient().readBead(input.dir, input.beadId);
        const forms = getBeadsForms(bead.metadata);
        return {
          bead,
          forms,
          beadRepoDir: input.dir,
          selectedForm: input.formId ? forms.find((form) => form.id === input.formId) : undefined,
        };
      },
      loadWorkspaceForms: async (input: LoadWorkspaceFormsInput): Promise<LoadWorkspaceFormsResult> => {
        if (!input.workspaceId.trim()) throw new Error('workspaceId is required');
        const [workspace, repos] = await Promise.all([
          vkClient().getWorkspace(input.workspaceId),
          vkClient().getWorkspaceRepos(input.workspaceId),
        ]);
        const workspaceDir = workspace.container_ref || workspace.agent_working_dir;
        if (!workspaceDir) throw new Error(`Workspace ${input.workspaceId} does not have a local workspace directory`);
        const workspaceBeads = await nodeClient().listWorkspaceBeads({
          workspaceId: input.workspaceId,
          workspaceDir,
          agentWorkingDir: workspace.agent_working_dir,
          repos,
          includeOtherWorkspaces: input.includeOtherWorkspaces ?? false,
        });
        const selectedRepo = input.beadId
          ? workspaceBeads.repos.find((repo) => repo.beads.some((bead) => bead.id === input.beadId))
          : undefined;
        const selectedBead = input.beadId
          ? selectedRepo?.beads.find((bead) => bead.id === input.beadId)
          : undefined;
        const forms = selectedBead ? getBeadsForms(selectedBead.metadata) : [];
        return {
          workspaceId: input.workspaceId,
          workspaceBeads,
          ...(selectedBead && selectedRepo ? {
            selected: {
              bead: selectedBead,
              forms,
              beadRepoDir: selectedRepo.dir,
              selectedForm: input.formId ? forms.find((form) => form.id === input.formId) : undefined,
            },
          } : {}),
        };
      },
      submitBeadForm: async (input: SubmitFormInput): Promise<SubmitFormResult> => {
        const result = await nodeClient().submitForm(input);
        const forms = getBeadsForms(result.metadata);
        const form = forms.find((candidate) => candidate.id === input.formId) ?? { id: input.formId, title: input.formId, html: '' };
        return {
          beadId: input.beadId,
          formId: input.formId,
          values: input.values,
          prettySummary: result.prettySummary,
          agentMessage: buildAgentResultMessage({ beadId: input.beadId, form, values: input.values }),
          reviewLabel: result.reviewLabel,
          warnings: result.warnings,
        };
      },
      removeReviewLabel: async (input: { dir: string; beadId: string; label?: string }) => {
        const label = input.label ?? 'needs-agent-review';
        try {
          await nodeClient().removeLabel(input.dir, input.beadId, label);
          return { success: true, warnings: [] };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return { success: true, warnings: [`Removing label "${label}" failed: ${message}`] };
        }
      },
    });

    moduleAPI.registerRoute('/dashboard/forms', { hideApplicationShell: true }, () => (
      <BeadsFormRoute actions={actions} />
    ));

    moduleAPI.registerRoute('/dashboard/forms/preview', { hideApplicationShell: true }, () => (
      <BeadsFormPreviewRoute actions={actions} />
    ));

    return { actions };
  },
);
