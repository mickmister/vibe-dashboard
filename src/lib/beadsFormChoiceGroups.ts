export type ChoiceGroupCleanup = () => void;

type ChoiceGroupConfig = {
  questionId: string;
  id: string;
  mode: 'any' | 'atMostOne' | 'exactlyOne';
  choiceIds: string[];
};

const GROUP_CONFIG_PREFIX = '__beadsform_choice_group_';

export function initializeChoiceGroups(host: ParentNode): ChoiceGroupCleanup {
  const cleanups: ChoiceGroupCleanup[] = [];
  for (const input of Array.from(host.querySelectorAll<HTMLInputElement>(`input[type="hidden"][name^="${GROUP_CONFIG_PREFIX}"]`))) {
    const config = parseConfig(input.value);
    if (!config || config.mode === 'any') continue;
    const form = input.closest('form');
    if (!form) continue;
    const checkboxes = config.choiceIds
      .map((choiceId) => Array.from(form.querySelectorAll<HTMLInputElement>(`input[type="checkbox"][name="${cssString(config.questionId)}"]`))
        .find((candidate) => candidate.value === choiceId))
      .filter((candidate): candidate is HTMLInputElement => !!candidate);
    if (checkboxes.length === 0) continue;

    enforceGroup(config, checkboxes);
    const listeners = checkboxes.map((checkbox) => {
      const listener = () => enforceGroup(config, checkboxes, checkbox);
      checkbox.addEventListener('change', listener);
      return () => checkbox.removeEventListener('change', listener);
    });
    cleanups.push(...listeners);
    cleanups.push(() => checkboxes[0]?.setCustomValidity(''));
  }
  return () => {
    cleanups.forEach((cleanup) => cleanup());
  };
}

function parseConfig(value: string): ChoiceGroupConfig | undefined {
  try {
    const parsed = JSON.parse(value) as Partial<ChoiceGroupConfig>;
    if (
      typeof parsed.questionId !== 'string'
      || typeof parsed.id !== 'string'
      || !['any', 'atMostOne', 'exactlyOne'].includes(String(parsed.mode))
      || !Array.isArray(parsed.choiceIds)
      || !parsed.choiceIds.every((choiceId) => typeof choiceId === 'string')
    ) return undefined;
    return {
      questionId: parsed.questionId,
      id: parsed.id,
      mode: parsed.mode as ChoiceGroupConfig['mode'],
      choiceIds: parsed.choiceIds,
    };
  } catch {
    return undefined;
  }
}

function enforceGroup(
  config: ChoiceGroupConfig,
  checkboxes: HTMLInputElement[],
  changed?: HTMLInputElement,
): void {
  if (changed?.checked) {
    checkboxes.forEach((checkbox) => {
      if (checkbox !== changed) checkbox.checked = false;
    });
    updateValidity(config, checkboxes);
    return;
  }

  const checked = checkboxes.filter((checkbox) => checkbox.checked);
  if (checked.length > 1) {
    const keep = changed && checked.includes(changed) ? changed : checked[0]!;
    checkboxes.forEach((checkbox) => {
      checkbox.checked = checkbox === keep;
    });
    updateValidity(config, checkboxes);
    return;
  }

  if (changed && config.mode === 'exactlyOne' && checked.length === 0) {
    changed.checked = true;
  }
  updateValidity(config, checkboxes);
}

function updateValidity(config: ChoiceGroupConfig, checkboxes: HTMLInputElement[]): void {
  const valid = config.mode !== 'exactlyOne' || checkboxes.some((checkbox) => checkbox.checked);
  checkboxes[0]?.setCustomValidity(valid ? '' : 'Select only one choice.');
}

function cssString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}
