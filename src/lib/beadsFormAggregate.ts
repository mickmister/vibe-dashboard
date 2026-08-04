export type AggregateBeadsFormRef = {
  dir: string;
  beadId: string;
  formId: string;
};

export type AggregateSubmitStatus =
  | { status: 'idle' }
  | { status: 'submitting' }
  | { status: 'success'; values: Record<string, unknown>; warnings: string[] }
  | { status: 'error'; message: string };

export function parseAggregateBeadsFormRefs(params: URLSearchParams): AggregateBeadsFormRef[] {
  const dirs = params.getAll('dir');
  const beads = params.getAll('bead');
  const forms = params.getAll('form');
  if (dirs.length === 0 && beads.length === 0 && forms.length === 0) return [];
  if (dirs.length !== beads.length || dirs.length !== forms.length) {
    throw new Error('Aggregate BeadsForm URLs require matching repeated dir, bead, and form parameters.');
  }
  const seen = new Set<string>();
  return dirs.map((dir, index) => {
    const beadId = beads[index] ?? '';
    const formId = forms[index] ?? '';
    if (!dir.trim()) throw new Error(`Aggregate BeadsForm ref ${index + 1} is missing dir.`);
    if (!beadId.trim()) throw new Error(`Aggregate BeadsForm ref ${index + 1} is missing bead.`);
    if (!formId.trim()) throw new Error(`Aggregate BeadsForm ref ${index + 1} is missing form.`);
    const key = `${dir}\0${beadId}\0${formId}`;
    if (seen.has(key)) throw new Error(`Duplicate aggregate BeadsForm ref: ${beadId}/${formId}`);
    seen.add(key);
    return { dir, beadId, formId };
  });
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
