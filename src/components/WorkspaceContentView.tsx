import React from 'react';
import { UnifiedTabView } from './UnifiedTabView';
import type { TabGroup, WorkspaceState } from '../types';
import type { WorkspaceActions, SessionActions } from './WorkspaceShell';

interface WorkspaceContentViewProps {
  activeTabGroups: TabGroup[];
  activeTabGroupId: string;
  actions: WorkspaceActions;
  sessionActions: SessionActions;
  onDragStart: (e: React.DragEvent, tabGroupId: string) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent, targetGroupId: string) => void;
  workspace: WorkspaceState;
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
    />
  );
}
