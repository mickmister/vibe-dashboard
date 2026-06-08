import React, {
  useState,
  useCallback,
  useEffect,
  useRef,
  useMemo,
} from 'react';
import { Button, Input } from '@heroui/react';
import type {
  WorkspaceState,
  Space,
  TabGroup,
  SavedWorkspaceSession,
  VoyageEntry,
} from '../types';
import { TabContextMenu } from './TabContextMenu';

const INTERNAL_URL_PREFIX = 'internal://';

interface SidebarProps {
  workspace: WorkspaceState;
  activeSpaceId: string;
  activeTabGroupId: string;
  activeItems: Record<string, string>;
  visitedTabGroupIds: string[];
  voyageEntries: VoyageEntry[];
  activeVoyageEntryId: string;
  savedSessions: SavedWorkspaceSession[];
  currentSessionId: string;
  onRequestClose?: () => void;
  onSelectTabGroup: (tabGroupId: string) => void;
  onSelectTab: (tabGroupId: string, tabId: string) => void;
  onSelectPair: (tabGroupId: string, pairId: string) => void;
  onSelectVoyageEntry: (voyageEntryId: string) => void;
  onAddSpace: (
    name: string,
  ) => Promise<{ spaceId: string; tabGroupId: string } | undefined> | { spaceId: string; tabGroupId: string } | undefined;
  onDeleteSpace: (spaceId: string) => void;
  onRenameSpace: (spaceId: string, name: string) => void;
  onDeleteTabGroup: (
    spaceId: string,
    tabGroupId: string,
  ) => Promise<{ wasDeleted: boolean; nextTabGroupId?: string } | undefined>;
  onRenameTabGroup: (tabGroupId: string, label: string) => void;
  onAddTabGroup: (label: string, spaceId?: string) => Promise<void> | void;
  onAddTab: (
    tabGroupId: string,
    title: string,
    url: string,
  ) => Promise<void> | void;
  onOpenCreateWorkspaceTab: () => Promise<void> | void;
  onOpenCraftFlow: () => Promise<void> | void;
  onCreatePair: (tabGroupId: string, tabIds: string[]) => Promise<void> | void;
  onCloseTab: (tabGroupId: string, tabId: string) => void;
  onSplitPair: (tabGroupId: string, pairId: string) => void;
  onRenameTab: (tabGroupId: string, tabId: string, title: string) => void;
  onOpenAddTabModal: (tabGroupId: string) => void;
  onToggleStarTabGroup: (tabGroupId: string) => void;
  onReorderTabGroups: (sourceId: string, targetId: string) => void;
  onReorderSpaces: (sourceId: string, targetId: string) => void;
  showAddressBar: boolean;
  onToggleAddressBar: () => void;
  onResumeSession: (sessionId: string) => void;
  onStartNewSession: () => void;
  onRenameSession: (sessionId: string, name: string) => void;
}

const SPACE_ICONS: Record<string, string> = {
  code: '</> ',
  preview: '👁 ',
  chat: '💬 ',
  default: '📁 ',
};

