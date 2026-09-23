import React, { useEffect, useState } from 'react';
import type {
  SavedWorkspaceSession,
  VoyageEntry,
  WorkspaceState,
} from '../types';
import type { SpaceTypeContribution } from '../modules/plugins/vibe-dashboard/types';
import { vkClient, type WorkspaceSummary } from '../lib/vk-client';
import { VoyageSidebar } from './VoyageSidebar';

interface SidebarProps {
  workspace: WorkspaceState;
  activeSpaceId: string;
  activeTabGroupId: string;
  activeItems: Record<string, string>;
  spaceTypes: Record<string, SpaceTypeContribution>;
  visitedTabGroupIds: string[];
  voyageEntries: VoyageEntry[];
  activeVoyageEntryId: string;
  savedSessions: SavedWorkspaceSession[];
  currentSessionId: string;
  onRequestClose?: () => void;
  onOpenHome: () => void;
  onOpenPluginAdmin: () => void;
  onSelectTabGroup: (tabGroupId: string) => void;
  onSelectTab: (tabGroupId: string, tabId: string) => void;
  onSelectPair: (tabGroupId: string, pairId: string) => void;
  onSelectVoyageEntry: (voyageEntryId: string) => void;
  onAddSpace: (
    name: string,
  ) => Promise<{ spaceId: string; tabGroupId: string } | undefined> | { spaceId: string; tabGroupId: string } | undefined;
  onDeleteSpace: (spaceId: string) => void;
  onRenameSpace: (spaceId: string, name: string) => void;
  onDeleteTabGroup: (
    spaceId: string,
    tabGroupId: string,
  ) => Promise<{ wasDeleted: boolean; nextTabGroupId?: string } | undefined>;
  onRenameTabGroup: (tabGroupId: string, label: string) => void;
  onAddTabGroup: (label: string, spaceId?: string) => Promise<void> | void;
  onOpenCreateWorkspaceTab: () => Promise<void> | void;
  onOpenCraftFlow: () => Promise<void> | void;
  onCreatePair: (tabGroupId: string, tabIds: string[]) => Promise<void> | void;
  onCloseTab: (tabGroupId: string, tabId: string) => void;
  onSplitPair: (tabGroupId: string, pairId: string) => void;
  onRenameTab: (tabGroupId: string, tabId: string, title: string) => void;
  onOpenAddTabModal: (tabGroupId: string) => void;
  onToggleStarTabGroup: (tabGroupId: string) => void;
  onReorderTabGroups: (sourceId: string, targetId: string) => void;
  onReorderSpaces: (sourceId: string, targetId: string) => void;
  showAddressBar: boolean;
  onToggleAddressBar: () => void;
  onResumeSession: (sessionId: string) => void;
  onStartNewSession: () => void;
  onRenameSession: (sessionId: string, name: string) => void;
}

/**
 * Compatibility shell for the left workbench sidebar.
 *
 * M4.1 intentionally stops exposing legacy Spaces management as a user-facing
 * navigation concept. The still-present props keep the old WorkspaceShell call
 * boundary stable until M4.3 replaces legacy Craft/Panel commands with
 * normalized Voyage commands.
 */
export function Sidebar({
  workspace,
  activeItems,
  activeVoyageEntryId,
  savedSessions,
  currentSessionId,
  onRequestClose,
  onOpenHome,
  onOpenPluginAdmin,
  onSelectTab,
  onSelectPair,
  onSelectVoyageEntry,
  onOpenCraftFlow,
  onResumeSession,
  onStartNewSession,
}: SidebarProps) {
  const [attentionSummaries, setAttentionSummaries] = useState<WorkspaceSummary[]>([]);
  const [attentionLoading, setAttentionLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const fetchAttentionSummaries = async (refresh = false) => {
      if (!refresh) setAttentionLoading(true);
      try {
        const result = await vkClient.getWorkspaceSummaries(false);
        if (!cancelled) setAttentionSummaries(result.summaries);
      } catch {
        if (!cancelled) setAttentionSummaries([]);
      } finally {
        if (!cancelled) setAttentionLoading(false);
      }
    };

    void fetchAttentionSummaries();
    const interval = window.setInterval(() => {
      void fetchAttentionSummaries(true);
    }, 30000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  return (
    <VoyageSidebar
      workspace={workspace}
      savedSessions={savedSessions}
      currentSessionId={currentSessionId}
      activeVoyageEntryId={activeVoyageEntryId}
      activeItems={activeItems}
      summaries={attentionSummaries}
      loadingAttention={attentionLoading}
      onRequestClose={onRequestClose}
      onOpenHome={onOpenHome}
      onOpenPluginAdmin={onOpenPluginAdmin}
      onStartNewVoyage={onStartNewSession}
      onOpenCraftFlow={() => {
        void onOpenCraftFlow();
      }}
      onResumeVoyage={onResumeSession}
      onSelectVoyageEntry={onSelectVoyageEntry}
      onSelectTab={onSelectTab}
      onSelectPair={onSelectPair}
    />
  );
}
