// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  applyValuesToForm,
  previewStorageKey,
  readPreviewStorage,
  setFormFieldsReadOnly,
  setSubmitButtonsDisabled,
  startPreviewEdit,
  stripCompiledFormHeader,
  writePreviewDraft,
  writePreviewSubmission,
} from './beadsFormPreviewState';

describe('BeadsForm preview state helpers', () => {
  it('persists drafts, latest submission, and submission history in localStorage', () => {
    const key = previewStorageKey({ folder: '/tmp/forms', formId: 'review' });
    localStorage.clear();

    writePreviewDraft(localStorage, key, { notes: 'draft' });
    expect(readPreviewStorage(localStorage, key)).toEqual({ draft: { notes: 'draft' }, history: [] });

    writePreviewSubmission(localStorage, key, { notes: 'submitted' }, '2026-07-15T00:00:00Z');
    expect(readPreviewStorage(localStorage, key)).toEqual({
      draft: { notes: 'submitted' },
      latest: { notes: 'submitted' },
      history: [{ submittedAt: '2026-07-15T00:00:00Z', values: { notes: 'submitted' } }],
    });

    startPreviewEdit(localStorage, key);
    writePreviewDraft(localStorage, key, { notes: 'edited draft' });
    expect(readPreviewStorage(localStorage, key)).toEqual({
      draft: { notes: 'edited draft' },
      latest: { notes: 'submitted' },
      editing: true,
      history: [{ submittedAt: '2026-07-15T00:00:00Z', values: { notes: 'submitted' } }],
    });
  });

  it('applies values to controls and disables submit buttons', () => {
    document.body.innerHTML = `
      <form>
        <input name="choice" type="checkbox" value="a">
        <input name="choice" type="checkbox" value="b">
        <textarea name="choice_a_more_info"></textarea>
        <button type="submit" value="true">Allow</button>
        <button value="default-submit">Default Submit</button>
        <input type="submit" value="false">
      </form>
    `;
    const form = document.querySelector('form')!;

    applyValuesToForm(form, { choice: { a: true, b: false }, choice_a_more_info: 'Because' });
    const choices = Array.from(form.querySelectorAll<HTMLInputElement>('input[name="choice"]'));
    expect(choices.map((choice) => choice.checked)).toEqual([true, false]);
    expect(form.querySelector('textarea')?.value).toBe('Because');

    setSubmitButtonsDisabled(form, true);
    expect(Array.from(form.querySelectorAll<HTMLButtonElement | HTMLInputElement>('button, input[type="submit"]')).map((button) => button.disabled)).toEqual([true, true, true]);

    setFormFieldsReadOnly(form, true);
    expect(choices.map((choice) => choice.disabled)).toEqual([true, true]);
    expect(form.querySelector('textarea')?.disabled).toBe(true);
  });

  it('strips only the generated form header from selected preview html', () => {
    expect(stripCompiledFormHeader('<form><header><h2>Title</h2><p>Desc</p></header><fieldset></fieldset></form>'))
      .toBe('<form><fieldset></fieldset></form>');
  });
});
