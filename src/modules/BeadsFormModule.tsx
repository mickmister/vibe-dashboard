import React, { useMemo, useRef, useState } from 'react';
import { addToast, Card, CardBody, Spinner } from '@heroui/react';
import { useSearchParams } from 'react-router';
import springboard from 'springboard';

import {
  buildAgentResultMessage,
  buildPrettySummary,
  beadFormDraftScopeKey,
  getBeadsForms,
  normalizeFormData,
  normalizeSubmittedValues,
  sanitizeBeadsFormHtml,
  validateSubmittedValues,
  type BeadLike,
  type BeadsFormDefinition,
  type BeadsFormDraft,
  type BeadsFormWizardPosition,
  type JsonObject,
} from '../lib/beadsFormCore';
import {
  applyValuesToForm,
  formValuesFromDom,
  latestSubmittedResponseValues,
  previewStorageKey,
  readPreviewStorage,
  setFormFieldsReadOnly,
  setSubmitButtonsDisabled,
  startPreviewEdit,
  writePreviewDraft,
  writePreviewSubmission,
} from '../lib/beadsFormPreviewState';
import { rewriteBeadBackedAttachmentRefs, rewriteFolderPreviewMediaRefs } from '../lib/beadsFormPreviewMedia';
import { shouldHydrateRefreshedWorkspaceForms } from '../lib/beadsFormRefreshState';
import { initializeSingleQuestionMode, prehideInactiveSingleQuestionItems } from '../lib/beadsFormSingleQuestion';
import { BeadsFormDraftSaveQueue } from '../lib/beadsFormDraftSaveQueue';
import { initializeCompactMoreInfo, refreshCompactMoreInfoState } from '../lib/beadsFormMoreInfo';
import { initializeMarkdownTextareaEditors, refreshMarkdownTextareaEditors } from '../lib/beadsFormMarkdownEditor';
import { preserveSubmittedFormDom } from '../lib/beadsFormSubmissionUi';
import {
  copySubmittedResultHandoffXml,
  pendingSubmittedResultHandoffCopy,
  submittedResultHandoffXml,
  type ClipboardCopyResult,
} from '../lib/beadsFormSubmitSuccess';
import type { BeadsFormSubmissionHandoffMetadata } from '../lib/beadsFormSubmissionHandoff';
import {
  aggregateFormDomPrefix,
  namespaceAggregateFormHtml,
  parseAggregateBeadsFormRefs,
  type AggregateBeadsFormRef,
  type AggregateSubmitStatus,
} from '../lib/beadsFormAggregate';
import {
  BeadsFormReadCache,
  directBeadFormsCacheKey,
  pendingBeadsFormsCacheKey,
  workspaceBeadFormsCacheKey,
  type BeadsFormCacheMetadata,
} from '../lib/beadsFormReadCache';
import {
  initialPendingQueueSentinel,
  shouldRefreshPendingQueueForSentinel,
  touchPendingQueueSentinel,
  type PendingQueueSentinel,
} from '../lib/beadsFormPendingQueueSentinel';

// @platform "node"
import { serverRegistry } from 'springboard/server/register';
import { createNodeBeadsClient, getBeadsFormDraft, type ListWorkspaceBeadsResult, type PendingBeadsFormQueueResult } from '../lib/beadsClient.node';
import { loadBeadsFormsFromFolder, tryAppendBeadsFormPreviewResponse } from '../lib/beadsFormFolder.node';
import {
  normalizePendingQueueInput,
  readPendingQueueDiskCache,
  shouldWarmPendingQueueOnStartup,
  writePendingQueueDiskCache,
} from '../lib/beadsFormPendingQueueCache.node';
import { registerBeadsFormMediaRoutes } from '../server/beads-form-media-routes';
import { BEADS_FORM_NOTIFICATION_TIMEOUT_MS, VibeKanbanServerClient } from '../server/vk-client';
// @platform end

type PreviewBeadsForm = BeadsFormDefinition & {
  sourceFile: string;
};

type LoadFormsInput = {
  dir: string;
  beadId: string;
  formId?: string;
  workspaceId?: string;
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
  selectedDraft?: BeadsFormDraft;
  beadRepoDir: string;
  cache?: BeadsFormCacheMetadata;
};

type AggregateBeadsFormItem = {
  ref: AggregateBeadsFormRef;
  key: string;
  beadRepoDir?: string;
  bead?: BeadLike;
  form?: BeadsFormDefinition;
  draft?: BeadsFormDraft;
  forms?: BeadsFormDefinition[];
  error?: string;
  cache?: BeadsFormCacheMetadata;
};

type LoadAggregateFormsInput = {
  refs: AggregateBeadsFormRef[];
};

type LoadAggregateFormsResult = {
  refs: AggregateBeadsFormRef[];
  items: AggregateBeadsFormItem[];
};

type LoadWorkspaceFormsResult = {
  workspaceId: string;
  workspaceBeads: ListWorkspaceBeadsResult;
  selected?: LoadFormsResult;
  cache?: BeadsFormCacheMetadata;
};

type SubmitFormInput = {
  dir: string;
  beadId: string;
  formId: string;
  workspaceId?: string;
  values: JsonObject;
  submissionId: string;
};

type SaveFormDraftInput = {
  dir: string;
  beadId: string;
  formId: string;
  workspaceId?: string;
  values: JsonObject;
  position?: BeadsFormWizardPosition;
  baseUpdatedAt?: string;
};

type SaveFormDraftResult = {
  draft: BeadsFormDraft;
};

type SubmitFormResult = {
  beadId: string;
  formId: string;
  values: JsonObject;
  submissionId: string;
  submittedAt: string;
  submittedBy: string;
  prettySummary: string;
  agentMessage: string;
  reviewLabel: string;
  warnings: string[];
};

function createSubmissionId(): string {
  return crypto.randomUUID();
}

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

type LoadPendingFormsInput = {
  reposRoot?: string;
  repoLimit?: number;
};

type LoadPendingFormsResult = PendingBeadsFormQueueResult & {
  cache?: BeadsFormCacheMetadata;
};

type PendingQueueSentinelState = {
  getState: () => PendingQueueSentinel;
  setState: (updater: PendingQueueSentinel | ((current: PendingQueueSentinel) => PendingQueueSentinel)) => PendingQueueSentinel;
};

const beadsFormReadCache = new BeadsFormReadCache();

function nodeClient() {
  if (typeof createNodeBeadsClient !== 'function') {
    throw new Error('Beads client is only available on the node side of the BeadsForm module');
  }
  return createNodeBeadsClient({
    notifySession: (sessionId, message) => vkClient().sendFollowUp(sessionId, message, {
      timeoutMs: BEADS_FORM_NOTIFICATION_TIMEOUT_MS,
    }),
  });
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
  warmPendingQueueCacheOnStartup();
});
// @platform end

async function readBeadFormsFresh(input: LoadFormsInput): Promise<LoadFormsResult> {
  if (!input.dir.trim()) throw new Error('dir is required');
  if (!input.beadId.trim()) throw new Error('beadId is required');
  const bead = await nodeClient().readBead(input.dir, input.beadId);
  const forms = getBeadsForms(bead.metadata);
  const selectedForm = input.formId ? forms.find((form) => form.id === input.formId) : undefined;
  return {
    bead,
    forms,
    beadRepoDir: input.dir,
    selectedForm,
    ...(selectedForm ? {
      selectedDraft: getBeadsFormDraft(bead.metadata, {
        ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
        dir: input.dir,
        beadId: input.beadId,
        formId: selectedForm.id,
      }),
    } : {}),
  };
}

async function readWorkspaceFormsFresh(input: LoadWorkspaceFormsInput): Promise<LoadWorkspaceFormsResult> {
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
    ...(input.beadId ? { beadId: input.beadId } : {}),
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
        ...(input.formId ? {
          selectedDraft: getBeadsFormDraft(selectedBead.metadata, {
            workspaceId: input.workspaceId,
            dir: selectedRepo.dir,
            beadId: input.beadId!,
            formId: input.formId,
          }),
        } : {}),
      },
    } : {}),
  };
}

