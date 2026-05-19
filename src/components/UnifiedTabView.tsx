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
            onNavigateToTabGroup={(spaceId, tabGroupId) => {
              sessionActions.selectSpace(spaceId);
              sessionActions.setActiveTabGroup(tabGroupId);
            }}
            onOpenVKWorkspace={async (taskAttemptId, name, containerRef, spaceId) => {
              const result = await actions.addVKWorkspace({
                taskAttemptId,
                name,
                containerRef,
                activeSpaceId: spaceId,
              });
              if (result) {
                sessionActions.selectSpace(spaceId);
                sessionActions.setActiveTabGroup(result.tabGroupId);
              }
            }}
          />
        ) : (
          <div className="flex-1 flex items-center justify-center text-neutral-500">
            <p>No tab group selected</p>
          </div>
        )}
      </div>
    </div>
  );
}
