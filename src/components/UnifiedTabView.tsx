import React from 'react';
import { AddressBar } from './AddressBar';
import { IframePanel } from './IframePanel';
import type {
  TabGroup,
  WorkspaceState,
  SavedWorkspaceSession,
} from '../types';
import type { WorkspaceActions, SessionActions } from './WorkspaceShell';

interface UnifiedTabViewProps {
  tabGroups: TabGroup[];
  activeTabGroupId: string;
  actions: WorkspaceActions;
  sessionActions: SessionActions;
  workspace: WorkspaceState;
  showAddressBar: boolean;
  savedSessions: SavedWorkspaceSession[];
  currentSessionId: string;
  onResumeSession: (sessionId: string) => void;
  onRenameSession: (sessionId: string, name: string) => void;
  onDeleteSession: (sessionId: string) => void;
  onStartNewSession: () => void;
  onNavigateToTabGroup: (spaceId: string, tabGroupId: string) => void;
}

export function UnifiedTabView({
  tabGroups,
  activeTabGroupId,
  actions,
  sessionActions,
  workspace,
  showAddressBar,
  savedSessions,
  currentSessionId,
  onResumeSession,
  onRenameSession,
  onDeleteSession,
  onStartNewSession,
  onNavigateToTabGroup,
}: UnifiedTabViewProps) {
  const activeTabGroup = tabGroups.find((tg) => tg.id === activeTabGroupId);

  return (
    <div className="flex flex-col flex-1 min-h-0 relative">
      {showAddressBar && activeTabGroup && (
        <AddressBar
          tabGroup={activeTabGroup}
          activeItemId={sessionActions.getActiveItem(activeTabGroup.id)}
          onNavigate={(tabId, newUrl) =>
            actions.updateTabUrl({
              tabGroupId: activeTabGroup.id,
              tabId,
              newUrl,
            })
          }
        />
      )}

      <div className="flex-1 min-h-0">
        {activeTabGroup ? (
          <IframePanel
            tabGroup={activeTabGroup}
            activeItemId={sessionActions.getActiveItem(activeTabGroup.id)}
            onUpdatePairRatios={(pairId, ratios) =>
              actions.updatePairRatios({
                tabGroupId: activeTabGroup.id,
                pairId,
                ratios,
              })
            }
            workspace={workspace}
            savedSessions={savedSessions}
            currentSessionId={currentSessionId}
            onResumeSession={onResumeSession}
            onRenameSession={onRenameSession}
            onDeleteSession={onDeleteSession}
            onStartNewSession={onStartNewSession}
            onNavigateToTabGroup={onNavigateToTabGroup}
            onOpenVKWorkspace={async (taskAttemptId, name, containerRef, spaceId) => {
              const result = await actions.addVKWorkspace({
                taskAttemptId,
                name,
                containerRef,
                activeSpaceId: spaceId,
              });
              if (result) {
                sessionActions.selectSessionTabGroup(
                  spaceId,
                  result.tabGroupId,
                );
              }
            }}
          />
        ) : (
          <div className="flex-1 flex items-center justify-center text-neutral-500">
            <p>No craft selected</p>
          </div>
        )}
      </div>
    </div>
  );
}
