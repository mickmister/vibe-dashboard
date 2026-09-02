import createDOMPurify from 'dompurify';
import {
  ALLOW_CODE_FILE_CHANGES_FIELD,
  compileBeadsForm,
  stripGeneratedBeadsFormFields,
  type BeadsFormControl,
  type ChoicesQuestion,
  type StandardBeadsForm,
  type StoredBeadsForm,
} from '../../packages/beads-form/src/index.ts';
import { beadsFormSubmissionXml } from './beadsFormSubmissionHandoff.ts';

export { ALLOW_CODE_FILE_CHANGES_FIELD };

export type JsonObject = Record<string, unknown>;

export type BeadsFormResponse = {
  submittedBy: string;
  submittedAt: string;
  values: JsonObject;
  prettySummary?: string;
};

export type BeadsFormDefinition = {
  id: string;
  goal: string;
  title: string;
  description?: string;
  version?: number;
  html: string;
  controls?: BeadsFormControl[];
  responses?: BeadsFormResponse[];
  format: 'standard';
  questions: StandardBeadsForm['questions'];
  content?: StandardBeadsForm['content'];
};

export type BeadsFormsSummary = {
  hasForms: boolean;
  hasPendingAnswer: boolean;
  pendingResponseCount: number;
  formIds: string[];
  pendingFormIds: string[];
};

export type BeadLike = {
  id: string;
  title?: string;
  description?: string;
  status?: string;
  createdAt?: string;
  updatedAt?: string;
  created_at?: string;
  updated_at?: string;
  metadata?: JsonObject | null;
};

export type LoadedBeadsForm = {
  bead: BeadLike;
  forms: BeadsFormDefinition[];
  selectedForm?: BeadsFormDefinition;
};

const FORM_META_KEY = 'beadForms';
const LEGACY_FORM_META_KEY = 'beadsWeb';
const FORM_RESPONSES_META_KEY = 'beadFormResponses';
const FORM_SUMMARY_META_KEY = 'beadFormsSummary';
export const BEAD_ISSUE_METADATA_JSON_MAX_BYTES = 16 * 1024 * 1024;

