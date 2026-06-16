import type { Tab, TabGroup, ViewPair, WorkspaceState } from '../types';
import { buildWorkspaceDiffUrl, buildWorkspaceFolderUrl } from './vkWorkspaceUrl';

export const BUILT_IN_AGENT_TAB_ID = 'agent';
export const BUILT_IN_CODE_TAB_ID = 'code';
export const BUILT_IN_DIFF_TAB_ID = 'diff';
export const BUILT_IN_AGENT_CODE_PAIR_ID = 'agent+code';
export const BUILT_IN_AGENT_DIFF_PAIR_ID = 'agent+diff';

export const BUILT_IN_WORKSPACE_TAB_IDS = new Set([
  BUILT_IN_AGENT_TAB_ID,
  BUILT_IN_CODE_TAB_ID,
  BUILT_IN_DIFF_TAB_ID,
]);

export const BUILT_IN_WORKSPACE_PAIR_IDS = new Set([
  BUILT_IN_AGENT_CODE_PAIR_ID,
  BUILT_IN_AGENT_DIFF_PAIR_ID,
]);

const URL_PARSE_BASE = 'https://workspace.local';

export type BuiltInWorkspaceMetadata = {
  workspaceId: string;
  workspaceDir: string;
  baseOrigin?: string;
};

export function getBuiltInWorkspaceMetadata(
  tabGroup: Pick<TabGroup, 'tabs' | 'workspace'>,
): BuiltInWorkspaceMetadata | null {
  if (tabGroup.workspace?.workspaceId && tabGroup.workspace.workspaceDir) {
    return tabGroup.workspace;
  }

  const workspaceId = getWorkspaceIdFromTabs(tabGroup.tabs);
  const workspaceDir = getWorkspaceDirFromTabs(tabGroup.tabs);
  if (!(workspaceId && workspaceDir)) return null;

  return {
    workspaceId,
    workspaceDir,
    baseOrigin: getAgentBaseOrigin(tabGroup.tabs),
  };
}

export function getBuiltInWorkspaceTabs(tabGroup: TabGroup): Tab[] {
  const metadata = getBuiltInWorkspaceMetadata(tabGroup);
  if (!metadata) return [];

  return [
    {
      id: BUILT_IN_AGENT_TAB_ID,
      title: 'Agent',
      url: buildWorkspaceTabUrl(metadata.baseOrigin || '', metadata.workspaceId),
      pinned: true,
    },
    {
      id: BUILT_IN_CODE_TAB_ID,
      title: 'Code',
      url: buildWorkspaceFolderUrl(metadata.baseOrigin || '', metadata.workspaceDir),
      pinned: true,
    },
    {
      id: BUILT_IN_DIFF_TAB_ID,
      title: 'Diff',
      url: buildWorkspaceDiffUrl(metadata.workspaceId, metadata.workspaceDir),
      pinned: true,
    },
  ];
}

export function getEffectiveTabs(tabGroup: TabGroup): Tab[] {
  const builtIns = getBuiltInWorkspaceTabs(tabGroup);
  const customTabs = tabGroup.tabs.filter(
    (tab) => !isBuiltInWorkspaceTabId(tab.id) && !isWorkspaceBuiltInTab(tab),
  );
  return [...builtIns, ...customTabs];
}

export function getBuiltInWorkspacePairs(tabGroup: TabGroup): ViewPair[] {
  if (!getBuiltInWorkspaceMetadata(tabGroup)) return [];
  return [
    {
      id: BUILT_IN_AGENT_CODE_PAIR_ID,
      tabIds: [BUILT_IN_AGENT_TAB_ID, BUILT_IN_CODE_TAB_ID],
      ratios: [50, 50],
    },
    {
      id: BUILT_IN_AGENT_DIFF_PAIR_ID,
      tabIds: [BUILT_IN_AGENT_TAB_ID, BUILT_IN_DIFF_TAB_ID],
      ratios: [50, 50],
    },
  ];
}

