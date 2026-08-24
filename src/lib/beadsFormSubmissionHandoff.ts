export type BeadsFormSubmissionHandoffMetadata = {
  beadId?: string;
  formId?: string;
  submittedAt?: string;
  submittedBy?: string;
};

export type BeadsFormSubmissionHandoffInput = BeadsFormSubmissionHandoffMetadata & {
  values: Record<string, unknown>;
};

export function beadsFormSubmissionXml(input: BeadsFormSubmissionHandoffInput): string {
  const lines = ['<beadsFormSubmission>'];
  const metadata = metadataEntries(input);
  if (metadata.length > 0) {
    lines.push('  <metadata>');
    for (const [name, value] of metadata) {
      lines.push(`    <${name}>${escapeXmlText(value)}</${name}>`);
    }
    lines.push('  </metadata>');
  }
  lines.push('  <answers>');
  for (const [id, value] of Object.entries(input.values)) {
    lines.push(...answerLines(id, value, '    '));
  }
  lines.push('  </answers>');
  lines.push('</beadsFormSubmission>');
  return lines.join('\n');
}

function metadataEntries(input: BeadsFormSubmissionHandoffInput): [string, string][] {
  const entries: [string, string][] = [];
  if (input.beadId) entries.push(['beadId', input.beadId]);
  if (input.formId) entries.push(['formId', input.formId]);
  if (input.submittedAt) entries.push(['submittedAt', input.submittedAt]);
  if (input.submittedBy) entries.push(['submittedBy', input.submittedBy]);
  return entries;
}

function answerLines(id: string, value: unknown, indent: string): string[] {
  if (isBooleanMap(value)) {
    return choiceGroupLines(id, value, indent);
  }
  const tag = answerTagForId(id);
  const type = scalarType(value);
  return [`${indent}<${tag} id="${escapeXmlAttribute(id)}" type="${type}">${escapeXmlText(stringifyValue(value))}</${tag}>`];
}

function choiceGroupLines(id: string, choices: Record<string, boolean>, indent: string): string[] {
  const lines = [`${indent}<choiceGroup id="${escapeXmlAttribute(id)}">`];
  for (const [choiceId, selected] of Object.entries(choices)) {
    lines.push(`${indent}  <choice id="${escapeXmlAttribute(choiceId)}" selected="${selected ? 'true' : 'false'}" />`);
  }
  lines.push(`${indent}</choiceGroup>`);
  return lines;
}

function answerTagForId(id: string): 'additionalNotes' | 'note' | 'answer' {
  if (id === 'additional_notes' || id === 'overall_more_info') return 'additionalNotes';
  if (id.endsWith('_more_info')) return 'note';
  return 'answer';
}

function scalarType(value: unknown): string {
  if (typeof value === 'string') return 'markdown';
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'number') return 'number';
  if (Array.isArray(value)) return 'list';
  if (value === null) return 'null';
  return 'json';
}

function stringifyValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value);
  if (Array.isArray(value)) return value.map((item) => stringifyValue(item)).join('\n');
  return JSON.stringify(value, null, 2);
}

function isBooleanMap(value: unknown): value is Record<string, boolean> {
  return !!value
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.keys(value).length > 0
    && Object.values(value).every((item) => typeof item === 'boolean');
}

function escapeXmlText(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function escapeXmlAttribute(value: string): string {
  return escapeXmlText(value)
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}
