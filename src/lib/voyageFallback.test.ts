import { describe, expect, it } from 'vitest';
import type { VoyageEntry } from '../types';
import { getVoyageEntryIdAfterClosingCraft } from './voyageFallback';

function entry(id: string, tabGroupId: string): VoyageEntry {
  return { id, tabGroupId, viewIds: [`tab_${tabGroupId}`] };
}

describe('getVoyageEntryIdAfterClosingCraft', () => {
  it('keeps fallback selection inside the current voyage when closing the active craft everywhere', () => {
    expect(
      getVoyageEntryIdAfterClosingCraft({
        voyageEntries: [entry('a', 'tg_a'), entry('b', 'tg_b'), entry('c', 'tg_c')],
        activeVoyageEntryId: 'b',
        closedTabGroupId: 'tg_b',
      }),
    ).toBe('a');
  });

  it('falls forward when there is no previous remaining craft in the voyage', () => {
    expect(
      getVoyageEntryIdAfterClosingCraft({
        voyageEntries: [entry('a', 'tg_a'), entry('b', 'tg_b')],
        activeVoyageEntryId: 'a',
        closedTabGroupId: 'tg_a',
      }),
    ).toBe('b');
  });

  it('skips duplicate entries for the closed craft', () => {
    expect(
      getVoyageEntryIdAfterClosingCraft({
        voyageEntries: [entry('a1', 'tg_a'), entry('a2', 'tg_a'), entry('b', 'tg_b')],
        activeVoyageEntryId: 'a2',
        closedTabGroupId: 'tg_a',
      }),
    ).toBe('b');
  });

  it('returns undefined when closing a non-active craft or no voyage-local fallback exists', () => {
    expect(
      getVoyageEntryIdAfterClosingCraft({
        voyageEntries: [entry('a', 'tg_a'), entry('b', 'tg_b')],
        activeVoyageEntryId: 'a',
        closedTabGroupId: 'tg_b',
      }),
    ).toBeUndefined();

    expect(
      getVoyageEntryIdAfterClosingCraft({
        voyageEntries: [entry('a', 'tg_a')],
        activeVoyageEntryId: 'a',
        closedTabGroupId: 'tg_a',
      }),
    ).toBeUndefined();
  });
});
