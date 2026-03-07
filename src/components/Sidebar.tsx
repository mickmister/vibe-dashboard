import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { Button, Input } from '@heroui/react';
import type { WorkspaceState, Space, TabGroup } from '../types';

interface SidebarProps {
  workspace: WorkspaceState;
  activeSpaceId: string;
  activeTabGroupId: string;
  onRequestClose?: () => void;
  onSelectSpace: (spaceId: string) => void;
  onSelectTabGroup: (tabGroupId: string) => void;
  onAddSpace: (name: string) => void;
  onDeleteSpace: (spaceId: string) => void;
  onRenameSpace: (spaceId: string, name: string) => void;
  onDeleteTabGroup: (spaceId: string, tabGroupId: string) => Promise<{ wasDeleted: boolean; nextTabGroupId?: string } | undefined>;
  onRenameTabGroup: (tabGroupId: string, label: string) => void;
  onAddTabGroup: (label: string) => Promise<void> | void;
  onAddTab: (tabGroupId: string, title: string, url: string) => Promise<void> | void;
  onCreatePair: (tabGroupId: string, tabIds: string[]) => Promise<void> | void;
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
  onRequestClose,
  onSelectSpace,
  onSelectTabGroup,
  onAddSpace,
  onDeleteSpace,
  onRenameSpace,
  onDeleteTabGroup,
  onRenameTabGroup,
  onAddTabGroup,
  onAddTab,
  onCreatePair,
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
  const [mobileAction, setMobileAction] = useState<'group' | 'tab' | 'pair' | null>(null);
  const [newGroupLabel, setNewGroupLabel] = useState('');
  const [newTabTitle, setNewTabTitle] = useState('');
  const [newTabUrl, setNewTabUrl] = useState('');
  const [pairSelection, setPairSelection] = useState<string[]>([]);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const groupContextMenuRef = useRef<HTMLDivElement>(null);
  const activeSpace = workspace.spaces.find((space) => space.id === activeSpaceId);
  const activeTabGroups = useMemo(() => {
    if (!activeSpace) return [];
    return activeSpace.tabGroupIds
      .map((id) => workspace.tabGroups.find((tabGroup) => tabGroup.id === id))
      .filter((tabGroup): tabGroup is TabGroup => tabGroup != null);
  }, [activeSpace, workspace.tabGroups]);
  const activeTabGroup = activeTabGroups.find((tabGroup) => tabGroup.id === activeTabGroupId);
  const availablePairTabs = useMemo(() => {
    if (!activeTabGroup) return [];
    const tabsInPairs = new Set(activeTabGroup.pairs.flatMap((pair) => pair.tabIds));
    return activeTabGroup.tabs.filter((tab) => !tabsInPairs.has(tab.id));
  }, [activeTabGroup]);

