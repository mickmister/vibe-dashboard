import { initializeChoiceGroups } from './beadsFormChoiceGroups';

export type SingleQuestionModeCleanup = () => void;

const WIZARD_QUESTION_PARAM = 'formQuestion';
const WIZARD_REVIEW_PARAM = 'formReview';
let progressIdSequence = 0;

export function prehideInactiveSingleQuestionItems(
  html: string,
  options: { urlState?: boolean } = {},
): string {
  if (typeof window === 'undefined' || typeof DOMParser === 'undefined') return html;
  const document = new DOMParser().parseFromString(html, 'text/html');
  const form = document.body.querySelector('form');
  if (!form) return html;
  const fieldsets = Array.from(form.children).filter((child): child is HTMLFieldSetElement => (
    child instanceof HTMLFieldSetElement
  ));
  const masterNotes = fieldsets.find(isMasterNotesFieldset);
  const questions = fieldsets.filter((fieldset) => fieldset !== masterNotes);
  if (questions.length <= 1) return html;

  const activeIndex = (options.urlState ?? true) ? (initialQuestionIndexFromUrl(questions.length) ?? 0) : 0;
  questions.forEach((question, index) => {
    question.hidden = index !== activeIndex;
  });
  const submitActions = form.querySelector<HTMLElement>('.beads-form-submit-actions');
  if (submitActions) {
    submitActions.hidden = true;
  }
  return document.body.innerHTML;
}

export function refreshSingleQuestionAdditionalNotes(host: ParentNode): void {
  for (const masterNotes of Array.from(host.querySelectorAll<HTMLFieldSetElement>('[data-beadsform-master-notes="true"]'))) {
    const panel = masterNotes.closest<HTMLElement>('.beadsform-single-question-notes');
    const toggle = panel?.querySelector<HTMLButtonElement>('.beadsform-single-question-notes-toggle');
    if (!toggle) continue;
    const hasValue = Array.from(masterNotes.querySelectorAll<HTMLTextAreaElement>('textarea'))
      .some((textarea) => textarea.value.trim().length > 0);
    if (hasValue) {
      masterNotes.hidden = false;
      masterNotes.removeAttribute('hidden');
      toggle.textContent = 'Hide notes';
      toggle.setAttribute('aria-expanded', 'true');
      toggle.setAttribute('aria-label', 'Hide global Additional Notes');
    }
    toggle.classList.toggle('has-value', hasValue);
  }
}

