import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Sidebar } from './Sidebar';
import { WorkspaceContentView } from './WorkspaceContentView';
import { AddTabModal } from './AddTabModal';
import {
  AddVKWorkspaceModal,
  prefetchVKWorkspaceSearchResults,
} from './dialogs/AddVKWorkspaceModal';
import type {
  WorkspaceState,
  TabGroup,
  SavedWorkspaceSession,
} from '../types';
import type { SessionWorkspaceNav } from '../sessionState';

const MOBILE_TAB_EMOJI_CHOICES = [
  '🚀',
  '🧠',
  '💻',
  '🛠️',
  '📚',
  '🔬',
  '🧪',
  '🎯',
  '🗂️',
  '🌟',
  '⚡',
  '🛰️',
];

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
  updateTabGroupMobileDisplay: (args: {
    tabGroupId: string;
    mobileLabel: string | null;
    mobileEmoji: string | null;
  }) => void;
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
  resumeSession: (sessionId: string) => void;
  startNewSession: () => void;
  renameSession: (sessionId: string, name: string) => void;
  deleteSession: (sessionId: string) => void;
  addTabGroupToSession: (tabGroupId: string) => void;
  removeTabGroupFromSession: (tabGroupId: string) => void;
};

interface WorkspaceShellProps {
  workspace: WorkspaceState;
  session: SessionWorkspaceNav;
  actions: WorkspaceActions;
  sessionActions: SessionActions;
  savedSessions: SavedWorkspaceSession[];
  currentSessionId: string;
}

