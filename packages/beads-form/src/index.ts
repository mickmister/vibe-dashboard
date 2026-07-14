export type BeadsFormControlType =
  | 'checkbox'
  | 'date'
  | 'datetime-local'
  | 'email'
  | 'hidden'
  | 'month'
  | 'number'
  | 'password'
  | 'radio'
  | 'range'
  | 'search'
  | 'select'
  | 'submit'
  | 'tel'
  | 'text'
  | 'textarea'
  | 'time'
  | 'url'
  | 'week';

export type BeadsFormControl = {
  id: string;
  name: string;
  type: BeadsFormControlType;
  required?: boolean;
  multiple?: boolean;
};

export type ChoiceQuestionChoice = {
  id: string;
  label: string;
  description?: string;
  /** Emphasizes the choice as the agent-recommended/default path. */
  recommended?: boolean;
};

export type QuestionBase = {
  id: string;
  title: string;
  /** Required by convention so humans know what decision/context the question captures. */
  description: string;
  required?: boolean;
  includeQuestionNotes?: boolean;
};

export type ChoicesQuestion = QuestionBase & {
  type: 'choices';
  choices: ChoiceQuestionChoice[];
  /** Defaults to true so users can express nuance. False renders radio buttons. */
  allowMultiple?: boolean;
  /** Defaults to true. Adds one textarea under every choice. */
  includePerChoiceNotes?: boolean;
};

export type TextQuestion = QuestionBase & {
  type: 'text' | 'textarea';
  placeholder?: string;
};

export type BeadsFormQuestion = ChoicesQuestion | TextQuestion;

export type MediaGalleryItem = {
  id: string;
  type: 'image' | 'video';
  src: string;
  alt?: string;
  caption?: string;
  poster?: string;
};

export type MediaGalleryBlock = {
  type: 'media-gallery';
  id: string;
  title: string;
  /** Explain what the human should compare or inspect in this gallery. */
  description: string;
  items: MediaGalleryItem[];
};

export type BeadsFormContentBlock = MediaGalleryBlock;

export type StandardBeadsForm = {
  format: 'standard';
  id: string;
  title: string;
  description?: string;
  version?: number;
  /**
   * Code/file-change permission submit actions. Defaults to shown.
   * Set to false to hide them, or pass text overrides to customize display.
   */
  allowCodeFileChanges?: false | {
    allowLabel?: string;
    avoidLabel?: string;
    label?: string;
    description?: string;
    defaultChecked?: boolean;
  };
  content?: BeadsFormContentBlock[];
  questions: BeadsFormQuestion[];
  sourceMessages?: Array<{ source?: string; submittedAt?: string; text: string }>;
};

export type CompiledBeadsForm = StandardBeadsForm & {
  html: string;
  controls: BeadsFormControl[];
};

export type BeadsFormMetadata = {
  beadForms: {
    forms: CompiledBeadsForm[];
  };
};

const DEFAULT_TEXTAREA_ROWS = 5;
const DEFAULT_CHOICE_NOTES_ROWS = 4;
export const ALLOW_CODE_FILE_CHANGES_FIELD = 'allow_code_file_changes';

function assertIdentifier(id: string, label: string): void {
  if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(id)) {
    throw new Error(`${label} must start with a letter and contain only letters, numbers, _ or -: ${id}`);
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function attr(value: string): string {
  return escapeHtml(value);
}

function safeHref(value: string): string | undefined {
  const trimmed = value.trim();
  const lower = trimmed.toLowerCase();
  if (!trimmed) return undefined;
  if (
    lower.startsWith('http://')
    || lower.startsWith('https://')
    || lower.startsWith('mailto:')
    || lower.startsWith('/')
    || lower.startsWith('#')
  ) {
    return trimmed;
  }
  return undefined;
}

function renderInlineMarkdown(input: string): string {
  let html = escapeHtml(input);
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  html = html.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (match, label: string, href: string) => {
    const safe = safeHref(href);
    if (!safe) return label;
    return `<a href="${attr(safe)}" rel="noopener noreferrer">${label}</a>`;
  });
  return html;
}

