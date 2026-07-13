import createDOMPurify from 'dompurify';
import {
  ALLOW_CODE_FILE_CHANGES_FIELD,
  compileBeadsForm,
  type BeadsFormControl,
  type StandardBeadsForm,
} from '@vibe-dashboard/beads-form';

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
  title: string;
  description?: string;
  version?: number;
  html: string;
  controls?: BeadsFormControl[];
  responses?: BeadsFormResponse[];
  sourceMessages?: Array<{ source?: string; submittedAt?: string; text: string }>;
  format?: 'standard';
  questions?: StandardBeadsForm['questions'];
};

export type BeadLike = {
  id: string;
  title?: string;
  description?: string;
  metadata?: JsonObject | null;
};

export type LoadedBeadsForm = {
  bead: BeadLike;
  forms: BeadsFormDefinition[];
  selectedForm?: BeadsFormDefinition;
};

const FORM_META_KEY = 'beadForms';
const LEGACY_FORM_META_KEY = 'beadsWeb';

function isObject(value: unknown): value is JsonObject {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isHtmlForm(value: unknown): value is BeadsFormDefinition {
  return isObject(value)
    && typeof value.id === 'string'
    && value.id.trim().length > 0
    && typeof value.title === 'string'
    && value.title.trim().length > 0
    && typeof value.html === 'string'
    && value.html.trim().length > 0;
}

function isStandardForm(value: unknown): value is StandardBeadsForm {
  return isObject(value)
    && value.format === 'standard'
    && typeof value.id === 'string'
    && value.id.trim().length > 0
    && typeof value.title === 'string'
    && value.title.trim().length > 0
    && Array.isArray(value.questions);
}

function normalizeForm(value: unknown): BeadsFormDefinition | undefined {
  if (isHtmlForm(value)) return value;
  if (!isStandardForm(value)) return undefined;
  return compileBeadsForm(value);
}

function formsAt(metadata: JsonObject, key: string): BeadsFormDefinition[] {
  const namespace = metadata[key];
  if (!isObject(namespace) || !Array.isArray(namespace.forms)) return [];
  return namespace.forms.map(normalizeForm).filter((form): form is BeadsFormDefinition => !!form);
}

export function getBeadsForms(metadata: unknown): BeadsFormDefinition[] {
  if (!isObject(metadata)) return [];
  const current = formsAt(metadata, FORM_META_KEY);
  const legacy = formsAt(metadata, LEGACY_FORM_META_KEY);
  const seen = new Set<string>();
  return [...current, ...legacy].filter((form) => {
    if (seen.has(form.id)) return false;
    seen.add(form.id);
    return true;
  });
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
  const namespace = next[FORM_META_KEY];
  if (!isObject(namespace)) next[FORM_META_KEY] = { forms: [] };
  const beadForms = next[FORM_META_KEY] as JsonObject;
  if (!Array.isArray(beadForms.forms)) beadForms.forms = [];

  let form = (beadForms.forms as unknown[]).find(
    (candidate) => isObject(candidate) && candidate.id === formId,
  ) as JsonObject | undefined;

  if (!form) {
    const legacy = selectBeadsForm(next, formId);
    if (!legacy) throw new Error(`Form not found: ${formId}`);
    form = structuredClone(legacy) as unknown as JsonObject;
    (beadForms.forms as unknown[]).push(form);
  }

  if (!Array.isArray(form.responses)) form.responses = [];
  (form.responses as unknown[]).push(response);
  return next;
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
  form: Pick<BeadsFormDefinition, 'controls'>,
  values: JsonObject,
): JsonObject {
  const next: JsonObject = { ...values };
  if (form.controls?.some((control) => control.name === ALLOW_CODE_FILE_CHANGES_FIELD)) {
    const value = next[ALLOW_CODE_FILE_CHANGES_FIELD];
    next[ALLOW_CODE_FILE_CHANGES_FIELD] = value === true
      || value === 'true'
      || value === 'on'
      || (Array.isArray(value) && value.some((item) => item === true || item === 'true' || item === 'on'));
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
      if (name === 'href' && !(value.startsWith('#') || value.startsWith('/') || value.startsWith('mailto:'))) {
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
  if (lower.startsWith('javascript:') || lower.startsWith('data:') || lower.startsWith('http:') || lower.startsWith('https:') || lower.startsWith('//')) {
    return false;
  }
  return lower.startsWith('/')
    || lower.startsWith('./')
    || lower.startsWith('../')
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
}): string {
  return [
    `Filled out form "${args.form.title}" (${args.form.id}) for bead ${args.beadId}.`,
    '',
    'Normalized response JSON:',
    JSON.stringify(args.values, null, 2),
    '',
    'The bead may have a review label now. Remove that label after processing the form response.',
  ].join('\n');
}

export function validateSubmittedValues(form: BeadsFormDefinition, values: JsonObject): string[] {
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
    if (!namedControls.some((control) => control.required)) continue;
    const value = values[name];
    if (value === undefined || value === '' || (Array.isArray(value) && value.length === 0)) {
      errors.push(`Required field "${name}" is missing`);
    }
  }
  return errors;
}
