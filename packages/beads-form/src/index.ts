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
  /** Preselects this choice while still marking it as an author-provided default in the UI. */
  defaultValue?: boolean;
  /** Marks this choice as recommended and explains why. Preferred over boolean markers so humans get the rationale. */
  is_recommended_reason?: string;
};

export type ChoiceGroupMode = 'any' | 'atMostOne' | 'exactlyOne';

export type ChoiceGroup = {
  id: string;
  title?: string;
  description?: string;
  choiceIds: string[];
  mode: ChoiceGroupMode;
  defaultChoiceId?: string;
};

export type QuestionBase = {
  id: string;
  title: string;
  /** Required by convention so humans know what decision/context the question captures. */
  description: string;
  required?: boolean;
};

export type ChoicesQuestion = QuestionBase & {
  type: 'choices';
  choices: ChoiceQuestionChoice[];
  choiceGroups?: ChoiceGroup[];
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

export type MarkdownAttachmentBlock = {
  type: 'markdown-attachment';
  id: string;
  title: string;
  description?: string;
  ref: string;
  label?: string;
};

export type AttachmentListItem = {
  id: string;
  ref: string;
  label: string;
  description?: string;
  mediaType?: 'markdown' | 'image' | 'video' | 'file';
};

export type AttachmentListBlock = {
  type: 'attachments';
  id: string;
  title: string;
  description?: string;
  items: AttachmentListItem[];
};

export type CodeSnippetRefBlock = {
  type: 'code-snippet';
  id: string;
  title: string;
  description?: string;
  path: string;
  commit: string;
  startLine: number;
  endLine?: number;
  url?: string;
};

export type BeadsFormContentBlock =
  | MediaGalleryBlock
  | MarkdownAttachmentBlock
  | AttachmentListBlock
  | CodeSnippetRefBlock;

export type StandardBeadsForm = {
  format: 'standard';
  id: string;
  /** Short Markdown phrase describing what the form is trying to get from the human. */
  goal: string;
  /** Markdown title. Raw HTML is escaped. */
  title: string;
  /** Markdown context. Raw HTML is escaped and long descriptions are collapsed by default. */
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
};

export type BeadsFormResponse = {
  submittedBy: string;
  submittedAt: string;
  values: Record<string, unknown>;
  prettySummary?: string;
};

export type StoredBeadsForm = StandardBeadsForm & {
  responses?: BeadsFormResponse[];
};

export type CompiledBeadsForm = StandardBeadsForm & {
  html: string;
  controls: BeadsFormControl[];
};

export type BeadsFormMetadata = {
  beadForms: {
    forms: StoredBeadsForm[];
  };
  beadFormResponses?: {
    responsesByFormId: Record<string, BeadsFormResponse[]>;
  };
  beadFormsSummary: BeadsFormsSummary;
};

export type BeadsFormsSummary = {
  hasForms: boolean;
  hasPendingAnswer: boolean;
  pendingResponseCount: number;
  formIds: string[];
  pendingFormIds: string[];
};

const DEFAULT_TEXTAREA_ROWS = 5;
const DEFAULT_CHOICE_NOTES_ROWS = 4;
const DESCRIPTION_TRUNCATE_THRESHOLD = 480;
const DESCRIPTION_PREVIEW_LENGTH = 320;
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
  const blocks: string[] = [];
  const lines = value.replace(/\r\n?/g, '\n').split('\n');
  let paragraph: string[] = [];
  let listItems: string[] = [];
  let codeLines: string[] | null = null;

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    blocks.push(`<p>${renderInlineMarkdown(paragraph.join('\n').trim()).replace(/\n/g, '<br>')}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (listItems.length === 0) return;
    blocks.push(`<ul>${listItems.map((item) => `<li>${renderInlineMarkdown(item)}</li>`).join('')}</ul>`);
    listItems = [];
  };

  for (const line of lines) {
    if (codeLines) {
      if (/^```/.test(line.trim())) {
        blocks.push(`<pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
        codeLines = null;
      } else {
        codeLines.push(line);
      }
      continue;
    }

    if (/^```/.test(line.trim())) {
      flushParagraph();
      flushList();
      codeLines = [];
      continue;
    }

    if (!line.trim()) {
      flushParagraph();
      flushList();
      continue;
    }

    const heading = /^(#{1,5})\s+(.+)$/.exec(line);
    if (heading) {
      flushParagraph();
      flushList();
      const level = Math.min(6, heading[1]!.length + 1);
      blocks.push(`<h${level}>${renderInlineMarkdown(heading[2]!.trim())}</h${level}>`);
      continue;
    }

    const listItem = /^\s*[-*]\s+(.+)$/.exec(line);
    if (listItem) {
      flushParagraph();
      listItems.push(listItem[1]!.trim());
      continue;
    }

    flushList();
    paragraph.push(line);
  }

  if (codeLines) blocks.push(`<pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
  flushParagraph();
  flushList();

  return blocks.join('');
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

export function buildMarkdownAttachment(input: Omit<MarkdownAttachmentBlock, 'type'>): MarkdownAttachmentBlock {
  return { ...input, type: 'markdown-attachment' };
}

export function buildAttachmentList(input: Omit<AttachmentListBlock, 'type'>): AttachmentListBlock {
  return { ...input, type: 'attachments' };
}

export function buildCodeSnippetRef(input: Omit<CodeSnippetRefBlock, 'type'>): CodeSnippetRefBlock {
  return { ...input, type: 'code-snippet' };
}

export function defineBeadsForm(input: Omit<StandardBeadsForm, 'format'>): StandardBeadsForm {
  return { ...input, format: 'standard' };
}

export function compileBeadsForm(form: StandardBeadsForm): CompiledBeadsForm {
  assertIdentifier(form.id, 'form.id');
  if (!form.goal?.trim()) throw new Error('form.goal is required');
  const controls: BeadsFormControl[] = [];
  const description = form.description ? compileFormDescription(form.description) : '';
  const submitActions = compileSubmitActions(form.allowCodeFileChanges, controls);
  const contentBlocks = (form.content ?? []).map(compileContentBlock);
  const sections = form.questions.map((question) => compileQuestion(question, controls));
  const html = [
    '<form>',
    '<header>',
    `<h2>${renderInlineMarkdown(form.title)}</h2>`,
    `<p class="beads-form-goal"><strong>Goal:</strong> ${renderInlineMarkdown(form.goal)}</p>`,
    description,
    '</header>',
    ...contentBlocks,
    ...sections,
    submitActions,
    '</form>',
  ].join('');

  return { ...form, html, controls };
}

export function stripGeneratedBeadsFormFields<T extends StandardBeadsForm & { responses?: BeadsFormResponse[] }>(
  form: T,
): StoredBeadsForm {
  const {
    html: _html,
    controls: _controls,
    sourceMessages: _sourceMessages,
    ...stored
  } = form as T & {
    html?: unknown;
    controls?: unknown;
    sourceMessages?: unknown;
  };
  return stored;
}

function truncateMarkdownText(value: string): string {
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (normalized.length <= DESCRIPTION_PREVIEW_LENGTH) return normalized;
  const candidate = normalized.slice(0, DESCRIPTION_PREVIEW_LENGTH);
  const lastSpace = candidate.lastIndexOf(' ');
  const preview = lastSpace > 240 ? candidate.slice(0, lastSpace) : candidate;
  return `${preview.trim()}…`;
}

function compileFormDescription(description: string): string {
  if (description.trim().length <= DESCRIPTION_TRUNCATE_THRESHOLD) {
    return `<div class="beads-form-description">${renderMarkdown(description)}</div>`;
  }
  return [
    '<div class="beads-form-description beads-form-description--truncated">',
    `<p class="beads-form-description-preview">${renderInlineMarkdown(truncateMarkdownText(description))}</p>`,
    '<details class="beads-form-description-details">',
    '<summary><span class="beads-form-description-toggle-show">Show more</span><span class="beads-form-description-toggle-hide">Show less</span></summary>',
    `<div class="beads-form-description-full">${renderMarkdown(description)}</div>`,
    '</details>',
    '</div>',
  ].join('');
}

export function buildBeadsFormMetadata(forms: StandardBeadsForm[]): BeadsFormMetadata {
  const storedForms = forms.map((form) => {
    compileBeadsForm(form);
    return stripGeneratedBeadsFormFields(form);
  });
  return {
    beadForms: {
      forms: storedForms,
    },
    beadFormsSummary: buildBeadsFormsSummary(storedForms),
  };
}

export function buildBeadsFormsSummary(forms: readonly Pick<StoredBeadsForm, 'id' | 'responses'>[]): BeadsFormsSummary {
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
  if (block.type === 'markdown-attachment') return compileMarkdownAttachment(block);
  if (block.type === 'attachments') return compileAttachmentList(block);
  if (block.type === 'code-snippet') return compileCodeSnippetRef(block);
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

function compileMarkdownAttachment(block: MarkdownAttachmentBlock): string {
  const description = block.description ? renderMarkdown(block.description) : '';
  return [
    `<section id="${attr(block.id)}" class="beads-form-attachment-block beads-form-markdown-attachment" aria-labelledby="${attr(block.id)}_title">`,
    `<h3 id="${attr(block.id)}_title">${escapeHtml(block.title)}</h3>`,
    description,
    `<a class="beads-form-attachment-link" href="${attr(block.ref)}" rel="noopener noreferrer">${escapeHtml(block.label ?? block.ref)}</a>`,
    '</section>',
  ].join('');
}

function compileAttachmentList(block: AttachmentListBlock): string {
  if (block.items.length === 0) throw new Error(`attachment list ${block.id} must have at least one item`);
  const description = block.description ? renderMarkdown(block.description) : '';
  const items = block.items.map((item) => {
    assertIdentifier(item.id, `attachment item id for ${block.id}`);
    return [
      `<li class="beads-form-attachment-item beads-form-attachment-item--${attr(item.mediaType ?? 'file')}">`,
      `<a class="beads-form-attachment-link" href="${attr(item.ref)}" rel="noopener noreferrer">${escapeHtml(item.label)}</a>`,
      item.description ? renderMarkdown(item.description) : '',
      '</li>',
    ].join('');
  }).join('');
  return [
    `<section id="${attr(block.id)}" class="beads-form-attachment-block beads-form-attachment-list" aria-labelledby="${attr(block.id)}_title">`,
    `<h3 id="${attr(block.id)}_title">${escapeHtml(block.title)}</h3>`,
    description,
    `<ul>${items}</ul>`,
    '</section>',
  ].join('');
}

function compileCodeSnippetRef(block: CodeSnippetRefBlock): string {
  validateCodeSnippetRef(block);
  const description = block.description ? renderMarkdown(block.description) : '';
  const lineLabel = block.endLine && block.endLine !== block.startLine
    ? `lines ${block.startLine}-${block.endLine}`
    : `line ${block.startLine}`;
  const source = `${block.path}@${block.commit} ${lineLabel}`;
  const link = block.url && safeHref(block.url)
    ? `<a class="beads-form-code-snippet-link" href="${attr(block.url)}" rel="noopener noreferrer">Open permalink</a>`
    : '';
  return [
    `<section id="${attr(block.id)}" class="beads-form-code-snippet" aria-labelledby="${attr(block.id)}_title">`,
    `<h3 id="${attr(block.id)}_title">${escapeHtml(block.title)}</h3>`,
    description,
    `<p class="beads-form-code-snippet-source"><code>${escapeHtml(block.path)}</code> at <code>${escapeHtml(block.commit)}</code>, ${escapeHtml(lineLabel)}</p>`,
    `<pre><code>${escapeHtml(source)}</code></pre>`,
    link,
    '</section>',
  ].join('');
}

function validateCodeSnippetRef(block: CodeSnippetRefBlock): void {
  if (!block.path.trim()) throw new Error(`code snippet ${block.id} path is required`);
  if (block.path.startsWith('/') || block.path.split(/[\\/]+/).includes('..')) {
    throw new Error(`code snippet ${block.id} path must be repo-relative and must not traverse directories`);
  }
  if (!/^[0-9a-f]{7,64}$/i.test(block.commit)) throw new Error(`code snippet ${block.id} commit must be a 7-64 character hex hash`);
  if (!Number.isInteger(block.startLine) || block.startLine < 1) throw new Error(`code snippet ${block.id} startLine must be a positive integer`);
  if (block.endLine !== undefined && (!Number.isInteger(block.endLine) || block.endLine < block.startLine)) {
    throw new Error(`code snippet ${block.id} endLine must be greater than or equal to startLine`);
  }
}

function compileQuestion(question: BeadsFormQuestion, controls: BeadsFormControl[]): string {
  assertIdentifier(question.id, 'question.id');
  if (question.type === 'choices') return compileChoicesQuestion(question, controls);
  return compileTextQuestion(question, controls);
}

function isGlobalAdditionalNotesQuestion(question: TextQuestion): boolean {
  const normalizedTitle = question.title.trim().toLowerCase();
  return question.id === 'additional_notes'
    || question.id === 'overall_more_info'
    || normalizedTitle === 'additional notes';
}

function compileChoicesQuestion(question: ChoicesQuestion, controls: BeadsFormControl[]): string {
  if (question.choices.length === 0) throw new Error(`choices question ${question.id} must have at least one choice`);
  validateChoiceGroups(question);

  const choiceHtmlById = new Map(question.choices.map((choice) => {
    assertIdentifier(choice.id, `choice.id for ${question.id}`);
    const inputId = `${question.id}_${choice.id}`;
    controls.push({
      id: inputId,
      name: question.id,
      type: 'checkbox',
      required: question.required,
      multiple: true,
    });

    const choiceDescription = choice.description
      ? renderMarkdown(choice.description)
      : '';
    const recommendationReason = choice.is_recommended_reason?.trim();
    const recommended = recommendationReason
      ? '<span class="beads-form-recommended" aria-label="Recommended choice">Recommended</span>'
      : '';
    const defaultBadge = isInitiallyChecked(question, choice)
      ? '<span class="beads-form-default" aria-label="Default selected choice">Default</span>'
      : '';
    const recommendation = recommendationReason
      ? `<p class="beads-form-recommended-reason"><span class="beads-form-recommended-reason-label">Why recommended:</span> ${renderInlineMarkdown(recommendationReason)}</p>`
      : '';
    const choiceNotes = compileNotesTextarea({
      id: choiceNotesName(question.id, choice.id),
      name: choiceNotesName(question.id, choice.id),
      ariaLabel: `More info for ${choice.label}`,
      rows: DEFAULT_CHOICE_NOTES_ROWS,
      controls,
    });

    const html = [
      '<div class="beads-form-choice">',
      `<label for="${attr(inputId)}"><input id="${attr(inputId)}" name="${attr(question.id)}" type="checkbox" value="${attr(choice.id)}"${isInitiallyChecked(question, choice) ? ' checked' : ''}> ${escapeHtml(choice.label)}${defaultBadge ? ` ${defaultBadge}` : ''}${recommended ? ` ${recommended}` : ''}</label>`,
      choiceDescription,
      recommendation,
      choiceNotes,
      '</div>',
    ].join('');
    return [choice.id, html] as const;
  }));

  const groupedChoiceIds = new Set((question.choiceGroups ?? []).flatMap((group) => group.choiceIds));
  const groupHtml = (question.choiceGroups ?? []).map((group) => renderChoiceGroup(question, group, choiceHtmlById)).join('');
  const ungroupedHtml = question.choices
    .filter((choice) => !groupedChoiceIds.has(choice.id))
    .map((choice) => choiceHtmlById.get(choice.id) ?? '')
    .join('');

  const questionNotes = compileNotesTextarea({
    id: notesName(question.id),
    name: notesName(question.id),
    ariaLabel: `More info for ${question.title}`,
    rows: DEFAULT_TEXTAREA_ROWS,
    controls,
  });

  return [
    '<fieldset>',
    `<legend>${escapeHtml(question.title)}</legend>`,
    renderMarkdown(question.description),
    groupHtml,
    ungroupedHtml,
    questionNotes,
    '</fieldset>',
  ].join('');
}

function validateChoiceGroups(question: ChoicesQuestion): void {
  const groups = question.choiceGroups ?? [];
  const choicesById = new Map(question.choices.map((choice) => [choice.id, choice]));
  const groupIds = new Set<string>();
  const groupedChoiceIds = new Set<string>();
  for (const group of groups) {
    assertIdentifier(group.id, `choiceGroups.id for ${question.id}`);
    if (groupIds.has(group.id)) throw new Error(`choice group "${group.id}" is duplicated in ${question.id}`);
    groupIds.add(group.id);
    if (!['any', 'atMostOne', 'exactlyOne'].includes(group.mode)) {
      throw new Error(`choice group "${group.id}" has invalid mode "${String(group.mode)}"`);
    }
    if (group.choiceIds.length === 0) throw new Error(`choice group "${group.id}" must include at least one choice id`);
    const idsInGroup = new Set<string>();
    for (const choiceId of group.choiceIds) {
      if (!choicesById.has(choiceId)) throw new Error(`choice group "${group.id}" references unknown choice id "${choiceId}"`);
      if (idsInGroup.has(choiceId)) throw new Error(`choice group "${group.id}" repeats choice id "${choiceId}"`);
      idsInGroup.add(choiceId);
      if (groupedChoiceIds.has(choiceId)) throw new Error(`choice "${choiceId}" appears in multiple choice groups for ${question.id}`);
      groupedChoiceIds.add(choiceId);
    }
    if (group.defaultChoiceId !== undefined && !idsInGroup.has(group.defaultChoiceId)) {
      throw new Error(`choice group "${group.id}" defaultChoiceId "${group.defaultChoiceId}" must reference a choice in the group`);
    }
    if (group.mode === 'any') continue;
    const defaultTrueChoices = group.choiceIds.filter((choiceId) => choicesById.get(choiceId)?.defaultValue === true);
    if (defaultTrueChoices.length > 1) throw new Error(`choice group "${group.id}" cannot have multiple defaultValue:true choices`);
    if (group.defaultChoiceId && defaultTrueChoices.length === 1 && defaultTrueChoices[0] !== group.defaultChoiceId) {
      throw new Error(`choice group "${group.id}" defaultChoiceId conflicts with defaultValue:true choice "${defaultTrueChoices[0]}"`);
    }
    if (group.mode === 'exactlyOne' && !group.defaultChoiceId && defaultTrueChoices.length !== 1) {
      throw new Error(`choice group "${group.id}" must define defaultChoiceId or exactly one defaultValue:true choice`);
    }
  }
}

function renderChoiceGroup(
  question: ChoicesQuestion,
  group: ChoiceGroup,
  choiceHtmlById: Map<string, string>,
): string {
  const title = group.title?.trim();
  const description = group.description?.trim();
  const titleId = `${question.id}_${group.id}_choice_group_title`;
  const descriptionId = `${question.id}_${group.id}_choice_group_description`;
  const config = escapeHtml(JSON.stringify({
    questionId: question.id,
    id: group.id,
    mode: group.mode,
    choiceIds: group.choiceIds,
    ...(group.defaultChoiceId ? { defaultChoiceId: group.defaultChoiceId } : {}),
  }));
  const accessibility = title
    ? ` role="group" aria-labelledby="${attr(titleId)}"${description ? ` aria-describedby="${attr(descriptionId)}"` : ''}`
    : ` role="group"${description ? ` aria-describedby="${attr(descriptionId)}"` : ''}`;
  return [
    `<div class="beads-form-choice-group beads-form-choice-group--${attr(group.mode)}"${accessibility}>`,
    `<input type="hidden" name="__beadsform_choice_group_${attr(question.id)}_${attr(group.id)}" value="${config}">`,
    title ? `<h4 id="${attr(titleId)}">${escapeHtml(title)}</h4>` : '',
    description ? `<div id="${attr(descriptionId)}">${renderMarkdown(description)}</div>` : '',
    ...group.choiceIds.map((choiceId) => choiceHtmlById.get(choiceId) ?? ''),
    '</div>',
  ].join('');
}

function isInitiallyChecked(question: ChoicesQuestion, choice: ChoiceQuestionChoice): boolean {
  const group = (question.choiceGroups ?? []).find((candidate) => candidate.choiceIds.includes(choice.id));
  if (group?.defaultChoiceId) return group.defaultChoiceId === choice.id;
  return choice.defaultValue === true;
}

function compileTextQuestion(question: TextQuestion, controls: BeadsFormControl[]): string {
  const controlId = question.id;
  controls.push({ id: controlId, name: question.id, type: toControlType(question), required: question.required });
  const input = question.type === 'textarea'
    ? `<textarea id="${attr(controlId)}" name="${attr(question.id)}" rows="${DEFAULT_TEXTAREA_ROWS}"${question.required ? ' required' : ''}${question.placeholder ? ` placeholder="${attr(question.placeholder)}"` : ''}></textarea>`
    : `<input id="${attr(controlId)}" name="${attr(question.id)}" type="text"${question.required ? ' required' : ''}${question.placeholder ? ` placeholder="${attr(question.placeholder)}"` : ''}>`;
  const questionNotes = isGlobalAdditionalNotesQuestion(question)
    ? ''
    : compileNotesTextarea({
      id: notesName(question.id),
      name: notesName(question.id),
      ariaLabel: `More info for ${question.title}`,
      rows: DEFAULT_TEXTAREA_ROWS,
      controls,
    });

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
