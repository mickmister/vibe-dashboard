// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { initializeChoiceGroups } from './beadsFormChoiceGroups';
import { applyValuesToForm } from './beadsFormPreviewState';

function groupConfig(input: unknown): string {
  return JSON.stringify(input).replace(/"/g, '&quot;');
}

describe('BeadsForm checkbox choice groups', () => {
  it('enforces at-most-one groups while leaving ungrouped choices multiple-select', () => {
    document.body.innerHTML = `
      <form>
        <input type="hidden" name="__beadsform_choice_group_scope_timing" value="${groupConfig({
          questionId: 'scope',
          id: 'timing',
          mode: 'atMostOne',
          choiceIds: ['now', 'later'],
        })}">
        <input name="scope" type="checkbox" value="now">
        <input name="scope" type="checkbox" value="later">
        <input name="scope" type="checkbox" value="add_tests">
        <input name="scope" type="checkbox" value="add_docs">
      </form>
    `;
    initializeChoiceGroups(document.body);
    const [now, later, addTests, addDocs] = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'));

    now!.click();
    later!.click();
    addTests!.click();
    addDocs!.click();

    expect([now!.checked, later!.checked, addTests!.checked, addDocs!.checked]).toEqual([false, true, true, true]);
  });

  it('starts exactly-one groups at defaultChoiceId and restores a different draft choice over the default', () => {
    document.body.innerHTML = `
      <form>
        <input type="hidden" name="__beadsform_choice_group_scope_risk" value="${groupConfig({
          questionId: 'scope',
          id: 'risk',
          mode: 'exactlyOne',
          choiceIds: ['low', 'high', 'none'],
          defaultChoiceId: 'none',
        })}">
        <input name="scope" type="checkbox" value="low">
        <input name="scope" type="checkbox" value="high">
        <input name="scope" type="checkbox" value="none" checked>
      </form>
    `;
    const form = document.querySelector('form')!;
    initializeChoiceGroups(document.body);
    const [low, high, none] = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'));
    expect([low!.checked, high!.checked, none!.checked]).toEqual([false, false, true]);

    applyValuesToForm(form, { scope: { low: false, high: true, none: false } });
    initializeChoiceGroups(document.body);

    expect([low!.checked, high!.checked, none!.checked]).toEqual([false, true, false]);
  });
});
