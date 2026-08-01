import { mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ALLOW_CODE_FILE_CHANGES_FIELD } from './beadsFormCore';
import { appendBeadsFormPreviewResponse, loadBeadsFormsFromFolder, tryAppendBeadsFormPreviewResponse } from './beadsFormFolder.node';

describe('loadBeadsFormsFromFolder', () => {
  it('loads a folder of standard and metadata-wrapped form JSON files', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'beads-form-folder-'));
    await writeFile(join(folder, 'standard.json'), JSON.stringify({
      format: 'standard',
      id: 'planning_review',
      goal: 'Collect planning notes.',
      title: 'Planning Review',
      questions: [{
        type: 'textarea',
        id: 'notes',
        title: 'Notes',
        description: 'Share planning notes.',
      }],
    }), 'utf8');
    await writeFile(join(folder, 'wrapped.json'), JSON.stringify({
      beadForms: {
        forms: [{
          id: 'raw_review',
          title: 'Raw Review',
          html: '<form><textarea name="comment"></textarea></form>',
          controls: [{ id: 'comment', name: 'comment', type: 'textarea' }],
        }],
      },
    }), 'utf8');
    await writeFile(join(folder, 'ignore.txt'), 'not json', 'utf8');

    const forms = await loadBeadsFormsFromFolder(folder);

    expect(forms.map((form) => form.id)).toEqual(['planning_review', 'raw_review']);
    expect(forms[0]!.sourceFile).toBe(join(folder, 'standard.json'));
    expect(forms[0]!.controls?.map((control) => control.name)).toContain(ALLOW_CODE_FILE_CHANGES_FIELD);
  });

  it('rejects non-directory paths', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'beads-form-folder-'));
    const file = join(folder, 'form.json');
    await writeFile(file, '{}', 'utf8');

    await expect(loadBeadsFormsFromFolder(file)).rejects.toThrow('not a directory');
  });

  it('appends folder preview responses to a constrained sidecar file', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'beads-form-folder-'));

    const first = await appendBeadsFormPreviewResponse(
      folder,
      'review/../../unsafe',
      { notes: 'first' },
      '2026-07-15T00:00:00.000Z',
    );
    const second = await appendBeadsFormPreviewResponse(
      folder,
      'review/../../unsafe',
      { notes: 'second' },
      '2026-07-15T00:01:00.000Z',
    );

    expect(first.sidecarPath).toBe(join(folder, '.beads-form-responses', 'review_unsafe.responses.json'));
    expect(second.sidecarPath).toBe(first.sidecarPath);
    expect(second.responses).toEqual([
      { formId: 'review/../../unsafe', submittedAt: '2026-07-15T00:00:00.000Z', values: { notes: 'first' } },
      { formId: 'review/../../unsafe', submittedAt: '2026-07-15T00:01:00.000Z', values: { notes: 'second' } },
    ]);
    await expect(readFile(second.sidecarPath, 'utf8')).resolves.toContain('"notes": "second"');
  });

  it('rejects sidecar response writes when the sidecar directory is a symlink outside the preview folder', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'beads-form-folder-'));
    const outside = await mkdtemp(join(tmpdir(), 'beads-form-outside-'));
    await symlink(outside, join(folder, '.beads-form-responses'), 'dir');

    await expect(appendBeadsFormPreviewResponse(
      folder,
      'review',
      { notes: 'should not escape' },
      '2026-07-15T00:00:00.000Z',
    )).rejects.toThrow('sidecar must stay inside the preview folder');
    await expect(readFile(join(outside, 'review.responses.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('returns a warning instead of writing outside when the sidecar directory is a symlink', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'beads-form-folder-'));
    const outside = await mkdtemp(join(tmpdir(), 'beads-form-outside-'));
    await symlink(outside, join(folder, '.beads-form-responses'), 'dir');

    const result = await tryAppendBeadsFormPreviewResponse(
      folder,
      'review',
      { notes: 'should not escape' },
      '2026-07-15T00:00:00.000Z',
    );

    expect(result).toEqual({
      submittedAt: '2026-07-15T00:00:00.000Z',
      warnings: [expect.stringContaining('sidecar must stay inside the preview folder')],
    });
    await expect(readFile(join(outside, 'review.responses.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