function renderMarkdown(value: string): string {
  return value
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => `<p>${renderInlineMarkdown(paragraph).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

function notesName(questionId: string): string {
  return `${questionId}_more_info`;
}

function choiceNotesName(questionId: string, choiceId: string): string {
  return `${questionId}_${choiceId}_more_info`;
}

function toControlType(question: TextQuestion): BeadsFormControlType {
  return question.type === 'textarea' ? 'textarea' : 'text';
}

export function buildChoicesQuestion(input: Omit<ChoicesQuestion, 'type'>): ChoicesQuestion {
  return { ...input, type: 'choices' };
}

export function buildTextQuestion(input: Omit<TextQuestion, 'type'>): TextQuestion {
  return { ...input, type: 'text' };
}

export function buildTextareaQuestion(input: Omit<TextQuestion, 'type'>): TextQuestion {
  return { ...input, type: 'textarea' };
}

export function buildMediaGallery(input: Omit<MediaGalleryBlock, 'type'>): MediaGalleryBlock {
  return { ...input, type: 'media-gallery' };
}

export function defineBeadsForm(input: Omit<StandardBeadsForm, 'format'>): StandardBeadsForm {
  return { ...input, format: 'standard' };
}

export function compileBeadsForm(form: StandardBeadsForm): CompiledBeadsForm {
  assertIdentifier(form.id, 'form.id');
  const controls: BeadsFormControl[] = [];
  const description = form.description ? renderMarkdown(form.description) : '';
  const submitActions = compileSubmitActions(form.allowCodeFileChanges, controls);
  const contentBlocks = (form.content ?? []).map(compileContentBlock);
  const sections = form.questions.map((question) => compileQuestion(question, controls));
  const html = [
    '<form>',
    '<header>',
    `<h2>${escapeHtml(form.title)}</h2>`,
    description,
    '</header>',
    ...contentBlocks,
    ...sections,
    submitActions,
    '</form>',
  ].join('');

  return { ...form, html, controls };
}

export function buildBeadsFormMetadata(forms: StandardBeadsForm[]): BeadsFormMetadata {
  return {
    beadForms: {
      forms: forms.map(compileBeadsForm),
    },
  };
}

function compileSubmitActions(
  config: StandardBeadsForm['allowCodeFileChanges'],
  controls: BeadsFormControl[],
): string {
  if (config === false) return '<button type="submit">Submit</button>';
  const allowLabel = config?.allowLabel ?? config?.label ?? 'Submit and allow code/file changes';
  const avoidLabel = config?.avoidLabel ?? 'Submit and avoid code/file changes';
  const description = config?.description
    ?? 'Choose whether agents may edit code/files after receiving this response.';
  controls.push({
    id: ALLOW_CODE_FILE_CHANGES_FIELD,
    name: ALLOW_CODE_FILE_CHANGES_FIELD,
    type: 'submit',
  });

  return [
    '<div class="beads-form-submit-actions" role="group" aria-label="Submit intent">',
    renderMarkdown(description),
    `<button id="${ALLOW_CODE_FILE_CHANGES_FIELD}_true" name="${ALLOW_CODE_FILE_CHANGES_FIELD}" type="submit" value="true">${escapeHtml(allowLabel)}</button>`,
    `<button id="${ALLOW_CODE_FILE_CHANGES_FIELD}_false" name="${ALLOW_CODE_FILE_CHANGES_FIELD}" type="submit" value="false">${escapeHtml(avoidLabel)}</button>`,
    '</div>',
  ].join('');
}

function compileContentBlock(block: BeadsFormContentBlock): string {
  assertIdentifier(block.id, 'content.id');
  if (block.type === 'media-gallery') return compileMediaGallery(block);
  return '';
}

function compileMediaGallery(block: MediaGalleryBlock): string {
  if (block.items.length === 0) throw new Error(`media gallery ${block.id} must have at least one item`);
  const items = block.items.map((item) => {
    assertIdentifier(item.id, `media item id for ${block.id}`);
    const media = item.type === 'image'
      ? `<img src="${attr(item.src)}" alt="${attr(item.alt ?? item.caption ?? item.id)}">`
      : `<video src="${attr(item.src)}"${item.poster ? ` poster="${attr(item.poster)}"` : ''} controls preload="metadata">${escapeHtml(item.alt ?? item.caption ?? item.id)}</video>`;
    const caption = item.caption ? `<figcaption>${escapeHtml(item.caption)}</figcaption>` : '';
    return [
      '<figure class="beads-form-media-item">',
      media,
      caption,
      '</figure>',
    ].join('');
  }).join('');

  return [
    `<section id="${attr(block.id)}" class="beads-form-media-gallery" aria-labelledby="${attr(block.id)}_title">`,
    `<h3 id="${attr(block.id)}_title">${escapeHtml(block.title)}</h3>`,
    renderMarkdown(block.description),
    '<div class="beads-form-media-grid">',
    items,
    '</div>',
    '</section>',
  ].join('');
}

function compileQuestion(question: BeadsFormQuestion, controls: BeadsFormControl[]): string {
  assertIdentifier(question.id, 'question.id');
  if (question.type === 'choices') return compileChoicesQuestion(question, controls);
  return compileTextQuestion(question, controls);
}

function compileChoicesQuestion(question: ChoicesQuestion, controls: BeadsFormControl[]): string {
  if (question.choices.length === 0) throw new Error(`choices question ${question.id} must have at least one choice`);
  const allowMultiple = question.allowMultiple ?? true;
  const includePerChoiceNotes = question.includePerChoiceNotes ?? true;
  const includeQuestionNotes = question.includeQuestionNotes ?? true;
  const inputType = allowMultiple ? 'checkbox' : 'radio';

  const choiceHtml = question.choices.map((choice) => {
    assertIdentifier(choice.id, `choice.id for ${question.id}`);
    const inputId = `${question.id}_${choice.id}`;
    controls.push({
      id: inputId,
      name: question.id,
      type: inputType,
      required: question.required,
      multiple: allowMultiple,
    });

    const choiceDescription = choice.description
      ? renderMarkdown(choice.description)
      : '';
    const recommended = choice.recommended
      ? '<span class="beads-form-recommended" aria-label="Recommended choice">Recommended</span>'
      : '';
    const choiceNotes = includePerChoiceNotes
      ? compileNotesTextarea({
        id: choiceNotesName(question.id, choice.id),
        name: choiceNotesName(question.id, choice.id),
        ariaLabel: `More info for ${choice.label}`,
        rows: DEFAULT_CHOICE_NOTES_ROWS,
        controls,
      })
      : '';

    return [
      '<div class="beads-form-choice">',
      `<label for="${attr(inputId)}"><input id="${attr(inputId)}" name="${attr(question.id)}" type="${inputType}" value="${attr(choice.id)}"${question.required && !allowMultiple ? ' required' : ''}> ${escapeHtml(choice.label)}${recommended ? ` ${recommended}` : ''}</label>`,
      choiceDescription,
      choiceNotes,
      '</div>',
    ].join('');
  }).join('');

  const questionNotes = includeQuestionNotes
    ? compileNotesTextarea({
      id: notesName(question.id),
      name: notesName(question.id),
      ariaLabel: `More info for ${question.title}`,
      rows: DEFAULT_TEXTAREA_ROWS,
      controls,
    })
    : '';

  return [
    '<fieldset>',
    `<legend>${escapeHtml(question.title)}</legend>`,
    renderMarkdown(question.description),
    choiceHtml,
    questionNotes,
    '</fieldset>',
  ].join('');
}

function compileTextQuestion(question: TextQuestion, controls: BeadsFormControl[]): string {
  const includeQuestionNotes = question.includeQuestionNotes ?? true;
  const controlId = question.id;
  controls.push({ id: controlId, name: question.id, type: toControlType(question), required: question.required });
  const input = question.type === 'textarea'
    ? `<textarea id="${attr(controlId)}" name="${attr(question.id)}" rows="${DEFAULT_TEXTAREA_ROWS}"${question.required ? ' required' : ''}${question.placeholder ? ` placeholder="${attr(question.placeholder)}"` : ''}></textarea>`
    : `<input id="${attr(controlId)}" name="${attr(question.id)}" type="text"${question.required ? ' required' : ''}${question.placeholder ? ` placeholder="${attr(question.placeholder)}"` : ''}>`;
  const questionNotes = includeQuestionNotes
    ? compileNotesTextarea({
      id: notesName(question.id),
      name: notesName(question.id),
      ariaLabel: `More info for ${question.title}`,
      rows: DEFAULT_TEXTAREA_ROWS,
      controls,
    })
    : '';

  return [
    '<fieldset>',
    `<legend>${escapeHtml(question.title)}</legend>`,
    renderMarkdown(question.description),
    `<label for="${attr(controlId)}">${escapeHtml(question.title)}</label>`,
    input,
    questionNotes,
    '</fieldset>',
  ].join('');
}

function compileNotesTextarea(args: {
  id: string;
  name: string;
  ariaLabel: string;
  rows: number;
  controls: BeadsFormControl[];
}): string {
  args.controls.push({ id: args.id, name: args.name, type: 'textarea' });
  return `<textarea id="${attr(args.id)}" name="${attr(args.name)}" rows="${args.rows}" aria-label="${attr(args.ariaLabel)}" placeholder="Optional context"></textarea>`;
}