export function WorkspaceShell({
  workspace,
  session,
  actions,
  sessionActions,
  savedSessions,
  currentSessionId,
}: WorkspaceShellProps) {
  const [addTabModalOpen, setAddTabModalOpen] = useState(false);
  const [workspaceSearchOpen, setWorkspaceSearchOpen] = useState(false);
  const [workspaceSearchMode, setWorkspaceSearchMode] = useState<
    'general' | 'session-add'
  >('general');
  const [addTabTargetGroupId, setAddTabTargetGroupId] = useState<string>('');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);
  const [showAddressBar, setShowAddressBar] = useState(false);
  const [showSessionTopBar, setShowSessionTopBar] = useState(true);
  const [mobileTabMenuTarget, setMobileTabMenuTarget] = useState<{
    spaceId: string;
    tabGroupId: string;
  } | null>(null);
  const [desktopTabMenuTarget, setDesktopTabMenuTarget] = useState<{
    spaceId: string;
    tabGroupId: string;
    position: { x: number; y: number };
  } | null>(null);
  const [expandedSessionTabGroupId, setExpandedSessionTabGroupId] = useState<
    string | null
  >(null);
  const [mobileTabDraftLabel, setMobileTabDraftLabel] = useState('');
  const [mobileTabDraftEmoji, setMobileTabDraftEmoji] = useState('');
  const dragGroupRef = useRef<string | null>(null);
  const longPressTimerRef = useRef<number | null>(null);
  const longPressStartedAtRef = useRef<{ x: number; y: number } | null>(null);
  const suppressMobileTabClickRef = useRef(false);

  const LONG_PRESS_MS = 450;
  const LONG_PRESS_MOVE_TOLERANCE_PX = 10;

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
        setWorkspaceSearchMode('general');
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

  const handleWorkspaceSearchAdd = async (
    taskAttemptId: string,
    name: string,
    containerRef: string,
  ) => {
    if (workspaceSearchMode === 'session-add') {
      await handleAddVKWorkspaceToSpace(
        taskAttemptId,
        name,
        containerRef,
        session.activeSpaceId,
      );
      setWorkspaceSearchMode('general');
      return;
    }

    await handleAddVKWorkspace(taskAttemptId, name, containerRef);
  };

  const handleWorkspaceSearchAddToSpace = async (
    taskAttemptId: string,
    name: string,
    containerRef: string,
    spaceId: string,
  ) => {
    await handleAddVKWorkspaceToSpace(taskAttemptId, name, containerRef, spaceId);
    setWorkspaceSearchMode('general');
  };

  const handleNavigateToWorkspaceTabGroup = (
    spaceId: string,
    tabGroupId: string,
  ) => {
    if (workspaceSearchMode === 'session-add') {
      sessionActions.addTabGroupToSession(tabGroupId);
    }
    sessionActions.selectSpace(spaceId);
    sessionActions.setActiveTabGroup(tabGroupId);
    setWorkspaceSearchMode('general');
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
  const mobileSessionTabGroups = session.visitedTabGroupIds
    .map((tabGroupId) => {
      const tabGroup = workspace.tabGroups.find((tg) => tg.id === tabGroupId);
      if (!tabGroup) return null;

      const space = workspace.spaces.find((candidate) =>
        candidate.tabGroupIds.includes(tabGroupId),
      );
      if (!space) return null;

      return { space, tabGroup };
    })
    .filter(
      (
        item,
      ): item is {
        space: WorkspaceState['spaces'][number];
        tabGroup: TabGroup;
      } => item != null,
    );
  const mobileTabMenuTabGroup = mobileTabMenuTarget
    ? workspace.tabGroups.find((tg) => tg.id === mobileTabMenuTarget.tabGroupId)
    : undefined;
  const mobileTabMenuSpace = mobileTabMenuTarget
    ? workspace.spaces.find((space) => space.id === mobileTabMenuTarget.spaceId)
    : undefined;

  const expandedSessionTabGroup = useMemo(() => {
    if (!expandedSessionTabGroupId) return null;
    return (
      mobileSessionTabGroups.find(
        ({ tabGroup }) => tabGroup.id === expandedSessionTabGroupId,
      ) || null
    );
  }, [expandedSessionTabGroupId, mobileSessionTabGroups]);

  const expandedSessionItems = useMemo(() => {
    if (!expandedSessionTabGroup) {
      return [] as Array<
        | { kind: 'tab'; id: string; label: string; isActive: boolean }
        | { kind: 'pair'; id: string; label: string; isActive: boolean }
      >;
    }

    const activeItemId = sessionActions.getActiveItem(
      expandedSessionTabGroup.tabGroup.id,
    );
    const tabItems = expandedSessionTabGroup.tabGroup.tabs.map((tab) => ({
      kind: 'tab' as const,
      id: tab.id,
      label: tab.title,
      isActive: activeItemId === tab.id,
    }));
    const pairItems = expandedSessionTabGroup.tabGroup.pairs.map((pair, index) => {
      const labels = pair.tabIds
        .map((tabId) =>
          expandedSessionTabGroup.tabGroup.tabs.find((tab) => tab.id === tabId)?.title ||
          'Untitled',
        )
        .join(' + ');
      return {
        kind: 'pair' as const,
        id: pair.id,
        label: labels || `Split ${index + 1}`,
        isActive: activeItemId === pair.id,
      };
    });

    return [...tabItems, ...pairItems];
  }, [expandedSessionTabGroup, sessionActions]);

  const clearLongPress = () => {
    if (longPressTimerRef.current != null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    longPressStartedAtRef.current = null;
  };

  const openMobileTabMenu = (spaceId: string, tabGroup: TabGroup) => {
    setMobileTabMenuTarget({ spaceId, tabGroupId: tabGroup.id });
    setMobileTabDraftLabel(tabGroup.mobileLabel || '');
    setMobileTabDraftEmoji(tabGroup.mobileEmoji || '');
  };

  const handleMobileTabPointerDown = (
    event: React.PointerEvent<HTMLButtonElement>,
    spaceId: string,
    tabGroup: TabGroup,
  ) => {
    if (event.pointerType === 'mouse') return;

    clearLongPress();
    longPressStartedAtRef.current = { x: event.clientX, y: event.clientY };
    longPressTimerRef.current = window.setTimeout(() => {
      longPressTimerRef.current = null;
      suppressMobileTabClickRef.current = true;
      openMobileTabMenu(spaceId, tabGroup);
    }, LONG_PRESS_MS);
  };

  const handleMobileTabPointerMove = (
    event: React.PointerEvent<HTMLButtonElement>,
  ) => {
    if (!longPressStartedAtRef.current || longPressTimerRef.current == null) {
      return;
    }

    const deltaX = Math.abs(event.clientX - longPressStartedAtRef.current.x);
    const deltaY = Math.abs(event.clientY - longPressStartedAtRef.current.y);
    if (deltaX > LONG_PRESS_MOVE_TOLERANCE_PX || deltaY > LONG_PRESS_MOVE_TOLERANCE_PX) {
      clearLongPress();
    }
  };

  const handleSaveMobileTabDisplay = () => {
    if (!mobileTabMenuTarget) return;

    actions.updateTabGroupMobileDisplay({
      tabGroupId: mobileTabMenuTarget.tabGroupId,
      mobileLabel: mobileTabDraftLabel.trim() || null,
      mobileEmoji: mobileTabDraftEmoji.trim() || null,
    });
    setMobileTabMenuTarget(null);
  };

  const handleCloseTabGroup = async (spaceId: string, tabGroupId: string) => {
    const result = await actions.deleteTabGroup({ spaceId, tabGroupId });
    setDesktopTabMenuTarget(null);
    setMobileTabMenuTarget(null);
    setExpandedSessionTabGroupId((current) =>
      current === tabGroupId ? null : current,
    );

    if (
      result?.wasDeleted &&
      session.activeTabGroupId === tabGroupId &&
      result.nextTabGroupId
    ) {
      sessionActions.selectSpace(spaceId);
      sessionActions.setActiveTabGroup(result.nextTabGroupId);
    }
  };

  const handleToggleSessionTabGroup = (spaceId: string, tabGroupId: string) => {
    if (tabGroupId === session.activeTabGroupId) {
      setExpandedSessionTabGroupId((current) =>
        current === tabGroupId ? null : tabGroupId,
      );
      return;
    }

    setExpandedSessionTabGroupId(null);
    sessionActions.selectSpace(spaceId);
    sessionActions.setActiveTabGroup(tabGroupId);
  };

  const handleSelectExpandedSessionItem = (
    tabGroupId: string,
    item: { kind: 'tab' | 'pair'; id: string },
  ) => {
    if (item.kind === 'pair') {
      sessionActions.selectPair(tabGroupId, item.id);
    } else {
      sessionActions.selectTab(tabGroupId, item.id);
    }
    setExpandedSessionTabGroupId(null);
  };

  const handleRemoveTabGroupFromSession = (tabGroupId: string) => {
    sessionActions.removeTabGroupFromSession(tabGroupId);
    setMobileTabMenuTarget(null);
    setDesktopTabMenuTarget(null);
    setExpandedSessionTabGroupId((current) =>
      current === tabGroupId ? null : current,
    );
  };

  const openSessionWorkspaceSearch = () => {
    setDesktopTabMenuTarget(null);
    setMobileTabMenuTarget(null);
    setWorkspaceSearchMode('session-add');
    setWorkspaceSearchOpen(true);
  };

  const handleWorkspaceSearchClose = () => {
    setWorkspaceSearchOpen(false);
    setWorkspaceSearchMode('general');
  };

  useEffect(() => {
    return () => clearLongPress();
  }, []);

  useEffect(() => {
    if (!expandedSessionTabGroupId) return;
    const exists = mobileSessionTabGroups.some(
      ({ tabGroup }) => tabGroup.id === expandedSessionTabGroupId,
    );
    if (!exists || expandedSessionTabGroupId !== session.activeTabGroupId) {
      setExpandedSessionTabGroupId(null);
    }
  }, [
    expandedSessionTabGroupId,
    mobileSessionTabGroups,
    session.activeTabGroupId,
  ]);

  useEffect(() => {
    if (!desktopTabMenuTarget) return;

    const handlePointerDown = () => {
      setDesktopTabMenuTarget(null);
    };

    window.addEventListener('pointerdown', handlePointerDown);
    return () => window.removeEventListener('pointerdown', handlePointerDown);
  }, [desktopTabMenuTarget]);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setDesktopTabMenuTarget(null);
        setExpandedSessionTabGroupId(null);
      }
    };

    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, []);

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
          visitedTabGroupIds={session.visitedTabGroupIds}
          savedSessions={savedSessions}
          currentSessionId={currentSessionId}
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
          showSessionTopBar={showSessionTopBar}
          onToggleSessionTopBar={() => setShowSessionTopBar((value) => !value)}
          onResumeSession={(sessionId) => {
            sessionActions.resumeSession(sessionId);
            setIsSidebarOpen(false);
          }}
          onStartNewSession={() => {
            sessionActions.startNewSession();
            setIsSidebarOpen(false);
          }}
          onRenameSession={(sessionId, name) => {
            sessionActions.renameSession(sessionId, name);
          }}
        />
      </div>

      {/* Main content area */}
      <div className="flex-1 flex flex-col min-h-0 min-w-0 relative">
        {showSessionTopBar && (
        <div className="hidden md:flex h-9 border-b border-neutral-600 bg-neutral-900 items-stretch shrink-0">
          <div className="flex-1 min-w-0 overflow-x-auto scrollbar-hide">
            <div className="flex h-full items-stretch whitespace-nowrap">
              {mobileSessionTabGroups.map(({ space, tabGroup }) => {
                const isActive = tabGroup.id === session.activeTabGroupId;

                return (
                  <div
                    key={tabGroup.id}
                    className={`shrink-0 inline-flex h-full select-none items-center border-r border-neutral-600 border-b-2 text-xs text-neutral-200 transition-colors ${
                      isActive
                        ? 'border-b-primary-400 bg-neutral-900'
                        : 'bg-neutral-900 hover:bg-neutral-800/80'
                    }`}
                    title={`${space.name} / ${tabGroup.label}`}
                  >
                    <button
                      className="inline-flex h-full items-center gap-2 px-3 text-inherit"
                      onClick={() => {
                        handleToggleSessionTabGroup(space.id, tabGroup.id);
                      }}
                      onContextMenu={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        setDesktopTabMenuTarget({
                          spaceId: space.id,
                          tabGroupId: tabGroup.id,
                          position: { x: event.clientX, y: event.clientY },
                        });
                      }}
                      aria-label={`Open ${tabGroup.label} in ${space.name}`}
                      aria-haspopup="menu"
                    >
                      <span aria-hidden="true">{getMobileTabGroupEmoji(tabGroup)}</span>
                      <span>{tabGroup.label}</span>
                    </button>
                  </div>
                );
              })}
              <button
                className="shrink-0 h-full border-r border-b-2 border-neutral-600 bg-neutral-900 px-3 text-xs text-neutral-200 transition-colors hover:bg-neutral-800/80"
                onClick={openSessionWorkspaceSearch}
                title="Add tab group to session"
                aria-label="Add tab group to session"
              >
                +
              </button>
            </div>
          </div>
        </div>
        )}
        {showSessionTopBar && expandedSessionTabGroup && (
          <div className="hidden md:flex h-9 border-b border-neutral-600 bg-neutral-900 items-stretch shrink-0">
            <div className="flex-1 min-w-0 overflow-x-auto scrollbar-hide">
              <div className="flex h-full items-stretch whitespace-nowrap">
                {expandedSessionItems.map((item) => (
                  <button
                    key={item.id}
                    className={`shrink-0 inline-flex h-full items-center border-r border-b-2 border-neutral-600 px-3 text-xs text-neutral-200 transition-colors ${
                      item.isActive
                        ? 'border-b-primary-400 bg-neutral-900'
                        : 'bg-neutral-900 hover:bg-neutral-800/80'
                    }`}
                    onClick={() =>
                      handleSelectExpandedSessionItem(
                        expandedSessionTabGroup.tabGroup.id,
                        item,
                      )
                    }
                    title={item.label}
                  >
                    <span className="max-w-[24rem] truncate">{item.label}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

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
          savedSessions={savedSessions}
          currentSessionId={currentSessionId}
          onResumeSession={sessionActions.resumeSession}
          onRenameSession={sessionActions.renameSession}
          onDeleteSession={sessionActions.deleteSession}
          onStartNewSession={sessionActions.startNewSession}
        />

        {expandedSessionTabGroup && (
          <div className="md:hidden border-y border-neutral-700 bg-neutral-900/95 shrink-0">
            <div className="flex flex-col gap-px bg-neutral-700 px-2 py-2">
              {expandedSessionItems.map((item) => (
                <button
                  key={item.id}
                  className={`min-w-0 rounded-sm px-3 py-2 text-left text-xs transition-colors ${
                    item.isActive
                      ? 'bg-neutral-700 text-neutral-100'
                      : 'bg-neutral-900 text-neutral-300'
                  }`}
                  onClick={() =>
                    handleSelectExpandedSessionItem(
                      expandedSessionTabGroup.tabGroup.id,
                      item,
                    )
                  }
                  title={item.label}
                >
                  <span className="block truncate">{item.label}</span>
                  <span className="mt-1 block text-[10px] uppercase tracking-wide text-neutral-500">
                    {item.kind === 'pair' ? 'Split view' : 'Tab'}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="md:hidden h-12 border-t border-neutral-700 bg-neutral-900 flex items-stretch shrink-0">
          <button
            className="h-full px-3 text-neutral-200 hover:bg-neutral-800 transition-colors flex items-center justify-center shrink-0 border-r border-neutral-700"
            onClick={() => setIsSidebarOpen(true)}
            title="Open sidebar"
            aria-label="Open sidebar"
          >
            ☰
          </button>
          <div className="flex-1 min-w-0 overflow-x-auto scrollbar-hide">
            <div className="flex h-full items-stretch whitespace-nowrap">
              {mobileSessionTabGroups.length > 0 ? (
                <>
                {mobileSessionTabGroups.map(({ space, tabGroup }) => {
                  const isActive = tabGroup.id === session.activeTabGroupId;

                  return (
                    <button
                      key={tabGroup.id}
                      className={`shrink-0 inline-flex h-full select-none items-center gap-2 border-r border-neutral-700 px-3 text-xs text-neutral-200 transition-colors ${
                        isActive
                          ? 'bg-neutral-800 shadow-[inset_0_2px_0_0_rgba(250,250,250,0.28)]'
                          : 'bg-neutral-900 hover:bg-neutral-800/80'
                      }`}
                      style={{ touchAction: 'manipulation' }}
                      onClick={() => {
                        if (suppressMobileTabClickRef.current) {
                          suppressMobileTabClickRef.current = false;
                          return;
                        }
                        handleToggleSessionTabGroup(space.id, tabGroup.id);
                      }}
                      onContextMenu={(event) => {
                        event.preventDefault();
                        openMobileTabMenu(space.id, tabGroup);
                      }}
                      onPointerDown={(event) =>
                        handleMobileTabPointerDown(event, space.id, tabGroup)
                      }
                      onPointerMove={handleMobileTabPointerMove}
                      onPointerUp={clearLongPress}
                      onPointerCancel={clearLongPress}
                      onPointerLeave={clearLongPress}
                      title={`${space.name} / ${tabGroup.label}`}
                      aria-label={`Open ${tabGroup.label} in ${space.name}`}
                      aria-haspopup="dialog"
                    >
                      <span aria-hidden="true">
                        {getMobileTabGroupEmoji(tabGroup)}
                      </span>
                      <span className="max-w-10 truncate">
                        {getMobileTabGroupLabel(tabGroup)}
                      </span>
                    </button>
                  );
                })}
                <button
                  className="shrink-0 h-full border-r border-neutral-700 bg-neutral-900 px-3 text-xs text-neutral-200 transition-colors hover:bg-neutral-800/80"
                  onClick={openSessionWorkspaceSearch}
                  title="Add tab group to session"
                  aria-label="Add tab group to session"
                >
                  +
                </button>
                </>
              ) : (
                <>
                  <div className="h-full inline-flex items-center px-3 text-xs text-neutral-500 border-r border-neutral-700">
                    {activeTabGroup?.label || 'No tab groups'}
                  </div>
                  <button
                    className="shrink-0 h-full border-r border-neutral-700 bg-neutral-900 px-3 text-xs text-neutral-200 transition-colors hover:bg-neutral-800/80"
                    onClick={openSessionWorkspaceSearch}
                    title="Add tab group to session"
                    aria-label="Add tab group to session"
                  >
                    +
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
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
          onClose={handleWorkspaceSearchClose}
          onAdd={handleWorkspaceSearchAdd}
          onAddToSpace={
            workspaceSearchMode === 'session-add'
              ? undefined
              : handleWorkspaceSearchAddToSpace
          }
          onNavigateToTabGroup={handleNavigateToWorkspaceTabGroup}
          workspaceState={workspace}
          allowCustomPath={false}
        />
      )}

      {desktopTabMenuTarget && (() => {
        const space = workspace.spaces.find(
          (candidate) => candidate.id === desktopTabMenuTarget.spaceId,
        );
        const tabGroup = workspace.tabGroups.find(
          (candidate) => candidate.id === desktopTabMenuTarget.tabGroupId,
        );

        return (
          <div
            className="hidden md:block fixed z-[90] min-w-[220px] rounded-md border border-neutral-700 bg-neutral-900 py-1 shadow-2xl"
            style={{
              left: desktopTabMenuTarget.position.x,
              top: desktopTabMenuTarget.position.y,
            }}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <button
              className="block w-full px-4 py-2 text-left text-sm text-neutral-200 transition-colors hover:bg-neutral-800"
              onClick={() => {
                handleRemoveTabGroupFromSession(
                  desktopTabMenuTarget.tabGroupId,
                );
              }}
            >
              Remove From Session
            </button>
            <div className="my-1 border-t border-neutral-700" />
            <button
              className="block w-full px-4 py-2 text-left text-sm text-red-300 transition-colors hover:bg-neutral-800"
              onClick={() => {
                setDesktopTabMenuTarget(null);
                if (
                  confirm(
                    space?.tabGroupIds.length === 1
                      ? `Close "${tabGroup?.label || 'this tab group'}" everywhere? Because it's the last tab group in this space, a replacement tab group will be created automatically.`
                      : `Close "${tabGroup?.label || 'this tab group'}" everywhere? This deletes the tab group, not just from the current session.`,
                  )
                ) {
                  void handleCloseTabGroup(
                    desktopTabMenuTarget.spaceId,
                    desktopTabMenuTarget.tabGroupId,
                  );
                }
              }}
            >
              Close Tab Group Everywhere
            </button>
          </div>
        );
      })()}

      {mobileTabMenuTarget && mobileTabMenuTabGroup && (
        <div className="md:hidden fixed inset-0 z-[90] bg-black/60 flex items-end">
          <button
            className="absolute inset-0"
            aria-label="Close mobile tab menu"
            onClick={() => setMobileTabMenuTarget(null)}
          />
          <div className="relative w-full rounded-t-2xl border-t border-neutral-700 bg-neutral-900 p-4 space-y-4">
            <div>
              <div className="text-sm font-semibold text-neutral-100">
                Edit Mobile Tab
              </div>
              <div className="text-xs text-neutral-500 mt-1">
                Long press opens this menu. Tap still switches tabs. Closing here closes the whole tab group.
              </div>
            </div>

            <div className="space-y-3">
              <label className="block">
                <span className="text-xs text-neutral-400">Mobile name</span>
                <input
                  type="text"
                  value={mobileTabDraftLabel}
                  onChange={(event) => setMobileTabDraftLabel(event.target.value)}
                  placeholder={mobileTabMenuTabGroup.label}
                  className="mt-1 w-full rounded-md border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-white focus:outline-none focus:border-primary-500"
                />
              </label>

              <label className="block">
                <span className="text-xs text-neutral-400">Emoji</span>
                <input
                  type="text"
                  value={mobileTabDraftEmoji}
                  onChange={(event) =>
                    setMobileTabDraftEmoji(getFirstGrapheme(event.target.value))
                  }
                  placeholder={getMobileTabGroupEmoji(mobileTabMenuTabGroup)}
                  className="mt-1 w-full rounded-md border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-white focus:outline-none focus:border-primary-500"
                />
                <div className="mt-2 flex flex-wrap gap-2">
                  {MOBILE_TAB_EMOJI_CHOICES.map((emoji) => (
                    <button
                      key={emoji}
                      type="button"
                      className={`rounded-md border px-2 py-1 text-base ${
                        mobileTabDraftEmoji === emoji
                          ? 'border-primary-500 bg-primary-500/15'
                          : 'border-neutral-700 bg-neutral-800'
                      }`}
                      onClick={() => setMobileTabDraftEmoji(emoji)}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              </label>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                className="rounded-md border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-neutral-200"
                onClick={() => setMobileTabMenuTarget(null)}
              >
                Cancel
              </button>
              <button
                className="rounded-md border border-primary-500/40 bg-primary-500/15 px-3 py-2 text-sm text-primary-200"
                onClick={handleSaveMobileTabDisplay}
              >
                Save
              </button>
              <button
                className="rounded-md border border-amber-500/40 bg-amber-500/15 px-3 py-2 text-sm text-amber-300"
                onClick={() => {
                  handleRemoveTabGroupFromSession(mobileTabMenuTarget.tabGroupId);
                }}
              >
                Remove From Session
              </button>
            </div>
            <button
                className="w-full rounded-md border border-red-500/40 bg-red-500/15 px-3 py-2 text-sm text-red-300"
                onClick={() => {
                  const { spaceId, tabGroupId } = mobileTabMenuTarget;
                  setMobileTabMenuTarget(null);
                  if (
                    confirm(
                      mobileTabMenuSpace?.tabGroupIds.length === 1
                        ? `Close "${mobileTabMenuTabGroup.label}" everywhere? Because it's the last tab group in this space, a replacement tab group will be created automatically.`
                        : `Close "${mobileTabMenuTabGroup.label}" everywhere? This deletes the tab group, not just from the current session.`,
                    )
                  ) {
                    void handleCloseTabGroup(spaceId, tabGroupId);
                  }
                }}
              >
                Close Tab Group
              </button>
          </div>
        </div>
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

function getMobileTabGroupLabel(tabGroup: TabGroup): string {
  const compact = (tabGroup.mobileLabel || tabGroup.label).trim();
  if (!compact) return 'Tab';
  if (compact.length <= 4) return compact;

  return compact.slice(0, 4);
}

function getMobileTabGroupEmoji(tabGroup: TabGroup): string {
  if (tabGroup.mobileEmoji?.trim()) return tabGroup.mobileEmoji.trim();

  const normalized = tabGroup.label.toLowerCase();

  if (normalized.includes('overview') || normalized.includes('home')) return '🏠';

  return MOBILE_TAB_EMOJI_CHOICES[getStableEmojiIndex(tabGroup.id)] || '📁';
}

function getFirstGrapheme(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';

  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    const iterator = segmenter.segment(trimmed)[Symbol.iterator]();
    const first = iterator.next();
    return first.done ? '' : first.value.segment;
  }

  return Array.from(trimmed)[0] || '';
}

function getStableEmojiIndex(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash % MOBILE_TAB_EMOJI_CHOICES.length;
}
