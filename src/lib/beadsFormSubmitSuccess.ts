import type { JsonObject } from './beadsFormCore';
import {
  beadsFormSubmissionXml,
  type BeadsFormSubmissionHandoffMetadata,
} from './beadsFormSubmissionHandoff';

export type ClipboardCopyResult = {
  status: 'pending' | 'copied' | 'failed' | 'unavailable';
  text: string;
  warning?: string;
};

export function normalizedSubmittedResultJson(values: JsonObject): string {
  return JSON.stringify(values, null, 2);
}

export function submittedResultHandoffXml(
  values: JsonObject,
  metadata: BeadsFormSubmissionHandoffMetadata = {},
): string {
  return beadsFormSubmissionXml({ values, ...metadata });
}

export function pendingSubmittedResultHandoffCopy(
  values: JsonObject,
  metadata: BeadsFormSubmissionHandoffMetadata = {},
): ClipboardCopyResult {
  return {
    status: 'pending',
    text: submittedResultHandoffXml(values, metadata),
  };
}

export async function copySubmittedResultHandoffXml(
  clipboard: Pick<Clipboard, 'writeText'> | undefined,
  values: JsonObject,
  metadata: BeadsFormSubmissionHandoffMetadata = {},
): Promise<ClipboardCopyResult> {
  const text = submittedResultHandoffXml(values, metadata);
  if (!clipboard) {
    return {
      status: 'unavailable',
      text,
      warning: 'Clipboard copy is unavailable. Use the manual XML handoff field below.',
    };
  }

  try {
    await clipboard.writeText(text);
    return { status: 'copied', text };
  } catch (error) {
    return {
      status: 'failed',
      text,
      warning: `Clipboard copy failed: ${error instanceof Error ? error.message : String(error)}. Use the manual XML handoff field below.`,
    };
  }
}
