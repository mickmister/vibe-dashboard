import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('BeadsForm edit response mode source', () => {
  it('reruns form restoration and single-question initialization after Edit response remounts the form', async () => {
    const source = await readFile(new URL('./BeadsFormModule.tsx', import.meta.url), 'utf8');

    expect(source).toContain('const [editResponseVersion, setEditResponseVersion] = useState(0);');
    expect(source).toContain('setEditResponseVersion((version) => version + 1);');
    expect(source).toContain('}, [beadDraftStorageKey, editResponseVersion, loaded?.selected?.selectedForm, selectedHtml]);');
    expect(source).toContain('}, [beadDraftStorageKey, editResponseVersion, loaded?.selected?.selectedForm?.format, selectedHtml]);');
    expect(source).toContain('}, [editResponseVersion, loaded?.selectedForm, previewStateKey, selectedHtml]);');
    expect(source).toContain('}, [editResponseVersion, loaded?.selectedForm?.format, previewStateKey, selectedHtml]);');
    expect(source).toContain('}, [editResponseVersion, form, html, storageKey]);');
    expect(source).toContain('}, [editResponseVersion, form, html]);');
  });
});
