import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('BeadsForm edit response mode source', () => {
  it('reruns form restoration and single-question initialization after Edit response remounts the form', async () => {
    const source = await readFile(new URL('./BeadsFormModule.tsx', import.meta.url), 'utf8');

    expect(source).toContain('const [editResponseVersion, setEditResponseVersion] = useState(0);');
    expect(source).toContain('setEditResponseVersion((version) => version + 1);');
    expect(source).toContain('}, [beadDraftScopeKey, editResponseVersion, editingSubmittedResponse, loaded?.selected?.selectedDraft, loaded?.selected?.selectedForm, rollbackValues, selectedHtml]);');
    expect(source).toContain('}, [beadDraftScopeKey, editResponseVersion, loaded?.selected?.selectedDraft?.position, loaded?.selected?.selectedForm?.format, selectedHtml]);');
    expect(source).toContain('}, [editResponseVersion, loaded?.selectedForm, previewStateKey, rollbackValues, selectedHtml]);');
    expect(source).toContain('}, [editResponseVersion, loaded?.selectedForm?.format, previewStateKey, selectedHtml]);');
    expect(source).toContain('}, [draftScopeKey, editResponseVersion, editingSubmittedResponse, form, html, item.draft, rollbackValues]);');
    expect(source).toContain('}, [editResponseVersion, form, html, item.draft?.position]);');
    expect(source).toContain('key={`preview-form-host:${loaded.selectedForm.id}:${editResponseVersion}`}');
    expect(source).toContain('key={`aggregate-form-host:${domPrefix}:${editResponseVersion}`}');
    expect(source).toContain('key={`bead-form-host:${beadDraftScopeKey}:${editResponseVersion}`}');
  });
});
