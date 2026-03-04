import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Button, Tooltip, Input } from '@heroui/react';
import type { WorkspaceState, Space } from '../types';

interface SidebarProps {
  workspace: WorkspaceState;
  activeSpaceId: string;
  onSelectSpace: (spaceId: string) => void;
  onAddSpace: (name: string) => void;
  onDeleteSpace: (spaceId: string) => void;
  onRenameSpace: (spaceId: string, name: string) => void;
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
  onSelectSpace,
  onAddSpace,
  onDeleteSpace,
  onRenameSpace,
}: SidebarProps) {
  const [hovered, setHovered] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [contextMenu, setContextMenu] = useState<{
    spaceId: string;
    position: { x: number; y: number };
  } | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);

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

  // Close context menu when clicking outside
  useEffect(() => {
    if (!contextMenu) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) {
        setContextMenu(null);
      }
    };

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setContextMenu(null);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [contextMenu]);

  return (
    <div
      className="fixed left-0 top-0 h-full z-50 flex"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => {
        setHovered(false);
        setAdding(false);
        setEditingId(null);
      }}
    >
      {/* Hover trigger zone */}
      <div className="w-2 h-full" />

      {/* Sidebar panel */}
      <div
        className={`h-full bg-neutral-900/95 backdrop-blur-md border-r border-neutral-800 flex flex-col transition-all duration-200 ease-out overflow-hidden ${
          hovered ? 'w-56 opacity-100' : 'w-0 opacity-0'
        }`}
      >
        <div className="p-3 border-b border-neutral-800">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-neutral-400">
            Spaces
          </h2>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {workspace.spaces.map((space: Space) => (
            <div
              key={space.id}
              className={`group flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer transition-colors ${
                activeSpaceId === space.id
                  ? 'bg-primary-500/20 text-primary-400'
                  : 'text-neutral-300 hover:bg-neutral-800'
              }`}
              onClick={() => onSelectSpace(space.id)}
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
      </div>

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
