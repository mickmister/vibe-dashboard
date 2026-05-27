import React from 'react';
import { UnifiedTabView } from './UnifiedTabView';
import type { TabGroup, WorkspaceState, SavedWorkspaceSession } from '../types';
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
  showAddressBar: boolean;
  savedSessions: SavedWorkspaceSession[];
  currentSessionId: string;
  onResumeSession: (sessionId: string) => void;
  onRenameSession: (sessionId: string, name: string) => void;
  onDeleteSession: (sessionId: string) => void;
  onStartNewSession: () => void;
  onNavigateToTabGroup: (spaceId: string, tabGroupId: string) => void;
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
  savedSessions,
  currentSessionId,
  onResumeSession,
  onRenameSession,
  onDeleteSession,
  onStartNewSession,
  onNavigateToTabGroup,
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
      savedSessions={savedSessions}
      currentSessionId={currentSessionId}
      onResumeSession={onResumeSession}
      onRenameSession={onRenameSession}
      onDeleteSession={onDeleteSession}
      onStartNewSession={onStartNewSession}
      onNavigateToTabGroup={onNavigateToTabGroup}
    />
  );
}
