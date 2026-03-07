import React, { useState, useEffect, useRef } from 'react';
import { Sidebar } from './Sidebar';
import { WorkspaceContentView } from './WorkspaceContentView';
import { AddTabModal } from './AddTabModal';
import type { WorkspaceState, TabGroup } from '../types';
import type { SessionWorkspaceNav } from '../sessionState';

export type WorkspaceActions = {
  addSpace: (args: { name: string }) => Promise<{ spaceId: string; tabGroupId: string } | undefined>;
  deleteSpace: (args: { spaceId: string }) => Promise<{ wasDeleted: boolean; deletedSpaceId?: string } | undefined>;
  renameSpace: (args: { spaceId: string; name: string }) => void;
  addTabGroup: (args: { spaceId: string; label: string }) => Promise<{ tabGroupId?: string; spaceId?: string } | undefined>;
  deleteTabGroup: (args: { spaceId: string; tabGroupId: string }) => Promise<{ wasDeleted: boolean; deletedTabGroupId?: string; nextTabGroupId?: string } | undefined>;
  renameTabGroup: (args: { tabGroupId: string; label: string }) => void;
  renameTab: (args: { tabGroupId: string; tabId: string; title: string }) => void;
  closeTab: (args: { tabGroupId: string; tabId: string }) => void;
  addTab: (args: { tabGroupId: string; title: string; url: string }) => void;
  createPair: (args: { tabGroupId: string; tabIds: string[] }) => void;
  deletePair: (args: { tabGroupId: string; pairId: string }) => void;
  updatePairRatios: (args: { tabGroupId: string; pairId: string; ratios: number[] }) => void;
  reorderTabGroups: (args: { sourceId: string; targetId: string }) => void;
  closeActiveTab: () => void;
  addVKWorkspace: (args: {
    taskAttemptId: string;
    name: string;
    containerRef: string;
    activeSpaceId: string;
  }) => Promise<{ tabGroupId: string; pairId: string; agentTabId: string } | undefined>;
  updateTabUrl: (args: { tabGroupId: string; tabId: string; newUrl: string }) => void;
};

export type SessionActions = {
  selectSpace: (spaceId: string) => void;
  selectTab: (tabGroupId: string, tabId: string) => void;
  selectPair: (tabGroupId: string, pairId: string) => void;
  setActiveTabGroup: (tabGroupId: string) => void;
  getActiveItem: (tabGroupId: string) => string;
};

interface WorkspaceShellProps {
  workspace: WorkspaceState;
  session: SessionWorkspaceNav;
  actions: WorkspaceActions;
  sessionActions: SessionActions;
}