export function getEffectivePairs(tabGroup: TabGroup): ViewPair[] {
  const builtInPairs = getBuiltInWorkspacePairs(tabGroup);
  const builtInPairIds = new Set(builtInPairs.map((pair) => pair.id));
  return [
    ...builtInPairs,
    ...tabGroup.pairs.filter((pair) => !builtInPairIds.has(pair.id)),
  ];
}

export function migrateWorkspaceBuiltInTabs(
  workspace: WorkspaceState,
): WorkspaceState {
  let changed = false;
  const tabGroups = workspace.tabGroups.map((tabGroup) => {
    const metadata = getBuiltInWorkspaceMetadata(tabGroup);
    const removedIds = new Set(
      tabGroup.tabs
        .filter(
          (tab) => isBuiltInWorkspaceTabId(tab.id) || isWorkspaceBuiltInTab(tab),
        )
        .map((tab) => tab.id),
    );
    const tabs = tabGroup.tabs.filter((tab) => !removedIds.has(tab.id));
    const validTabIds = new Set(tabs.map((tab) => tab.id));
    const pairs = tabGroup.pairs.filter(
      (pair) =>
        !isBuiltInWorkspacePairId(pair.id) &&
        pair.tabIds.every((tabId) => validTabIds.has(tabId)),
    );

    if (
      metadata ||
      tabs.length !== tabGroup.tabs.length ||
      pairs.length !== tabGroup.pairs.length
    ) {
      changed = true;
      return {
        ...tabGroup,
        ...(metadata ? { workspace: metadata } : {}),
        tabs,
        pairs,
      };
    }

    return tabGroup;
  });

  return changed ? { ...workspace, tabGroups } : workspace;
}

export function isBuiltInWorkspaceTabId(tabId: string): boolean {
  return BUILT_IN_WORKSPACE_TAB_IDS.has(tabId);
}

export function isBuiltInWorkspacePairId(pairId: string): boolean {
  return BUILT_IN_WORKSPACE_PAIR_IDS.has(pairId);
}

export function isWorkspaceBuiltInTab(tab: Pick<Tab, 'title' | 'url'>): boolean {
  return isAgentTab(tab) || isCodeTab(tab) || isDiffTab(tab);
}

function buildWorkspaceTabUrl(baseOrigin: string, workspaceId: string): string {
  return `${baseOrigin}/workspaces/${workspaceId}`;
}

function getWorkspaceIdFromTabs(tabs: Tab[]): string | null {
  for (const tab of tabs) {
    const match = tab.url.match(/\/workspaces\/([^/?#]+)/);
    if (match?.[1]) return decodeURIComponent(match[1]);
  }
  return null;
}

function getWorkspaceDirFromTabs(tabs: Tab[]): string | null {
  for (const tab of tabs) {
    try {
      const parsed = new URL(tab.url, URL_PARSE_BASE);
      const folder = parsed.searchParams.get('folder')?.trim();
      if (folder) return folder;
    } catch {
      // Ignore invalid custom URLs.
    }
  }
  return null;
}

function getAgentBaseOrigin(tabs: Tab[]): string | undefined {
  const agentTab = tabs.find(isAgentTab);
  if (!agentTab) return undefined;
  try {
    const parsed = new URL(agentTab.url, URL_PARSE_BASE);
    return parsed.origin === URL_PARSE_BASE ? '' : parsed.origin;
  } catch {
    return undefined;
  }
}

function isAgentTab(tab: Pick<Tab, 'title' | 'url'>): boolean {
  return (
    tab.title.trim().toLowerCase() === 'agent' ||
    /\/workspaces\/[^/?#]+/.test(tab.url)
  );
}

function isCodeTab(tab: Pick<Tab, 'title' | 'url'>): boolean {
  if (tab.title.trim().toLowerCase() === 'code') return true;
  try {
    return new URL(tab.url, URL_PARSE_BASE).searchParams.has('folder');
  } catch {
    return false;
  }
}

function isDiffTab(tab: Pick<Tab, 'title' | 'url'>): boolean {
  return (
    tab.title.trim().toLowerCase() === 'diff' ||
    tab.url.startsWith('internal://diff')
  );
}