export function Sidebar({
  workspace,
  activeSpaceId,
  activeTabGroupId,
  activeItems,
  visitedTabGroupIds,
  voyageEntries,
  activeVoyageEntryId,
  savedSessions,
  currentSessionId,
  onRequestClose,
  onSelectTabGroup,
  onSelectTab,
  onSelectPair,
  onSelectVoyageEntry,
  onAddSpace,
  onDeleteSpace,
  onRenameSpace,
  onDeleteTabGroup,
  onRenameTabGroup,
  onAddTabGroup,
  onAddTab,
  onOpenCreateWorkspaceTab,
  onOpenCraftFlow,
  onCreatePair,
  onCloseTab,
  onSplitPair,
  onRenameTab,
  onOpenAddTabModal,
  onToggleStarTabGroup,
  onReorderTabGroups,
  onReorderSpaces,
  showAddressBar,
  onToggleAddressBar,
  onResumeSession,
  onStartNewSession,
  onRenameSession,
}: SidebarProps) {
  const [view, setView] = useState<'groups' | 'spaces'>('groups');
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [contextMenu, setContextMenu] = useState<{
    spaceId: string;
    position: { x: number; y: number };
  } | null>(null);
  const [groupContextMenu, setGroupContextMenu] = useState<{
    tabGroupId: string;
    position: { x: number; y: number };
  } | null>(null);
  const [tabItemContextMenu, setTabItemContextMenu] = useState<{
    tabGroupId: string;
    tabId: string;
    position: { x: number; y: number };
  } | null>(null);
  const [mobileAction, setMobileAction] = useState<
    'group' | 'tab' | 'pair' | null
  >(null);
  const [newGroupLabel, setNewGroupLabel] = useState('');
  const [newTabTitle, setNewTabTitle] = useState('');
  const [newTabUrl, setNewTabUrl] = useState('');
  const [pairSelection, setPairSelection] = useState<string[]>([]);
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [sessionNameDraft, setSessionNameDraft] = useState('');
  const [viewedSpaceId, setViewedSpaceId] = useState(activeSpaceId);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const groupContextMenuRef = useRef<HTMLDivElement>(null);
  const dragTabGroupRef = useRef<string | null>(null);
  const dragSpaceRef = useRef<string | null>(null);
  const [starredExpanded, setStarredExpanded] = useState(() => {
    try {
      return sessionStorage.getItem('sidebar-starred-expanded') === 'true';
    } catch {
      return false;
    }
  });
  useEffect(() => {
    setViewedSpaceId(activeSpaceId);
  }, [activeSpaceId]);

  const viewedSpace = workspace.spaces.find(
    (space) => space.id === viewedSpaceId,
  );

  const orderedSpaces = useMemo(() => {
    return [...workspace.spaces].sort((left, right) => {
      if (left.isSystem === right.isSystem) return 0;
      return left.isSystem ? -1 : 1;
    });
  }, [workspace.spaces]);
  const activeTabGroups = useMemo(() => {
    if (!viewedSpace) return [];
    return viewedSpace.tabGroupIds
      .map((id) => workspace.tabGroups.find((tabGroup) => tabGroup.id === id))
      .filter((tabGroup): tabGroup is TabGroup => tabGroup != null);
  }, [viewedSpace, workspace.tabGroups]);
  const activeTabGroup = activeTabGroups.find(
    (tabGroup) => tabGroup.id === activeTabGroupId,
  );
  const availablePairTabs = useMemo(() => {
    if (!activeTabGroup) return [];
    const tabsInPairs = new Set(
      activeTabGroup.pairs.flatMap((pair) => pair.tabIds),
    );
    return activeTabGroup.tabs.filter(
      (tab) =>
        !tabsInPairs.has(tab.id) && !tab.url.startsWith(INTERNAL_URL_PREFIX),
    );
  }, [activeTabGroup]);

  const starredTabGroups = useMemo(() => {
    const items: { space: Space; tg: TabGroup }[] = [];
    for (const space of orderedSpaces) {
      if (space.isSystem) continue;
      for (const tgId of space.tabGroupIds) {
        const tg = workspace.tabGroups.find((g) => g.id === tgId);
        if (tg?.starred) items.push({ space, tg });
      }
    }
    return items;
  }, [orderedSpaces, workspace.tabGroups]);

  const sessionVoyageEntries = useMemo(() => {
    return voyageEntries
      .map((entry) => {
        const tabGroup = workspace.tabGroups.find((group) => group.id === entry.tabGroupId);
        if (!tabGroup) return null;

        const space = workspace.spaces.find((candidate) =>
          candidate.tabGroupIds.includes(entry.tabGroupId),
        );
        if (!space) return null;

        return { entry, space, tg: tabGroup };
      })
      .filter((item): item is { entry: VoyageEntry; space: Space; tg: TabGroup } => item != null);
  }, [voyageEntries, workspace.spaces, workspace.tabGroups]);

  const resumableSessions = useMemo(() => {
    return savedSessions
      .filter((session) => session.id !== currentSessionId)
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
      .slice(0, 6);
  }, [currentSessionId, savedSessions]);
  const currentSession = useMemo(
    () => savedSessions.find((session) => session.id === currentSessionId),
    [currentSessionId, savedSessions],
  );

  const toggleStarredExpanded = useCallback(() => {
    setStarredExpanded((prev) => {
      const next = !prev;
      try {
        sessionStorage.setItem('sidebar-starred-expanded', String(next));
      } catch {}
      return next;
    });
  }, []);

  const handleTabGroupDragStart = useCallback(
    (e: React.DragEvent, tabGroupId: string) => {
      dragTabGroupRef.current = tabGroupId;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', tabGroupId);
    },
    [workspace.spaces],
  );

  const handleTabGroupDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }, []);

  const handleTabGroupDrop = useCallback(
    (e: React.DragEvent, targetId: string) => {
      e.preventDefault();
      const sourceId = dragTabGroupRef.current;
      if (!sourceId || sourceId === targetId) return;
      onReorderTabGroups(sourceId, targetId);
      dragTabGroupRef.current = null;
    },
    [onReorderTabGroups],
  );

  const handleSpaceDragStart = useCallback(
    (e: React.DragEvent, spaceId: string) => {
      const space = workspace.spaces.find((entry) => entry.id === spaceId);
      if (space?.isSystem) return;
      dragSpaceRef.current = spaceId;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', spaceId);
    },
    [],
  );

  const handleSpaceDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }, []);

  const handleSpaceDrop = useCallback(
    (e: React.DragEvent, targetId: string) => {
      e.preventDefault();
      const sourceId = dragSpaceRef.current;
      if (!sourceId || sourceId === targetId) return;
      onReorderSpaces(sourceId, targetId);
      dragSpaceRef.current = null;
    },
    [onReorderSpaces],
  );

  const handleAddSubmit = useCallback(() => {
    const name = newName.trim();
    if (name) {
      void Promise.resolve(onAddSpace(name)).then((result) => {
        if (result?.spaceId) {
          setViewedSpaceId(result.spaceId);
          setView('groups');
        }
        setNewName('');
        setAdding(false);
      });
    }
  }, [newName, onAddSpace]);

  const handleRenameSubmit = useCallback(
    (id: string) => {
      const name = editName.trim();
      if (name) {
        onRenameSpace(id, name);
      }
      setEditingId(null);
    },
    [editName, onRenameSpace],
  );

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, spaceId: string) => {
      e.preventDefault();
      e.stopPropagation();
      setContextMenu({
        spaceId,
        position: { x: e.clientX, y: e.clientY },
      });
    },
    [],
  );

  const handleGroupContextMenu = useCallback(
    (e: React.MouseEvent, tabGroupId: string) => {
      e.preventDefault();
      e.stopPropagation();
      setGroupContextMenu({
        tabGroupId,
        position: { x: e.clientX, y: e.clientY },
      });
    },
    [],
  );

  const handleTabItemContextMenu = useCallback(
    (e: React.MouseEvent, tabGroupId: string, tabId: string) => {
      e.preventDefault();
      e.stopPropagation();
      setTabItemContextMenu({
        tabGroupId,
        tabId,
        position: { x: e.clientX, y: e.clientY },
      });
    },
    [],
  );

  const handleDeleteSpace = useCallback(() => {
    if (!contextMenu) return;

    if (confirm(`Delete this space? All craft and views will be closed.`)) {
      onDeleteSpace(contextMenu.spaceId);
    }
    setContextMenu(null);
  }, [contextMenu, onDeleteSpace]);

  const handleRenameFromContextMenu = useCallback(() => {
    if (!contextMenu) return;

    const space = workspace.spaces.find((s) => s.id === contextMenu.spaceId);
    if (space) {
      setEditingId(contextMenu.spaceId);
      setEditName(space.name);
    }
    setContextMenu(null);
  }, [contextMenu, workspace.spaces]);

  const handleRenameTabGroup = useCallback(() => {
    if (!groupContextMenu) return;

    const tabGroup = activeTabGroups.find(
      (group) => group.id === groupContextMenu.tabGroupId,
    );
    if (!tabGroup) {
      setGroupContextMenu(null);
      return;
    }

    const newLabel = prompt('Rename craft:', tabGroup.label);
    if (newLabel && newLabel.trim() && newLabel.trim() !== tabGroup.label) {
      onRenameTabGroup(tabGroup.id, newLabel.trim());
    }
    setGroupContextMenu(null);
  }, [activeTabGroups, groupContextMenu, onRenameTabGroup]);

  const handleDeleteTabGroup = useCallback(async () => {
    if (!groupContextMenu) return;

    const tabGroup = activeTabGroups.find(
      (group) => group.id === groupContextMenu.tabGroupId,
    );
    if (!tabGroup) {
      setGroupContextMenu(null);
      return;
    }

    const confirmed = confirm(
      `Delete craft "${tabGroup.label}"? All views in this craft will be closed.`,
    );
    if (!confirmed) {
      setGroupContextMenu(null);
      return;
    }

    const result = await onDeleteTabGroup(viewedSpace?.id || activeSpaceId, tabGroup.id);
    if (result?.wasDeleted && result.nextTabGroupId) {
      onSelectTabGroup(result.nextTabGroupId);
    }
    setGroupContextMenu(null);
  }, [
    activeSpaceId,
    activeTabGroups,
    groupContextMenu,
    onDeleteTabGroup,
    onSelectTabGroup,
    viewedSpace?.id,
  ]);

  const handleSelectSpace = useCallback(
    (spaceId: string) => {
      setViewedSpaceId(spaceId);
      setView('groups');
    },
    [],
  );

  const handleCreateGroup = useCallback(async () => {
    const label = newGroupLabel.trim();
    if (!label) return;
    await onAddTabGroup(label, viewedSpace?.id);
    setNewGroupLabel('');
    setMobileAction(null);
  }, [newGroupLabel, onAddTabGroup, viewedSpace?.id]);

  const handleCreateTab = useCallback(async () => {
    if (!activeTabGroup) return;
    const title = newTabTitle.trim();
    const url = newTabUrl.trim();
    if (!(title && url)) return;
    await onAddTab(activeTabGroup.id, title, url);
    setNewTabTitle('');
    setNewTabUrl('');
    setMobileAction(null);
  }, [activeTabGroup, newTabTitle, newTabUrl, onAddTab]);

  const togglePairTab = useCallback((tabId: string) => {
    setPairSelection((prev) => {
      if (prev.includes(tabId)) {
        return prev.filter((id) => id !== tabId);
      }
      if (prev.length >= 2) return prev;
      return [...prev, tabId];
    });
  }, []);

  const handleCreatePair = useCallback(async () => {
    if (!activeTabGroup || pairSelection.length !== 2) return;
    await onCreatePair(activeTabGroup.id, pairSelection);
    setPairSelection([]);
    setMobileAction(null);
  }, [activeTabGroup, onCreatePair, pairSelection]);

  const getSessionDisplayName = useCallback(
    (session: SavedWorkspaceSession) => {
      const explicitName = session.name?.trim();
      if (explicitName) return explicitName;

      const sessionTabGroup = workspace.tabGroups.find(
        (tabGroup) => tabGroup.id === session.activeTabGroupId,
      );
      return sessionTabGroup?.label || 'Saved voyage';
    },
    [workspace.tabGroups],
  );

  const startRenamingSession = useCallback(
    (session: SavedWorkspaceSession) => {
      setEditingSessionId(session.id);
      setSessionNameDraft(getSessionDisplayName(session));
    },
    [getSessionDisplayName],
  );

  const cancelSessionRename = useCallback(() => {
    setEditingSessionId(null);
    setSessionNameDraft('');
  }, []);

  const submitSessionRename = useCallback(
    (sessionId: string) => {
      const nextName = sessionNameDraft.trim();
      if (nextName) {
        onRenameSession(sessionId, nextName);
      }
      cancelSessionRename();
    },
    [cancelSessionRename, onRenameSession, sessionNameDraft],
  );

  useEffect(() => {
    setAdding(false);
    setEditingId(null);
    setContextMenu(null);
    setGroupContextMenu(null);
    setTabItemContextMenu(null);
    setMobileAction(null);
  }, [view]);

  useEffect(() => {
    setMobileAction(null);
    setPairSelection([]);
    setTabItemContextMenu(null);
  }, [activeTabGroupId]);

  // Close context menus when clicking outside
  useEffect(() => {
    if (!contextMenu && !groupContextMenu) return;

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (contextMenuRef.current?.contains(target)) return;
      if (groupContextMenuRef.current?.contains(target)) return;
      setContextMenu(null);
      setGroupContextMenu(null);
    };

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setContextMenu(null);
        setGroupContextMenu(null);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [contextMenu, groupContextMenu]);

  return (
    <div className="h-full w-72 bg-neutral-900 border-r border-neutral-800 flex flex-col shrink-0">
      <div className="p-3 border-b border-neutral-800">
        {view === 'groups' ? (
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <button
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-neutral-300 transition-colors hover:bg-neutral-800 hover:text-white"
                title="Close sidebar"
                aria-label="Close sidebar"
                onClick={onRequestClose}
              >
                ✕
              </button>
              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
                  Current Space
                </p>
                <h2 className="text-sm font-semibold text-neutral-100 truncate">
                  {viewedSpace?.name || 'Unknown Space'}
                </h2>
              </div>
            </div>
            <button
              className="inline-flex h-8 shrink-0 items-center justify-center rounded-md px-2 text-xs font-medium text-neutral-300 transition-colors hover:bg-neutral-800 hover:text-white"
              title="Show all spaces"
              onClick={() => setView('spaces')}
            >
              Spaces
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <button
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-neutral-300 transition-colors hover:bg-neutral-800 hover:text-white"
                title="Close sidebar"
                aria-label="Close sidebar"
                onClick={onRequestClose}
              >
                ✕
              </button>
              <h2 className="text-xs font-semibold uppercase tracking-wider text-neutral-400">
                Spaces
              </h2>
            </div>
            <button
              className="inline-flex h-8 shrink-0 items-center justify-center rounded-md px-2 text-xs font-medium text-neutral-300 transition-colors hover:bg-neutral-800 hover:text-white"
              title="Back to current space"
              onClick={() => {
                setViewedSpaceId(activeSpaceId);
                setView('groups');
              }}
            >
              Current
            </button>
          </div>
        )}
      </div>

      {view === 'groups' ? (
        <div className="flex-1 min-h-0 flex flex-col">
          <div className="p-2 border-b border-neutral-800 space-y-2">
            <Button
              size="sm"
              color="primary"
              className="w-full"
              onPress={() => {
                void onOpenCreateWorkspaceTab();
              }}
            >
              New Task
            </Button>
            <Button
              size="sm"
              variant="flat"
              className="w-full"
              onPress={() => {
                void onOpenCraftFlow();
              }}
            >
              Open Craft
            </Button>
            <div className="grid grid-cols-3 gap-1.5">
              <Button
                size="sm"
                variant={mobileAction === 'group' ? 'solid' : 'flat'}
                color={mobileAction === 'group' ? 'primary' : 'default'}
                onPress={() =>
                  setMobileAction((prev) => (prev === 'group' ? null : 'group'))
                }
              >
                + Craft
              </Button>
              <Button
                size="sm"
                variant={mobileAction === 'tab' ? 'solid' : 'flat'}
                color={mobileAction === 'tab' ? 'primary' : 'default'}
                onPress={() => {
                  if (!activeTabGroup) return;
                  setMobileAction((prev) => (prev === 'tab' ? null : 'tab'));
                  setNewTabTitle((prev) => prev || 'New View');
                  setNewTabUrl((prev) => prev || '/');
                }}
                isDisabled={!activeTabGroup}
              >
                + View
              </Button>
              <Button
                size="sm"
                variant={mobileAction === 'pair' ? 'solid' : 'flat'}
                color={mobileAction === 'pair' ? 'primary' : 'default'}
                onPress={() => {
                  if (availablePairTabs.length < 2) return;
                  setMobileAction((prev) => (prev === 'pair' ? null : 'pair'));
                  setPairSelection([]);
                }}
                isDisabled={availablePairTabs.length < 2}
              >
                + Pair
              </Button>
            </div>

            {mobileAction === 'group' && (
              <div className="space-y-1.5">
                <Input
                  size="sm"
                  value={newGroupLabel}
                  onChange={(e) => setNewGroupLabel(e.target.value)}
                  placeholder="Craft name..."
                  classNames={{ inputWrapper: 'bg-neutral-800' }}
                />
                <Button
                  size="sm"
                  color="primary"
                  className="w-full"
                  onPress={handleCreateGroup}
                >
                  Create Craft
                </Button>
              </div>
            )}

            {mobileAction === 'tab' && (
              <div className="space-y-1.5">
                <Input
                  size="sm"
                  value={newTabTitle}
                  onChange={(e) => setNewTabTitle(e.target.value)}
                  placeholder="View title..."
                  classNames={{ inputWrapper: 'bg-neutral-800' }}
                />
                <Input
                  size="sm"
                  value={newTabUrl}
                  onChange={(e) => setNewTabUrl(e.target.value)}
                  placeholder="/ or https://..."
                  classNames={{ inputWrapper: 'bg-neutral-800' }}
                />
                <Button
                  size="sm"
                  color="primary"
                  className="w-full"
                  onPress={handleCreateTab}
                  isDisabled={!activeTabGroup}
                >
                  Create View
                </Button>
              </div>
            )}

            {mobileAction === 'pair' && (
              <div className="space-y-1.5">
                <p className="text-xs text-neutral-400">Pick 2 views to split</p>
                <div className="max-h-28 overflow-y-auto space-y-1">
                  {availablePairTabs.map((tab) => {
                    const selected = pairSelection.includes(tab.id);
                    return (
                      <button
                        key={tab.id}
                        className={`w-full text-left px-2 py-1.5 rounded text-sm transition-colors ${
                          selected
                            ? 'bg-primary-500/25 text-primary-200'
                            : 'bg-neutral-800 text-neutral-200'
                        }`}
                        onClick={() => togglePairTab(tab.id)}
                      >
                        {tab.title}
                      </button>
                    );
                  })}
                </div>
                <Button
                  size="sm"
                  color="primary"
                  className="w-full"
                  onPress={handleCreatePair}
                  isDisabled={pairSelection.length !== 2}
                >
                  Create Pair
                </Button>
              </div>
            )}
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto">
            <div className="border-b border-neutral-800">
              <div className="px-3 py-2 text-xs font-semibold uppercase tracking-wider text-neutral-500">
                Current Voyage
              </div>
              <div className="px-2 pb-2 space-y-2">
                <div className="px-3 py-2 rounded-lg bg-neutral-800/60">
                  {currentSession && editingSessionId === currentSession.id ? (
                    <Input
                      size="sm"
                      value={sessionNameDraft}
                      onChange={(e) => setSessionNameDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') submitSessionRename(currentSession.id);
                        if (e.key === 'Escape') cancelSessionRename();
                      }}
                      onBlur={() => submitSessionRename(currentSession.id)}
                      autoFocus
                      classNames={{
                        input: 'text-sm',
                        inputWrapper: 'h-8 min-h-8 bg-neutral-700',
                      }}
                    />
                  ) : (
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-neutral-100 truncate">
                          {currentSession
                            ? getSessionDisplayName(currentSession)
                            : 'Current voyage'}
                        </div>
                        {currentSession && (
                          <div className="text-xs text-neutral-500 mt-1 truncate">
                            Updated {formatSessionTimestamp(currentSession.updatedAt)}
                          </div>
                        )}
                      </div>
                      {currentSession && (
                        <button
                          className="text-[10px] uppercase tracking-wide text-neutral-500 hover:text-neutral-300"
                          onClick={() => startRenamingSession(currentSession)}
                        >
                          Rename
                        </button>
                      )}
                    </div>
                  )}
                </div>
                <Button
                  size="sm"
                  variant="flat"
                  className="w-full"
                  onPress={onStartNewSession}
                >
                  + New Voyage
                </Button>
              </div>
            </div>

            {sessionVoyageEntries.length > 0 && (
              <div className="border-b border-neutral-800">
                <div className="px-3 py-2 text-xs font-semibold uppercase tracking-wider text-neutral-500">
                  Active Fleet
                </div>
                <div className="px-2 pb-2 space-y-0.5">
                  {sessionVoyageEntries.map(({ entry, space, tg }) => (
                    <button
                      key={entry.id}
                      className={`w-full text-left px-3 py-1.5 rounded-lg transition-colors ${
                        activeVoyageEntryId === entry.id
                          ? 'bg-primary-500/20 text-primary-300'
                          : 'text-neutral-300 hover:bg-neutral-800'
                      }`}
                      onClick={() => {
                        onSelectVoyageEntry(entry.id);
                      }}
                    >
                      <div className="text-sm font-medium truncate">{tg.label}</div>
                      <div className="text-xs text-neutral-500 mt-0.5">
                        {space.name}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {resumableSessions.length > 0 && (
              <div className="border-b border-neutral-800">
                <div className="px-3 py-2 text-xs font-semibold uppercase tracking-wider text-neutral-500">
                  Resume Voyage
                </div>
                <div className="px-2 pb-2 space-y-0.5">
                  {resumableSessions.map((session) => {
                    const sessionSpace = workspace.spaces.find(
                      (space) => space.id === session.activeSpaceId,
                    );
                    const sessionTabGroup = workspace.tabGroups.find(
                      (tabGroup) => tabGroup.id === session.activeTabGroupId,
                    );

                    return (
                      <div
                        key={session.id}
                        className="w-full text-left px-3 py-1.5 rounded-lg text-neutral-300 hover:bg-neutral-800 transition-colors"
                      >
                        <div className="flex items-center gap-2">
                          {editingSessionId === session.id ? (
                            <Input
                              size="sm"
                              value={sessionNameDraft}
                              onChange={(e) => setSessionNameDraft(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') submitSessionRename(session.id);
                                if (e.key === 'Escape') cancelSessionRename();
                              }}
                              onBlur={() => submitSessionRename(session.id)}
                              autoFocus
                              classNames={{
                                input: 'text-sm',
                                inputWrapper: 'h-7 min-h-7 bg-neutral-700',
                              }}
                            />
                          ) : (
                            <>
                              <button
                                className="text-sm font-medium truncate flex-1 text-left"
                                onClick={() => onResumeSession(session.id)}
                              >
                                {getSessionDisplayName(session)}
                              </button>
                              <button
                                className="text-[10px] uppercase tracking-wide text-neutral-500 hover:text-neutral-300"
                                onClick={() => startRenamingSession(session)}
                              >
                                Rename
                              </button>
                            </>
                          )}
                        </div>
                        <div className="text-xs text-neutral-500 mt-0.5 truncate">
                          {sessionSpace?.name || 'Unknown space'} •{' '}
                          {formatSessionTimestamp(session.updatedAt)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Starred crafts section */}
            {starredTabGroups.length > 0 && (
              <div className="border-b border-neutral-800">
                <button
                  className="w-full flex items-center gap-2 px-3 py-2 text-xs font-semibold uppercase tracking-wider text-neutral-500 hover:text-neutral-300 transition-colors"
                  onClick={toggleStarredExpanded}
                >
                  <span className="text-[10px]">
                    {starredExpanded ? '▼' : '▶'}
                  </span>
                  Starred ({starredTabGroups.length})
                </button>
                {starredExpanded && (
                  <div className="px-2 pb-2 space-y-0.5">
                    {starredTabGroups.map(({ space, tg }) => (
                      <button
                        key={tg.id}
                        className={`w-full text-left px-3 py-1.5 rounded-lg transition-colors ${
                          activeTabGroupId === tg.id
                            ? 'bg-primary-500/20 text-primary-300'
                            : 'text-neutral-300 hover:bg-neutral-800'
                        }`}
                        onClick={() => {
                          setViewedSpaceId(space.id);
                          onSelectTabGroup(tg.id);
                        }}
                      >
                        <div className="text-sm font-medium truncate flex items-center gap-1.5">
                          <span className="text-amber-400 text-xs">★</span>
                          {tg.label}
                        </div>
                        <div className="text-xs text-neutral-500 mt-0.5 pl-4">
                          {space.name}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="p-2 space-y-1">
            {activeTabGroups.length === 0 ? (
              <div className="px-3 py-4 text-sm text-neutral-500">
                No craft in this space.
              </div>
            ) : (
              activeTabGroups.map((tabGroup) => (
                <div
                  key={tabGroup.id}
                  className="space-y-1"
                  draggable
                  onDragStart={(e) => handleTabGroupDragStart(e, tabGroup.id)}
                  onDragOver={handleTabGroupDragOver}
                  onDrop={(e) => handleTabGroupDrop(e, tabGroup.id)}
                >
                  <div className="flex items-center gap-1">
                    <button
                      className={`shrink-0 w-6 h-6 flex items-center justify-center rounded text-xs transition-colors ${
                        tabGroup.starred
                          ? 'text-amber-400 hover:text-amber-300'
                          : 'text-neutral-600 hover:text-neutral-400'
                      }`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleStarTabGroup(tabGroup.id);
                      }}
                      title={tabGroup.starred ? 'Unstar' : 'Star'}
                    >
                      {tabGroup.starred ? '★' : '☆'}
                    </button>
                    <button
                      className={`flex-1 text-left px-2 py-2 rounded-lg transition-colors ${
                        activeTabGroupId === tabGroup.id
                          ? 'bg-primary-500/20 text-primary-300'
                          : 'text-neutral-300 hover:bg-neutral-800'
                      }`}
                      onClick={() => onSelectTabGroup(tabGroup.id)}
                      onContextMenu={(e) =>
                        handleGroupContextMenu(e, tabGroup.id)
                      }
                    >
                      <div className="text-sm font-medium truncate">
                        {tabGroup.label}
                      </div>
                      <div className="text-xs text-neutral-500 mt-0.5">
                        {tabGroup.tabs.length} tab
                        {tabGroup.tabs.length !== 1 ? 's' : ''}
                        {tabGroup.pairs.length > 0
                          ? ` • ${tabGroup.pairs.length} pair${tabGroup.pairs.length !== 1 ? 's' : ''}`
                          : ''}
                      </div>
                    </button>
                  </div>

                  {activeTabGroupId === tabGroup.id && (
                    <div className="ml-2 pl-2 border-l border-neutral-800 space-y-0.5">
                      {tabGroup.tabs.map((tab) => {
                        const isActiveTab = activeItems[tabGroup.id] === tab.id;
                        return (
                          <button
                            key={tab.id}
                            className={`w-full text-left px-2 py-1.5 rounded text-xs transition-colors ${
                              isActiveTab
                                ? 'bg-primary-500/20 text-primary-300'
                                : 'text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200'
                            }`}
                            onClick={(e) => {
                              e.stopPropagation();
                              onSelectTab(tabGroup.id, tab.id);
                            }}
                            onContextMenu={(e) =>
                              handleTabItemContextMenu(e, tabGroup.id, tab.id)
                            }
                            title={tab.title}
                          >
                            <span className="truncate block">{tab.title}</span>
                          </button>
                        );
                      })}

                      {tabGroup.pairs.map((pair) => {
                        const isActivePair =
                          activeItems[tabGroup.id] === pair.id;
                        const pairTitle = pair.tabIds
                          .map(
                            (tabId) =>
                              tabGroup.tabs.find((t) => t.id === tabId)
                                ?.title || 'Unknown',
                          )
                          .join(' | ');

                        return (
                          <button
                            key={pair.id}
                            className={`w-full text-left px-2 py-1.5 rounded text-xs transition-colors ${
                              isActivePair
                                ? 'bg-primary-500/20 text-primary-300'
                                : 'text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200'
                            }`}
                            onClick={(e) => {
                              e.stopPropagation();
                              onSelectPair(tabGroup.id, pair.id);
                            }}
                            onContextMenu={(e) =>
                              handleTabItemContextMenu(e, tabGroup.id, pair.id)
                            }
                            title={pairTitle ? `Pair: ${pairTitle}` : 'Pair'}
                          >
                            <span className="truncate block">
                              ⊞ {pairTitle || 'Pair'}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              ))
            )}
            </div>
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {orderedSpaces.map((space: Space) => (
            <div
              key={space.id}
              draggable={!space.isSystem}
              onDragStart={(e) => handleSpaceDragStart(e, space.id)}
              onDragOver={handleSpaceDragOver}
              onDrop={(e) => handleSpaceDrop(e, space.id)}
              className={`group flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer transition-colors ${
                viewedSpaceId === space.id
                  ? 'bg-primary-500/20 text-primary-400'
                  : 'text-neutral-300 hover:bg-neutral-800'
              }`}
              onClick={() => handleSelectSpace(space.id)}
              onContextMenu={(e) => handleContextMenu(e, space.id)}
            >
              <span className="text-sm">
                {SPACE_ICONS[space.icon] || SPACE_ICONS.default}
              </span>
              {editingId === space.id ? (
                <Input
                  size="sm"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleRenameSubmit(space.id);
                    if (e.key === 'Escape') setEditingId(null);
                  }}
                  onBlur={() => handleRenameSubmit(space.id)}
                  autoFocus
                  classNames={{
                    input: 'text-sm',
                    inputWrapper: 'h-6 min-h-6 bg-neutral-800',
                  }}
                />
              ) : (
                <span className="text-sm flex-1 truncate">{space.name}</span>
              )}
            </div>
          ))}
        </div>
      )}

      {view === 'spaces' && (
        <div className="p-2 border-t border-neutral-800">
          {adding ? (
            <div className="flex gap-1">
              <Input
                size="sm"
                placeholder="Space name..."
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleAddSubmit();
                  if (e.key === 'Escape') setAdding(false);
                }}
                autoFocus
                classNames={{
                  inputWrapper: 'h-8 min-h-8 bg-neutral-800',
                }}
              />
              <Button
                size="sm"
                color="primary"
                isIconOnly
                onPress={handleAddSubmit}
                className="min-w-8 h-8"
              >
                +
              </Button>
            </div>
          ) : (
            <Button
              size="sm"
              variant="flat"
              className="w-full"
              onPress={() => setAdding(true)}
            >
              + New Space
            </Button>
          )}
        </div>
      )}

      {tabItemContextMenu &&
        (() => {
          const tabGroup = workspace.tabGroups.find(
            (group) => group.id === tabItemContextMenu.tabGroupId,
          );
          if (!tabGroup) return null;

          return (
            <TabContextMenu
              position={tabItemContextMenu.position}
              tabId={tabItemContextMenu.tabId}
              tabGroup={tabGroup}
              activeItemId={activeItems[tabGroup.id] || ''}
              activeSpaceId={viewedSpace?.id || activeSpaceId}
              onClose={() => setTabItemContextMenu(null)}
              onCreatePair={(tabIds) => onCreatePair(tabGroup.id, tabIds)}
              onCloseTab={(tabId) => onCloseTab(tabGroup.id, tabId)}
              onSplitPair={(pairId) => onSplitPair(tabGroup.id, pairId)}
              onRenameTabGroup={(tabGroupId, newLabel) =>
                onRenameTabGroup(tabGroupId, newLabel)
              }
              onDeleteTabGroup={async (spaceId, tabGroupId) => {
                const result = await onDeleteTabGroup(spaceId, tabGroupId);
                if (result?.wasDeleted && result.nextTabGroupId) {
                  onSelectTabGroup(result.nextTabGroupId);
                }
              }}
              onRenameTab={(tabId, newTitle) =>
                onRenameTab(tabGroup.id, tabId, newTitle)
              }
            />
          );
        })()}

      {groupContextMenu &&
        (() => {
          const canDelete = activeTabGroups.length > 1;

          return (
            <div
              ref={groupContextMenuRef}
              className="fixed z-[100] bg-neutral-800 border border-neutral-700 rounded-md shadow-xl py-1 min-w-[200px]"
              style={{
                left: `${groupContextMenu.position.x}px`,
                top: `${groupContextMenu.position.y}px`,
              }}
            >
              <button
                className="w-full text-left px-4 py-2 text-sm text-neutral-200 hover:bg-neutral-700 transition-colors"
                onClick={handleRenameTabGroup}
              >
                Rename Craft
              </button>
              <div className="border-t border-neutral-700 my-1" />
              {canDelete ? (
                <button
                  className="w-full text-left px-4 py-2 text-sm text-red-400 hover:bg-neutral-700 transition-colors"
                  onClick={handleDeleteTabGroup}
                >
                  Delete Craft
                </button>
              ) : (
                <div className="px-4 py-2 text-sm text-neutral-500 italic">
                  Cannot delete last craft
                </div>
              )}
            </div>
          );
        })()}

      {/* Address bar toggle */}
      <div className="p-2 border-t border-neutral-800">
        <Button
          size="sm"
          variant={showAddressBar ? 'solid' : 'flat'}
          color={showAddressBar ? 'primary' : 'default'}
          className="w-full"
          onPress={onToggleAddressBar}
        >
          {showAddressBar ? 'Hide Address Bar' : 'Show Address Bar'}
        </Button>
      </div>

      {/* Context menu for space management */}
      {contextMenu &&
        (() => {
          const space = workspace.spaces.find(
            (s) => s.id === contextMenu.spaceId,
          );
          const isSystemSpace = space?.isSystem;
          const canDelete = workspace.spaces.length > 1 && !isSystemSpace;

          return (
            <div
              ref={contextMenuRef}
              className="fixed z-[100] bg-neutral-800 border border-neutral-700 rounded-md shadow-xl py-1 min-w-[200px]"
              style={{
                left: `${contextMenu.position.x}px`,
                top: `${contextMenu.position.y}px`,
              }}
            >
              {!isSystemSpace && (
                <button
                  className="w-full text-left px-4 py-2 text-sm text-neutral-200 hover:bg-neutral-700 transition-colors"
                  onClick={handleRenameFromContextMenu}
                >
                  Rename Space
                </button>
              )}
              {!isSystemSpace && workspace.spaces.length > 1 && (
                <div className="border-t border-neutral-700 my-1" />
              )}
              {canDelete ? (
                <button
                  className="w-full text-left px-4 py-2 text-sm text-red-400 hover:bg-neutral-700 transition-colors"
                  onClick={handleDeleteSpace}
                >
                  Delete Space
                </button>
              ) : isSystemSpace ? (
                <div className="px-4 py-2 text-sm text-neutral-500 italic">
                  System space cannot be modified
                </div>
              ) : (
                <div className="px-4 py-2 text-sm text-neutral-500 italic">
                  Cannot delete last space
                </div>
              )}
            </div>
          );
        })()}
    </div>
  );
}

function formatSessionTimestamp(value: string): string {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return 'Recently';

  const diffMs = Date.now() - timestamp;
  const diffMinutes = Math.max(0, Math.floor(diffMs / 60000));
  if (diffMinutes < 1) return 'Just now';
  if (diffMinutes < 60) return `${diffMinutes}m ago`;

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;

  return new Date(timestamp).toLocaleDateString();
}