function isObject(value: unknown): value is JsonObject {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isHtmlForm(value: unknown): value is JsonObject & { id: string; title: string; html: string } {
  return isObject(value)
    && typeof value.id === 'string'
    && value.id.trim().length > 0
    && typeof value.title === 'string'
    && value.title.trim().length > 0
    && typeof value.html === 'string'
    && value.html.trim().length > 0;
}

function isStandardForm(value: unknown): value is StoredBeadsForm {
  return isObject(value)
    && value.format === 'standard'
    && typeof value.id === 'string'
    && value.id.trim().length > 0
    && typeof value.title === 'string'
    && value.title.trim().length > 0
    && Array.isArray(value.questions);
}

function withLegacyFallbackGoal(form: StoredBeadsForm): StoredBeadsForm {
  if (typeof form.goal === 'string' && form.goal.trim().length > 0) return form;
  return {
    ...form,
    goal: `Answer ${form.title}.`,
  };
}

function normalizeForm(value: unknown): BeadsFormDefinition | undefined {
  if (isHtmlForm(value) && !isStandardForm(value)) {
    throw new Error('Raw HTML BeadsForms are no longer supported; express the form with the standard BeadsForm DSL.');
  }
  if (!isStandardForm(value)) return undefined;
  const stored = stripGeneratedBeadsFormFields(withLegacyFallbackGoal(value));
  const compiled = compileBeadsForm(stored);
  return {
    ...compiled,
    ...(stored.responses ? { responses: stored.responses } : {}),
  };
}

function isBeadsFormResponse(value: unknown): value is BeadsFormResponse {
  return isObject(value)
    && typeof value.submittedBy === 'string'
    && typeof value.submittedAt === 'string'
    && isObject(value.values);
}

function getSplitResponsesByFormId(metadata: JsonObject): Map<string, BeadsFormResponse[]> {
  const responsesByFormId = new Map<string, BeadsFormResponse[]>();
  const namespace = metadata[FORM_RESPONSES_META_KEY];
  if (!isObject(namespace) || !isObject(namespace.responsesByFormId)) return responsesByFormId;
  for (const [formId, responses] of Object.entries(namespace.responsesByFormId)) {
    if (Array.isArray(responses) && responses.every(isBeadsFormResponse)) {
      responsesByFormId.set(formId, responses);
    }
  }
  return responsesByFormId;
}

function applySplitResponses(
  metadata: JsonObject,
  forms: BeadsFormDefinition[],
): BeadsFormDefinition[] {
  const splitResponses = getSplitResponsesByFormId(metadata);
  return forms.map((form) => {
    const responses = splitResponses.get(form.id) ?? form.responses;
    if (!responses) return form;
    return { ...form, responses };
  });
}

function stripResponsesFromStoredForm(form: BeadsFormDefinition): StoredBeadsForm {
  const { responses: _responses, ...stored } = stripGeneratedBeadsFormFields(form as StoredBeadsForm) as BeadsFormDefinition;
  return stored as StoredBeadsForm;
}

function writeSplitResponses(next: JsonObject, forms: BeadsFormDefinition[]): void {
  const responsesByFormId: Record<string, BeadsFormResponse[]> = {};
  for (const form of forms) {
    if ((form.responses?.length ?? 0) > 0) {
      responsesByFormId[form.id] = form.responses!;
    }
  }
  if (Object.keys(responsesByFormId).length > 0) {
    next[FORM_RESPONSES_META_KEY] = { responsesByFormId };
  } else {
    delete next[FORM_RESPONSES_META_KEY];
  }
}

function formsAt(metadata: JsonObject, key: string, options: { skipUnsupported?: boolean } = {}): BeadsFormDefinition[] {
  const namespace = metadata[key];
  if (!isObject(namespace) || !Array.isArray(namespace.forms)) return [];
  const forms: BeadsFormDefinition[] = [];
  for (const candidate of namespace.forms) {
    try {
      const form = normalizeForm(candidate);
      if (form) forms.push(form);
    } catch (error) {
      if (!options.skipUnsupported) throw error;
    }
  }
  return forms;
}

export function getBeadsForms(metadata: unknown): BeadsFormDefinition[] {
  if (!isObject(metadata)) return [];
  const current = formsAt(metadata, FORM_META_KEY);
  const legacy = formsAt(metadata, LEGACY_FORM_META_KEY);
  const seen = new Set<string>();
  const forms = [...current, ...legacy].filter((form) => {
    if (seen.has(form.id)) return false;
    seen.add(form.id);
    return true;
  });
  return applySplitResponses(metadata, forms);
}

export function getSupportedBeadsForms(metadata: unknown): BeadsFormDefinition[] {
  if (!isObject(metadata)) return [];
  const current = formsAt(metadata, FORM_META_KEY, { skipUnsupported: true });
  const seen = new Set<string>();
  const forms = current.filter((form) => {
    if (seen.has(form.id)) return false;
    seen.add(form.id);
    return true;
  });
  return applySplitResponses(metadata, forms);
}

export function selectBeadsForm(metadata: unknown, formId?: string): BeadsFormDefinition | undefined {
  const forms = getBeadsForms(metadata);
  if (!formId) return forms[0];
  return forms.find((form) => form.id === formId);
}

export function appendBeadsFormResponse(
  metadata: unknown,
  formId: string,
  response: BeadsFormResponse,
): JsonObject {
  const next: JsonObject = isObject(metadata) ? structuredClone(metadata) as JsonObject : {};
  const namespace = isObject(next[FORM_META_KEY]) ? next[FORM_META_KEY] as JsonObject : { forms: [] };
  const forms = getBeadsForms(next);
  const formIndex = forms.findIndex((candidate) => candidate.id === formId);
  if (formIndex < 0) throw new Error(`Form not found: ${formId}`);

  const updatedForms = forms.map((form, index) => {
    if (index !== formIndex) return form;
    return {
      ...form,
      responses: [...(form.responses ?? []), response],
    };
  });
  next[FORM_META_KEY] = {
    ...namespace,
    forms: updatedForms.map(stripResponsesFromStoredForm),
  };
  writeSplitResponses(next, updatedForms);
  return withBeadsFormsSummary(next);
}

export function buildBeadsFormsSummary(forms: readonly Pick<BeadsFormDefinition, 'id' | 'responses'>[]): BeadsFormsSummary {
  const formIds = forms.map((form) => form.id);
  const pendingFormIds = forms
    .filter((form) => (form.responses?.length ?? 0) === 0)
    .map((form) => form.id);
  return {
    hasForms: formIds.length > 0,
    hasPendingAnswer: pendingFormIds.length > 0,
    pendingResponseCount: pendingFormIds.length,
    formIds,
    pendingFormIds,
  };
}

export function withBeadsFormsSummary(metadata: unknown): JsonObject {
  const next: JsonObject = isObject(metadata) ? structuredClone(metadata) as JsonObject : {};
  next[FORM_SUMMARY_META_KEY] = buildBeadsFormsSummary(getBeadsForms(next));
  return next;
}

export function metadataJsonByteLength(metadata: unknown): number {
  return new TextEncoder().encode(JSON.stringify(metadata)).byteLength;
}

export function assertMetadataWithinIssueJsonGuard(
  metadata: unknown,
  maxBytes = BEAD_ISSUE_METADATA_JSON_MAX_BYTES,
): void {
  const bytes = metadataJsonByteLength(metadata);
  if (bytes > maxBytes) {
    throw new Error(
      `Bead JSON metadata is too large for the configured BeadsForm performance guard (${bytes} bytes > ${maxBytes} bytes). `
      + 'No bead metadata was changed. Bead issue metadata is stored in the Dolt issues.metadata JSON column, not the global metadata.value TEXT table; reduce form/response payload size or raise the app guard before retrying.',
    );
  }
}

export function normalizeFormEntries(entries: Iterable<[string, FormDataEntryValue]>): JsonObject {
  const values: JsonObject = {};
  for (const [key, value] of entries) {
    if (!key || key.startsWith('__beadsform_')) continue;
    const normalized = typeof File !== 'undefined' && value instanceof File ? value.name : String(value);
    const existing = values[key];
    if (existing === undefined) {
      values[key] = normalized;
    } else if (Array.isArray(existing)) {
      existing.push(normalized);
    } else {
      values[key] = [existing, normalized];
    }
  }
  return values;
}

export function normalizeFormData(formData: FormData): JsonObject {
  return normalizeFormEntries(formData.entries());
}

export function normalizeSubmittedValues(
  form: { controls?: BeadsFormControl[]; questions?: StandardBeadsForm['questions'] },
  values: JsonObject,
): JsonObject {
  const next: JsonObject = {};
  for (const [key, value] of Object.entries(values)) {
    if (value === '') continue;
    if (Array.isArray(value) && value.length === 0) continue;
    next[key] = value;
  }

  for (const question of form.questions ?? []) {
    if (question.type !== 'choices') continue;
    next[question.id] = normalizeChoiceQuestionValue(question, next[question.id]);
  }

  if (form.controls?.some((control) => control.name === ALLOW_CODE_FILE_CHANGES_FIELD)) {
    const value = next[ALLOW_CODE_FILE_CHANGES_FIELD];
    next[ALLOW_CODE_FILE_CHANGES_FIELD] = value === true
      || value === 'true'
      || value === 'on'
      || (Array.isArray(value) && value.some((item) => item === true || item === 'true' || item === 'on'));
  }
  return next;
}

function normalizeChoiceQuestionValue(question: ChoicesQuestion, value: unknown): Record<string, boolean> {
  const selectedValues = new Set<string>();
  if (Array.isArray(value)) {
    for (const item of value) selectedValues.add(String(item));
  } else if (isObject(value)) {
    for (const [key, selected] of Object.entries(value)) {
      if (selected === true) selectedValues.add(key);
    }
  } else if (value !== undefined && value !== '') {
    selectedValues.add(String(value));
  }

  const next = Object.fromEntries(
    question.choices.map((choice) => [choice.id, selectedValues.has(choice.id)]),
  );
  for (const group of question.choiceGroups ?? []) {
    if (group.mode === 'any') continue;
    const selectedInGroup = group.choiceIds.filter((choiceId) => next[choiceId] === true);
    if (selectedInGroup.length > 1) {
      for (const choiceId of selectedInGroup.slice(1)) next[choiceId] = false;
    }
    if (group.mode === 'exactlyOne' && selectedInGroup.length === 0) {
      const fallback = group.defaultChoiceId
        ?? group.choiceIds.find((choiceId) => question.choices.find((choice) => choice.id === choiceId)?.defaultValue === true)
        ?? group.choiceIds[0];
      if (fallback) next[fallback] = true;
    }
  }
  return next;
}

const ALLOWED_TAGS = [
  'a', 'abbr', 'blockquote', 'br', 'button', 'caption', 'code', 'col', 'colgroup',
  'dd', 'del', 'details', 'dfn', 'div', 'dl', 'dt', 'em', 'fieldset', 'figcaption',
  'figure', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'img', 'input', 'ins', 'kbd', 'label', 'legend', 'li',
  'mark', 'ol', 'optgroup', 'option', 'output', 'p', 'pre', 's', 'samp', 'section',
  'select', 'small', 'span', 'strong', 'sub', 'summary', 'sup', 'table', 'tbody', 'td',
  'textarea', 'tfoot', 'th', 'thead', 'tr', 'u', 'ul', 'var', 'video',
];

const ALLOWED_ATTR = [
  'accept', 'aria-describedby', 'aria-label', 'aria-labelledby', 'aria-required',
  'alt', 'autocomplete', 'checked', 'class', 'cols', 'colspan', 'controls', 'dir', 'disabled', 'for',
  'headers', 'href', 'id', 'label', 'lang', 'max', 'maxlength', 'method', 'min',
  'minlength', 'multiple', 'name', 'pattern', 'placeholder', 'readonly', 'rel',
  'poster', 'preload', 'required', 'role', 'rows', 'rowspan', 'scope', 'selected', 'size', 'span', 'src', 'step',
  'target', 'title', 'type', 'value',
];

function getWindowForPurify(): Window {
  if (typeof window !== 'undefined') return window;
  throw new Error('sanitizeBeadsFormHtml requires a DOM window');
}

export function sanitizeBeadsFormHtml(html: string): string {
  const purifier = createDOMPurify(getWindowForPurify() as unknown as Parameters<typeof createDOMPurify>[0]);
  const sanitized = purifier.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOWED_URI_REGEXP: /^(?!\s*(?:javascript|data):)/i,
    ALLOW_DATA_ATTR: false,
    FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'link', 'meta', 'audio', 'source'],
  });

  const parsed = new DOMParser().parseFromString(sanitized, 'text/html');
  for (const element of Array.from(parsed.body.querySelectorAll('*'))) {
    for (const attr of Array.from(element.attributes)) {
      const name = attr.name.toLowerCase();
      const value = attr.value.trim().toLowerCase();
      if (name.startsWith('on')) element.removeAttribute(attr.name);
      if (name === 'href' && !(value.startsWith('#') || value.startsWith('/') || value.startsWith('mailto:') || value.startsWith('http://') || value.startsWith('https://'))) {
        element.removeAttribute(attr.name);
      }
      if ((name === 'src' || name === 'poster') && !isSafeMediaReference(attr.value)) {
        element.removeAttribute(attr.name);
      }
    }

    if (element.tagName.toLowerCase() === 'form') {
      element.setAttribute('method', 'post');
      element.removeAttribute('action');
    }
  }

  return parsed.body.innerHTML;
}

