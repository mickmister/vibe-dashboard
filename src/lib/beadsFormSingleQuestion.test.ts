// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initializeCompactMoreInfo } from './beadsFormMoreInfo';
import { initializeSingleQuestionMode } from './beadsFormSingleQuestion';

describe('BeadsForm single-question mode', () => {
  beforeEach(() => {
    window.history.pushState(null, '', '/dashboard/forms');
  });

  it('pages standard form questions with progress and a question list', () => {
    document.body.innerHTML = `
      <div id="host">
        <form>
          <fieldset><legend>First question</legend><input name="first"></fieldset>
          <fieldset><legend>Second question</legend><input name="second"></fieldset>
          <fieldset><legend>Additional notes</legend><textarea name="additional_notes"></textarea></fieldset>
          <div class="beads-form-submit-actions"><button type="submit">Submit</button></div>
        </form>
      </div>
    `;

    initializeSingleQuestionMode(document.querySelector('#host')!);

    const questionItems = Array.from(document.querySelectorAll<HTMLFieldSetElement>('.beadsform-single-question-item'));
    expect(document.querySelector('.beadsform-single-question-progress')?.textContent).toBe('Question 1 of 2');
    expect(questionItems[0]!.hidden).toBe(false);
    expect(questionItems[1]!.hidden).toBe(true);
    expect(document.querySelector<HTMLElement>('.beads-form-submit-actions')?.hidden).toBe(true);
    expect(document.querySelector('.beadsform-single-question-notes textarea[name="additional_notes"]')).toBeTruthy();
    expect(Array.from(document.querySelector('.beadsform-single-question-main')!.children).map((child) => child.className)).toEqual([
      'beadsform-single-question-notes',
      'beadsform-single-question-progress',
      'beadsform-single-question-item',
      'beadsform-single-question-item',
      'beadsform-single-question-controls',
    ]);
    expect(document.querySelector('.beadsform-single-question-progress')?.previousElementSibling?.className).toBe('beadsform-single-question-notes');
    expect(document.querySelector('.beadsform-single-question-progress')?.nextElementSibling?.textContent).toContain('First question');
    expect(Array.from(document.querySelectorAll('.beadsform-single-question-list-button')).map((button) => button.textContent)).toEqual([
      'First question',
      'Second question',
    ]);

    document.querySelectorAll<HTMLButtonElement>('.beadsform-single-question-controls button')[1]!.click();
    expect(document.querySelector('.beadsform-single-question-progress')?.textContent).toBe('Question 2 of 2');
    expect(questionItems[0]!.hidden).toBe(true);
    expect(questionItems[1]!.hidden).toBe(false);
    expect(document.querySelector<HTMLElement>('.beads-form-submit-actions')?.hidden).toBe(false);
  });

  it('reports active fieldset validity before navigating forward', () => {
    document.body.innerHTML = `
      <div id="host">
        <form>
          <fieldset><legend>Required</legend><input name="first" required></fieldset>
          <fieldset><legend>Second</legend><input name="second"></fieldset>
        </form>
      </div>
    `;
    initializeSingleQuestionMode(document.querySelector('#host')!);
    const firstInput = document.querySelector<HTMLInputElement>('input[name="first"]')!;
    const reportValidity = vi.spyOn(firstInput, 'reportValidity');

    document.querySelectorAll<HTMLButtonElement>('.beadsform-single-question-controls button')[1]!.click();

    expect(reportValidity).toHaveBeenCalled();
    expect(document.querySelector('.beadsform-single-question-progress')?.textContent).toBe('Question 1 of 2');
  });

  it('scrolls the question progress into view when navigation changes the active question', () => {
    document.body.innerHTML = `
      <div id="host">
        <form>
          <fieldset><legend>First</legend><input name="first"></fieldset>
          <fieldset><legend>Second</legend><input name="second"></fieldset>
          <fieldset><legend>Third</legend><input name="third"></fieldset>
        </form>
      </div>
    `;
    const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
    const scrollIntoView = vi.fn();
    HTMLElement.prototype.scrollIntoView = scrollIntoView;
    try {
      initializeSingleQuestionMode(document.querySelector('#host')!);
      expect(scrollIntoView).not.toHaveBeenCalled();

      document.querySelectorAll<HTMLButtonElement>('.beadsform-single-question-controls button')[1]!.click();

      expect(scrollIntoView).toHaveBeenCalledWith({
        block: 'start',
        inline: 'nearest',
        behavior: 'smooth',
      });
      expect(document.querySelector('.beadsform-single-question-progress')?.textContent).toBe('Question 2 of 3');

      scrollIntoView.mockClear();
      document.querySelectorAll<HTMLButtonElement>('.beadsform-single-question-list-button')[2]!.click();

      expect(scrollIntoView).toHaveBeenCalledTimes(1);
      expect(document.querySelector('.beadsform-single-question-progress')?.textContent).toBe('Question 3 of 3');
    } finally {
      HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
    }
  });

  it('restores and persists the wizard question through URL query params while preserving route params', () => {
    window.history.pushState(null, '', '/dashboard/forms?dir=%2Frepo&bead=bd-1&form=review&formQuestion=2');
    document.body.innerHTML = `
      <div id="host">
        <form>
          <fieldset><legend>First</legend><input name="first"></fieldset>
          <fieldset><legend>Second</legend><input name="second"></fieldset>
          <fieldset><legend>Third</legend><input name="third"></fieldset>
        </form>
      </div>
    `;

    initializeSingleQuestionMode(document.querySelector('#host')!);

    expect(document.querySelector('.beadsform-single-question-progress')?.textContent).toBe('Question 2 of 3');
    expect(document.querySelectorAll<HTMLFieldSetElement>('fieldset')[1]!.hidden).toBe(false);

    document.querySelectorAll<HTMLButtonElement>('.beadsform-single-question-controls button')[1]!.click();

    const params = new URLSearchParams(window.location.search);
    expect(params.get('dir')).toBe('/repo');
    expect(params.get('bead')).toBe('bd-1');
    expect(params.get('form')).toBe('review');
    expect(params.get('formQuestion')).toBe('3');
    expect(document.querySelector('.beadsform-single-question-progress')?.textContent).toBe('Question 3 of 3');

    window.history.pushState(null, '', '/dashboard/forms?dir=%2Frepo&bead=bd-1&form=review&formQuestion=1');
    window.dispatchEvent(new PopStateEvent('popstate'));

    expect(document.querySelector('.beadsform-single-question-progress')?.textContent).toBe('Question 1 of 3');
    expect(document.querySelectorAll<HTMLFieldSetElement>('fieldset')[0]!.hidden).toBe(false);
  });

  it('restores question one when browser back returns to a URL without formQuestion', () => {
    window.history.pushState(null, '', '/dashboard/forms?dir=%2Frepo&bead=bd-1&form=review');
    document.body.innerHTML = `
      <div id="host">
        <form>
          <fieldset><legend>First</legend><input name="first"></fieldset>
          <fieldset><legend>Second</legend><input name="second"></fieldset>
        </form>
      </div>
    `;

    initializeSingleQuestionMode(document.querySelector('#host')!);
    document.querySelectorAll<HTMLButtonElement>('.beadsform-single-question-controls button')[1]!.click();
    expect(new URLSearchParams(window.location.search).get('formQuestion')).toBe('2');
    expect(document.querySelector('.beadsform-single-question-progress')?.textContent).toBe('Question 2 of 2');

    window.history.pushState(null, '', '/dashboard/forms?dir=%2Frepo&bead=bd-1&form=review');
    window.dispatchEvent(new PopStateEvent('popstate'));

    expect(new URLSearchParams(window.location.search).get('formQuestion')).toBeNull();
    expect(document.querySelector('.beadsform-single-question-progress')?.textContent).toBe('Question 1 of 2');
    expect(document.querySelectorAll<HTMLFieldSetElement>('fieldset')[0]!.hidden).toBe(false);
    expect(document.querySelectorAll<HTMLFieldSetElement>('fieldset')[1]!.hidden).toBe(true);
  });

  it('keeps Additional Notes visible above progress and active question after compact more-info initializes', () => {
    document.body.innerHTML = `
      <div id="host">
        <form>
          <fieldset><legend>First</legend><textarea id="first_more_info" name="first_more_info"></textarea></fieldset>
          <fieldset><legend>Second</legend><textarea id="second_more_info" name="second_more_info"></textarea></fieldset>
          <fieldset hidden><legend>Additional Notes</legend><textarea id="additional_notes" name="additional_notes" hidden></textarea></fieldset>
        </form>
      </div>
    `;
    const host = document.querySelector('#host')!;

    initializeSingleQuestionMode(host);
    initializeCompactMoreInfo(host);

    const notesPanel = document.querySelector<HTMLElement>('.beadsform-single-question-notes')!;
    const masterNotes = document.querySelector<HTMLFieldSetElement>('[data-beadsform-master-notes="true"]')!;
    const textarea = document.querySelector<HTMLTextAreaElement>('#additional_notes')!;
    const progress = document.querySelector<HTMLElement>('.beadsform-single-question-progress')!;

    expect(notesPanel.hidden).toBe(false);
    expect(masterNotes.hidden).toBe(false);
    expect(textarea.hidden).toBe(false);
    expect(document.querySelector('.beadsform-single-question-notes #additional_notes')).toBeTruthy();
    expect(progress.previousElementSibling).toBe(notesPanel);
    expect(progress.nextElementSibling?.textContent).toContain('First');
    expect(document.querySelectorAll('.beads-form-more-info-toggle')).toHaveLength(2);
  });

  it('does not allow question-list jumps to skip an invalid intermediate question', () => {
    document.body.innerHTML = `
      <div id="host">
        <form>
          <fieldset><legend>First</legend><input name="first" value="ok" required></fieldset>
          <fieldset><legend>Second</legend><input name="second" required></fieldset>
          <fieldset><legend>Third</legend><input name="third"></fieldset>
        </form>
      </div>
    `;
    initializeSingleQuestionMode(document.querySelector('#host')!);
    const secondInput = document.querySelector<HTMLInputElement>('input[name="second"]')!;
    const reportValidity = vi.spyOn(secondInput, 'reportValidity');

    document.querySelectorAll<HTMLButtonElement>('.beadsform-single-question-list-button')[2]!.click();

    expect(reportValidity).toHaveBeenCalled();
    expect(document.querySelector('.beadsform-single-question-progress')?.textContent).toBe('Question 2 of 3');
    expect(document.querySelectorAll<HTMLFieldSetElement>('fieldset')[1]!.hidden).toBe(false);
    expect(document.querySelectorAll<HTMLFieldSetElement>('fieldset')[2]!.hidden).toBe(true);
  });

  it('intercepts submit and routes to the first invalid hidden question', () => {
    document.body.innerHTML = `
      <div id="host">
        <form>
          <fieldset><legend>First</legend><input name="first" value="ok" required></fieldset>
          <fieldset><legend>Second</legend><input name="second" value="ok" required></fieldset>
          <div class="beads-form-submit-actions"><button type="submit">Submit</button></div>
        </form>
      </div>
    `;
    initializeSingleQuestionMode(document.querySelector('#host')!);
    const firstInput = document.querySelector<HTMLInputElement>('input[name="first"]')!;
    const reportValidity = vi.spyOn(firstInput, 'reportValidity');
    document.querySelectorAll<HTMLButtonElement>('.beadsform-single-question-list-button')[1]!.click();
    firstInput.value = '';

    const form = document.querySelector('form')!;
    const submitEvent = new SubmitEvent('submit', { bubbles: true, cancelable: true });
    const notCancelled = form.dispatchEvent(submitEvent);

    expect(notCancelled).toBe(false);
    expect(reportValidity).toHaveBeenCalled();
    expect(document.querySelector('.beadsform-single-question-progress')?.textContent).toBe('Question 1 of 2');
    expect(document.querySelectorAll<HTMLFieldSetElement>('fieldset')[0]!.hidden).toBe(false);
  });
});
