export type SingleQuestionModeCleanup = () => void;

export function initializeSingleQuestionMode(host: ParentNode): SingleQuestionModeCleanup {
  const form = host.querySelector('form');
  if (!form || form.dataset.beadsformSingleQuestion === 'true') return () => undefined;

  const fieldsets = Array.from(form.children).filter((child): child is HTMLFieldSetElement => (
    child instanceof HTMLFieldSetElement
  ));
  const masterNotes = fieldsets.find(isMasterNotesFieldset);
  const questions = fieldsets.filter((fieldset) => fieldset !== masterNotes);
  if (questions.length <= 1) return () => undefined;

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
  progress.className = 'beadsform-single-question-progress';
  progress.setAttribute('aria-live', 'polite');

  const controls = document.createElement('div');
  controls.className = 'beadsform-single-question-controls';
  const previous = button('Previous');
  const next = button('Next');
  controls.append(previous, next);

  const notesPanel = document.createElement('aside');
  notesPanel.className = 'beadsform-single-question-notes';
  notesPanel.setAttribute('aria-label', 'Additional notes');

  form.insertBefore(layout, firstQuestion);
  layout.append(questionList, main);
  if (masterNotes) main.append(notesPanel);
  main.append(progress);

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
  if (masterNotes) {
    masterNotes.classList.add('beadsform-single-question-master-notes');
    notesPanel.append(masterNotes);
  }
  main.append(controls);

  let activeIndex = 0;
  const listButtons = Array.from(questionList.querySelectorAll<HTMLButtonElement>('button'));
  const submitActions = form.querySelector<HTMLElement>('.beads-form-submit-actions');

  function render(options: { scrollToQuestion?: boolean } = {}) {
    questions.forEach((question, index) => {
      question.hidden = index !== activeIndex;
    });
    listButtons.forEach((listButton, index) => {
      listButton.setAttribute('aria-current', index === activeIndex ? 'step' : 'false');
      listButton.classList.toggle('is-active', index === activeIndex);
    });
    progress.textContent = `Question ${activeIndex + 1} of ${questions.length}`;
    previous.disabled = activeIndex === 0;
    next.hidden = activeIndex === questions.length - 1;
    if (submitActions) {
      submitActions.hidden = activeIndex !== questions.length - 1;
    }
    if (options.scrollToQuestion) scrollActiveQuestionIntoView();
  }

  function scrollActiveQuestionIntoView() {
    progress.scrollIntoView?.({
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
    const target = Math.max(0, Math.min(index, questions.length - 1));
    const startingIndex = activeIndex;
    if (target > activeIndex) {
      for (let current = activeIndex; current < target; current += 1) {
        activeIndex = current;
        render({ scrollToQuestion: activeIndex !== startingIndex });
        if (!questionIsValid(current)) return;
      }
    }
    activeIndex = target;
    render({ scrollToQuestion: activeIndex !== startingIndex });
  }

  function handleSubmit(event: SubmitEvent) {
    const invalidIndex = firstInvalidQuestionIndex();
    if (invalidIndex < 0 && activeIndex === questions.length - 1) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    const startingIndex = activeIndex;
    activeIndex = invalidIndex >= 0 ? invalidIndex : questions.length - 1;
    render({ scrollToQuestion: activeIndex !== startingIndex });
    if (invalidIndex >= 0) questionIsValid(invalidIndex);
  }

  previous.addEventListener('click', () => goTo(activeIndex - 1));
  next.addEventListener('click', () => goTo(activeIndex + 1));
  form.addEventListener('submit', handleSubmit, true);
  render();

  return () => {
    form.removeEventListener('submit', handleSubmit, true);
    form.classList.remove('beadsform-single-question-form');
    delete form.dataset.beadsformSingleQuestion;
  };
}

function button(label: string): HTMLButtonElement {
  const element = document.createElement('button');
  element.type = 'button';
  element.textContent = label;
  return element;
}

function questionTitle(fieldset: HTMLFieldSetElement): string {
  return fieldset.querySelector('legend')?.textContent?.trim() ?? '';
}

function isMasterNotesFieldset(fieldset: HTMLFieldSetElement): boolean {
  const legend = questionTitle(fieldset).toLowerCase();
  if (legend === 'additional notes') return true;
  return !!fieldset.querySelector('[name="additional_notes"], [name="overall_more_info"]');
}