export function initializeSingleQuestionMode(host: ParentNode, options: { urlState?: boolean } = {}): SingleQuestionModeCleanup {
  const form = host.querySelector('form');
  if (!form || form.dataset.beadsformSingleQuestion === 'true') return () => undefined;
  const choiceGroupsCleanup = initializeChoiceGroups(host);
  const useUrlState = options.urlState ?? true;

  const fieldsets = Array.from(form.children).filter((child): child is HTMLFieldSetElement => (
    child instanceof HTMLFieldSetElement
  ));
  const masterNotes = fieldsets.find(isMasterNotesFieldset);
  const questions = fieldsets.filter((fieldset) => fieldset !== masterNotes);
  if (questions.length <= 1) return choiceGroupsCleanup;

  form.dataset.beadsformSingleQuestion = 'true';
  form.classList.add('beadsform-single-question-form');

  const firstQuestion = questions[0]!;
  const layout = document.createElement('div');
  layout.className = 'beadsform-single-question-layout';

  const questionList = document.createElement('nav');
  questionList.className = 'beadsform-single-question-list';
  questionList.setAttribute('aria-label', 'Questions');

  const main = document.createElement('div');
  main.className = 'beadsform-single-question-main';

  const progress = document.createElement('p');
  progress.id = `beadsform-single-question-progress-${progressIdSequence += 1}`;
  progress.className = 'beadsform-single-question-progress';
  progress.setAttribute('aria-live', 'polite');

  const progressToggle = button('Show progress');
  progressToggle.className = 'beadsform-single-question-progress-toggle';
  progressToggle.setAttribute('aria-controls', progress.id);
  progressToggle.setAttribute('aria-expanded', 'false');
  progressToggle.hidden = true;

  const topControls = navigationControls('top');
  const bottomControls = navigationControls('bottom');
  const previousButtons = [topControls.previous, bottomControls.previous];
  const nextButtons = [topControls.next, bottomControls.next];
  const reviewIndex = questions.length;

  const notesPanel = document.createElement('aside');
  notesPanel.className = 'beadsform-single-question-notes';
  notesPanel.setAttribute('aria-label', 'Additional notes');
  const notesToggle = button('Add notes');
  notesToggle.className = 'beadsform-single-question-notes-toggle';
  notesToggle.setAttribute('aria-controls', 'beadsform-additional-notes');
  notesToggle.setAttribute('aria-expanded', 'false');
  notesToggle.setAttribute('aria-label', 'Add global Additional Notes');

  const reviewPanel = document.createElement('section');
  reviewPanel.className = 'beadsform-single-question-review';
  reviewPanel.setAttribute('aria-live', 'polite');
  reviewPanel.setAttribute('aria-labelledby', 'beadsform-review-title');
  reviewPanel.hidden = true;

  form.insertBefore(layout, firstQuestion);
  layout.append(questionList, main);
  main.append(topControls.container);
  if (masterNotes) main.append(notesPanel);
  main.append(progressToggle, progress);

  questions.forEach((question, index) => {
    question.classList.add('beadsform-single-question-item');
    main.append(question);

    const listButton = button(questionTitle(question) || `Question ${index + 1}`);
    listButton.className = 'beadsform-single-question-list-button';
    listButton.addEventListener('click', () => {
      goTo(index);
    });
    questionList.append(listButton);
  });
  const reviewListButton = button('Review answers');
  reviewListButton.className = 'beadsform-single-question-list-button';
  reviewListButton.addEventListener('click', () => {
    goTo(reviewIndex);
  });
  questionList.append(reviewListButton);
  if (masterNotes) {
    masterNotes.classList.add('beadsform-single-question-master-notes');
    masterNotes.id ||= 'beadsform-additional-notes';
    masterNotes.setAttribute('data-beadsform-master-notes', 'true');
    for (const textarea of Array.from(masterNotes.querySelectorAll('textarea'))) {
      textarea.hidden = false;
      textarea.removeAttribute('hidden');
      textarea.addEventListener('input', updateNotesToggleState);
      textarea.addEventListener('change', updateNotesToggleState);
    }
    notesPanel.hidden = false;
    notesPanel.removeAttribute('hidden');
    notesPanel.append(notesToggle, masterNotes);
    setNotesExpanded(masterNotesHasValue());
  }
  main.append(reviewPanel);
  main.append(bottomControls.container);

  let activeIndex = useUrlState ? initialStepIndexFromUrl(questions.length) : 0;
  const listButtons = Array.from(questionList.querySelectorAll<HTMLButtonElement>('button'));
  const submitActions = form.querySelector<HTMLElement>('.beads-form-submit-actions');
  let middleProgressRevealed = false;
  if (submitActions) {
    submitActions.hidden = true;
    reviewPanel.append(submitActions);
  }

  function render(options: { scrollToQuestion?: boolean } = {}) {
    questions.forEach((question, index) => {
      question.hidden = index !== activeIndex;
    });
    listButtons.forEach((listButton, index) => {
      listButton.setAttribute('aria-current', index === activeIndex ? 'step' : 'false');
      listButton.classList.toggle('is-active', index === activeIndex);
    });
    const reviewing = activeIndex === reviewIndex;
    reviewPanel.hidden = !reviewing;
    if (reviewing) renderReviewSummary();
    progress.textContent = reviewing ? 'Review answers' : `Question ${activeIndex + 1} of ${questions.length}`;
    const middleQuestion = !reviewing && activeIndex > 0 && activeIndex < questions.length - 1;
    progressToggle.hidden = !middleQuestion;
    progressToggle.textContent = middleProgressRevealed ? 'Hide progress' : 'Show progress';
    progressToggle.setAttribute('aria-label', middleProgressRevealed ? 'Hide question progress' : 'Show question progress');
    progressToggle.setAttribute('aria-expanded', middleProgressRevealed ? 'true' : 'false');
    progress.hidden = middleQuestion && !middleProgressRevealed;
    previousButtons.forEach((previous) => {
      previous.disabled = activeIndex === 0;
    });
    nextButtons.forEach((next) => {
      next.hidden = reviewing;
      next.textContent = activeIndex === questions.length - 1 ? 'Review answers' : 'Next';
    });
    if (submitActions) {
      submitActions.hidden = !reviewing;
    }
    if (options.scrollToQuestion) scrollActiveQuestionIntoView();
  }

  function scrollActiveQuestionIntoView() {
    const target = activeIndex === reviewIndex ? reviewPanel : questions[activeIndex];
    target?.scrollIntoView?.({
      block: 'start',
      inline: 'nearest',
      behavior: 'smooth',
    });
  }

  function firstInvalidControl(question: HTMLFieldSetElement): HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | undefined {
    return Array.from(question.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('input, textarea, select'))
      .find((control) => !control.checkValidity());
  }

  function questionIsValid(index: number): boolean {
    const question = questions[index];
    if (!question) return true;
    const invalid = firstInvalidControl(question);
    if (!invalid) return true;
    invalid.reportValidity();
    return false;
  }

  function firstInvalidQuestionIndex(): number {
    return questions.findIndex((question) => !!firstInvalidControl(question));
  }

  function goTo(index: number) {
    const target = Math.max(0, Math.min(index, reviewIndex));
    const startingIndex = activeIndex;
    if (target !== activeIndex) middleProgressRevealed = false;
    if (target > activeIndex) {
      for (let current = activeIndex; current < target; current += 1) {
        if (current >= questions.length) break;
        activeIndex = current;
        render({ scrollToQuestion: activeIndex !== startingIndex });
        if (!questionIsValid(current)) {
          if (useUrlState && activeIndex !== startingIndex) writeStepIndexToUrl(activeIndex, 'push', questions.length);
          return;
        }
      }
    }
    activeIndex = target;
    render({ scrollToQuestion: activeIndex !== startingIndex });
    if (useUrlState && activeIndex !== startingIndex) writeStepIndexToUrl(activeIndex, 'push', questions.length);
  }

  function handleSubmit(event: SubmitEvent) {
    const invalidIndex = firstInvalidQuestionIndex();
    if (invalidIndex < 0 && activeIndex === reviewIndex) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    const startingIndex = activeIndex;
    activeIndex = invalidIndex >= 0 ? invalidIndex : reviewIndex;
    if (activeIndex !== startingIndex) middleProgressRevealed = false;
    render({ scrollToQuestion: activeIndex !== startingIndex });
    if (useUrlState && activeIndex !== startingIndex) writeStepIndexToUrl(activeIndex, 'replace', questions.length);
    if (invalidIndex >= 0) questionIsValid(invalidIndex);
  }

  function handlePopState() {
    const nextIndex = initialStepIndexFromUrl(questions.length);
    if (nextIndex === activeIndex) return;
    activeIndex = nextIndex;
    middleProgressRevealed = false;
    render();
  }

  function renderReviewSummary() {
    reviewPanel.replaceChildren();
    const title = document.createElement('h3');
    title.id = 'beadsform-review-title';
    title.textContent = 'Review your answers';
    const description = document.createElement('p');
    description.textContent = 'Confirm the current answers before choosing a submit intent. Use Edit to change any answer without losing your draft.';
    const list = document.createElement('ol');
    list.className = 'beadsform-single-question-review-list';
    questions.forEach((question, index) => {
      list.append(reviewItemForQuestion(question, index));
    });
    if (masterNotes) {
      list.append(reviewItemForAdditionalNotes(masterNotes));
    }
    reviewPanel.append(title, description, list);
    if (submitActions) reviewPanel.append(submitActions);
  }

  function reviewItemForQuestion(question: HTMLFieldSetElement, index: number): HTMLLIElement {
    const item = document.createElement('li');
    item.className = 'beadsform-single-question-review-item';
    const heading = document.createElement('h4');
    heading.textContent = questionTitle(question) || `Question ${index + 1}`;
    const answers = document.createElement('ul');
    answers.className = 'beadsform-single-question-review-answers';
    const rows = reviewRowsForQuestion(question);
    rows.forEach((row) => {
      const answer = document.createElement('li');
      answer.textContent = row;
      answers.append(answer);
    });
    const edit = button('Edit');
    edit.setAttribute('aria-label', `Edit ${heading.textContent}`);
    edit.setAttribute('data-beadsform-review-edit', String(index));
    edit.addEventListener('click', () => goTo(index));
    item.append(heading, answers, edit);
    return item;
  }

  function reviewItemForAdditionalNotes(notes: HTMLFieldSetElement): HTMLLIElement {
    const item = document.createElement('li');
    item.className = 'beadsform-single-question-review-item';
    const heading = document.createElement('h4');
    heading.textContent = questionTitle(notes) || 'Additional Notes';
    const answers = document.createElement('ul');
    answers.className = 'beadsform-single-question-review-answers';
    const values = Array.from(notes.querySelectorAll<HTMLTextAreaElement>('textarea'))
      .map((textarea) => textarea.value.trim())
      .filter(Boolean);
    const answer = document.createElement('li');
    answer.textContent = `Answer: ${values.length > 0 ? values.join('\n\n') : 'Unanswered'}`;
    answers.append(answer);
    const edit = button('Edit');
    edit.setAttribute('aria-label', `Edit ${heading.textContent}`);
    edit.addEventListener('click', () => {
      const firstTextarea = notes.querySelector<HTMLTextAreaElement>('textarea');
      firstTextarea?.focus();
      firstTextarea?.scrollIntoView?.({
        block: 'center',
        inline: 'nearest',
        behavior: 'smooth',
      });
    });
    item.append(heading, answers, edit);
    return item;
  }

  previousButtons.forEach((previous) => {
    previous.addEventListener('click', () => goTo(activeIndex - 1));
  });
  nextButtons.forEach((next) => {
    next.addEventListener('click', () => goTo(activeIndex + 1));
  });
  progressToggle.addEventListener('click', () => {
    middleProgressRevealed = !middleProgressRevealed;
    render();
  });
  notesToggle.addEventListener('click', () => {
    if (!masterNotes) return;
    setNotesExpanded(masterNotes.hidden);
  });
  form.addEventListener('submit', handleSubmit, true);
  if (useUrlState) window.addEventListener('popstate', handlePopState);
  render();

  return () => {
    form.removeEventListener('submit', handleSubmit, true);
    if (useUrlState) window.removeEventListener('popstate', handlePopState);
    choiceGroupsCleanup();
    form.classList.remove('beadsform-single-question-form');
    delete form.dataset.beadsformSingleQuestion;
  };

  function masterNotesHasValue(): boolean {
    if (!masterNotes) return false;
    return Array.from(masterNotes.querySelectorAll<HTMLTextAreaElement>('textarea'))
      .some((textarea) => textarea.value.trim().length > 0);
  }

  function setNotesExpanded(expanded: boolean): void {
    if (!masterNotes) return;
    masterNotes.hidden = !expanded;
    if (expanded) masterNotes.removeAttribute('hidden');
    notesToggle.textContent = expanded ? 'Hide notes' : 'Add notes';
    notesToggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    notesToggle.setAttribute('aria-label', expanded ? 'Hide global Additional Notes' : 'Add global Additional Notes');
    notesToggle.classList.toggle('has-value', masterNotesHasValue());
  }

  function updateNotesToggleState(): void {
    if (!masterNotes) return;
    const hasValue = masterNotesHasValue();
    if (hasValue && masterNotes.hidden) setNotesExpanded(true);
    notesToggle.classList.toggle('has-value', hasValue);
  }
}

