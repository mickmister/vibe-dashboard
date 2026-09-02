// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  applyValuesToForm,
  beadFormStorageKey,
  clearPreviewStorage,
  latestSubmittedResponseValues,
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
  it('scopes bead-backed storage keys by workspace or repo, bead, and form', () => {
    expect(beadFormStorageKey({
      workspaceId: 'workspace-1',
      dir: '/repo-a',
      beadId: 'beads-web-1',
      formId: 'review',
    })).not.toBe(beadFormStorageKey({
      workspaceId: 'workspace-2',
      dir: '/repo-a',
      beadId: 'beads-web-1',
      formId: 'review',
    }));
    expect(beadFormStorageKey({
      workspaceId: 'workspace-1',
      dir: '/repo-a',
      beadId: 'beads-web-1',
      formId: 'review',
    })).not.toBe(beadFormStorageKey({
      workspaceId: 'workspace-1',
      dir: '/repo-b',
      beadId: 'beads-web-1',
      formId: 'review',
    }));
    expect(beadFormStorageKey({
      dir: '/repo-a',
      beadId: 'beads-web-1',
      formId: 'review',
    })).not.toBe(beadFormStorageKey({
      dir: '/repo-b',
      beadId: 'beads-web-1',
      formId: 'review',
    }));
  });

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

  it('saves and restores bead-backed drafts with the scoped storage key', () => {
    const key = beadFormStorageKey({
      workspaceId: 'workspace-1',
      dir: '/repo-a',
      beadId: 'beads-web-1',
      formId: 'review',
    });
    localStorage.clear();
    writePreviewDraft(localStorage, key, { comment: 'Saved draft' });

    document.body.innerHTML = '<form><textarea name="comment"></textarea></form>';
    const form = document.querySelector('form')!;
    const snapshot = readPreviewStorage(localStorage, key);
    applyValuesToForm(form, snapshot.draft ?? {});

    expect(form.querySelector('textarea')?.value).toBe('Saved draft');
  });

  it('clears bead-backed localStorage after successful backend submission', () => {
    const key = beadFormStorageKey({
      workspaceId: 'workspace-1',
      dir: '/repo-a',
      beadId: 'beads-web-1',
      formId: 'review',
    });
    localStorage.clear();

    writePreviewDraft(localStorage, key, { comment: 'Unsaved draft' });
    expect(readPreviewStorage(localStorage, key)).toEqual({ draft: { comment: 'Unsaved draft' }, history: [] });

    clearPreviewStorage(localStorage, key);

    expect(localStorage.getItem(key)).toBeNull();
    expect(readPreviewStorage(localStorage, key)).toEqual({ history: [] });
  });

  it('selects latest backend response values so stale local drafts do not override persisted submissions', () => {
    expect(latestSubmittedResponseValues([
      { submittedBy: 'user', submittedAt: '2026-07-15T00:00:00Z', values: { comment: 'Older' } },
      { submittedBy: 'user', submittedAt: '2026-07-16T00:00:00Z', values: { comment: 'Latest backend' } },
    ])).toEqual({ comment: 'Latest backend' });
    expect(latestSubmittedResponseValues(undefined)).toBeUndefined();
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

  it('lets restored drafts clear compiler-provided default checked choices', () => {
    document.body.innerHTML = `
      <form>
        <input name="priority" type="checkbox" value="storage" checked>
        <input name="priority" type="checkbox" value="copy_result">
      </form>
    `;
    const form = document.querySelector('form')!;

    applyValuesToForm(form, { priority: { storage: false, copy_result: true } });

    const choices = Array.from(form.querySelectorAll<HTMLInputElement>('input[name="priority"]'));
    expect(choices.map((choice) => choice.checked)).toEqual([false, true]);
  });

  it('strips only the generated form header from selected preview html', () => {
    expect(stripCompiledFormHeader('<form><header><h2>Title</h2><p>Desc</p></header><fieldset></fieldset></form>'))
      .toBe('<form><fieldset></fieldset></form>');
  });
});
