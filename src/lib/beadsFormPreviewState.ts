import { normalizeFormData, type BeadsFormResponse, type JsonObject } from './beadsFormCore';

export type PreviewStorageSnapshot = {
  draft?: JsonObject;
  latest?: JsonObject;
  editing?: boolean;
  history: Array<{ submittedAt: string; values: JsonObject }>;
};

const STORAGE_PREFIX = 'beadsform:preview:v1:';
const BEAD_STORAGE_PREFIX = 'beadsform:bead:v1:';

export function previewStorageKey(args: { folder: string; formId: string }): string {
  return `${STORAGE_PREFIX}${encodeURIComponent(args.folder)}:${encodeURIComponent(args.formId)}`;
}

export function beadFormStorageKey(args: { workspaceId?: string; dir?: string; beadId: string; formId: string }): string {
  const scope = args.workspaceId
    ? `workspace:${args.workspaceId}:dir:${args.dir ?? ''}`
    : `dir:${args.dir ?? ''}`;
  return `${BEAD_STORAGE_PREFIX}${encodeURIComponent(scope)}:${encodeURIComponent(args.beadId)}:${encodeURIComponent(args.formId)}`;
}

export function readPreviewStorage(storage: Storage | undefined, key: string): PreviewStorageSnapshot {
  if (!storage) return { history: [] };
  try {
    const raw = storage.getItem(key);
    if (!raw) return { history: [] };
    const parsed = JSON.parse(raw) as Partial<PreviewStorageSnapshot>;
    return {
      ...(isJsonObject(parsed.draft) ? { draft: parsed.draft } : {}),
      ...(isJsonObject(parsed.latest) ? { latest: parsed.latest } : {}),
      ...(parsed.editing === true ? { editing: true } : {}),
      history: Array.isArray(parsed.history)
        ? parsed.history.filter(isHistoryEntry)
        : [],
    };
  } catch {
    return { history: [] };
  }
}

export function writePreviewDraft(storage: Storage | undefined, key: string, draft: JsonObject): PreviewStorageSnapshot {
  const current = readPreviewStorage(storage, key);
  const next = { ...current, draft, ...(current.latest ? { editing: true } : {}) };
  writePreviewStorage(storage, key, next);
  return next;
}

export function writePreviewSubmission(
  storage: Storage | undefined,
  key: string,
  values: JsonObject,
  submittedAt = new Date().toISOString(),
): PreviewStorageSnapshot {
  const current = readPreviewStorage(storage, key);
  const next: PreviewStorageSnapshot = {
    latest: values,
    draft: values,
    editing: false,
    history: [...current.history, { submittedAt, values }],
  };
  writePreviewStorage(storage, key, next);
  return next;
}

export function latestSubmittedResponseValues(responses: BeadsFormResponse[] | undefined): JsonObject | undefined {
  return responses?.at(-1)?.values;
}

export function clearPreviewStorage(storage: Storage | undefined, key: string): void {
  try {
    storage?.removeItem(key);
  } catch {
    // localStorage can be unavailable; clearing best-effort state should not break the form.
  }
}

export function startPreviewEdit(storage: Storage | undefined, key: string): PreviewStorageSnapshot {
  const current = readPreviewStorage(storage, key);
  const next = { ...current, editing: true };
  writePreviewStorage(storage, key, next);
  return next;
}

function writePreviewStorage(storage: Storage | undefined, key: string, value: PreviewStorageSnapshot): void {
  try {
    storage?.setItem(key, JSON.stringify(value));
  } catch {
    // localStorage can be unavailable/quota-limited; preview still works without persistence.
  }
}

export function formValuesFromDom(form: HTMLFormElement): JsonObject {
  return normalizeFormData(new FormData(form));
}

export function applyValuesToForm(form: HTMLFormElement, values: JsonObject): void {
  for (const element of Array.from(form.elements)) {
    if (!isNamedFormControl(element)) continue;
    const value = values[element.name];
    if (element instanceof HTMLInputElement) {
      if (element.type === 'checkbox' || element.type === 'radio') {
        element.checked = isChoiceSelected(value, element.value);
      } else if (element.type !== 'submit' && element.type !== 'button') {
        element.value = stringifyControlValue(value);
      }
    } else if (element instanceof HTMLTextAreaElement) {
      element.value = stringifyControlValue(value);
    } else if (element instanceof HTMLSelectElement) {
      if (element.multiple && Array.isArray(value)) {
        for (const option of Array.from(element.options)) option.selected = value.map(String).includes(option.value);
      } else {
        element.value = stringifyControlValue(value);
      }
    }
  }
}

export function setSubmitButtonsDisabled(root: ParentNode, disabled: boolean): void {
  for (const button of Array.from(root.querySelectorAll<HTMLButtonElement | HTMLInputElement>('button:not([type]), button[type="submit"], input[type="submit"]'))) {
    button.disabled = disabled;
  }
}

export function setFormFieldsReadOnly(form: HTMLFormElement, readOnly: boolean): void {
  for (const element of Array.from(form.elements)) {
    if (!isNamedFormControl(element)) continue;
    if (element instanceof HTMLInputElement && (element.type === 'submit' || element.type === 'button' || element.type === 'hidden')) {
      continue;
    }
    element.disabled = readOnly;
  }
}

export function stripCompiledFormHeader(html: string): string {
  return html.replace(/(<form\b[^>]*>)\s*<header\b[^>]*>[\s\S]*?<\/header>/i, '$1');
}

function isNamedFormControl(element: Element): element is HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement {
  return (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement)
    && !!element.name;
}

function isChoiceSelected(value: unknown, optionValue: string): boolean {
  if (Array.isArray(value)) return value.map(String).includes(optionValue);
  if (isJsonObject(value)) return value[optionValue] === true;
  return String(value ?? '') === optionValue;
}

function stringifyControlValue(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (Array.isArray(value)) return value.map(String).join(', ');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function isJsonObject(value: unknown): value is JsonObject {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isHistoryEntry(value: unknown): value is { submittedAt: string; values: JsonObject } {
  return isJsonObject(value)
    && typeof value.submittedAt === 'string'
    && isJsonObject(value.values);
}
