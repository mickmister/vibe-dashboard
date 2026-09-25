import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('BeadsForm optimistic submit source', () => {
  it('locks and copies direct bead-backed submissions before persistence returns', async () => {
    const source = await readFile(new URL('./BeadsFormModule.tsx', import.meta.url), 'utf8');
    const directStart = source.indexOf('const optimisticSubmissionId = submissionIdRef.current ??= createSubmissionId();');
    const directCopy = source.indexOf('void copySubmittedResultHandoffXml(navigator.clipboard, values, handoffMetadata).then(setClipboardResult);', directStart);
    const directPersist = source.indexOf('actions.submitBeadForm({', directStart);

    expect(directStart).toBeGreaterThan(0);
    expect(source.indexOf('preserveSubmittedFormDom(formHostRef.current, values', directStart)).toBeLessThan(directPersist);
    expect(source.indexOf('setSubmitResult({', directStart)).toBeLessThan(directPersist);
    expect(directCopy).toBeLessThan(directPersist);
    expect(source.indexOf('draftSaveQueueRef.current?.cancel();', directStart - 500)).toBeLessThan(directPersist);
  });

  it('optimistically submits aggregate cards and rolls back editable values on failure', async () => {
    const source = await readFile(new URL('./BeadsFormModule.tsx', import.meta.url), 'utf8');
    const aggregateStart = source.indexOf("setStatus({\n      status: 'success',\n      values,");
    const aggregatePersist = source.indexOf('submitBeadForm({', aggregateStart);

    expect(aggregateStart).toBeGreaterThan(0);
    expect(aggregateStart).toBeLessThan(aggregatePersist);
    expect(source.indexOf('void copySubmittedResultHandoffXml(navigator.clipboard, values, handoffMetadata)', aggregateStart)).toBeLessThan(aggregatePersist);
    expect(source).toContain('setRollbackValues(values);');
    expect(source).toContain('setEditResponseVersion((version) => version + 1);');
  });

  it('optimistically submits folder preview without waiting for sidecar persistence', async () => {
    const source = await readFile(new URL('./BeadsFormModule.tsx', import.meta.url), 'utf8');
    const previewStart = source.indexOf('setSubmitResult({\n      formId: loaded.selectedForm.id,');
    const previewPersist = source.indexOf('actions.submitPreviewForm({', previewStart);

    expect(previewStart).toBeGreaterThan(0);
    expect(previewStart).toBeLessThan(previewPersist);
    expect(source.indexOf('void copySubmittedResultHandoffXml(navigator.clipboard, values, handoffMetadata).then(setClipboardResult);', previewStart)).toBeLessThan(previewPersist);
  });
});