  const handleAddSubmit = useCallback(() => {
    const name = newName.trim();
    if (name) {
      onAddSpace(name);
      setNewName('');
      setAdding(false);
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
    [editName, onRenameSpace]
  );

  const handleContextMenu = useCallback((e: React.MouseEvent, spaceId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({
      spaceId,
      position: { x: e.clientX, y: e.clientY },
    });
  }, []);

  const handleGroupContextMenu = useCallback((e: React.MouseEvent, tabGroupId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setGroupContextMenu({
      tabGroupId,
      position: { x: e.clientX, y: e.clientY },
    });
  }, []);

  const handleDeleteSpace = useCallback(() => {
    if (!contextMenu) return;

    if (confirm(`Delete this space? All tab groups and tabs will be closed.`)) {
      onDeleteSpace(contextMenu.spaceId);
    }
    setContextMenu(null);
  }, [contextMenu, onDeleteSpace]);

  const handleRenameFromContextMenu = useCallback(() => {
    if (!contextMenu) return;

    const space = workspace.spaces.find(s => s.id === contextMenu.spaceId);
    if (space) {
      setEditingId(contextMenu.spaceId);
      setEditName(space.name);
    }
    setContextMenu(null);
  }, [contextMenu, workspace.spaces]);

  const handleRenameTabGroup = useCallback(() => {
    if (!groupContextMenu) return;

    const tabGroup = activeTabGroups.find((group) => group.id === groupContextMenu.tabGroupId);
    if (!tabGroup) {
      setGroupContextMenu(null);
      return;
    }

    const newLabel = prompt('Rename tab group:', tabGroup.label);
    if (newLabel && newLabel.trim() && newLabel.trim() !== tabGroup.label) {
      onRenameTabGroup(tabGroup.id, newLabel.trim());
    }
    setGroupContextMenu(null);
  }, [activeTabGroups, groupContextMenu, onRenameTabGroup]);

  const handleDeleteTabGroup = useCallback(async () => {
    if (!groupContextMenu) return;

    const tabGroup = activeTabGroups.find((group) => group.id === groupContextMenu.tabGroupId);
    if (!tabGroup) {
      setGroupContextMenu(null);
      return;
    }

    const confirmed = confirm(`Delete tab group "${tabGroup.label}"? All tabs in this group will be closed.`);
    if (!confirmed) {
      setGroupContextMenu(null);
      return;
    }

    const result = await onDeleteTabGroup(activeSpaceId, tabGroup.id);
    if (result?.wasDeleted && result.nextTabGroupId) {
      onSelectTabGroup(result.nextTabGroupId);
    }
    setGroupContextMenu(null);
  }, [activeSpaceId, activeTabGroups, groupContextMenu, onDeleteTabGroup, onSelectTabGroup]);

  const handleSelectSpace = useCallback((spaceId: string) => {
    onSelectSpace(spaceId);
    setView('groups');
  }, [onSelectSpace]);

  const handleCreateGroup = useCallback(async () => {
    const label = newGroupLabel.trim();
    if (!label) return;
    await onAddTabGroup(label);
    setNewGroupLabel('');
    setMobileAction(null);
  }, [newGroupLabel, onAddTabGroup]);

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

  useEffect(() => {
    setAdding(false);
    setEditingId(null);
    setContextMenu(null);
    setGroupContextMenu(null);
    setMobileAction(null);
  }, [view]);

  useEffect(() => {
    setMobileAction(null);
    setPairSelection([]);
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
                className="h-8 w-8 rounded-md text-neutral-300 hover:bg-neutral-800 hover:text-white transition-colors"
                title="Show spaces"
                onClick={() => setView('spaces')}
              >
                ←
              </button>
              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
                  Current Space
                </p>
                <h2 className="text-sm font-semibold text-neutral-100 truncate">
                  {activeSpace?.name || 'Unknown Space'}
                </h2>
              </div>
            </div>
            <button
              className="md:hidden h-8 w-8 rounded-md text-neutral-300 hover:bg-neutral-800 hover:text-white transition-colors"
              title="Close sidebar"
              onClick={onRequestClose}
            >
              ✕
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <button
                className="h-8 w-8 rounded-md text-neutral-300 hover:bg-neutral-800 hover:text-white transition-colors"
                title="Back to groups"
                onClick={() => setView('groups')}
              >
                ←
              </button>
              <h2 className="text-xs font-semibold uppercase tracking-wider text-neutral-400">
                Spaces
              </h2>
            </div>
            <button
              className="md:hidden h-8 w-8 rounded-md text-neutral-300 hover:bg-neutral-800 hover:text-white transition-colors"
              title="Close sidebar"
              onClick={onRequestClose}
            >
              ✕
            </button>
          </div>
        )}
      </div>

      {view === 'groups' ? (
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {activeTabGroups.length === 0 ? (
            <div className="px-3 py-4 text-sm text-neutral-500">
              No tab groups in this space.
            </div>
          ) : (
            activeTabGroups.map((tabGroup) => (
              <button
                key={tabGroup.id}
                className={`w-full text-left px-3 py-2 rounded-lg transition-colors ${
                  activeTabGroupId === tabGroup.id
                    ? 'bg-primary-500/20 text-primary-300'
                    : 'text-neutral-300 hover:bg-neutral-800'
                }`}
                onClick={() => onSelectTabGroup(tabGroup.id)}
                onContextMenu={(e) => handleGroupContextMenu(e, tabGroup.id)}
              >
                <div className="text-sm font-medium truncate">
                  {tabGroup.label}
                </div>
                <div className="text-xs text-neutral-500 mt-0.5">
                  {tabGroup.tabs.length} tab{tabGroup.tabs.length !== 1 ? 's' : ''}
                  {tabGroup.pairs.length > 0
                    ? ` • ${tabGroup.pairs.length} pair${tabGroup.pairs.length !== 1 ? 's' : ''}`
                    : ''}
                </div>
              </button>
            ))
          )}
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {workspace.spaces.map((space: Space) => (
            <div
              key={space.id}
              className={`group flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer transition-colors ${
                activeSpaceId === space.id
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

      {view === 'groups' && (
        <div className="md:hidden p-2 border-t border-neutral-800 space-y-2">
          <div className="grid grid-cols-3 gap-1.5">
            <Button
              size="sm"
              variant={mobileAction === 'group' ? 'solid' : 'flat'}
              color={mobileAction === 'group' ? 'primary' : 'default'}
              onPress={() => setMobileAction((prev) => prev === 'group' ? null : 'group')}
            >
              + Group
            </Button>
            <Button
              size="sm"
              variant={mobileAction === 'tab' ? 'solid' : 'flat'}
              color={mobileAction === 'tab' ? 'primary' : 'default'}
              onPress={() => {
                if (!activeTabGroup) return;
                setMobileAction((prev) => prev === 'tab' ? null : 'tab');
                setNewTabTitle((prev) => prev || 'New Tab');
                setNewTabUrl((prev) => prev || '/');
              }}
              isDisabled={!activeTabGroup}
            >
              + Tab
            </Button>
            <Button
              size="sm"
              variant={mobileAction === 'pair' ? 'solid' : 'flat'}
              color={mobileAction === 'pair' ? 'primary' : 'default'}
              onPress={() => {
                if (availablePairTabs.length < 2) return;
                setMobileAction((prev) => prev === 'pair' ? null : 'pair');
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
                placeholder="Group name..."
                classNames={{ inputWrapper: 'bg-neutral-800' }}
              />
              <Button size="sm" color="primary" className="w-full" onPress={handleCreateGroup}>
                Create Group
              </Button>
            </div>
          )}

          {mobileAction === 'tab' && (
            <div className="space-y-1.5">
              <Input
                size="sm"
                value={newTabTitle}
                onChange={(e) => setNewTabTitle(e.target.value)}
                placeholder="Tab title..."
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
                Create Tab
              </Button>
            </div>
          )}

          {mobileAction === 'pair' && (
            <div className="space-y-1.5">
              <p className="text-xs text-neutral-400">
                Pick 2 tabs to pair
              </p>
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
      )}

      {groupContextMenu && (() => {
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
              Rename Tab Group
            </button>
            <div className="border-t border-neutral-700 my-1" />
            {canDelete ? (
              <button
                className="w-full text-left px-4 py-2 text-sm text-red-400 hover:bg-neutral-700 transition-colors"
                onClick={handleDeleteTabGroup}
              >
                Delete Tab Group
              </button>
            ) : (
              <div className="px-4 py-2 text-sm text-neutral-500 italic">
                Cannot delete last tab group
              </div>
            )}
          </div>
        );
      })()}

      {/* Context menu for space management */}
      {contextMenu && (() => {
        const space = workspace.spaces.find((s) => s.id === contextMenu.spaceId);
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
            {!isSystemSpace && workspace.spaces.length > 1 && <div className="border-t border-neutral-700 my-1" />}
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