function initialStepIndexFromUrl(questionCount: number): number {
  if (new URLSearchParams(window.location.search).get(WIZARD_REVIEW_PARAM) === '1') return questionCount;
  return initialQuestionIndexFromUrl(questionCount) ?? 0;
}

function initialQuestionIndexFromUrl(questionCount: number): number | undefined {
  const raw = new URLSearchParams(window.location.search).get(WIZARD_QUESTION_PARAM);
  if (!raw) return undefined;
  const page = Number(raw);
  if (!Number.isInteger(page) || page < 1 || page > questionCount) return undefined;
  return page - 1;
}

function writeStepIndexToUrl(index: number, mode: 'push' | 'replace', questionCount: number): void {
  const url = new URL(window.location.href);
  if (index >= questionCount) {
    url.searchParams.delete(WIZARD_QUESTION_PARAM);
    url.searchParams.set(WIZARD_REVIEW_PARAM, '1');
  } else {
    url.searchParams.set(WIZARD_QUESTION_PARAM, String(index + 1));
    url.searchParams.delete(WIZARD_REVIEW_PARAM);
  }
  const state = window.history.state;
  if (mode === 'replace') {
    window.history.replaceState(state, '', url);
  } else {
    window.history.pushState(state, '', url);
  }
}

function button(label: string): HTMLButtonElement {
  const element = document.createElement('button');
  element.type = 'button';
  element.textContent = label;
  return element;
}

