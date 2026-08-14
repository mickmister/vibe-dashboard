// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initializeCompactMoreInfo } from './beadsFormMoreInfo';
import { initializeSingleQuestionMode, prehideInactiveSingleQuestionItems } from './beadsFormSingleQuestion';

describe('BeadsForm single-question mode', () => {
  beforeEach(() => {
    window.history.pushState(null, '', '/dashboard/forms');
  });

  it('pre-hides inactive questions before wizard initialization to prevent all-question flashes', () => {
    window.history.pushState(null, '', '/dashboard/forms?formQuestion=2');

    const html = prehideInactiveSingleQuestionItems(`
      <form>
        <fieldset><legend>First question</legend><input name="first"></fieldset>
        <fieldset><legend>Second question</legend><input name="second"></fieldset>
        <fieldset><legend>Additional notes</legend><textarea name="additional_notes"></textarea></fieldset>
        <div class="beads-form-submit-actions"><button type="submit">Submit</button></div>
      </form>
    `);
    document.body.innerHTML = html;

    const fieldsets = Array.from(document.querySelectorAll<HTMLFieldSetElement>('fieldset'));
    expect(fieldsets[0]!.hidden).toBe(true);
    expect(fieldsets[1]!.hidden).toBe(false);
    expect(fieldsets[2]!.hidden).toBe(false);
    expect(document.querySelector<HTMLElement>('.beads-form-submit-actions')!.hidden).toBe(true);

    initializeSingleQuestionMode(document.body);

    const questionItems = Array.from(document.querySelectorAll<HTMLFieldSetElement>('.beadsform-single-question-item'));
    expect(document.querySelector('.beadsform-single-question-progress')?.textContent).toBe('Question 2 of 2');
    expect(questionItems[0]!.hidden).toBe(true);
    expect(questionItems[1]!.hidden).toBe(false);
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
      'beadsform-single-question-controls beadsform-single-question-controls--top',
      'beadsform-single-question-notes',
      'beadsform-single-question-progress-toggle',
      'beadsform-single-question-progress',
      'beadsform-single-question-item',
      'beadsform-single-question-item',
      'beadsform-single-question-review',
      'beadsform-single-question-controls beadsform-single-question-controls--bottom',
    ]);
    expect(document.querySelector('.beadsform-single-question-progress')?.previousElementSibling?.className).toBe('beadsform-single-question-progress-toggle');
    expect(document.querySelector('.beadsform-single-question-progress')?.nextElementSibling?.textContent).toContain('First question');
    expect(document.querySelectorAll('.beadsform-single-question-controls')).toHaveLength(2);
    expect(document.querySelector('.beadsform-single-question-controls--top')?.getAttribute('role')).toBe('group');
    expect(document.querySelector('.beadsform-single-question-controls--top')?.getAttribute('aria-label')).toBe('Top question navigation');
    expect(Array.from(document.querySelectorAll('.beadsform-single-question-list-button')).map((button) => button.textContent)).toEqual([
      'First question',
      'Second question',
      'Review answers',
    ]);

    document.querySelectorAll<HTMLButtonElement>('.beadsform-single-question-controls button')[1]!.click();
    expect(document.querySelector('.beadsform-single-question-progress')?.textContent).toBe('Question 2 of 2');
    expect(questionItems[0]!.hidden).toBe(true);
    expect(questionItems[1]!.hidden).toBe(false);
    expect(document.querySelector<HTMLElement>('.beads-form-submit-actions')?.hidden).toBe(true);
    expect(Array.from(document.querySelectorAll<HTMLButtonElement>('.beadsform-single-question-controls button:nth-child(2)')).every((button) => !button.hidden && button.textContent === 'Review answers')).toBe(true);

    document.querySelectorAll<HTMLButtonElement>('.beadsform-single-question-controls button')[1]!.click();
    expect(document.querySelector('.beadsform-single-question-progress')?.textContent).toBe('Review answers');
    expect(questionItems.every((question) => question.hidden)).toBe(true);
    expect(document.querySelector<HTMLElement>('.beadsform-single-question-review')?.hidden).toBe(false);
    expect(document.querySelector<HTMLElement>('.beads-form-submit-actions')?.hidden).toBe(false);
  });

  it('shows progress on first and last questions while hiding middle progress behind an accessible toggle', () => {
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

    const progress = document.querySelector<HTMLElement>('.beadsform-single-question-progress')!;
    const toggle = document.querySelector<HTMLButtonElement>('.beadsform-single-question-progress-toggle')!;
    expect(progress.textContent).toBe('Question 1 of 3');
    expect(progress.hidden).toBe(false);
    expect(toggle.hidden).toBe(true);

    document.querySelectorAll<HTMLButtonElement>('.beadsform-single-question-controls button')[1]!.click();

    expect(progress.textContent).toBe('Question 2 of 3');
    expect(progress.hidden).toBe(true);
    expect(toggle.hidden).toBe(false);
    expect(toggle.textContent).toBe('Show progress');
    expect(toggle.getAttribute('aria-label')).toBe('Show question progress');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.getAttribute('aria-controls')).toBe(progress.id);

    toggle.click();
    expect(progress.hidden).toBe(false);
    expect(toggle.textContent).toBe('Hide progress');
    expect(toggle.getAttribute('aria-label')).toBe('Hide question progress');
    expect(toggle.getAttribute('aria-expanded')).toBe('true');

    toggle.click();
    expect(progress.hidden).toBe(true);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');

    document.querySelectorAll<HTMLButtonElement>('.beadsform-single-question-controls button')[1]!.click();

    expect(progress.textContent).toBe('Question 3 of 3');
    expect(progress.hidden).toBe(false);
    expect(toggle.hidden).toBe(true);
  });

  it('keeps top and bottom navigation controls synchronized', () => {
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

    const topPrevious = document.querySelector<HTMLButtonElement>('.beadsform-single-question-controls--top button:first-child')!;
    const topNext = document.querySelector<HTMLButtonElement>('.beadsform-single-question-controls--top button:nth-child(2)')!;
    const bottomPrevious = document.querySelector<HTMLButtonElement>('.beadsform-single-question-controls--bottom button:first-child')!;
    const bottomNext = document.querySelector<HTMLButtonElement>('.beadsform-single-question-controls--bottom button:nth-child(2)')!;

    expect(topPrevious.disabled).toBe(true);
    expect(bottomPrevious.disabled).toBe(true);
    expect(topNext.hidden).toBe(false);
    expect(bottomNext.hidden).toBe(false);

    topNext.click();
    expect(document.querySelector('.beadsform-single-question-progress')?.textContent).toBe('Question 2 of 3');
    expect(topPrevious.disabled).toBe(false);
    expect(bottomPrevious.disabled).toBe(false);
    expect(topNext.hidden).toBe(false);
    expect(bottomNext.hidden).toBe(false);

    bottomNext.click();
    expect(document.querySelector('.beadsform-single-question-progress')?.textContent).toBe('Question 3 of 3');
    expect(topNext.hidden).toBe(false);
    expect(bottomNext.hidden).toBe(false);
    expect(topNext.textContent).toBe('Review answers');
    expect(bottomNext.textContent).toBe('Review answers');

    bottomNext.click();
    expect(document.querySelector('.beadsform-single-question-progress')?.textContent).toBe('Review answers');
    expect(topNext.hidden).toBe(true);
    expect(bottomNext.hidden).toBe(true);

    topPrevious.click();
    expect(document.querySelector('.beadsform-single-question-progress')?.textContent).toBe('Question 3 of 3');
    expect(topNext.hidden).toBe(false);
    expect(bottomNext.hidden).toBe(false);
  });

  it('can initialize wizard mode without writing aggregate card navigation to URL state', () => {
    window.history.pushState(null, '', '/dashboard/forms/aggregate?dir=%2Frepo&bead=bd-1&form=review');
    document.body.innerHTML = `
      <div id="host">
        <form>
          <fieldset><legend>First</legend><input name="first"></fieldset>
          <fieldset><legend>Second</legend><input name="second"></fieldset>
        </form>
      </div>
    `;

    initializeSingleQuestionMode(document.querySelector('#host')!, { urlState: false });

    document.querySelector<HTMLButtonElement>('.beadsform-single-question-controls--top button:nth-child(2)')!.click();
    expect(document.querySelector('.beadsform-single-question-progress')?.textContent).toBe('Question 2 of 2');
    expect(new URL(window.location.href).searchParams.get('formQuestion')).toBeNull();
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

  it('scrolls the active question content into view below the progress toggle when navigation changes the active question', () => {
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
      expect(scrollIntoView.mock.contexts[0]).toBe(document.querySelectorAll<HTMLFieldSetElement>('.beadsform-single-question-item')[1]);

      scrollIntoView.mockClear();
      document.querySelectorAll<HTMLButtonElement>('.beadsform-single-question-list-button')[2]!.click();

      expect(scrollIntoView).toHaveBeenCalledTimes(1);
      expect(document.querySelector('.beadsform-single-question-progress')?.textContent).toBe('Question 3 of 3');
      expect(scrollIntoView.mock.contexts[0]).toBe(document.querySelectorAll<HTMLFieldSetElement>('.beadsform-single-question-item')[2]);
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
          <fieldset><legend>First</legend><div class="beads-form-choice"><textarea id="first_choice_more_info" name="first_choice_more_info"></textarea></div><textarea id="first_more_info" name="first_more_info"></textarea></fieldset>
          <fieldset><legend>Second</legend><div class="beads-form-choice"><textarea id="second_choice_more_info" name="second_choice_more_info"></textarea></div><textarea id="second_more_info" name="second_more_info"></textarea></fieldset>
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
    expect(document.querySelector('.beadsform-single-question-progress-toggle')?.previousElementSibling).toBe(notesPanel);
    expect(progress.previousElementSibling?.className).toBe('beadsform-single-question-progress-toggle');
    expect(progress.nextElementSibling?.textContent).toContain('First');
    expect(document.querySelectorAll('.beads-form-more-info-toggle')).toHaveLength(2);
    expect(document.querySelector<HTMLTextAreaElement>('#first_more_info')?.hidden).toBe(false);
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

  it('shows a compact review step with answers before submit and edits jump back to the question', () => {
    document.body.innerHTML = `
      <div id="host">
        <form>
          <fieldset>
            <legend>Scope choice</legend>
            <div class="beads-form-choice">
              <label for="scope_fix"><input id="scope_fix" name="scope" type="checkbox" value="fix" checked> Fix the bug <span class="beads-form-default" aria-label="Default selected choice">Default</span></label>
              <textarea name="scope_fix_more_info">Only the regression</textarea>
            </div>
            <div class="beads-form-choice">
              <label for="scope_refactor"><input id="scope_refactor" name="scope" type="checkbox" value="refactor"> Refactor broadly</label>
              <textarea name="scope_refactor_more_info"></textarea>
            </div>
            <textarea name="scope_more_info">Keep it small</textarea>
          </fieldset>
          <fieldset>
            <legend>Implementation notes</legend>
            <label for="notes">Implementation notes</label>
            <textarea id="notes" name="notes">Use the cached draft</textarea>
            <textarea name="notes_more_info"></textarea>
          </fieldset>
          <fieldset>
            <legend>Optional follow-up</legend>
            <label for="followup">Optional follow-up</label>
            <input id="followup" name="followup">
          </fieldset>
          <fieldset hidden><legend>Additional Notes</legend><textarea name="additional_notes" hidden></textarea></fieldset>
          <div class="beads-form-submit-actions"><button type="submit">Submit</button></div>
        </form>
      </div>
    `;
    initializeSingleQuestionMode(document.querySelector('#host')!);

    document.querySelectorAll<HTMLButtonElement>('.beadsform-single-question-list-button')[3]!.click();

    const review = document.querySelector<HTMLElement>('.beadsform-single-question-review')!;
    expect(review.hidden).toBe(false);
    expect(document.querySelector('.beadsform-single-question-progress')?.textContent).toBe('Review answers');
    expect(Array.from(document.querySelectorAll<HTMLFieldSetElement>('.beadsform-single-question-item')).every((question) => question.hidden)).toBe(true);
    expect(review.textContent).toContain('Scope choice');
    expect(review.textContent).toContain('Selected choices: Fix the bug');
    expect(review.textContent).not.toContain('Selected choices: Fix the bug Default');
    expect(review.textContent).toContain('Note for Fix the bug: Only the regression');
    expect(review.textContent).toContain('Question notes: Keep it small');
    expect(review.textContent).toContain('Implementation notes');
    expect(review.textContent).toContain('Answer: Use the cached draft');
    expect(review.textContent).toContain('Optional follow-up');
    expect(review.textContent).toContain('Answer: Unanswered');
    expect(review.textContent).toContain('Additional Notes');
    expect(review.textContent).toContain('Answer: Unanswered');
    expect(document.querySelector<HTMLElement>('.beads-form-submit-actions')?.hidden).toBe(false);

    document.querySelector<HTMLButtonElement>('[data-beadsform-review-edit="1"]')!.click();

    expect(document.querySelector('.beadsform-single-question-progress')?.textContent).toBe('Question 2 of 3');
    expect(document.querySelector<HTMLTextAreaElement>('#notes')?.value).toBe('Use the cached draft');
    expect(review.hidden).toBe(true);
    expect(document.querySelector<HTMLElement>('.beads-form-submit-actions')?.hidden).toBe(true);
  });

  it('routes submit attempts to review after valid questions instead of submitting from the final question', () => {
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
    document.querySelectorAll<HTMLButtonElement>('.beadsform-single-question-list-button')[1]!.click();

    const form = document.querySelector('form')!;
    const submitEvent = new SubmitEvent('submit', { bubbles: true, cancelable: true });
    const notCancelled = form.dispatchEvent(submitEvent);

    expect(notCancelled).toBe(false);
    expect(document.querySelector('.beadsform-single-question-progress')?.textContent).toBe('Review answers');
    expect(document.querySelector<HTMLElement>('.beadsform-single-question-review')?.hidden).toBe(false);
    expect(document.querySelector<HTMLElement>('.beads-form-submit-actions')?.hidden).toBe(false);
  });

  it('keeps final review submit actions at the bottom of the wizard review flow', () => {
    document.body.innerHTML = `
      <div id="host">
        <form>
          <fieldset><legend>First</legend><input name="first" value="ok" required></fieldset>
          <fieldset><legend>Second</legend><input name="second" value="ok" required></fieldset>
          <div class="beads-form-submit-actions" role="group" aria-label="Submit intent">
            <p>Choose how to submit.</p>
            <button name="allow_code_file_changes" type="submit" value="true">Submit and allow implementation for the selected next milestone</button>
            <button name="allow_code_file_changes" type="submit" value="false">Submit for planning only; no code/file changes</button>
          </div>
        </form>
      </div>
    `;
    initializeSingleQuestionMode(document.querySelector('#host')!);

    document.querySelectorAll<HTMLButtonElement>('.beadsform-single-question-list-button')[2]!.click();

    const review = document.querySelector<HTMLElement>('.beadsform-single-question-review')!;
    const submitActions = document.querySelector<HTMLElement>('.beads-form-submit-actions')!;
    expect(review.hidden).toBe(false);
    expect(submitActions.hidden).toBe(false);
    expect(submitActions.parentElement).toBe(review);
    expect(review.lastElementChild).toBe(submitActions);
    expect(Array.from(submitActions.querySelectorAll<HTMLButtonElement>('button')).map((button) => button.value)).toEqual(['true', 'false']);
  });

  it('preserves review state in the URL and allows submit from review', () => {
    window.history.pushState(null, '', '/dashboard/forms?dir=%2Frepo&bead=bd-1&form=review');
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

    document.querySelectorAll<HTMLButtonElement>('.beadsform-single-question-list-button')[2]!.click();

    let params = new URLSearchParams(window.location.search);
    expect(params.get('formReview')).toBe('1');
    expect(params.get('formQuestion')).toBeNull();
    expect(params.get('dir')).toBe('/repo');
    expect(document.querySelector('.beadsform-single-question-progress')?.textContent).toBe('Review answers');

    const form = document.querySelector('form')!;
    const submitEvent = new SubmitEvent('submit', { bubbles: true, cancelable: true });
    const notCancelled = form.dispatchEvent(submitEvent);

    expect(notCancelled).toBe(true);

    document.querySelector<HTMLButtonElement>('[data-beadsform-review-edit="0"]')!.click();
    params = new URLSearchParams(window.location.search);
    expect(params.get('formQuestion')).toBe('1');
    expect(params.get('formReview')).toBeNull();
  });
});
