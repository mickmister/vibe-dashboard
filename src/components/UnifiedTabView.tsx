import React from 'react';
import { AddressBar } from './AddressBar';
import { IframePanel } from './IframePanel';
import type { TabGroup, WorkspaceState } from '../types';
import type { WorkspaceActions, SessionActions } from './WorkspaceShell';
import type { GasCityDashboardState, GasCityPluginModule } from '../modules/plugins/gas-city/types';

interface UnifiedTabViewProps {
  tabGroups: TabGroup[];
  activeTabGroupId: string;
  actions: WorkspaceActions;
  sessionActions: SessionActions;
  workspace: WorkspaceState;
  showAddressBar: boolean;
  gasCity?: {
    state: GasCityDashboardState;
    actions: GasCityPluginModule['actions'];
  };
  onOpenGasCityWorkDir?: (workDir: string, title: string) => void;
}

export function UnifiedTabView({
  tabGroups,
  activeTabGroupId,
  actions,
  sessionActions,
  workspace,
  showAddressBar,
  gasCity,
  onOpenGasCityWorkDir,
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
            gasCity={gasCity}
            onNavigateToTabGroup={(spaceId, tabGroupId) => {
              sessionActions.selectSpace(spaceId);
              sessionActions.setActiveTabGroup(tabGroupId);
            }}
            onOpenVKWorkspace={async (workspaceId, name, containerRef, spaceId) => {
              const result = await actions.addVKWorkspace({
                workspaceId,
                name,
                containerRef,
                activeSpaceId: spaceId,
              });
              if (result) {
                sessionActions.selectSpace(spaceId);
                sessionActions.setActiveTabGroup(result.tabGroupId);
              }
            }}
            onOpenGasCityWorkDir={onOpenGasCityWorkDir}
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
