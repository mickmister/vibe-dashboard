export function initializeCompactMoreInfo(host: ParentNode): void {
  for (const [index, textarea] of findMoreInfoTextareas(host).entries()) {
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
    setTextareaOpen(textarea, false);
    updateButtonState(textarea);
  }
}

function ensureTextareaId(textarea: HTMLTextAreaElement, index: number): void {
  if (textarea.id) return;
  textarea.id = `beads_form_more_info_${index}`;
}

export function refreshCompactMoreInfoState(host: ParentNode): void {
  for (const textarea of findMoreInfoTextareas(host)) {
    updateButtonState(textarea);
  }
}

function findMoreInfoTextareas(host: ParentNode): HTMLTextAreaElement[] {
  return Array.from(host.querySelectorAll<HTMLTextAreaElement>('textarea[name$="_more_info"], textarea[id$="_more_info"]'))
    .filter((textarea) => !isMasterNotesTextarea(textarea));
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

function setTextareaOpen(textarea: HTMLTextAreaElement, open: boolean): void {
  textarea.hidden = !open;
  buttonForTextarea(textarea)?.setAttribute('aria-expanded', String(open));
}

function updateButtonState(textarea: HTMLTextAreaElement): void {
  const button = buttonForTextarea(textarea);
  if (!button) return;
  const hasValue = textarea.value.trim().length > 0;
  button.classList.toggle('has-value', hasValue);
  button.setAttribute('aria-label', `${hasValue ? 'View' : 'Add'} optional context: ${textareaLabel(textarea)}`);
  button.title = hasValue ? 'More info added' : 'Add more info';
}

function textareaLabel(textarea: HTMLTextAreaElement): string {
  return textarea.getAttribute('aria-label')?.trim()
    || textarea.name
    || textarea.id
    || 'more info';
}
