import type { JsonObject } from './beadsFormCore';

export type ClipboardCopyResult = {
  copied: boolean;
  text: string;
  warning?: string;
};

export function normalizedSubmittedResultJson(values: JsonObject): string {
  return JSON.stringify(values, null, 2);
}

export async function copyNormalizedSubmittedResultJson(
  clipboard: Pick<Clipboard, 'writeText'> | undefined,
  values: JsonObject,
): Promise<ClipboardCopyResult> {
  const text = normalizedSubmittedResultJson(values);
  if (!clipboard) {
    return {
      copied: false,
      text,
      warning: 'Clipboard copy is unavailable. Use the manual copy field below.',
    };
  }

  try {
    await clipboard.writeText(text);
    return { copied: true, text };
  } catch (error) {
    return {
      copied: false,
      text,
      warning: `Clipboard copy failed: ${error instanceof Error ? error.message : String(error)}. Use the manual copy field below.`,
    };
  }
}
