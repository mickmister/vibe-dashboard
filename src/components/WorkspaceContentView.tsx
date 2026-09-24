/* eslint-disable formatjs/no-id -- Legacy shell components are mounted before message extraction wiring in some tests. */
import React from 'react';
import { defineMessages, FormattedMessage } from 'react-intl';
import { UnifiedTabView } from './UnifiedTabView';
import type { TabGroup, WorkspaceState, SavedWorkspaceSession } from '../types';
import type { WorkspaceActions, SessionActions } from './WorkspaceShell';

const workspaceContentViewMessages = defineMessages({
  emptyVoyage: {
    id: 'workspaceContentView.emptyVoyage',
    defaultMessage: 'No Craft in this Voyage. Open the sidebar to switch Voyages or add a Craft.',
    description: 'Accessible empty-state text shown when the current Voyage has no Crafts.',
  },
});

interface WorkspaceContentViewProps {
  activeTabGroups: TabGroup[];
  activeTabGroupId: string;
  actions: WorkspaceActions;
  sessionActions: SessionActions;
  disableSplitViews?: boolean;
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
  onOpenVKWorkspace: (
    taskAttemptId: string,
    name: string,
    containerRef: string,
    spaceId: string,
  ) => Promise<void>;
}

export function WorkspaceContentView({
  activeTabGroups,
  activeTabGroupId,
  actions,
  sessionActions,
  disableSplitViews,
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
  onOpenVKWorkspace,
}: WorkspaceContentViewProps) {
  if (activeTabGroups.length === 0) {
    return (
      <div
        className="flex-1 flex items-center justify-center text-neutral-500"
        role="status"
        aria-live="polite"
      >
        <p>
          <FormattedMessage {...workspaceContentViewMessages.emptyVoyage} />
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
      disableSplitViews={disableSplitViews}
      workspace={workspace}
      showAddressBar={showAddressBar}
      savedSessions={savedSessions}
      currentSessionId={currentSessionId}
      onResumeSession={onResumeSession}
      onRenameSession={onRenameSession}
      onDeleteSession={onDeleteSession}
      onStartNewSession={onStartNewSession}
      onNavigateToTabGroup={onNavigateToTabGroup}
      onOpenVKWorkspace={onOpenVKWorkspace}
    />
  );
}