function isSafeMediaReference(value: string): boolean {
  const trimmed = value.trim();
  const lower = trimmed.toLowerCase();
  if (!trimmed) return false;
  if (lower.startsWith('javascript:') || lower.startsWith('data:') || lower.startsWith('//')) {
    return false;
  }
  return lower.startsWith('/')
    || lower.startsWith('./')
    || lower.startsWith('../')
    || lower.startsWith('http://')
    || lower.startsWith('https://')
    || lower.startsWith('attachment://')
    || !/^[a-z][a-z0-9+.-]*:/i.test(trimmed);
}

export function buildPrettySummary(form: Pick<BeadsFormDefinition, 'title'>, values: JsonObject): string {
  const lines = [`${form.title} response`, ''];
  for (const [key, value] of Object.entries(values)) {
    if (value === '') continue;
    lines.push(`- ${key}: ${Array.isArray(value) ? value.join(', ') : String(value)}`);
  }
  return lines.join('\n').trim();
}

export function buildAgentResultMessage(args: {
  beadId: string;
  form: Pick<BeadsFormDefinition, 'id' | 'title'>;
  values: JsonObject;
  submittedAt?: string;
  submittedBy?: string;
}): string {
  return [
    `Filled out form "${args.form.title}" (${args.form.id}) for bead ${args.beadId}.`,
    '',
    'BeadsForm XML handoff:',
    beadsFormSubmissionXml({
      beadId: args.beadId,
      formId: args.form.id,
      ...(args.submittedAt ? { submittedAt: args.submittedAt } : {}),
      ...(args.submittedBy ? { submittedBy: args.submittedBy } : {}),
      values: args.values,
    }),
    '',
    'The bead may have a review label now. Remove that label after processing the form response.',
  ].join('\n');
}

