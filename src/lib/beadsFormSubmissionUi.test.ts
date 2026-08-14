// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyValuesToForm, setFormFieldsReadOnly, setSubmitButtonsDisabled } from './beadsFormPreviewState';
import { preserveSubmittedFormDom } from './beadsFormSubmissionUi';
import { initializeSingleQuestionMode } from './beadsFormSingleQuestion';

describe('BeadsForm submission UI preservation', () => {
  it('restores submitted values and single-question wizard state after raw form DOM is present', () => {
    window.history.pushState(null, '', '/dashboard/forms?dir=%2Frepo&bead=bd-1&form=review&formQuestion=2');
    document.body.innerHTML = `
      <div id="host">
        <form>
          <fieldset><legend>First question</legend><input name="first"></fieldset>
          <fieldset><legend>Second question</legend><textarea name="second"></textarea></fieldset>
          <div class="beads-form-submit-actions"><button type="submit">Submit</button></div>
        </form>
      </div>
    `;

    preserveSubmittedFormDom(document.querySelector<HTMLElement>('#host'), { first: 'saved first', second: 'saved second' }, {
      lock: true,
      singleQuestionMode: true,
    });

    expect(document.querySelector('.beadsform-single-question-progress')?.textContent).toBe('Question 2 of 2');
    expect(document.querySelectorAll<HTMLFieldSetElement>('fieldset')[0]!.hidden).toBe(true);
    expect(document.querySelectorAll<HTMLFieldSetElement>('fieldset')[1]!.hidden).toBe(false);
    expect(document.querySelector<HTMLInputElement>('input[name="first"]')?.value).toBe('saved first');
    expect(document.querySelector<HTMLTextAreaElement>('textarea[name="second"]')?.value).toBe('saved second');
    expect(document.querySelector<HTMLButtonElement>('.beads-form-submit-actions button')?.disabled).toBe(true);
    expect(document.querySelector<HTMLInputElement>('input[name="first"]')?.disabled).toBe(true);
  });

  it('keeps the form hidden behind a centered submitting overlay while submission is in flight', () => {
    const styles = readFileSync(resolve(process.cwd(), 'src/styles.css'), 'utf8');

    expect(styles).toContain('.beadsform-root.is-submitting .beadsform-form-host');
    expect(styles).toContain('visibility: hidden;');
    expect(styles).toContain('.beadsform-root .beadsform-submit-overlay');
    expect(styles).toContain('position: fixed;');
    expect(styles).toContain('justify-content: center;');
  });

  it('restores edit response wizard navigation after remounting fresh form DOM', () => {
    window.history.pushState(null, '', '/dashboard/forms');
    const rawFormHtml = `
      <form>
        <fieldset><legend>First question</legend><input name="first"></fieldset>
        <fieldset><legend>Second question</legend><textarea name="second"></textarea></fieldset>
        <div class="beads-form-submit-actions"><button type="submit">Submit</button></div>
      </form>
    `;
    document.body.innerHTML = `<div id="host">${rawFormHtml}</div>`;
    const host = document.querySelector<HTMLElement>('#host')!;

    initializeSingleQuestionMode(host);
    const lockedForm = host.querySelector('form')!;
    applyValuesToForm(lockedForm, { first: 'saved first', second: 'saved second' });
    setSubmitButtonsDisabled(lockedForm, true);
    setFormFieldsReadOnly(lockedForm, true);
    expect(host.querySelectorAll('.beadsform-single-question-controls')).toHaveLength(2);

    host.innerHTML = rawFormHtml;
    const editingForm = host.querySelector('form')!;
    applyValuesToForm(editingForm, { first: 'saved first', second: 'saved second' });
    setSubmitButtonsDisabled(editingForm, false);
    setFormFieldsReadOnly(editingForm, false);
    initializeSingleQuestionMode(host);

    const questions = Array.from(host.querySelectorAll<HTMLFieldSetElement>('.beadsform-single-question-item'));
    expect(questions).toHaveLength(2);
    expect(questions[0]!.hidden).toBe(false);
    expect(questions[1]!.hidden).toBe(true);
    expect(host.querySelectorAll('form > fieldset')).toHaveLength(0);
    expect(host.querySelectorAll('.beadsform-single-question-controls')).toHaveLength(2);
    expect(host.querySelector<HTMLInputElement>('input[name="first"]')?.value).toBe('saved first');
    expect(host.querySelector<HTMLTextAreaElement>('textarea[name="second"]')?.value).toBe('saved second');
    expect(host.querySelector<HTMLInputElement>('input[name="first"]')?.disabled).toBe(false);

    host.querySelector<HTMLButtonElement>('.beadsform-single-question-controls--top button:nth-child(2)')!.click();
    expect(questions[0]!.hidden).toBe(true);
    expect(questions[1]!.hidden).toBe(false);
  });
});