function reviewRowsForQuestion(question: HTMLFieldSetElement): string[] {
  const choices = Array.from(question.querySelectorAll<HTMLElement>('.beads-form-choice'));
  if (choices.length > 0) return reviewRowsForChoices(question, choices);

  const rows: string[] = [];
  const controls = Array.from(question.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('input, textarea, select'))
    .filter((control) => control.type !== 'hidden' && control.type !== 'submit');
  const answerControls = controls.filter((control) => !isQuestionNotesControl(control));
  const answerValues = answerControls.map(controlReviewValue).filter((value) => value.length > 0);
  rows.push(`Answer: ${answerValues.length > 0 ? answerValues.join(', ') : 'Unanswered'}`);

  for (const note of controls.filter(isQuestionNotesControl)) {
    const value = controlReviewValue(note);
    if (value) rows.push(`Question notes: ${value}`);
  }
  return rows;
}

function reviewRowsForChoices(question: HTMLFieldSetElement, choices: HTMLElement[]): string[] {
  const selected: string[] = [];
  const rows: string[] = [];
  for (const choice of choices) {
    const checkbox = choice.querySelector<HTMLInputElement>('input[type="checkbox"], input[type="radio"]');
    const label = choiceLabel(choice);
    if (checkbox?.checked) selected.push(label);
    for (const note of Array.from(choice.querySelectorAll<HTMLTextAreaElement>('textarea'))) {
      const value = controlReviewValue(note);
      if (value) rows.push(`Note for ${label}: ${value}`);
    }
  }
  return [
    `Selected choices: ${selected.length > 0 ? selected.join(', ') : 'None'}`,
    ...rows,
    ...Array.from(question.querySelectorAll<HTMLTextAreaElement>(':scope > textarea'))
      .map((note) => controlReviewValue(note))
      .filter((value) => value.length > 0)
      .map((value) => `Question notes: ${value}`),
  ];
}

