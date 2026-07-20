// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { initializeCompactMoreInfo, refreshCompactMoreInfoState } from './beadsFormMoreInfo';
import { initializeSingleQuestionMode } from './beadsFormSingleQuestion';

describe('compact BeadsForm more-info fields', () => {
  it('keeps question-level more-info visible and compacts per-choice more-info fields', () => {
    document.body.innerHTML = `
      <form>
        <fieldset>
          <legend>Question</legend>
          <div class="beads-form-choice">
            <label><input name="question" type="checkbox" value="choice"> Choice</label>
            <textarea id="question_choice_more_info" name="question_choice_more_info" aria-label="More info for Choice"></textarea>
          </div>
          <textarea id="question_more_info" name="question_more_info" aria-label="More info for Question"></textarea>
        </fieldset>
      </form>
    `;

    initializeCompactMoreInfo(document);

    const choiceTextarea = document.querySelector<HTMLTextAreaElement>('#question_choice_more_info')!;
    const questionTextarea = document.querySelector<HTMLTextAreaElement>('#question_more_info')!;
    const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('.beads-form-more-info-toggle'));
    expect(choiceTextarea.hidden).toBe(true);
    expect(questionTextarea.hidden).toBe(false);
    expect(buttons).toHaveLength(1);
    expect(buttons[0]!.type).toBe('button');
    expect(buttons[0]!.getAttribute('aria-expanded')).toBe('false');
    expect(buttons[0]!.getAttribute('aria-label')).toBe('Add optional context: More info for Choice');

    buttons[0]!.click();

    expect(choiceTextarea.hidden).toBe(false);
    expect(buttons[0]!.getAttribute('aria-expanded')).toBe('true');
  });

  it('expands and indicates existing values while preserving normal form submission', () => {
    document.body.innerHTML = `
      <form>
        <div class="beads-form-choice">
          <textarea id="choice_more_info" name="choice_more_info" aria-label="More info for Choice">Saved context</textarea>
        </div>
      </form>
    `;

    initializeCompactMoreInfo(document);

    const textarea = document.querySelector<HTMLTextAreaElement>('textarea')!;
    const button = document.querySelector<HTMLButtonElement>('.beads-form-more-info-toggle')!;
    expect(textarea.hidden).toBe(false);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(button.classList.contains('has-value')).toBe(true);
    expect(button.getAttribute('aria-label')).toBe('View optional context: More info for Choice');
    expect(Object.fromEntries(new FormData(document.querySelector('form')!))).toEqual({
      choice_more_info: 'Saved context',
    });
  });

  it('refreshes the visible indicator and expands after draft restore applies values', () => {
    document.body.innerHTML = '<form><div class="beads-form-choice"><textarea id="choice_more_info" name="choice_more_info"></textarea></div></form>';
    initializeCompactMoreInfo(document);
    const textarea = document.querySelector<HTMLTextAreaElement>('textarea')!;
    const button = document.querySelector<HTMLButtonElement>('.beads-form-more-info-toggle')!;

    textarea.value = 'Draft context';
    refreshCompactMoreInfoState(document);

    expect(textarea.hidden).toBe(false);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(button.classList.contains('has-value')).toBe(true);
    expect(button.getAttribute('aria-label')).toContain('View optional context');
  });

  it('keeps empty restored more-info fields collapsed', () => {
    document.body.innerHTML = '<form><div class="beads-form-choice"><textarea id="choice_more_info" name="choice_more_info"></textarea></div></form>';
    initializeCompactMoreInfo(document);

    const textarea = document.querySelector<HTMLTextAreaElement>('textarea')!;
    const button = document.querySelector<HTMLButtonElement>('.beads-form-more-info-toggle')!;
    refreshCompactMoreInfoState(document);

    expect(textarea.hidden).toBe(true);
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(button.classList.contains('has-value')).toBe(false);
  });

  it('does not compact the master/global Additional notes textarea', () => {
    document.body.innerHTML = `
      <form>
        <fieldset>
          <legend>Additional notes</legend>
          <textarea id="overall_more_info" name="overall_more_info"></textarea>
        </fieldset>
      </form>
    `;

    initializeCompactMoreInfo(document);

    expect(document.querySelector('textarea')?.hidden).toBe(false);
    expect(document.querySelector('.beads-form-more-info-toggle')).toBeNull();
  });

  it('works alongside single-question mode without hiding master Additional notes', () => {
    document.body.innerHTML = `
      <div id="host">
        <form>
          <fieldset><legend>First</legend><div class="beads-form-choice"><textarea id="first_choice_more_info" name="first_choice_more_info"></textarea></div><textarea id="first_more_info" name="first_more_info"></textarea></fieldset>
          <fieldset><legend>Second</legend><div class="beads-form-choice"><textarea id="second_choice_more_info" name="second_choice_more_info"></textarea></div><textarea id="second_more_info" name="second_more_info"></textarea></fieldset>
          <fieldset><legend>Additional notes</legend><textarea id="overall_more_info" name="overall_more_info"></textarea></fieldset>
        </form>
      </div>
    `;

    const host = document.querySelector('#host')!;
    initializeSingleQuestionMode(host);
    initializeCompactMoreInfo(host);

    expect(document.querySelector<HTMLTextAreaElement>('#first_choice_more_info')?.hidden).toBe(true);
    expect(document.querySelector<HTMLTextAreaElement>('#first_more_info')?.hidden).toBe(false);
    expect(document.querySelector<HTMLTextAreaElement>('#overall_more_info')?.hidden).toBe(false);
    expect(document.querySelectorAll('.beads-form-more-info-toggle')).toHaveLength(2);
    expect(document.querySelector('.beadsform-single-question-notes #overall_more_info')).toBeTruthy();
  });

  it('auto-expands filled more-info fields when revisiting questions in single-question mode', () => {
    document.body.innerHTML = `
      <div id="host">
        <form>
          <fieldset><legend>First</legend><div class="beads-form-choice"><textarea id="first_choice_more_info" name="first_choice_more_info"></textarea></div><textarea id="first_more_info" name="first_more_info"></textarea></fieldset>
          <fieldset><legend>Second</legend><div class="beads-form-choice"><textarea id="second_choice_more_info" name="second_choice_more_info">Submitted context</textarea></div><textarea id="second_more_info" name="second_more_info"></textarea></fieldset>
        </form>
      </div>
    `;

    const host = document.querySelector('#host')!;
    initializeSingleQuestionMode(host);
    initializeCompactMoreInfo(host);

    const secondTextarea = document.querySelector<HTMLTextAreaElement>('#second_choice_more_info')!;
    const questionTextarea = document.querySelector<HTMLTextAreaElement>('#second_more_info')!;
    const secondButton = document.querySelector<HTMLButtonElement>('[aria-controls="second_choice_more_info"]')!;
    expect(secondTextarea.hidden).toBe(false);
    expect(questionTextarea.hidden).toBe(false);
    expect(secondButton.classList.contains('has-value')).toBe(true);

    document.querySelector<HTMLButtonElement>('.beadsform-single-question-controls--bottom button:nth-child(2)')!.click();

    expect(document.querySelector('.beadsform-single-question-progress')?.textContent).toBe('Question 2 of 2');
    expect(secondTextarea.hidden).toBe(false);
    expect(secondButton.getAttribute('aria-expanded')).toBe('true');
  });
});
