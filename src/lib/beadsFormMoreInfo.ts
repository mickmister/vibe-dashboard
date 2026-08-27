export function initializeCompactMoreInfo(host: ParentNode): void {
  for (const textarea of findVisibleQuestionMoreInfoTextareas(host)) {
    keepTextareaVisible(textarea);
  }

  for (const [index, textarea] of findCompactMoreInfoTextareas(host).entries()) {
    textarea.classList.add('beads-form-more-info-textarea');
    ensureTextareaId(textarea, index);
    let button = buttonForTextarea(textarea);
    if (!button) {
      button = document.createElement('button');
      button.type = 'button';
      button.className = 'beads-form-more-info-toggle';
      button.setAttribute('aria-controls', textarea.id);
      button.textContent = '💬';
      textarea.before(button);
      button.addEventListener('click', () => {
        setTextareaOpen(textarea, textarea.hidden);
        if (!textarea.hidden) textarea.focus();
      });
      textarea.addEventListener('input', () => updateButtonState(textarea));
    }
    setTextareaOpen(textarea, textareaHasValue(textarea));
    updateButtonState(textarea);
  }
}

function ensureTextareaId(textarea: HTMLTextAreaElement, index: number): void {
  if (textarea.id) return;
  textarea.id = `beads_form_more_info_${index}`;
}

export function refreshCompactMoreInfoState(host: ParentNode): void {
  for (const textarea of findVisibleQuestionMoreInfoTextareas(host)) {
    keepTextareaVisible(textarea);
  }

  for (const textarea of findCompactMoreInfoTextareas(host)) {
    if (textareaHasValue(textarea)) {
      setTextareaOpen(textarea, true);
    }
    updateButtonState(textarea);
  }
}

function findCompactMoreInfoTextareas(host: ParentNode): HTMLTextAreaElement[] {
  return Array.from(host.querySelectorAll<HTMLTextAreaElement>('textarea[name$="_more_info"], textarea[id$="_more_info"]'))
    .filter((textarea) => !isMasterNotesTextarea(textarea) && !isQuestionLevelMoreInfoTextarea(textarea));
}

function findVisibleQuestionMoreInfoTextareas(host: ParentNode): HTMLTextAreaElement[] {
  return Array.from(host.querySelectorAll<HTMLTextAreaElement>('textarea[name$="_more_info"], textarea[id$="_more_info"]'))
    .filter((textarea) => !isMasterNotesTextarea(textarea) && isQuestionLevelMoreInfoTextarea(textarea));
}

function isMasterNotesTextarea(textarea: HTMLTextAreaElement): boolean {
  const name = textarea.name || textarea.id;
  if (name === 'overall_more_info' || name === 'additional_notes') return true;
  const fieldset = textarea.closest('fieldset');
  return fieldset?.querySelector('legend')?.textContent?.trim().toLowerCase() === 'additional notes';
}

function buttonForTextarea(textarea: HTMLTextAreaElement): HTMLButtonElement | null {
  const previous = textarea.previousElementSibling;
  if (
    previous instanceof HTMLButtonElement
    && previous.classList.contains('beads-form-more-info-toggle')
    && previous.getAttribute('aria-controls') === textarea.id
  ) {
    return previous;
  }
  return null;
}

function isQuestionLevelMoreInfoTextarea(textarea: HTMLTextAreaElement): boolean {
  if (textarea.closest('.beads-form-choice')) return false;
  const fieldset = textarea.closest('fieldset');
  if (!fieldset) return false;
  const moreInfoTextareas = Array.from(fieldset.querySelectorAll<HTMLTextAreaElement>('textarea[name$="_more_info"], textarea[id$="_more_info"]'))
    .filter((candidate) => !isMasterNotesTextarea(candidate));
  return moreInfoTextareas.at(-1) === textarea;
}

function keepTextareaVisible(textarea: HTMLTextAreaElement): void {
  textarea.hidden = false;
  textarea.removeAttribute('hidden');
  textarea.classList.remove('beads-form-more-info-textarea');
  buttonForTextarea(textarea)?.remove();
}

function setTextareaOpen(textarea: HTMLTextAreaElement, open: boolean): void {
  textarea.hidden = !open;
  buttonForTextarea(textarea)?.setAttribute('aria-expanded', String(open));
  textarea.dispatchEvent(new Event('beadsform:textarea-visibility-change'));
}

function updateButtonState(textarea: HTMLTextAreaElement): void {
  const button = buttonForTextarea(textarea);
  if (!button) return;
  const hasValue = textareaHasValue(textarea);
  button.classList.toggle('has-value', hasValue);
  button.setAttribute('aria-label', `${hasValue ? 'View' : 'Add'} optional context: ${textareaLabel(textarea)}`);
  button.title = hasValue ? 'More info added' : 'Add more info';
}

function textareaHasValue(textarea: HTMLTextAreaElement): boolean {
  return textarea.value.trim().length > 0;
}

function textareaLabel(textarea: HTMLTextAreaElement): string {
  return textarea.getAttribute('aria-label')?.trim()
    || textarea.name
    || textarea.id
    || 'more info';
}
