import type { WorkspaceState } from '../types';

/**
 * Looks up a pair in the rendered/effective workspace model, not the persisted
 * workspace model. Generated built-in pairs such as Agent+Code and Agent+Beads
 * only exist after Craft surfaces are composed for rendering.
 */
export function getRenderedPairViewIds(
  effectiveWorkspace: WorkspaceState,
  tabGroupId: string,
  pairId: string,
): string[] | undefined {
  const pair = effectiveWorkspace.tabGroups
    .find((tabGroup) => tabGroup.id === tabGroupId)
    ?.pairs.find((candidate) => candidate.id === pairId);

  return pair ? [...pair.tabIds] : undefined;
}
