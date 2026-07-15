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

    const fieldsets = Array.from(document.querySelectorAll<HTMLFieldSetElement>('fieldset'));
    expect(document.querySelector('.beadsform-single-question-progress')?.textContent).toBe('Question 1 of 2');
    expect(fieldsets[0]!.hidden).toBe(false);
    expect(fieldsets[1]!.hidden).toBe(true);
    expect(document.querySelector('.beadsform-single-question-notes textarea[name="additional_notes"]')).toBeTruthy();
    expect(Array.from(document.querySelectorAll('.beadsform-single-question-list-button')).map((button) => button.textContent)).toEqual([
      'First question',
      'Second question',
    ]);

    document.querySelectorAll<HTMLButtonElement>('.beadsform-single-question-controls button')[1]!.click();
    expect(document.querySelector('.beadsform-single-question-progress')?.textContent).toBe('Question 2 of 2');
    expect(fieldsets[0]!.hidden).toBe(true);
    expect(fieldsets[1]!.hidden).toBe(false);
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
});