export function validateSubmittedValues(
  form: { id?: string; title?: string; html?: string; controls?: BeadsFormControl[] },
  values: JsonObject,
): string[] {
  const controls = form.controls ?? [];
  if (controls.length === 0) return [];

  const controlsByName = new Map<string, BeadsFormControl[]>();
  for (const control of controls) {
    const existing = controlsByName.get(control.name) ?? [];
    existing.push(control);
    controlsByName.set(control.name, existing);
  }

  const allowedNames = new Set(controlsByName.keys());
  const errors: string[] = [];
  for (const key of Object.keys(values)) {
    if (!allowedNames.has(key)) errors.push(`Submitted field "${key}" is not declared in controls[]`);
  }

  for (const [name, namedControls] of controlsByName) {
    const requiredControls = namedControls.filter((control) => control.required);
    if (requiredControls.length === 0) continue;
    const value = values[name];
    if (!hasSubmittedValue(value, requiredControls)) {
      errors.push(`Required field "${name}" is missing`);
    }
  }
  return errors;
}

function hasSubmittedValue(value: unknown, controls: BeadsFormControl[]): boolean {
  if (value === undefined || value === '') return false;
  if (Array.isArray(value)) return value.length > 0;
  if (isObject(value) && controls.some((control) => control.type === 'checkbox' || control.type === 'radio')) {
    return Object.values(value).some((selected) => selected === true);
  }
  return true;
}
