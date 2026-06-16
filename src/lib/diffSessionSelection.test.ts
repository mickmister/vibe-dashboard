import { describe, expect, it } from 'vitest';
import { selectDiffSessionId } from './diffSessionSelection';

describe('selectDiffSessionId', () => {
  it('defaults to the first VK session because VK returns most-recently-used order', () => {
    expect(
      selectDiffSessionId([{ id: 'most-recent' }, { id: 'older' }], ''),
    ).toBe('most-recent');
  });

  it('keeps the current session when it still belongs to the workspace', () => {
    expect(
      selectDiffSessionId([{ id: 'most-recent' }, { id: 'selected' }], 'selected'),
    ).toBe('selected');
  });

  it('falls back to VK order when the current session is stale', () => {
    expect(
      selectDiffSessionId([{ id: 'most-recent' }], 'other-workspace-session'),
    ).toBe('most-recent');
  });
});

