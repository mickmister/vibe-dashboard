export type AggregateBeadsFormRef = {
  dir: string;
  beadId: string;
  formId: string;
};

export type AggregateSubmitStatus =
  | { status: 'idle' }
  | { status: 'submitting' }
  | {
    status: 'success';
    values: Record<string, unknown>;
    warnings: string[];
    clipboardStatus: 'pending' | 'copied' | 'failed' | 'unavailable';
    clipboardText: string;
    clipboardWarning?: string;
  }
  | { status: 'error'; message: string };

export function parseAggregateBeadsFormRefs(params: URLSearchParams): AggregateBeadsFormRef[] {
  const entries = Array.from(params.entries());
  if (entries.length === 0) return [];
  if (entries.length % 3 !== 0) {
    throw new Error('Aggregate BeadsForm URLs require repeated dir, bead, form parameter triplets.');
  }
  const seen = new Set<string>();
  const refs: AggregateBeadsFormRef[] = [];
  for (let index = 0; index < entries.length; index += 3) {
    const refIndex = refs.length + 1;
    const [dirKey, dir = ''] = entries[index] ?? [];
    const [beadKey, beadId = ''] = entries[index + 1] ?? [];
    const [formKey, formId = ''] = entries[index + 2] ?? [];
    if (dirKey !== 'dir' || beadKey !== 'bead' || formKey !== 'form') {
      throw new Error('Aggregate BeadsForm URLs require parameters ordered as dir, bead, form triplets.');
    }
    if (!dir.trim()) throw new Error(`Aggregate BeadsForm ref ${refIndex} is missing dir.`);
    if (!beadId.trim()) throw new Error(`Aggregate BeadsForm ref ${refIndex} is missing bead.`);
    if (!formId.trim()) throw new Error(`Aggregate BeadsForm ref ${refIndex} is missing form.`);
    const key = `${dir}\0${beadId}\0${formId}`;
    if (seen.has(key)) throw new Error(`Duplicate aggregate BeadsForm ref: ${beadId}/${formId}`);
    seen.add(key);
    refs.push({ dir, beadId, formId });
  }
  return refs;
}

export function buildAggregateBeadsFormUrl(refs: readonly AggregateBeadsFormRef[]): string {
  const params = new URLSearchParams();
  for (const ref of refs) {
    params.append('dir', ref.dir);
    params.append('bead', ref.beadId);
    params.append('form', ref.formId);
  }
  return `/dashboard/forms/aggregate?${params.toString()}`;
}

export function aggregateFormDomPrefix(ref: AggregateBeadsFormRef): string {
  return `beadsform_agg_${shortStableHash(`${ref.dir}\0${ref.beadId}\0${ref.formId}`)}`;
}

export function namespaceAggregateFormHtml(html: string, prefix: string): string {
  const ids = new Set<string>();
  const withIds = html.replace(/\sid=(["'])([^"']+)\1/g, (match, quote: string, id: string) => {
    ids.add(id);
    return ` id=${quote}${prefixId(prefix, id)}${quote}`;
  });
  return withIds
    .replace(/\sfor=(["'])([^"']+)\1/g, (match, quote: string, value: string) => (
      ids.has(value) ? ` for=${quote}${prefixId(prefix, value)}${quote}` : match
    ))
    .replace(/\s(aria-describedby|aria-labelledby|aria-controls)=(["'])([^"']+)\2/g, (
      match,
      attr: string,
      quote: string,
      value: string,
    ) => {
      const rewritten = value
        .split(/\s+/)
        .filter(Boolean)
        .map((token) => (ids.has(token) ? prefixId(prefix, token) : token))
        .join(' ');
      return ` ${attr}=${quote}${rewritten}${quote}`;
    })
    .replace(/\shref=(["'])#([^"']+)\1/g, (match, quote: string, value: string) => (
      ids.has(value) ? ` href=${quote}#${prefixId(prefix, value)}${quote}` : match
    ));
}

function prefixId(prefix: string, id: string): string {
  return `${prefix}__${id}`;
}

function shortStableHash(value: string): string {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) + hash + value.charCodeAt(index)) >>> 0;
  }
  return hash.toString(36);
}
