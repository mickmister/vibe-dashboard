import { initializeCompactMoreInfo, refreshCompactMoreInfoState } from './beadsFormMoreInfo';
import { applyValuesToForm, setFormFieldsReadOnly, setSubmitButtonsDisabled } from './beadsFormPreviewState';
import { initializeSingleQuestionMode } from './beadsFormSingleQuestion';
import type { JsonObject } from './beadsFormCore';

export function preserveSubmittedFormDom(
  host: HTMLElement | null,
  values: JsonObject,
  options: { lock: boolean; singleQuestionMode: boolean },
): void {
  const apply = () => {
    if (!host) return;
    if (options.singleQuestionMode) initializeSingleQuestionMode(host);
    initializeCompactMoreInfo(host);
    const form = host.querySelector('form');
    if (!form) return;
    applyValuesToForm(form, values);
    refreshCompactMoreInfoState(host);
    setSubmitButtonsDisabled(form, options.lock);
    setFormFieldsReadOnly(form, options.lock);
  };

  apply();
  if (typeof window !== 'undefined') {
    window.setTimeout(apply, 0);
  }
}
