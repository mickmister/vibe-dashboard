import type { VoyageEntry } from '../types';

export function getVoyageEntryIdAfterClosingCraft({
  voyageEntries,
  activeVoyageEntryId,
  closedTabGroupId,
}: {
  voyageEntries: VoyageEntry[];
  activeVoyageEntryId: string;
  closedTabGroupId: string;
}): string | undefined {
  const activeIndex = voyageEntries.findIndex(
    (entry) => entry.id === activeVoyageEntryId,
  );
  const activeEntry = activeIndex >= 0 ? voyageEntries[activeIndex] : undefined;
  if (activeEntry?.tabGroupId !== closedTabGroupId) return undefined;

  const previousEntry = voyageEntries
    .slice(0, activeIndex)
    .reverse()
    .find((entry) => entry.tabGroupId !== closedTabGroupId);
  if (previousEntry) return previousEntry.id;

  const nextEntry = voyageEntries
    .slice(activeIndex + 1)
    .find((entry) => entry.tabGroupId !== closedTabGroupId);
  if (nextEntry) return nextEntry.id;

  return voyageEntries.find((entry) => entry.tabGroupId !== closedTabGroupId)?.id;
}
