// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { initializeSingleQuestionMode } from './beadsFormSingleQuestion';

describe('BeadsForm single-question mode', () => {
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
