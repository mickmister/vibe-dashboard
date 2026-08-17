import { initializeCompactMoreInfo, refreshCompactMoreInfoState } from './beadsFormMoreInfo';
import { applyValuesToForm, setFormFieldsReadOnly, setSubmitButtonsDisabled } from './beadsFormPreviewState';
import { initializeSingleQuestionMode, refreshSingleQuestionAdditionalNotes } from './beadsFormSingleQuestion';
import type { JsonObject } from './beadsFormCore';

export function preserveSubmittedFormDom(
  host: HTMLElement | null,
  values: JsonObject,
  options: { lock: boolean; singleQuestionMode: boolean; singleQuestionModeUrlState?: boolean },
): void {
  const apply = () => {
    if (!host) return;
    if (options.singleQuestionMode) initializeSingleQuestionMode(host, { urlState: options.singleQuestionModeUrlState });
    initializeCompactMoreInfo(host);
    const form = host.querySelector('form');
    if (!form) return;
    applyValuesToForm(form, values);
    refreshSingleQuestionAdditionalNotes(host);
    refreshCompactMoreInfoState(host);
    setSubmitButtonsDisabled(form, options.lock);
    setFormFieldsReadOnly(form, options.lock);
  };

  apply();
  if (typeof window !== 'undefined') {
    window.setTimeout(apply, 0);
  }
}
