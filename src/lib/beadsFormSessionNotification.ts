/// <reference types="node" />

import { stripGeneratedBeadsFormFields } from '@vibe-dashboard/beads-form';

import { normalizeSubmittedValues, type BeadsFormDefinition, type JsonObject } from './beadsFormCore.ts';
import { beadsFormSubmissionXml } from './beadsFormSubmissionHandoff.ts';

export const BEADS_FORM_SESSION_NOTIFICATION_MAX_BYTES = 256 * 1024;

const SESSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidBeadsFormSessionId(value: unknown): value is string {
  return typeof value === 'string' && SESSION_ID_PATTERN.test(value);
}

export function buildBeadsFormSessionNotification(args: {
  beadId: string;
  form: BeadsFormDefinition;
  values: JsonObject;
  submittedAt: string;
  submittedBy: string;
  maxBytes?: number;
}): string {
  const { responses: _responses, ...leanForm } = stripGeneratedBeadsFormFields(args.form) as ReturnType<typeof stripGeneratedBeadsFormFields> & {
    responses?: unknown;
  };
  const values = normalizeSubmittedValues(args.form, args.values);
  const message = [
    `A BeadsForm response was saved for bead ${args.beadId}, form ${args.form.id}.`,
    '',
    'Canonical lean BeadsForm DSL:',
    '```json',
    JSON.stringify(leanForm, null, 2),
    '```',
    '',
    'Normalized structured response:',
    '```json',
    JSON.stringify(values, null, 2),
    '```',
    '',
    'BeadsForm XML handoff:',
    beadsFormSubmissionXml({
      beadId: args.beadId,
      formId: args.form.id,
      submittedAt: args.submittedAt,
      submittedBy: args.submittedBy,
      values,
    }),
    '',
    'Please use `vibe-agent full_summary` to catch up before processing this response.',
  ].join('\n');

  const maxBytes = args.maxBytes ?? BEADS_FORM_SESSION_NOTIFICATION_MAX_BYTES;
  const size = Buffer.byteLength(message, 'utf8');
  if (size > maxBytes) {
    throw new Error(`creating-session notification exceeds the ${maxBytes}-byte safety limit (${size} bytes)`);
  }
  return message;
}
