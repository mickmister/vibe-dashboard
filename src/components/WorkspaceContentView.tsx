import React from 'react';
import { UnifiedTabView } from './UnifiedTabView';
import type { TabGroup, WorkspaceState } from '../types';
import type { WorkspaceActions, SessionActions } from './WorkspaceShell';
import type { GasCityDashboardState, GasCityPluginModule } from '../modules/plugins/gas-city/types';

interface WorkspaceContentViewProps {
  activeTabGroups: TabGroup[];
  activeTabGroupId: string;
  actions: WorkspaceActions;
  sessionActions: SessionActions;
  onDragStart: (e: React.DragEvent, tabGroupId: string) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent, targetGroupId: string) => void;
  workspace: WorkspaceState;
  showAddressBar: boolean;
  gasCity?: {
    state: GasCityDashboardState;
    actions: GasCityPluginModule['actions'];
  };
  onOpenGasCityWorkDir?: (workDir: string, title: string) => void;
}

export function WorkspaceContentView({
  activeTabGroups,
  activeTabGroupId,
  actions,
  sessionActions,
  onDragStart,
  onDragOver,
  onDrop,
  workspace,
  showAddressBar,
  gasCity,
  onOpenGasCityWorkDir,
}: WorkspaceContentViewProps) {
  if (activeTabGroups.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-neutral-500">
        <p>
          No tab groups in this space. Hover left to switch spaces.
        </p>
      </div>
    );
  }

  return (
    <UnifiedTabView
      tabGroups={activeTabGroups}
      activeTabGroupId={activeTabGroupId}
      actions={actions}
      sessionActions={sessionActions}
      workspace={workspace}
      showAddressBar={showAddressBar}
      gasCity={gasCity}
      onOpenGasCityWorkDir={onOpenGasCityWorkDir}
    />
  );
}