export function WorkspaceShell({ workspace, session, actions, sessionActions }: WorkspaceShellProps) {
  const [addTabModalOpen, setAddTabModalOpen] = useState(false);
  const [addTabTargetGroupId, setAddTabTargetGroupId] = useState<string>('');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const dragGroupRef = useRef<string | null>(null);

  // --- Drag-and-drop for tab groups ---
  const handleDragStart = (e: React.DragEvent, tabGroupId: string) => {
    dragGroupRef.current = tabGroupId;
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = (e: React.DragEvent, targetGroupId: string) => {
    e.preventDefault();
    const sourceId = dragGroupRef.current;
    if (!sourceId || sourceId === targetGroupId) return;
    actions.reorderTabGroups({ sourceId, targetId: targetGroupId });
    dragGroupRef.current = null;
  };

  // --- Cmd+W handler ---
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'w') {
        e.preventDefault();
        e.stopPropagation();
        actions.closeActiveTab();
      }
    };

    window.addEventListener('keydown', handler, { capture: true });
    return () =>
      window.removeEventListener('keydown', handler, { capture: true });
  }, [actions]);

  // --- Add tab modal handler ---
  const openAddTabModal = (tabGroupId: string) => {
    setAddTabTargetGroupId(tabGroupId);
    setAddTabModalOpen(true);
  };

  const handleAddTab = (title: string, url: string) => {
    actions.addTab({ tabGroupId: addTabTargetGroupId, title, url });
  };

  const handleAddVKWorkspace = async (
    taskAttemptId: string,
    name: string,
    containerRef: string
  ) => {
    const result = await actions.addVKWorkspace({
      taskAttemptId,
      name,
      containerRef,
      activeSpaceId: session.activeSpaceId,
    });

    // Auto-select the Agent tab (not the pair)
    if (result) {
      sessionActions.setActiveTabGroup(result.tabGroupId);
      sessionActions.selectTab(result.tabGroupId, result.agentTabId);
    }
  };

  const handleAddTabGroup = async (label: string) => {
    const result = await actions.addTabGroup({
      spaceId: session.activeSpaceId,
      label,
    });

    // Auto-select the new tab group
    if (result?.tabGroupId) {
      sessionActions.setActiveTabGroup(result.tabGroupId);
    }
  };

  // --- Derived state ---
  const activeSpace = workspace.spaces.find(
    (s) => s.id === session.activeSpaceId
  );
  const activeTabGroups = activeSpace
    ? activeSpace.tabGroupIds
        .map((id) => workspace.tabGroups.find((tg) => tg.id === id))
        .filter((tg): tg is TabGroup => tg != null)
    : [];

  return (
    <div className="w-full h-full flex bg-neutral-950">
      {isSidebarOpen && (
        <button
          className="md:hidden fixed inset-0 z-[60] bg-black/40"
          onClick={() => setIsSidebarOpen(false)}
          aria-label="Close sidebar overlay"
        />
      )}

      <div
        className={`fixed inset-y-0 left-0 z-[70] transform transition-transform duration-200 md:static md:z-auto md:translate-x-0 ${
          isSidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <Sidebar
          workspace={workspace}
          activeSpaceId={session.activeSpaceId}
          activeTabGroupId={session.activeTabGroupId}
          onRequestClose={() => setIsSidebarOpen(false)}
          onSelectSpace={(spaceId) => {
            sessionActions.selectSpace(spaceId);
            setIsSidebarOpen(false);
          }}
          onSelectTabGroup={(tabGroupId) => {
            sessionActions.setActiveTabGroup(tabGroupId);
            setIsSidebarOpen(false);
          }}
          onAddSpace={async (name) => {
            const result = await actions.addSpace({ name });
            if (result) {
              sessionActions.selectSpace(result.spaceId);
              setIsSidebarOpen(false);
            }
          }}
          onDeleteSpace={(spaceId) => actions.deleteSpace({ spaceId })}
          onRenameSpace={(spaceId, name) => actions.renameSpace({ spaceId, name })}
          onDeleteTabGroup={async (spaceId, tabGroupId) =>
            actions.deleteTabGroup({ spaceId, tabGroupId })
          }
          onRenameTabGroup={(tabGroupId, label) =>
            actions.renameTabGroup({ tabGroupId, label })
          }
          onAddTabGroup={handleAddTabGroup}
          onAddTab={async (tabGroupId, title, url) => {
            actions.addTab({ tabGroupId, title, url });
          }}
          onCreatePair={async (tabGroupId, tabIds) => {
            actions.createPair({ tabGroupId, tabIds });
          }}
        />
      </div>

      {/* Main content area */}
      <div className="flex-1 flex flex-col min-h-0 min-w-0 relative">
        {!isSidebarOpen && (
          <button
            className="md:hidden absolute top-2 left-2 z-[60] h-9 w-9 rounded-md bg-neutral-900/90 border border-neutral-700 text-neutral-200"
            onClick={() => setIsSidebarOpen(true)}
            title="Open sidebar"
            aria-label="Open sidebar"
          >
            ☰
          </button>
        )}
        <WorkspaceContentView
          activeTabGroups={activeTabGroups}
          activeTabGroupId={session.activeTabGroupId}
          activeSpaceId={session.activeSpaceId}
          actions={actions}
          sessionActions={sessionActions}
          onOpenAddTabModal={openAddTabModal}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          workspace={workspace}
        />
      </div>

      {addTabModalOpen && (
        <AddTabModal
          isOpen={addTabModalOpen}
          onClose={() => setAddTabModalOpen(false)}
          onAdd={handleAddTab}
          onAddVKWorkspace={handleAddVKWorkspace}
          onAddTabGroup={handleAddTabGroup}
        />
      )}
    </div>
  );
}