function choiceLabel(choice: HTMLElement): string {
  const label = choice.querySelector('label');
  if (!label) return 'choice';
  const copy = label.cloneNode(true) as HTMLElement;
  for (const badge of Array.from(copy.querySelectorAll('.beads-form-default, .beads-form-recommended'))) {
    badge.remove();
  }
  return copy.textContent?.replace(/\s+/g, ' ').trim() || 'choice';
}

function isQuestionNotesControl(control: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement): boolean {
  return control.name.endsWith('_more_info') || control.getAttribute('aria-label')?.toLowerCase().startsWith('more info') === true;
}

function controlReviewValue(control: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement): string {
  if (control instanceof HTMLInputElement && (control.type === 'checkbox' || control.type === 'radio')) {
    return control.checked ? labelForControl(control) || control.value : '';
  }
  if (control instanceof HTMLSelectElement) {
    return Array.from(control.selectedOptions).map((option) => option.textContent?.trim() || option.value).filter(Boolean).join(', ');
  }
  return control.value.trim();
}

function labelForControl(control: HTMLInputElement): string {
  if (!control.id) return '';
  return Array.from(control.ownerDocument.querySelectorAll<HTMLLabelElement>('label'))
    .find((label) => label.htmlFor === control.id)
    ?.textContent
    ?.replace(/\s+/g, ' ')
    .trim() ?? '';
}

function navigationControls(position: 'top' | 'bottom'): {
  container: HTMLDivElement;
  previous: HTMLButtonElement;
  next: HTMLButtonElement;
} {
  const container = document.createElement('div');
  container.className = `beadsform-single-question-controls beadsform-single-question-controls--${position}`;
  container.setAttribute('role', 'group');
  container.setAttribute('aria-label', `${position === 'top' ? 'Top' : 'Bottom'} question navigation`);
  const previous = button('Previous');
  const next = button('Next');
  container.append(previous, next);
  return { container, previous, next };
}

function questionTitle(fieldset: HTMLFieldSetElement): string {
  return fieldset.querySelector('legend')?.textContent?.trim() ?? '';
}

function isMasterNotesFieldset(fieldset: HTMLFieldSetElement): boolean {
  const legend = questionTitle(fieldset).toLowerCase();
  if (legend === 'additional notes') return true;
  return !!fieldset.querySelector('[name="additional_notes"], [name="overall_more_info"]');
}
