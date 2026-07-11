import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ALLOW_CODE_FILE_CHANGES_FIELD } from './beadsFormCore';
import { loadBeadsFormsFromFolder } from './beadsFormFolder.node';

describe('loadBeadsFormsFromFolder', () => {
  it('loads a folder of standard and metadata-wrapped form JSON files', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'beads-form-folder-'));
    await writeFile(join(folder, 'standard.json'), JSON.stringify({
      format: 'standard',
      id: 'planning_review',
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
});
