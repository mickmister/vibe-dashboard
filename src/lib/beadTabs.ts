import type { TabGroup, WorkspaceState } from "../types";

export type OpenBeadSplitInput = {
  tabGroupId: string;
  agentTabId: string;
  beadId: string;
  beadsUrl: string;
};

export type OpenBeadSplitResult = {
  tabGroupId: string;
  pairId: string;
  beadsTabId: string;
};

const BEADS_TAB_TITLE = "Beads";

function isBeadsTab(tab: { title: string; url: string }): boolean {
  if (tab.title === BEADS_TAB_TITLE) return true;

  try {
    const url = new URL(tab.url, "https://workspace.local");
    return url.pathname.endsWith("/project") && url.searchParams.has("bead");
  } catch {
    return false;
  }
}

function findOrCreateBeadsTab(
  group: TabGroup,
  state: WorkspaceState,
  beadsUrl: string,
): string {
  const existing = group.tabs.find(isBeadsTab);
  if (existing) {
    existing.url = beadsUrl;
    existing.title = BEADS_TAB_TITLE;
    return existing.id;
  }

  const tabId = `tab_${state.nextId++}`;
  group.tabs.push({ id: tabId, title: BEADS_TAB_TITLE, url: beadsUrl });
  return tabId;
}

function findPair(
  group: TabGroup,
  leftTabId: string,
  rightTabId: string,
): string | null {
  const pair = group.pairs.find(
    (candidate) =>
      candidate.tabIds.length === 2 &&
      candidate.tabIds[0] === leftTabId &&
      candidate.tabIds[1] === rightTabId,
  );
  return pair?.id ?? null;
}

export function openBeadSplitInWorkspace(
  state: WorkspaceState,
  input: OpenBeadSplitInput,
): OpenBeadSplitResult | undefined {
  const group = state.tabGroups.find(
    (candidate) => candidate.id === input.tabGroupId,
  );
  if (!group) return undefined;
  if (!group.tabs.some((tab) => tab.id === input.agentTabId)) return undefined;

  const beadsTabId = findOrCreateBeadsTab(group, state, input.beadsUrl);
  const existingPairId = findPair(group, input.agentTabId, beadsTabId);
  if (existingPairId) {
    return { tabGroupId: group.id, pairId: existingPairId, beadsTabId };
  }

  const pairId = `pair_${state.nextId++}`;
  group.pairs.push({
    id: pairId,
    tabIds: [input.agentTabId, beadsTabId],
    ratios: [55, 45],
  });

  return { tabGroupId: group.id, pairId, beadsTabId };
}

export function buildBeadsDeepLink(baseUrl: string, beadId: string): string {
  const trimmedBase = baseUrl.trim().replace(/\/$/, "");
  const path = `${trimmedBase || "/beads"}/project`;
  const params = new URLSearchParams({ bead: beadId });
  return `${path}?${params.toString()}`;
}
