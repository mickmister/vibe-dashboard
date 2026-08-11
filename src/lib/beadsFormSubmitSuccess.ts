import type { JsonObject } from './beadsFormCore';

export type ClipboardCopyResult = {
  status: 'pending' | 'copied' | 'failed' | 'unavailable';
  text: string;
  warning?: string;
};

export function normalizedSubmittedResultJson(values: JsonObject): string {
  return JSON.stringify(values, null, 2);
}

export function pendingNormalizedSubmittedResultCopy(values: JsonObject): ClipboardCopyResult {
  return {
    status: 'pending',
    text: normalizedSubmittedResultJson(values),
  };
}

export async function copyNormalizedSubmittedResultJson(
  clipboard: Pick<Clipboard, 'writeText'> | undefined,
  values: JsonObject,
): Promise<ClipboardCopyResult> {
  const text = normalizedSubmittedResultJson(values);
  if (!clipboard) {
    return {
      status: 'unavailable',
      text,
      warning: 'Clipboard copy is unavailable. Use the manual copy field below.',
    };
  }

  try {
    await clipboard.writeText(text);
    return { status: 'copied', text };
  } catch (error) {
    return {
      status: 'failed',
      text,
      warning: `Clipboard copy failed: ${error instanceof Error ? error.message : String(error)}. Use the manual copy field below.`,
    };
  }
}
