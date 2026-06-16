import type { Tab, TabGroup } from '../types';
import { buildWorkspaceDiffUrl } from './vkWorkspaceUrl';

export const DIFF_TAB_ID = 'diff';
const URL_PARSE_BASE = 'https://workspace.local';

export function getVirtualDiffTab(tabGroup: TabGroup): Tab | null {
  const workspaceId = getTabGroupWorkspaceId(tabGroup);
  const workspaceDir = getTabGroupWorkspaceDir(tabGroup);
  if (!(workspaceId && workspaceDir)) return null;
  return {
    id: DIFF_TAB_ID,
    title: 'Diff',
    url: buildWorkspaceDiffUrl(workspaceId, workspaceDir),
  };
}

export function getTabsWithVirtualDiff(tabGroup: TabGroup): Tab[] {
  const virtualDiffTab = getVirtualDiffTab(tabGroup);
  if (!virtualDiffTab || tabGroup.tabs.some((tab) => tab.id === DIFF_TAB_ID)) {
    return tabGroup.tabs;
  }
  return [...tabGroup.tabs, virtualDiffTab];
}

function getTabGroupWorkspaceId(tabGroup: TabGroup): string | null {
  for (const tab of tabGroup.tabs) {
    const match = tab.url.match(/\/workspaces\/([^/?#]+)/);
    if (match?.[1]) return decodeURIComponent(match[1]);
  }
  return null;
}

function getTabGroupWorkspaceDir(tabGroup: TabGroup): string | null {
  for (const tab of tabGroup.tabs) {
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
