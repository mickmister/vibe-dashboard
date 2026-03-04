import React, { useState, useCallback } from 'react';
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
              onDoubleClick={() => {
                setEditingId(space.id);
                setEditName(space.name);
              }}
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
    </div>
  );
}
