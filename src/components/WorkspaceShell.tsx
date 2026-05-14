import React, { useState, useEffect, useRef } from 'react';
import { Sidebar } from './Sidebar';
import { WorkspaceContentView } from './WorkspaceContentView';
import { AddTabModal } from './AddTabModal';
import {
  AddVKWorkspaceModal,
  prefetchVKWorkspaceSearchResults,
} from './dialogs/AddVKWorkspaceModal';
import type { WorkspaceState, TabGroup } from '../types';
import type { SessionWorkspaceNav } from '../sessionState';

export type WorkspaceActions = {
  addSpace: (args: {
    name: string;
  }) => Promise<{ spaceId: string; tabGroupId: string } | undefined>;
  deleteSpace: (args: {
    spaceId: string;
  }) => Promise<{ wasDeleted: boolean; deletedSpaceId?: string } | undefined>;
  renameSpace: (args: { spaceId: string; name: string }) => void;
  addTabGroup: (args: {
    spaceId: string;
    label: string;
  }) => Promise<{ tabGroupId?: string; spaceId?: string } | undefined>;
  deleteTabGroup: (args: { spaceId: string; tabGroupId: string }) => Promise<
    | {
        wasDeleted: boolean;
        deletedTabGroupId?: string;
        nextTabGroupId?: string;
      }
    | undefined
  >;
  renameTabGroup: (args: { tabGroupId: string; label: string }) => void;
  renameTab: (args: {
    tabGroupId: string;
    tabId: string;
    title: string;
  }) => void;
  closeTab: (args: { tabGroupId: string; tabId: string }) => void;
  addTab: (args: { tabGroupId: string; title: string; url: string }) => void;
  ensureCreateWorkspaceTab: () => Promise<
    { spaceId: string; tabGroupId: string; tabId: string } | undefined
  >;
  createPair: (args: { tabGroupId: string; tabIds: string[] }) => void;
  deletePair: (args: { tabGroupId: string; pairId: string }) => void;
  updatePairRatios: (args: {
    tabGroupId: string;
    pairId: string;
    ratios: number[];
  }) => void;
  reorderTabGroups: (args: { sourceId: string; targetId: string }) => void;
  closeActiveTab: () => void;
  addVKWorkspace: (args: {
    taskAttemptId: string;
    name: string;
    containerRef: string;
    activeSpaceId: string;
  }) => Promise<
    { tabGroupId: string; pairId: string; agentTabId: string } | undefined
  >;
  updateTabUrl: (args: {
    tabGroupId: string;
    tabId: string;
    newUrl: string;
  }) => void;
  touchTabGroup: (args: { tabGroupId: string }) => void;
  toggleStarTabGroup: (args: { tabGroupId: string }) => void;
  reorderSpaces: (args: { sourceId: string; targetId: string }) => void;
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

export function WorkspaceShell({
  workspace,
  session,
  actions,
  sessionActions,
}: WorkspaceShellProps) {
  const [addTabModalOpen, setAddTabModalOpen] = useState(false);
  const [workspaceSearchOpen, setWorkspaceSearchOpen] = useState(false);
  const [addTabTargetGroupId, setAddTabTargetGroupId] = useState<string>('');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);
  const [showAddressBar, setShowAddressBar] = useState(false);
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

  // --- Cmd+W / Cmd+Q exit confirmation ---
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();

      if (
        (e.metaKey || e.ctrlKey) &&
        key === 'k' &&
        !isEditableTarget(e.target)
      ) {
        e.preventDefault();
        e.stopPropagation();
        setAddTabModalOpen(false);
        setWorkspaceSearchOpen(true);
        setIsSidebarOpen(false);
        return;
      }

      if ((e.metaKey || e.ctrlKey) && (key === 'w' || key === 'q')) {
        e.preventDefault();
        e.stopPropagation();
        if (confirm('Are you sure you want to exit the app?')) {
          window.close();
        }
      }
    };

    window.addEventListener('keydown', handler, { capture: true });
    return () =>
      window.removeEventListener('keydown', handler, { capture: true });
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const mediaQuery = window.matchMedia('(min-width: 768px)');
    const handleViewportChange = (event: MediaQueryListEvent) => {
      setIsDesktop(event.matches);
      setIsSidebarOpen(false);
    };

    setIsDesktop(mediaQuery.matches);
    mediaQuery.addEventListener('change', handleViewportChange);
    return () => mediaQuery.removeEventListener('change', handleViewportChange);
  }, []);

  useEffect(() => {
    void prefetchVKWorkspaceSearchResults();
  }, []);

  // --- Add tab modal handler ---
  const openAddTabModal = (tabGroupId: string) => {
    setAddTabTargetGroupId(tabGroupId);
    setAddTabModalOpen(true);
  };

  const handleAddTab = (title: string, url: string) => {
    actions.addTab({ tabGroupId: addTabTargetGroupId, title, url });
  };

  const handleOpenCreateWorkspaceTab = async () => {
    const result = await actions.ensureCreateWorkspaceTab();
    if (!result) return;

    sessionActions.selectSpace(result.spaceId);
    sessionActions.selectTab(result.tabGroupId, result.tabId);
  };

  const handleAddVKWorkspace = async (
    taskAttemptId: string,
    name: string,
    containerRef: string,
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

  const handleAddVKWorkspaceToSpace = async (
    taskAttemptId: string,
    name: string,
    containerRef: string,
    spaceId: string,
  ) => {
    const result = await actions.addVKWorkspace({
      taskAttemptId,
      name,
      containerRef,
      activeSpaceId: spaceId,
    });

    if (result) {
      sessionActions.selectSpace(spaceId);
      sessionActions.setActiveTabGroup(result.tabGroupId);
      sessionActions.selectTab(result.tabGroupId, result.agentTabId);
    }
  };

  const handleNavigateToWorkspaceTabGroup = (
    spaceId: string,
    tabGroupId: string,
  ) => {
    sessionActions.selectSpace(spaceId);
    sessionActions.setActiveTabGroup(tabGroupId);
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
    (s) => s.id === session.activeSpaceId,
  );
  const activeTabGroups = activeSpace
    ? activeSpace.tabGroupIds
        .map((id) => workspace.tabGroups.find((tg) => tg.id === id))
        .filter((tg): tg is TabGroup => tg != null)
    : [];
  const activeTabGroup = activeTabGroups.find(
    (tg) => tg.id === session.activeTabGroupId,
  );

  return (
    <div className="w-full h-full flex bg-neutral-950">
      {isSidebarOpen && (
        <button
          className="fixed inset-0 z-[60] bg-black/40 md:hidden"
          onClick={() => setIsSidebarOpen(false)}
          aria-label="Close sidebar overlay"
        />
      )}

      {!isSidebarOpen && (
        <div
          className="hidden md:block fixed inset-y-0 left-0 w-2 z-[55]"
          onMouseEnter={() => setIsSidebarOpen(true)}
          aria-hidden="true"
        />
      )}

      <div
        className={`fixed inset-y-0 left-0 z-[70] transform transition-transform duration-200 ${
          isSidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
        onMouseLeave={() => {
          if (isDesktop) {
            setIsSidebarOpen(false);
          }
        }}
      >
        <Sidebar
          workspace={workspace}
          activeSpaceId={session.activeSpaceId}
          activeTabGroupId={session.activeTabGroupId}
          activeItems={session.activeItems}
          onRequestClose={() => setIsSidebarOpen(false)}
          onSelectSpace={(spaceId) => {
            sessionActions.selectSpace(spaceId);
          }}
          onSelectTabGroup={(tabGroupId) => {
            sessionActions.setActiveTabGroup(tabGroupId);
          }}
          onSelectTab={(tabGroupId, tabId) => {
            sessionActions.selectTab(tabGroupId, tabId);
          }}
          onSelectPair={(tabGroupId, pairId) => {
            sessionActions.selectPair(tabGroupId, pairId);
          }}
          onAddSpace={async (name) => {
            const result = await actions.addSpace({ name });
            if (result) {
              sessionActions.selectSpace(result.spaceId);
              setIsSidebarOpen(false);
            }
          }}
          onDeleteSpace={(spaceId) => actions.deleteSpace({ spaceId })}
          onRenameSpace={(spaceId, name) =>
            actions.renameSpace({ spaceId, name })
          }
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
          onOpenCreateWorkspaceTab={async () => {
            await handleOpenCreateWorkspaceTab();
            setIsSidebarOpen(false);
          }}
          onCreatePair={async (tabGroupId, tabIds) => {
            actions.createPair({ tabGroupId, tabIds });
          }}
          onCloseTab={(tabGroupId, tabId) => {
            actions.closeTab({ tabGroupId, tabId });
          }}
          onSplitPair={(tabGroupId, pairId) => {
            actions.deletePair({ tabGroupId, pairId });
          }}
          onRenameTab={(tabGroupId, tabId, title) => {
            actions.renameTab({ tabGroupId, tabId, title });
          }}
          onOpenAddTabModal={openAddTabModal}
          onToggleStarTabGroup={(tabGroupId) =>
            actions.toggleStarTabGroup({ tabGroupId })
          }
          onReorderTabGroups={(sourceId, targetId) =>
            actions.reorderTabGroups({ sourceId, targetId })
          }
          onReorderSpaces={(sourceId, targetId) =>
            actions.reorderSpaces({ sourceId, targetId })
          }
          showAddressBar={showAddressBar}
          onToggleAddressBar={() => setShowAddressBar((v) => !v)}
        />
      </div>

      {/* Main content area */}
      <div className="flex-1 flex flex-col min-h-0 min-w-0 relative">
        <div className="md:hidden h-10 px-2 border-b border-neutral-800 bg-neutral-900 flex items-center gap-2 shrink-0">
          <button
            className="h-8 w-8 rounded-md text-neutral-200 hover:bg-neutral-800 transition-colors flex items-center justify-center shrink-0"
            onClick={() => setIsSidebarOpen(true)}
            title="Open sidebar"
            aria-label="Open sidebar"
          >
            ☰
          </button>
          <div className="flex-1 min-w-0 text-sm font-medium text-neutral-200 truncate">
            {activeTabGroup?.label || 'No tab group selected'}
          </div>
        </div>
        <WorkspaceContentView
          activeTabGroups={activeTabGroups}
          activeTabGroupId={session.activeTabGroupId}
          actions={actions}
          sessionActions={sessionActions}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          workspace={workspace}
          showAddressBar={showAddressBar}
        />
      </div>

      {addTabModalOpen && (
        <AddTabModal
          isOpen={addTabModalOpen}
          onClose={() => setAddTabModalOpen(false)}
          onAdd={handleAddTab}
          onAddVKWorkspace={handleAddVKWorkspace}
          onAddVKWorkspaceToSpace={handleAddVKWorkspaceToSpace}
          onNavigateToTabGroup={handleNavigateToWorkspaceTabGroup}
          onAddTabGroup={handleAddTabGroup}
          workspace={workspace}
        />
      )}

      {workspaceSearchOpen && (
        <AddVKWorkspaceModal
          isOpen={workspaceSearchOpen}
          onClose={() => setWorkspaceSearchOpen(false)}
          onAdd={handleAddVKWorkspace}
          onAddToSpace={handleAddVKWorkspaceToSpace}
          onNavigateToTabGroup={handleNavigateToWorkspaceTabGroup}
          workspaceState={workspace}
          allowCustomPath={false}
        />
      )}
    </div>
  );
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;

  const tagName = target.tagName.toLowerCase();
  return (
    tagName === 'input' ||
    tagName === 'textarea' ||
    tagName === 'select' ||
    target.isContentEditable
  );
}