async function readPendingFormsFresh(input: LoadPendingFormsInput): Promise<LoadPendingFormsResult> {
  const normalized = normalizePendingQueueInput(input);
  return nodeClient().listPendingBeadsFormQueue(normalized);
}

async function readPendingFormsCached(input: LoadPendingFormsInput): Promise<LoadPendingFormsResult> {
  const normalized = normalizePendingQueueInput(input);
  const key = pendingBeadsFormsCacheKey(normalized);
  const memory = beadsFormReadCache.get<PendingBeadsFormQueueResult>(key);
  if (memory) return memory;

  const disk = await readPendingQueueDiskCache(normalized);
  if (disk) return beadsFormReadCache.set(key, disk.result, disk.loadedAtMs);

  return refreshPendingFormsCached(normalized);
}

async function refreshPendingFormsCached(input: LoadPendingFormsInput): Promise<LoadPendingFormsResult> {
  const normalized = normalizePendingQueueInput(input);
  const key = pendingBeadsFormsCacheKey(normalized);
  return beadsFormReadCache.refresh(key, async () => {
    const result = await readPendingFormsFresh(normalized);
    await writePendingQueueDiskCache(normalized, result);
    return result;
  });
}

let pendingQueueWarmStarted = false;

function warmPendingQueueCacheOnStartup(): void {
  if (pendingQueueWarmStarted || !shouldWarmPendingQueueOnStartup()) return;
  pendingQueueWarmStarted = true;
  void refreshPendingFormsCached(normalizePendingQueueInput()).catch((error) => {
    console.warn('BeadsForm pending queue startup warm failed:', error);
  });
}

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

function aggregateItemKey(ref: AggregateBeadsFormRef): string {
  return `${ref.dir}:${ref.beadId}:${ref.formId}`;
}

function pendingQueueFingerprint(result: PendingBeadsFormQueueResult): string {
  return JSON.stringify({
    reposRoot: result.reposRoot,
    repoLimit: result.repoLimit,
    reposScanned: result.reposScanned,
    entries: result.entries.map((entry) => ({
      repoDir: entry.repoDir,
      beadId: entry.bead.id,
      formId: entry.form.id,
      responseCount: entry.form.responseCount,
    })),
    skipped: result.skipped.map((skip) => ({ repoDir: skip.repoDir, reason: skip.reason })),
  });
}

function pendingQueueScopeKey(input: LoadPendingFormsInput): string {
  return pendingBeadsFormsCacheKey(input);
}

function markPendingQueueDirtyForRepo(state: PendingQueueSentinelState, repoDir: string): void {
  const parentDir = parentDirOf(repoDir);
  const scopeKey = pendingQueueScopeKey({ reposRoot: parentDir });
  state.setState((current) => touchPendingQueueSentinel(current, [scopeKey]));
}

function parentDirOf(repoDir: string): string {
  const trimmed = repoDir.replace(/\/+$/, '');
  const lastSlash = trimmed.lastIndexOf('/');
  if (lastSlash <= 0) return repoDir;
  return trimmed.slice(0, lastSlash);
}

function formatPendingEntryDate(value: string | undefined): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

