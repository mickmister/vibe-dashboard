import React, { useState, useEffect, useRef } from 'react';
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
  const [addTabTargetGroupId, setAddTabTargetGroupId] = useState<string>('');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);
  const [showAddressBar, setShowAddressBar] = useState(false);
  const [mobileTabMenuTarget, setMobileTabMenuTarget] = useState<{
    spaceId: string;
    tabGroupId: string;
  } | null>(null);
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

  const handleCloseMobileTab = async () => {
    if (!mobileTabMenuTarget) return;
    const { spaceId, tabGroupId } = mobileTabMenuTarget;
    const result = await actions.deleteTabGroup({ spaceId, tabGroupId });
    if (result?.wasDeleted && result.nextTabGroupId) {
      sessionActions.selectSpace(spaceId);
      sessionActions.setActiveTabGroup(result.nextTabGroupId);
      setMobileTabMenuTarget(null);
      return;
    }
    setMobileTabMenuTarget(null);
  };

  useEffect(() => {
    return () => clearLongPress();
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
        />

        <div className="md:hidden h-12 px-2 border-t border-neutral-800 bg-neutral-900 flex items-center gap-2 shrink-0">
          <button
            className="h-8 w-8 rounded-md text-neutral-200 hover:bg-neutral-800 transition-colors flex items-center justify-center shrink-0"
            onClick={() => setIsSidebarOpen(true)}
            title="Open sidebar"
            aria-label="Open sidebar"
          >
            ☰
          </button>
          <div className="flex-1 min-w-0 overflow-x-auto scrollbar-hide">
            <div className="flex items-center gap-1 pr-1">
              {mobileSessionTabGroups.length > 0 ? (
                mobileSessionTabGroups.map(({ space, tabGroup }) => {
                  const isActive = tabGroup.id === session.activeTabGroupId;

                  return (
                    <button
                      key={tabGroup.id}
                      className={`shrink-0 inline-flex select-none items-center gap-1 rounded-md px-2 py-1 text-xs transition-colors ${
                        isActive
                          ? 'bg-primary-500/20 text-primary-300'
                          : 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700'
                      }`}
                      style={{ touchAction: 'manipulation' }}
                      onClick={() => {
                        if (suppressMobileTabClickRef.current) {
                          suppressMobileTabClickRef.current = false;
                          return;
                        }
                        sessionActions.selectSpace(space.id);
                        sessionActions.setActiveTabGroup(tabGroup.id);
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
                })
              ) : (
                <div className="text-xs text-neutral-500">
                  {activeTabGroup?.label || 'No tab groups'}
                </div>
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
          onClose={() => setWorkspaceSearchOpen(false)}
          onAdd={handleAddVKWorkspace}
          onAddToSpace={handleAddVKWorkspaceToSpace}
          onNavigateToTabGroup={handleNavigateToWorkspaceTabGroup}
          workspaceState={workspace}
          allowCustomPath={false}
        />
      )}

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

            <div className="grid grid-cols-3 gap-2">
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
                className="rounded-md border border-red-500/40 bg-red-500/15 px-3 py-2 text-sm text-red-300"
                onClick={() => {
                  void handleCloseMobileTab();
                }}
              >
                Close Tab Group
              </button>
            </div>
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
