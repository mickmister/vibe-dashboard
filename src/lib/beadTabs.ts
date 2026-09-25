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

export type OpenBeadFormsSplitInput = {
  tabGroupId: string;
  agentTabId: string;
  beadId: string;
  formsUrl: string;
};

export type OpenBeadFormsSplitResult = {
  tabGroupId: string;
  pairId: string;
  formsTabId: string;
};

const BEADS_TAB_TITLE = "Beads";
const FORMS_TAB_TITLE = "Forms";

function isBeadsTab(tab: { title: string; url: string }): boolean {
  if (tab.title === BEADS_TAB_TITLE) return true;

  try {
    const url = new URL(tab.url, "https://workspace.local");
    return url.pathname.endsWith("/project") && url.searchParams.has("bead");
  } catch {
    return false;
  }
}

function isFormsTab(tab: { title: string; url: string }): boolean {
  if (tab.title === FORMS_TAB_TITLE) return true;

  try {
    const url = new URL(tab.url, "https://workspace.local");
    return url.pathname === "/dashboard/forms" && url.searchParams.has("bead");
  } catch {
    return false;
  }
}

function findOrCreateTab(
  group: TabGroup,
  state: WorkspaceState,
  title: string,
  url: string,
  predicate: (tab: { title: string; url: string }) => boolean,
): string {
  const existing = group.tabs.find(predicate);
  if (existing) {
    existing.url = url;
    existing.title = title;
    return existing.id;
  }

  const tabId = `tab_${state.nextId++}`;
  group.tabs.push({ id: tabId, title, url });
  return tabId;
}

function findOrCreateBeadsTab(
  group: TabGroup,
  state: WorkspaceState,
  beadsUrl: string,
): string {
  return findOrCreateTab(group, state, BEADS_TAB_TITLE, beadsUrl, isBeadsTab);
}

function findOrCreateFormsTab(
  group: TabGroup,
  state: WorkspaceState,
  formsUrl: string,
): string {
  return findOrCreateTab(group, state, FORMS_TAB_TITLE, formsUrl, isFormsTab);
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

export function openBeadFormsSplitInWorkspace(
  state: WorkspaceState,
  input: OpenBeadFormsSplitInput,
): OpenBeadFormsSplitResult | undefined {
  const group = state.tabGroups.find(
    (candidate) => candidate.id === input.tabGroupId,
  );
  if (!group) return undefined;
  if (!group.tabs.some((tab) => tab.id === input.agentTabId)) return undefined;

  const formsTabId = findOrCreateFormsTab(group, state, input.formsUrl);
  const existingPairId = findPair(group, input.agentTabId, formsTabId);
  if (existingPairId) {
    return { tabGroupId: group.id, pairId: existingPairId, formsTabId };
  }

  const pairId = `pair_${state.nextId++}`;
  group.pairs.push({
    id: pairId,
    tabIds: [input.agentTabId, formsTabId],
    ratios: [55, 45],
  });

  return { tabGroupId: group.id, pairId, formsTabId };
}

export function buildBeadsDeepLink(baseUrl: string, beadId: string): string {
  const trimmedBase = baseUrl.trim().replace(/\/$/, "");
  const path = `${trimmedBase || "/beads"}/project`;
  const params = new URLSearchParams({ bead: beadId });
  return `${path}?${params.toString()}`;
}

export function buildBeadFormsLink(args: {
  dir: string;
  beadId: string;
  formId?: string;
  returnTo?: string;
}): string {
  const params = new URLSearchParams({ dir: args.dir, bead: args.beadId });
  if (args.formId) params.set("form", args.formId);
  if (args.returnTo) params.set("returnTo", args.returnTo);
  return `/dashboard/forms?${params.toString()}`;
}