async function readAggregateForms(input: LoadAggregateFormsInput): Promise<LoadAggregateFormsResult> {
  if (input.refs.length === 0) throw new Error('Aggregate BeadsForm URL requires at least one form ref.');
  const items = await Promise.all(input.refs.map(async (ref): Promise<AggregateBeadsFormItem> => {
    const key = aggregateItemKey(ref);
    try {
      const result = await beadsFormReadCache.cachedOrLoad(
        directBeadFormsCacheKey({ dir: ref.dir, beadId: ref.beadId, formId: ref.formId }),
        () => readBeadFormsFresh({ dir: ref.dir, beadId: ref.beadId, formId: ref.formId }),
      );
      const form = result.selectedForm;
      if (!form) {
        return {
          ref,
          key,
          beadRepoDir: result.beadRepoDir,
          bead: result.bead,
          forms: result.forms,
          error: `Form not found: ${ref.formId}`,
          ...(result.cache ? { cache: result.cache } : {}),
        };
      }
      return {
        ref,
        key,
        beadRepoDir: result.beadRepoDir,
        bead: result.bead,
        form,
        draft: result.selectedDraft,
        forms: result.forms,
        ...(result.cache ? { cache: result.cache } : {}),
      };
    } catch (error) {
      return {
        ref,
        key,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }));
  return { refs: input.refs, items };
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

function wizardSafeFormHtml(form: BeadsFormDefinition, html: string, options: { urlState?: boolean; initialPosition?: BeadsFormWizardPosition } = {}): string {
  if (form.format !== 'standard') return html;
  return prehideInactiveSingleQuestionItems(html, options);
}

function SubmittingOverlay() {
  return (
    <div className="beadsform-submit-overlay" role="status" aria-live="polite">
      <Spinner size="lg" aria-hidden="true" />
      <p>Submitting…</p>
    </div>
  );
}

function SubmitSuccessSummary({
  title,
  clipboardResult,
  values,
  handoffMetadata,
  warnings,
  onEdit,
  children,
}: {
  title: string;
  clipboardResult?: ClipboardCopyResult | null;
  values: JsonObject;
  handoffMetadata?: BeadsFormSubmissionHandoffMetadata;
  warnings: string[];
  onEdit: () => void;
  children?: React.ReactNode;
}) {
  const manualCopyText = clipboardResult?.text ?? submittedResultHandoffXml(values, handoffMetadata);
  return (
    <section className="beadsform-submit-result" aria-live="polite">
      <h2>{title}</h2>
      <p>Your BeadsForm response is submitted and the form is locked to the submitted answers.</p>
      {clipboardResult?.status === 'copied' ? (
        <p>Copied BeadsForm XML handoff to your clipboard.</p>
      ) : !clipboardResult || clipboardResult.status === 'pending' ? (
        <p>Copying BeadsForm XML handoff…</p>
      ) : (
        <div className="beadsform-warning" role="status">
          <p>{clipboardResult?.warning ?? 'Clipboard copy is unavailable. Use the manual XML handoff field below.'}</p>
        </div>
      )}
      {warnings.length > 0 ? (
        <div className="beadsform-warning" role="status">
          <h3>Warnings</h3>
          <ul>{warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
        </div>
      ) : null}
      {children}
      <button type="button" onClick={onEdit}>Edit response</button>
      <h3>BeadsForm XML handoff</h3>
      <textarea readOnly rows={Math.min(20, Math.max(6, manualCopyText.split('\n').length + 1))} value={manualCopyText} />
    </section>
  );
}

function BeadsFormLoadingCard({ title, description }: { title: string; description: React.ReactNode }) {
  return (
    <div className="beadsform-loading-shell" role="status" aria-live="polite">
      <Card className="beadsform-loading-card" shadow="sm">
        <CardBody className="beadsform-loading-card-body">
          <Spinner size="lg" />
          <h1>{title}</h1>
          <p>{description}</p>
        </CardBody>
      </Card>
    </div>
  );
}

function BeadsFormLoadingPage({ title, description }: { title: string; description: React.ReactNode }) {
  return (
    <div className="beadsform-root beadsform-page">
      <BeadsFormLoadingCard title={title} description={description} />
    </div>
  );
}

function BeadsFormSelectedChrome({
  label,
  allFormsHref,
  children,
}: {
  label: string;
  allFormsHref?: string;
  children?: React.ReactNode;
}) {
  return (
    <header className="beadsform-page-chrome beadsform-page-chrome--compact">
      <div>
        <p className="beadsform-eyebrow">{label}</p>
        {children ? (
          <details className="beadsform-context-details">
            <summary>Bead context</summary>
            <div className="beadsform-context-details-body">{children}</div>
          </details>
        ) : null}
      </div>
      {allFormsHref ? <a className="beadsform-all-forms-link" href={allFormsHref}>All forms</a> : null}
    </header>
  );
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
  const [clipboardResult, setClipboardResult] = useState<ClipboardCopyResult | null>(null);
  const [submittedLocked, setSubmittedLocked] = useState(false);
  const [rollbackValues, setRollbackValues] = useState<JsonObject | null>(null);
  const [editResponseVersion, setEditResponseVersion] = useState(0);
  const submittedLockedRef = useRef(false);
  const submitInFlightRef = useRef(false);
  const formHostRef = useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    submittedLockedRef.current = submittedLocked;
  }, [submittedLocked]);

  React.useEffect(() => {
    let cancelled = false;
    setLoaded(null);
    setError(null);
    setSubmitResult(null);
    setClipboardResult(null);
    setRollbackValues(null);
    setEditResponseVersion(0);
    submittedLockedRef.current = false;
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
    return wizardSafeFormHtml(loaded.selectedForm, sanitized);
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
    const restoredValues = rollbackValues ?? (snapshot.editing ? (snapshot.draft ?? snapshot.latest) : (snapshot.latest ?? snapshot.draft));
    if (restoredValues) {
      applyValuesToForm(form, restoredValues);
    }
    initializeCompactMoreInfo(host);
    refreshCompactMoreInfoState(host);
    initializeMarkdownTextareaEditors(host);
    refreshMarkdownTextareaEditors(host);

    const locked = submittedLockedRef.current || (!!snapshot.latest && !snapshot.editing);
    submittedLockedRef.current = locked;
    setSubmittedLocked(locked);
    setSubmitButtonsDisabled(form, locked);
    setFormFieldsReadOnly(form, locked);
    setSubmitResult(snapshot.latest ? {
      formId: loaded.selectedForm.id,
      values: snapshot.latest,
      submittedAt: snapshot.history.at(-1)?.submittedAt ?? '',
      warnings: [],
    } : null);
  }, [editResponseVersion, loaded?.selectedForm, previewStateKey, rollbackValues, selectedHtml]);

  React.useEffect(() => {
    if (loaded?.selectedForm?.format !== 'standard') return undefined;
    const host = formHostRef.current;
    if (!host) return undefined;
    return initializeSingleQuestionMode(host);
  }, [editResponseVersion, loaded?.selectedForm?.format, previewStateKey, selectedHtml]);

  React.useEffect(() => {
    const host = formHostRef.current;
    if (!host || !loaded?.selectedForm) return;
    initializeCompactMoreInfo(host);
    refreshCompactMoreInfoState(host);
    initializeMarkdownTextareaEditors(host);
    refreshMarkdownTextareaEditors(host);
  }, [loaded?.selectedForm, selectedHtml]);

  React.useEffect(() => {
    if (!submitResult || !loaded?.selectedForm) return;
    preserveSubmittedFormDom(formHostRef.current, submitResult.values, {
      lock: submittedLocked,
      singleQuestionMode: loaded.selectedForm.format === 'standard',
    });
  }, [loaded?.selectedForm, selectedHtml, submitResult, submittedLocked]);

  const handleDraftChange = () => {
    if (submittedLocked || !previewStateKey || typeof window === 'undefined') return;
    const form = formHostRef.current?.querySelector('form');
    if (!form) return;
    writePreviewDraft(window.localStorage, previewStateKey, formValuesFromDom(form));
  };

  const handleEditResponse = () => {
    submittedLockedRef.current = false;
    setSubmittedLocked(false);
    setSubmitResult(null);
    setClipboardResult(null);
    setRollbackValues(null);
    setEditResponseVersion((version) => version + 1);
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
    submittedLockedRef.current = true;
    setSubmittedLocked(true);
    setRollbackValues(null);
    setError(null);
    preserveSubmittedFormDom(formHostRef.current, values, {
      lock: true,
      singleQuestionMode: loaded.selectedForm.format === 'standard',
    });
    const handoffMetadata = { formId: loaded.selectedForm.id };
    setClipboardResult(pendingSubmittedResultHandoffCopy(values, handoffMetadata));
    setSubmitResult({
      formId: loaded.selectedForm.id,
      values,
      submittedAt: '',
      warnings: [],
    });
    void copySubmittedResultHandoffXml(navigator.clipboard, values, handoffMetadata).then(setClipboardResult);
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
      submittedLockedRef.current = true;
      setSubmittedLocked(true);
      setSubmitResult((current) => current ? {
        ...current,
        submittedAt: result.submittedAt,
        warnings: result.warnings,
      } : result);
    } catch (reason) {
      submittedLockedRef.current = false;
      setSubmittedLocked(false);
      setSubmitResult(null);
      setClipboardResult(null);
      setRollbackValues(values);
      setEditResponseVersion((version) => version + 1);
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      submitInFlightRef.current = false;
    }
  };

  return (
    <div className={`beadsform-root beadsform-page${submitting ? ' is-submitting' : ''}`} aria-busy={submitting}>
      {!loaded?.selectedForm ? <header>
        <p className="beadsform-eyebrow">Forms preview</p>
        <h1>Folder forms</h1>
        <p>Load forms from a local folder, submit them without touching beads, and copy the XML handoff only.</p>
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
      {loaded?.selectedForm && !submitResult ? (
        <section>
          <BeadsFormSelectedChrome
            label="Forms preview"
            allFormsHref={previewFormUrl({ folder: loaded.folder })}
          >
            <p>Preview folder: <code>{loaded.folder}</code></p>
          </BeadsFormSelectedChrome>
          <div
            key={`preview-form-host:${loaded.selectedForm.id}:${editResponseVersion}`}
            ref={formHostRef}
            className="beadsform-form-host"
            aria-hidden={submitting ? true : undefined}
            onInput={handleDraftChange}
            onChange={handleDraftChange}
            onSubmit={handleSubmit}
            dangerouslySetInnerHTML={{ __html: selectedHtml }}
          />
          {submitting ? <SubmittingOverlay /> : null}
        </section>
      ) : null}
      {submitResult ? (
        <SubmitSuccessSummary
          title="Preview response submitted"
          clipboardResult={clipboardResult}
          values={submitResult.values}
          handoffMetadata={{ formId: submitResult.formId, submittedAt: submitResult.submittedAt }}
          warnings={submitResult.warnings}
          onEdit={handleEditResponse}
        >
          <p>Preview response is locked to the submitted answers.</p>
        </SubmitSuccessSummary>
      ) : null}
    </div>
  );
}

function BeadsFormPendingQueue({ actions, parentDir, pendingQueueSentinel }: {
  actions: {
    loadPendingForms: (input: LoadPendingFormsInput) => MaybeNestedPromise<LoadPendingFormsResult>;
    refreshPendingForms: (input: LoadPendingFormsInput) => MaybeNestedPromise<LoadPendingFormsResult>;
  };
  parentDir?: string;
  pendingQueueSentinel: PendingQueueSentinel;
}) {
  const [pending, setPending] = useState<LoadPendingFormsResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshNotice, setRefreshNotice] = useState<string | null>(null);
  const loadTokenRef = useRef(0);
  const pendingRef = useRef<LoadPendingFormsResult | null>(null);
  const observedSentinelVersionRef = useRef<number | undefined>(undefined);

  React.useEffect(() => {
    pendingRef.current = pending;
  }, [pending]);

  const load = React.useCallback(async () => {
    const token = loadTokenRef.current + 1;
    loadTokenRef.current = token;
    const input = {
      ...(parentDir ? { reposRoot: parentDir } : {}),
    };
    setLoading(!pendingRef.current);
    setRefreshing(!!pendingRef.current);
    setError(null);
    setRefreshNotice(null);
    try {
      const result = await (await actions.loadPendingForms(input));
      if (token !== loadTokenRef.current) return;
      pendingRef.current = result;
      setPending(result);
      if (result.cache?.status === 'cached') {
        setRefreshing(true);
        void (async () => {
          const fresh = await (await actions.refreshPendingForms(input));
          if (token === loadTokenRef.current) {
            const changed = pendingQueueFingerprint(result) !== pendingQueueFingerprint(fresh);
            pendingRef.current = fresh;
            setPending(fresh);
            if (changed) {
              const message = 'Fresh scan found updated pending BeadsForms.';
              setRefreshNotice(message);
              addToast({ title: 'Pending BeadsForms updated', description: message, color: 'primary' });
            }
          }
        })().catch((reason) => {
          if (token === loadTokenRef.current) setError(reason instanceof Error ? reason.message : String(reason));
        }).finally(() => {
          if (token === loadTokenRef.current) setRefreshing(false);
        });
      }
    } catch (reason) {
      if (token === loadTokenRef.current) setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (token === loadTokenRef.current) setLoading(false);
      if (token === loadTokenRef.current && !pendingRef.current) setRefreshing(false);
    }
  }, [actions, parentDir]);

  React.useEffect(() => {
    void load();
  }, [load]);

  React.useEffect(() => {
    const input = {
      ...(parentDir ? { reposRoot: parentDir } : {}),
    };
    if (!shouldRefreshPendingQueueForSentinel({
      previousVersion: observedSentinelVersionRef.current,
      sentinel: pendingQueueSentinel,
      scopeKey: pendingQueueScopeKey(input),
    })) {
      observedSentinelVersionRef.current = pendingQueueSentinel.version;
      return;
    }
    observedSentinelVersionRef.current = pendingQueueSentinel.version;
    if (!pendingRef.current) return;

    const token = loadTokenRef.current + 1;
    loadTokenRef.current = token;
    setRefreshing(true);
    setError(null);
    setRefreshNotice(null);
    void (async () => {
      const fresh = await (await actions.refreshPendingForms(input));
      if (token !== loadTokenRef.current) return;
      const changed = pendingRef.current
        ? pendingQueueFingerprint(pendingRef.current) !== pendingQueueFingerprint(fresh)
        : true;
      pendingRef.current = fresh;
      setPending(fresh);
      if (changed) {
        const message = 'Pending BeadsForms changed.';
        setRefreshNotice(message);
        addToast({ title: 'Pending BeadsForms updated', description: message, color: 'primary' });
      }
    })().catch((reason) => {
      if (token === loadTokenRef.current) setError(reason instanceof Error ? reason.message : String(reason));
    }).finally(() => {
      if (token === loadTokenRef.current) setRefreshing(false);
    });
  }, [actions, parentDir, pendingQueueSentinel]);

  return (
    <div className="beadsform-root beadsform-page">
      {pending ? <h1>Pending BeadsForms</h1> : null}
      {error ? <p role="alert" className="beadsform-error">{error}</p> : null}
      {!pending && !error ? (
        <BeadsFormLoadingCard
          title="Loading pending BeadsForms"
          description={<>Checking first-level child directories under <code>{parentDir || '~/repos'}</code>…</>}
        />
      ) : null}
      {pending ? (
        <>
          {refreshing ? <p className="beadsform-refresh-notice" role="status">Checking for updates…</p> : null}
          {refreshNotice ? <p className="beadsform-refresh-notice" role="status">{refreshNotice}</p> : null}
          {pending.entries.length === 0 ? (
            <section className="beadsform-pending-empty" aria-live="polite">
              <h2>Inbox clear</h2>
              <p>No pending BeadsForms found. New forms will appear here after agents attach them.</p>
            </section>
          ) : (
            <section aria-label="Pending BeadsForms inbox">
              <ul className="beadsform-pending-list">
                {pending.entries.map((entry) => (
                  <li key={`${entry.repoDir}:${entry.bead.id}:${entry.form.id}`}>
                    <article className="beadsform-pending-card">
                      <div className="beadsform-pending-card-main">
                        <p className="beadsform-pending-repo">{entry.repoName}</p>
                        <h2 className="beadsform-pending-title">
                          <a href={formViewUrl({ dir: entry.repoDir, beadId: entry.bead.id, formId: entry.form.id })}>{entry.form.title}</a>
                        </h2>
                        {entry.form.description ? <p className="beadsform-pending-description">{entry.form.description}</p> : null}
                        <dl className="beadsform-pending-meta" aria-label={`Context for ${entry.form.title}`}>
                          <div>
                            <dt>Bead</dt>
                            <dd><code>{entry.bead.id}</code>{entry.bead.title ? <> · {entry.bead.title}</> : null}</dd>
                          </div>
                          <div>
                            <dt>Repo</dt>
                            <dd>{entry.repoName}</dd>
                          </div>
                          {entry.bead.updatedAt || entry.bead.createdAt ? (
                            <div>
                              <dt>{entry.bead.updatedAt ? 'Updated' : 'Created'}</dt>
                              <dd>{formatPendingEntryDate(entry.bead.updatedAt ?? entry.bead.createdAt)}</dd>
                            </div>
                          ) : null}
                        </dl>
                      </div>
                      <a className="beadsform-pending-action" href={formViewUrl({ dir: entry.repoDir, beadId: entry.bead.id, formId: entry.form.id })}>Fill out form</a>
                    </article>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      ) : null}
    </div>
  );
}

function AggregateBeadsFormCard({ item, submitBeadForm, saveBeadFormDraft }: {
  item: AggregateBeadsFormItem;
  submitBeadForm: (input: SubmitFormInput) => MaybeNestedPromise<SubmitFormResult>;
  saveBeadFormDraft: (input: SaveFormDraftInput) => MaybeNestedPromise<SaveFormDraftResult>;
}) {
  const [status, setStatus] = useState<AggregateSubmitStatus>({ status: 'idle' });
  const [submittedLocked, setSubmittedLocked] = useState(false);
  const [editingSubmittedResponse, setEditingSubmittedResponse] = useState(false);
  const [rollbackValues, setRollbackValues] = useState<JsonObject | null>(null);
  const [editResponseVersion, setEditResponseVersion] = useState(0);
  const submittedLockedRef = useRef(false);
  const submitInFlightRef = useRef(false);
  const submissionIdRef = useRef<string | null>(null);
  const formHostRef = useRef<HTMLDivElement | null>(null);
  const draftSaveQueueRef = useRef<BeadsFormDraftSaveQueue | null>(null);
  const wizardPositionRef = useRef<BeadsFormWizardPosition | undefined>(item.draft?.position);
  const form = item.form;
  const domPrefix = useMemo(() => aggregateFormDomPrefix(item.ref), [item.ref]);
  const html = useMemo(() => (
    form ? wizardSafeFormHtml(
      form,
      namespaceAggregateFormHtml(sanitizeBeadsFormHtml(rewriteBeadBackedAttachmentRefs(form.html, item.beadRepoDir ?? item.ref.dir)), domPrefix),
      { urlState: false, initialPosition: item.draft?.position },
    ) : ''
  ), [domPrefix, form, item.beadRepoDir, item.ref.dir, item.draft?.position]);
  const draftScopeKey = useMemo(() => {
    if (!form || !item.beadRepoDir) return '';
    return beadFormDraftScopeKey({
      dir: item.beadRepoDir,
      beadId: item.ref.beadId,
      formId: form.id,
    });
  }, [form, item.beadRepoDir, item.ref.beadId]);

  React.useEffect(() => {
    submittedLockedRef.current = submittedLocked;
  }, [submittedLocked]);

  React.useEffect(() => () => {
    draftSaveQueueRef.current?.dispose();
  }, []);

  React.useEffect(() => {
    wizardPositionRef.current = item.draft?.position;
    draftSaveQueueRef.current?.setBaseUpdatedAt(item.draft?.updatedAt);
  }, [draftScopeKey, item.draft]);

  React.useEffect(() => {
    draftSaveQueueRef.current?.dispose();
    draftSaveQueueRef.current = null;
  }, [draftScopeKey]);

  React.useEffect(() => {
    const element = formHostRef.current?.querySelector('form');
    if (!element || !form || !draftScopeKey) return;
    const backendValues = latestSubmittedResponseValues(form.responses);
    const restoredValues = editingSubmittedResponse
      ? (rollbackValues ?? item.draft?.values ?? backendValues)
      : (rollbackValues ?? backendValues ?? item.draft?.values);
    if (restoredValues) applyValuesToForm(element, restoredValues);
    const locked = submittedLockedRef.current || (!!backendValues && !editingSubmittedResponse);
    submittedLockedRef.current = locked;
    setSubmittedLocked(locked);
    setSubmitButtonsDisabled(element, locked);
    setFormFieldsReadOnly(element, locked);
    const host = formHostRef.current;
    if (host) {
      initializeCompactMoreInfo(host);
      refreshCompactMoreInfoState(host);
      initializeMarkdownTextareaEditors(host);
      refreshMarkdownTextareaEditors(host);
    }
  }, [draftScopeKey, editResponseVersion, editingSubmittedResponse, form, html, item.draft, rollbackValues]);

  React.useEffect(() => {
    const element = formHostRef.current;
    if (!element || !form) return;
    if (form.format === 'standard') initializeSingleQuestionMode(element, { urlState: false, initialPosition: item.draft?.position });
    initializeCompactMoreInfo(element);
    refreshCompactMoreInfoState(element);
    initializeMarkdownTextareaEditors(element);
    refreshMarkdownTextareaEditors(element);
  }, [editResponseVersion, form, html, item.draft?.position]);

  const handleDraftChange = () => {
    if (submittedLocked || !draftScopeKey || !form || !item.beadRepoDir) return;
    const element = formHostRef.current?.querySelector('form');
    if (!element) return;
    const values = formValuesFromDom(element);
    draftSaveQueueRef.current ??= new BeadsFormDraftSaveQueue({
      initialBaseUpdatedAt: item.draft?.updatedAt,
      save: async (payload, baseUpdatedAt) => await (await saveBeadFormDraft({
        dir: item.beadRepoDir!,
        beadId: item.ref.beadId,
        formId: form.id,
        values: payload.values,
        ...(payload.position ? { position: payload.position } : {}),
        ...(baseUpdatedAt ? { baseUpdatedAt } : {}),
      })),
      onError: (reason) => {
        setStatus({ status: 'error', message: reason instanceof Error ? reason.message : String(reason) });
      },
    });
    draftSaveQueueRef.current.schedule({
      values,
      ...(wizardPositionRef.current ? { position: wizardPositionRef.current } : {}),
    });
  };

  React.useEffect(() => {
    const host = formHostRef.current;
    if (!host) return undefined;
    const handlePositionChange = (event: Event) => {
      const detail = (event as CustomEvent<{ position?: BeadsFormWizardPosition }>).detail;
      if (detail?.position) {
        wizardPositionRef.current = detail.position;
        handleDraftChange();
      }
    };
    host.addEventListener('beadsform:wizard-position-change', handlePositionChange);
    return () => {
      host.removeEventListener('beadsform:wizard-position-change', handlePositionChange);
    };
  });

  const handleEditResponse = () => {
    submissionIdRef.current = null;
    submittedLockedRef.current = false;
    setSubmittedLocked(false);
    setEditingSubmittedResponse(true);
    setRollbackValues(null);
    setStatus({ status: 'idle' });
    setEditResponseVersion((version) => version + 1);
    const element = formHostRef.current?.querySelector('form');
    if (element) {
      setSubmitButtonsDisabled(element, false);
      setFormFieldsReadOnly(element, false);
    }
  };

  const handleSubmit = async (event: React.FormEvent<HTMLDivElement>) => {
    const target = event.target;
    if (!(target instanceof HTMLFormElement) || !form || !item.beadRepoDir) return;
    event.preventDefault();
    if (submitInFlightRef.current || submittedLocked) return;
    if (!target.reportValidity()) return;
    const values = normalizeSubmittedFormEvent(event, target, form);
    draftSaveQueueRef.current?.cancel();
    submitInFlightRef.current = true;
    setRollbackValues(null);
    submittedLockedRef.current = true;
    setSubmittedLocked(true);
    setEditingSubmittedResponse(false);
    preserveSubmittedFormDom(formHostRef.current, values, {
      lock: true,
      singleQuestionMode: form.format === 'standard',
      singleQuestionModeUrlState: false,
    });
    const handoffMetadata = {
      beadId: item.ref.beadId,
      formId: form.id,
    };
    const pendingCopy = pendingSubmittedResultHandoffCopy(values, handoffMetadata);
    setStatus({
      status: 'success',
      values,
      submittedAt: '',
      submittedBy: '',
      warnings: [],
      clipboardStatus: pendingCopy.status,
      clipboardText: pendingCopy.text,
    });
    void copySubmittedResultHandoffXml(navigator.clipboard, values, handoffMetadata).then((copyResult) => {
      setStatus((current) => {
        if (current.status !== 'success') return current;
        return {
          ...current,
          clipboardStatus: copyResult.status,
          clipboardText: copyResult.text,
          ...(copyResult.warning ? { clipboardWarning: copyResult.warning } : {}),
        };
      });
    });
    try {
      const result = await (await submitBeadForm({
        dir: item.beadRepoDir,
        beadId: item.ref.beadId,
        formId: form.id,
        values,
        submissionId: submissionIdRef.current ??= createSubmissionId(),
      }));
      draftSaveQueueRef.current?.setBaseUpdatedAt(undefined);
      submittedLockedRef.current = true;
      setSubmittedLocked(true);
      setEditingSubmittedResponse(false);
      setStatus((current) => ({
        status: 'success',
        values: current.status === 'success' ? current.values : result.values,
        submittedAt: result.submittedAt,
        submittedBy: result.submittedBy,
        warnings: result.warnings,
        clipboardStatus: current.status === 'success' ? current.clipboardStatus : 'pending',
        clipboardText: current.status === 'success' ? current.clipboardText : pendingSubmittedResultHandoffCopy(result.values, {
          beadId: item.ref.beadId,
          formId: form.id,
          submittedAt: result.submittedAt,
          submittedBy: result.submittedBy,
        }).text,
        ...(current.status === 'success' && current.clipboardWarning ? { clipboardWarning: current.clipboardWarning } : {}),
      }));
    } catch (error) {
      submittedLockedRef.current = false;
      setSubmittedLocked(false);
      setEditingSubmittedResponse(false);
      setRollbackValues(values);
      setEditResponseVersion((version) => version + 1);
      setStatus({ status: 'error', message: error instanceof Error ? error.message : String(error) });
    } finally {
      submitInFlightRef.current = false;
    }
  };

  return (
    <article className={`beadsform-aggregate-card${status.status === 'submitting' ? ' is-submitting' : ''}`} aria-busy={status.status === 'submitting'}>
      <header className="beadsform-page-chrome beadsform-page-chrome--compact">
        <div>
          <p className="beadsform-eyebrow">{item.ref.beadId} / {item.ref.formId}</p>
          <details className="beadsform-context-details">
            <summary>Bead context</summary>
            <div className="beadsform-context-details-body">
              {item.bead?.title ? <p>Bead: {item.bead.title}</p> : null}
              <p>Repo: <code>{item.ref.dir}</code></p>
            </div>
          </details>
        </div>
        <a className="beadsform-all-forms-link" href={formViewUrl({ dir: item.ref.dir, beadId: item.ref.beadId, formId: item.ref.formId })}>Open alone</a>
      </header>
      {item.error ? <p role="alert" className="beadsform-error">{item.error}</p> : null}
      {form && status.status !== 'success' ? (
        <>
          {submittedLocked ? (
            <div className="beadsform-warning" role="status">
              <p>This source form is showing the latest submitted response and is locked until you edit it.</p>
              <button type="button" onClick={handleEditResponse}>Edit response</button>
            </div>
          ) : null}
          <div
            key={`aggregate-form-host:${domPrefix}:${editResponseVersion}`}
            ref={formHostRef}
            className="beadsform-form-host"
            aria-hidden={status.status === 'submitting' ? true : undefined}
            onInput={handleDraftChange}
            onChange={handleDraftChange}
            onSubmit={handleSubmit}
            dangerouslySetInnerHTML={{ __html: html }}
          />
          {status.status === 'submitting' ? <SubmittingOverlay /> : null}
        </>
      ) : null}
      {status.status === 'success' ? (
        <SubmitSuccessSummary
          title="Submitted this source form"
          clipboardResult={{
            status: status.clipboardStatus,
            text: status.clipboardText,
            ...(status.clipboardWarning ? { warning: status.clipboardWarning } : {}),
          }}
          values={status.values}
          handoffMetadata={{
            beadId: item.ref.beadId,
            formId: item.ref.formId,
            submittedAt: status.submittedAt,
            submittedBy: status.submittedBy,
          }}
          warnings={status.warnings}
          onEdit={handleEditResponse}
        />
      ) : status.status === 'error' ? (
        <p role="alert" className="beadsform-error">Submit failed for this source form: {status.message}</p>
      ) : null}
    </article>
  );
}

function BeadsFormAggregateRoute({ actions }: { actions: {
  loadAggregateForms: (input: LoadAggregateFormsInput) => MaybeNestedPromise<LoadAggregateFormsResult>;
  submitBeadForm: (input: SubmitFormInput) => MaybeNestedPromise<SubmitFormResult>;
  saveBeadFormDraft: (input: SaveFormDraftInput) => MaybeNestedPromise<SaveFormDraftResult>;
} }) {
  const [params] = useSearchParams();
  const [loaded, setLoaded] = useState<LoadAggregateFormsResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const paramString = params.toString();
  const parsedRefs = useMemo((): { refs: AggregateBeadsFormRef[]; error?: string } => {
    try {
      return { refs: parseAggregateBeadsFormRefs(new URLSearchParams(paramString)) };
    } catch (reason) {
      return { refs: [], error: reason instanceof Error ? reason.message : String(reason) };
    }
  }, [paramString]);

  React.useEffect(() => {
    let cancelled = false;
    setLoaded(null);
    if (parsedRefs.error) {
      setError(parsedRefs.error);
      return;
    }
    if (parsedRefs.refs.length === 0) {
      setError('Aggregate BeadsForm URL requires repeated dir, bead, and form parameters.');
      return;
    }
    setError(null);
    void (async () => {
      try {
        const result = await (await actions.loadAggregateForms({ refs: parsedRefs.refs }));
        if (!cancelled) setLoaded(result);
      } catch (reason) {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [actions, parsedRefs]);

  return (
    <div className="beadsform-root beadsform-page beadsform-aggregate-page">
      <header>
        <p className="beadsform-eyebrow">Forms</p>
        <h1>Aggregate BeadsForm review</h1>
        <p>Answer several bead-backed forms from one page. Each section submits back to its source bead/form independently, so partial failures are visible per source form.</p>
      </header>
      {error ? <p role="alert" className="beadsform-error">{error}</p> : null}
      {!loaded && !error ? (
        <BeadsFormLoadingCard
          title="Loading aggregate BeadsForms"
          description="Fetching each source form directly without scanning the whole workspace."
        />
      ) : null}
      {loaded ? (
        <section className="beadsform-aggregate-list">
          <h2>Source forms</h2>
          {loaded.items.map((item) => (
            <AggregateBeadsFormCard
              key={item.key}
              item={item}
              submitBeadForm={actions.submitBeadForm}
              saveBeadFormDraft={actions.saveBeadFormDraft}
            />
          ))}
        </section>
      ) : null}
    </div>
  );
}

function BeadsFormRoute({ actions, pendingQueueSentinel }: { actions: {
  loadBeadForms: (input: LoadFormsInput) => MaybeNestedPromise<LoadFormsResult>;
  refreshBeadForms: (input: LoadFormsInput) => MaybeNestedPromise<LoadFormsResult>;
  loadWorkspaceForms: (input: LoadWorkspaceFormsInput) => MaybeNestedPromise<LoadWorkspaceFormsResult>;
  refreshWorkspaceForms: (input: LoadWorkspaceFormsInput) => MaybeNestedPromise<LoadWorkspaceFormsResult>;
  loadPendingForms: (input: LoadPendingFormsInput) => MaybeNestedPromise<LoadPendingFormsResult>;
  refreshPendingForms: (input: LoadPendingFormsInput) => MaybeNestedPromise<LoadPendingFormsResult>;
  submitBeadForm: (input: SubmitFormInput) => MaybeNestedPromise<SubmitFormResult>;
  saveBeadFormDraft: (input: SaveFormDraftInput) => MaybeNestedPromise<SaveFormDraftResult>;
}; pendingQueueSentinel: PendingQueueSentinel }) {
  const [params] = useSearchParams();
  const workspaceId = params.get('workspace') ?? '';
  const dir = params.get('dir') ?? '';
  const parentDir = params.get('parentDir') ?? '';
  const beadId = params.get('bead') ?? '';
  const formId = params.get('form') ?? undefined;
  const includeOtherWorkspaces = params.get('scope') === 'all';
  const returnTo = params.get('returnTo') ?? '';
  const [loaded, setLoaded] = useState<LoadWorkspaceFormsResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitResult, setSubmitResult] = useState<SubmitFormResult | null>(null);
  const [clipboardResult, setClipboardResult] = useState<ClipboardCopyResult | null>(null);
  const [submittedLocked, setSubmittedLocked] = useState(false);
  const [editingSubmittedResponse, setEditingSubmittedResponse] = useState(false);
  const [rollbackValues, setRollbackValues] = useState<JsonObject | null>(null);
  const [editResponseVersion, setEditResponseVersion] = useState(0);
  const submittedLockedRef = useRef(false);
  const submitInFlightRef = useRef(false);
  const submissionIdRef = useRef<string | null>(null);
  const formHostRef = useRef<HTMLDivElement | null>(null);
  const draftSaveQueueRef = useRef<BeadsFormDraftSaveQueue | null>(null);
  const wizardPositionRef = useRef<BeadsFormWizardPosition | undefined>(undefined);

  React.useEffect(() => {
    submittedLockedRef.current = submittedLocked;
  }, [submittedLocked]);

  React.useEffect(() => () => {
    draftSaveQueueRef.current?.dispose();
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    setLoaded(null);
    setError(null);
    setSubmitResult(null);
    setClipboardResult(null);
    setEditingSubmittedResponse(false);
    setRollbackValues(null);
    setEditResponseVersion(0);
    submittedLockedRef.current = false;
    setSubmittedLocked(false);
    draftSaveQueueRef.current?.cancel();
    draftSaveQueueRef.current?.setBaseUpdatedAt(undefined);
    wizardPositionRef.current = undefined;

    if (!workspaceId && (!dir || !beadId)) {
      return;
    }

    void (async () => {
      try {
        const directResult = async (
          loader: (input: LoadFormsInput) => MaybeNestedPromise<LoadFormsResult>,
        ): Promise<LoadWorkspaceFormsResult> => {
          const selected = await (await loader({
            dir,
            beadId,
            formId,
            ...(workspaceId ? { workspaceId } : {}),
          }));
          return {
            workspaceId,
            workspaceBeads: {
              workspaceId,
              repos: [{
                repo: { id: 'direct', name: dir },
                dir,
                initialized: true,
                beads: [],
                unscopedCount: 0,
                otherWorkspaceCount: 0,
              }],
            },
            selected,
            ...(selected.cache ? { cache: selected.cache } : {}),
          };
        };
        const shouldUseDirectSelectedLoad = !!dir && !!beadId;
        const workspaceInput = {
          workspaceId,
          ...(beadId ? { beadId } : {}),
          ...(formId ? { formId } : {}),
          includeOtherWorkspaces,
        };
        const result = shouldUseDirectSelectedLoad
          ? await directResult(actions.loadBeadForms)
          : await (await actions.loadWorkspaceForms(workspaceInput));
        if (!cancelled) setLoaded(result);
        if (result.cache?.status === 'cached') {
          const fresh = shouldUseDirectSelectedLoad
            ? await directResult(actions.refreshBeadForms)
            : await (await actions.refreshWorkspaceForms(workspaceInput));
          if (!cancelled && shouldHydrateRefreshedWorkspaceForms({
            cached: result,
            fresh,
            submittedLocked: submittedLockedRef.current,
          })) {
            setLoaded(fresh);
          }
        }
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
    return wizardSafeFormHtml(
      loaded.selected.selectedForm,
      sanitizeBeadsFormHtml(rewriteBeadBackedAttachmentRefs(loaded.selected.selectedForm.html, loaded.selected.beadRepoDir)),
      { initialPosition: loaded.selected.selectedDraft?.position },
    );
  }, [loaded?.selected?.beadRepoDir, loaded?.selected?.selectedDraft?.position, loaded?.selected?.selectedForm]);

  const beadDraftScopeKey = useMemo(() => {
    if (!loaded?.selected?.selectedForm || !beadId) return '';
    return beadFormDraftScopeKey({
      ...(workspaceId ? { workspaceId } : {}),
      dir: loaded.selected.beadRepoDir,
      beadId,
      formId: loaded.selected.selectedForm.id,
    });
  }, [beadId, loaded?.selected?.beadRepoDir, loaded?.selected?.selectedForm, workspaceId]);

  React.useEffect(() => {
    wizardPositionRef.current = loaded?.selected?.selectedDraft?.position;
    draftSaveQueueRef.current?.setBaseUpdatedAt(loaded?.selected?.selectedDraft?.updatedAt);
  }, [beadDraftScopeKey, loaded?.selected?.selectedDraft]);

  React.useEffect(() => {
    draftSaveQueueRef.current?.dispose();
    draftSaveQueueRef.current = null;
  }, [beadDraftScopeKey]);

  React.useEffect(() => {
    const form = formHostRef.current?.querySelector('form');
    const selectedForm = loaded?.selected?.selectedForm;
    if (!form || !beadDraftScopeKey || !selectedForm) return;
    const backendValues = latestSubmittedResponseValues(selectedForm.responses);
    const serverDraft = loaded?.selected?.selectedDraft;
    const restoredValues = editingSubmittedResponse
      ? (rollbackValues ?? serverDraft?.values ?? backendValues)
      : (rollbackValues ?? backendValues ?? serverDraft?.values);
    if (restoredValues) {
      applyValuesToForm(form, restoredValues);
    }
    const host = formHostRef.current;
    if (host) {
      initializeCompactMoreInfo(host);
      refreshCompactMoreInfoState(host);
      initializeMarkdownTextareaEditors(host);
      refreshMarkdownTextareaEditors(host);
    }
    const locked = submittedLockedRef.current || (!!backendValues && !editingSubmittedResponse);
    submittedLockedRef.current = locked;
    setSubmittedLocked(locked);
    setSubmitButtonsDisabled(form, locked);
    setFormFieldsReadOnly(form, locked);
  }, [beadDraftScopeKey, editResponseVersion, editingSubmittedResponse, loaded?.selected?.selectedDraft, loaded?.selected?.selectedForm, rollbackValues, selectedHtml]);

  React.useEffect(() => {
    if (loaded?.selected?.selectedForm?.format !== 'standard') return undefined;
    const host = formHostRef.current;
    if (!host) return undefined;
    return initializeSingleQuestionMode(host, { initialPosition: loaded.selected.selectedDraft?.position });
  }, [beadDraftScopeKey, editResponseVersion, loaded?.selected?.selectedDraft?.position, loaded?.selected?.selectedForm?.format, selectedHtml]);

  React.useEffect(() => {
    const host = formHostRef.current;
    if (!host || !loaded?.selected?.selectedForm) return;
    initializeCompactMoreInfo(host);
    refreshCompactMoreInfoState(host);
    initializeMarkdownTextareaEditors(host);
    refreshMarkdownTextareaEditors(host);
  }, [loaded?.selected?.selectedForm, selectedHtml]);

  React.useEffect(() => {
    if (!submitResult || !loaded?.selected?.selectedForm) return;
    preserveSubmittedFormDom(formHostRef.current, submitResult.values, {
      lock: submittedLocked,
      singleQuestionMode: loaded.selected.selectedForm.format === 'standard',
    });
  }, [loaded?.selected?.selectedForm, selectedHtml, submitResult, submittedLocked]);

  const handleBeadDraftChange = () => {
    if (submittedLocked || !beadDraftScopeKey) return;
    const form = formHostRef.current?.querySelector('form');
    if (!form) return;
    const values = formValuesFromDom(form);
    if (!loaded?.selected?.selectedForm || !beadId) return;
    draftSaveQueueRef.current ??= new BeadsFormDraftSaveQueue({
      initialBaseUpdatedAt: loaded.selected.selectedDraft?.updatedAt,
      save: async (payload, baseUpdatedAt) => await (await actions.saveBeadFormDraft({
        dir: loaded.selected!.beadRepoDir,
        beadId,
        formId: loaded.selected!.selectedForm!.id,
        ...(workspaceId ? { workspaceId } : {}),
        values: payload.values,
        ...(payload.position ? { position: payload.position } : {}),
        ...(baseUpdatedAt ? { baseUpdatedAt } : {}),
      })),
      onError: (reason) => {
        setError(reason instanceof Error ? reason.message : String(reason));
      },
    });
    draftSaveQueueRef.current.schedule({
      values,
      ...(wizardPositionRef.current ? { position: wizardPositionRef.current } : {}),
    });
  };

  React.useEffect(() => {
    const host = formHostRef.current;
    if (!host) return undefined;
    const handlePositionChange = (event: Event) => {
      const detail = (event as CustomEvent<{ position?: BeadsFormWizardPosition }>).detail;
      if (detail?.position) {
        wizardPositionRef.current = detail.position;
        handleBeadDraftChange();
      }
    };
    host.addEventListener('beadsform:wizard-position-change', handlePositionChange);
    return () => {
      host.removeEventListener('beadsform:wizard-position-change', handlePositionChange);
    };
  });

  const handleEditBeadResponse = () => {
    submissionIdRef.current = null;
    submittedLockedRef.current = false;
    setSubmittedLocked(false);
    setSubmitResult(null);
    setClipboardResult(null);
    setEditingSubmittedResponse(true);
    setRollbackValues(null);
    setEditResponseVersion((version) => version + 1);
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
    draftSaveQueueRef.current?.cancel();
    submitInFlightRef.current = true;
    setRollbackValues(null);
    setError(null);
    preserveSubmittedFormDom(formHostRef.current, values, {
      lock: true,
      singleQuestionMode: loaded.selected.selectedForm.format === 'standard',
    });
    submittedLockedRef.current = true;
    setSubmittedLocked(true);
    setEditingSubmittedResponse(false);
    const optimisticSubmissionId = submissionIdRef.current ??= createSubmissionId();
    const handoffMetadata = {
      beadId,
      formId: loaded.selected.selectedForm.id,
    };
    setClipboardResult(pendingSubmittedResultHandoffCopy(values, handoffMetadata));
    setSubmitResult({
      beadId,
      formId: loaded.selected.selectedForm.id,
      values,
      submissionId: optimisticSubmissionId,
      submittedAt: '',
      submittedBy: '',
      prettySummary: buildPrettySummary(loaded.selected.selectedForm, values),
      agentMessage: '',
      reviewLabel: 'needs-agent-review',
      warnings: [],
    });
    void copySubmittedResultHandoffXml(navigator.clipboard, values, handoffMetadata).then(setClipboardResult);
    try {
      const result = await (await actions.submitBeadForm({
        dir: loaded.selected.beadRepoDir,
        beadId,
        formId: loaded.selected.selectedForm.id,
        ...(workspaceId ? { workspaceId } : {}),
        values,
        submissionId: optimisticSubmissionId,
      }));
      draftSaveQueueRef.current?.setBaseUpdatedAt(undefined);
      submittedLockedRef.current = true;
      setSubmittedLocked(true);
      setEditingSubmittedResponse(false);
      setSubmitResult((current) => current ? {
        ...current,
        submittedAt: result.submittedAt,
        submittedBy: result.submittedBy,
        prettySummary: result.prettySummary,
        agentMessage: result.agentMessage,
        reviewLabel: result.reviewLabel,
        warnings: result.warnings,
      } : result);
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({ type: 'vk:bead-form-submitted' }, window.location.origin);
      }
      if (returnTo) {
        window.location.assign(returnTo);
      }
    } catch (reason) {
      submittedLockedRef.current = false;
      setSubmittedLocked(false);
      setSubmitResult(null);
      setClipboardResult(null);
      setRollbackValues(values);
      setEditResponseVersion((version) => version + 1);
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      submitInFlightRef.current = false;
    }
  };

  if (!workspaceId && (!dir || !beadId)) {
    return <BeadsFormPendingQueue actions={actions} parentDir={parentDir || undefined} pendingQueueSentinel={pendingQueueSentinel} />;
  }

  if (error && !loaded) {
    return <div className="beadsform-root beadsform-page"><h1>Forms</h1><p role="alert">{error}</p></div>;
  }

  if (!loaded) {
    return (
      <BeadsFormLoadingPage
        title={workspaceId && !dir ? 'Loading workspace forms' : 'Loading bead form'}
        description={workspaceId && !dir ? 'Reading workspace BeadsForm metadata…' : 'Reading this bead-backed form directly…'}
      />
    );
  }

  const selected = loaded.selected;
  const bead = selected?.bead;
  const forms = selected?.forms ?? [];
  const selectedForm = selected?.selectedForm;

  return (
    <div className={`beadsform-root beadsform-page${submitting ? ' is-submitting' : ''}`} aria-busy={submitting}>
      <header>
        {selectedForm ? (
          <div className="beadsform-page-chrome beadsform-page-chrome--compact">
            <div>
              <p className="beadsform-eyebrow">Forms</p>
              {bead ? (
                <details className="beadsform-context-details">
                  <summary>Bead context</summary>
                  <div className="beadsform-context-details-body">
                    <p><strong>{bead.id}</strong>{bead.title ? <>: {bead.title}</> : null}</p>
                    {bead.description ? <p>{bead.description}</p> : null}
                    {selected?.beadRepoDir ? <p>Repo: <code>{selected.beadRepoDir}</code></p> : null}
                  </div>
                </details>
              ) : null}
            </div>
          </div>
        ) : (
          <>
            <p className="beadsform-eyebrow">Forms</p>
            <h1>{bead ? `${bead.id}: ${bead.title ?? 'Untitled bead'}` : 'Workspace forms'}</h1>
            {bead?.description ? <p>{bead.description}</p> : null}
          </>
        )}
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
      ) : selectedForm && submitResult ? (
        <SubmitSuccessSummary
          title="BeadsForm submitted"
          clipboardResult={clipboardResult}
          values={submitResult.values}
          handoffMetadata={{
            beadId,
            formId: submitResult.formId,
            submittedAt: submitResult.submittedAt,
            submittedBy: submitResult.submittedBy,
          }}
          warnings={submitResult.warnings}
          onEdit={handleEditBeadResponse}
        >
          <p>Response for bead <code>{beadId}</code>.</p>
          <h3>Pretty summary</h3>
          <pre>{submitResult.prettySummary}</pre>
        </SubmitSuccessSummary>
      ) : (
        <section>
          <div className="beadsform-form-nav-row">
            {forms.length > 1 ? (
              <a className="beadsform-all-forms-link" href={formViewUrl({ workspaceId, dir: selected.beadRepoDir, beadId, includeOtherWorkspaces })}>All forms</a>
            ) : null}
          </div>
          {submittedLocked && !submitResult ? (
            <div className="beadsform-warning" role="status">
              <p>The visual form is showing the latest submitted response and is locked until you edit it.</p>
              <button type="button" onClick={handleEditBeadResponse}>Edit response</button>
            </div>
          ) : null}
          <div
            key={`bead-form-host:${beadDraftScopeKey}:${editResponseVersion}`}
            ref={formHostRef}
            className="beadsform-form-host"
            aria-hidden={submitting ? true : undefined}
            onInput={handleBeadDraftChange}
            onChange={handleBeadDraftChange}
            onSubmit={handleSubmit}
            dangerouslySetInnerHTML={{ __html: selectedHtml }}
          />
          {submitting ? <SubmittingOverlay /> : null}
        </section>
      )}

      {error ? <p role="alert" className="beadsform-error">{error}</p> : null}
    </div>
  );
}

springboard.registerModule(
  'BeadsForm',
  { rpcMode: 'remote' },
  async (moduleAPI) => {
    const states = await moduleAPI.createStates({
      pendingQueueSentinel: initialPendingQueueSentinel,
    });
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
        return beadsFormReadCache.cachedOrLoad(
          directBeadFormsCacheKey(input),
          () => readBeadFormsFresh(input),
        );
      },
      refreshBeadForms: async (input: LoadFormsInput): Promise<LoadFormsResult> => {
        return beadsFormReadCache.refresh(
          directBeadFormsCacheKey(input),
          () => readBeadFormsFresh(input),
        );
      },
      loadWorkspaceForms: async (input: LoadWorkspaceFormsInput): Promise<LoadWorkspaceFormsResult> => {
        return beadsFormReadCache.cachedOrLoad(
          workspaceBeadFormsCacheKey(input),
          () => readWorkspaceFormsFresh(input),
        );
      },
      refreshWorkspaceForms: async (input: LoadWorkspaceFormsInput): Promise<LoadWorkspaceFormsResult> => {
        return beadsFormReadCache.refresh(
          workspaceBeadFormsCacheKey(input),
          () => readWorkspaceFormsFresh(input),
        );
      },
      loadPendingForms: async (input: LoadPendingFormsInput): Promise<LoadPendingFormsResult> => (
        readPendingFormsCached(input)
      ),
      refreshPendingForms: async (input: LoadPendingFormsInput): Promise<LoadPendingFormsResult> => (
        refreshPendingFormsCached(input)
      ),
      loadAggregateForms: async (input: LoadAggregateFormsInput): Promise<LoadAggregateFormsResult> => (
        readAggregateForms(input)
      ),
      saveBeadFormDraft: async (input: SaveFormDraftInput): Promise<SaveFormDraftResult> => {
        const result = await nodeClient().saveFormDraft(input);
        beadsFormReadCache.invalidateAll();
        return { draft: result.draft };
      },
      submitBeadForm: async (input: SubmitFormInput): Promise<SubmitFormResult> => {
        const result = await nodeClient().submitForm(input);
        beadsFormReadCache.invalidateAll();
        markPendingQueueDirtyForRepo(states.pendingQueueSentinel, input.dir);
        const forms = getBeadsForms(result.metadata);
        const form = forms.find((candidate) => candidate.id === input.formId) ?? { id: input.formId, title: input.formId, html: '' };
        return {
          beadId: input.beadId,
          formId: input.formId,
          submissionId: result.submissionId,
          values: result.values,
          submittedAt: result.submittedAt,
          submittedBy: result.submittedBy,
          prettySummary: result.prettySummary,
          agentMessage: buildAgentResultMessage({
            beadId: input.beadId,
            form,
            values: result.values,
            submittedAt: result.submittedAt,
            submittedBy: result.submittedBy,
          }),
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
      <BeadsFormRoute actions={actions} pendingQueueSentinel={states.pendingQueueSentinel.useState()} />
    ));

    moduleAPI.registerRoute('/dashboard/forms/preview', { hideApplicationShell: true }, () => (
      <BeadsFormPreviewRoute actions={actions} />
    ));

    moduleAPI.registerRoute('/dashboard/forms/aggregate', { hideApplicationShell: true }, () => (
      <BeadsFormAggregateRoute actions={actions} />
    ));

    return { actions, states };
  },
);
