import React, { forwardRef } from 'react';
import { IconChevronUp, IconMenu2, IconUfo } from '@tabler/icons-react';
import type { SavedWorkspaceSession, Space, TabGroup, VoyageEntry } from '../types';

export interface PendingOpenCraftDisplayTab {
  label: string;
  status: 'pending' | 'error';
  errorMessage?: string;
}

export interface WorkspaceShellVoyageItem {
  entry: VoyageEntry;
  space: Space;
  tabGroup: TabGroup;
}

export type ExpandedCraftItem =
  | { kind: 'tab'; id: string; label: string; isActive: boolean }
  | { kind: 'pair'; id: string; label: string; isActive: boolean };

export function PendingOpenCraftVoyageTab({
  tab,
  compact,
  active,
  onRetry,
  onClose,
}: {
  tab: PendingOpenCraftDisplayTab;
  compact: boolean;
  active?: boolean;
  onRetry: () => void;
  onClose: () => void;
}) {
  const isError = tab.status === 'error';
  const label = tab.label || 'craft';
  const baseBorderClass = compact
    ? 'border-r border-neutral-700'
    : 'border-r border-neutral-600 border-b-2';

  return (
    <div
      className={`shrink-0 inline-flex h-full max-w-[22rem] items-center gap-2 ${baseBorderClass} ${
        isError
          ? 'border-b-red-400 bg-red-950/40 text-red-100'
          : active
            ? 'border-b-amber-400 bg-neutral-800 text-neutral-100'
            : 'border-b-amber-400 bg-neutral-900 text-neutral-200'
      } px-3 text-xs`}
      role={isError ? 'alert' : 'status'}
      aria-live="polite"
      aria-label={isError ? `Failed opening ${label}` : `Opening ${label}`}
      title={isError ? tab.errorMessage || `Failed opening ${label}` : `Opening ${label}`}
    >
      {isError ? (
        <span aria-hidden="true" className="font-semibold text-red-300">
          !
        </span>
      ) : (
        <span
          aria-hidden="true"
          className="inline-block h-3 w-3 animate-spin rounded-full border border-neutral-500 border-t-amber-300"
        />
      )}
      <span className="min-w-0 truncate">
        {isError ? `Failed ${label}` : `Opening ${label}`}
      </span>
      {isError && (
        <span className="ml-1 inline-flex shrink-0 items-center gap-1">
          <button
            type="button"
            className="rounded border border-red-400/50 px-1.5 py-0.5 text-[10px] font-medium text-red-100 transition-colors hover:bg-red-500/20"
            onClick={onRetry}
          >
            Retry
          </button>
          <button
            type="button"
            className="rounded border border-neutral-600 px-1.5 py-0.5 text-[10px] font-medium text-neutral-200 transition-colors hover:bg-neutral-800"
            onClick={onClose}
            aria-label={`Close failed ${label} tab`}
          >
            ×
          </button>
        </span>
      )}
    </div>
  );
}

export function PendingOpenCraftContent({
  tab,
  onRetry,
  onClose,
}: {
  tab: PendingOpenCraftDisplayTab;
  onRetry: () => void;
  onClose: () => void;
}) {
  const isError = tab.status === 'error';
  const label = tab.label || 'craft';

  return (
    <div className="flex-1 bg-neutral-950">
      <div className="flex h-full items-center justify-center p-6 text-center">
        <div
          role={isError ? 'alert' : 'status'}
          aria-live="polite"
          className={`w-full max-w-md rounded-xl border p-6 shadow-2xl ${
            isError
              ? 'border-red-500/40 bg-red-950/20'
              : 'border-amber-400/30 bg-neutral-900'
          }`}
        >
          {isError ? (
            <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full border border-red-400/50 bg-red-500/10 text-lg font-semibold text-red-200">
              !
            </div>
          ) : (
            <div className="mx-auto h-10 w-10 animate-spin rounded-full border-2 border-neutral-700 border-t-amber-300" />
          )}
          <h2 className="mt-4 text-base font-semibold text-neutral-100">
            {isError ? `Could not open ${label}` : `Opening ${label}`}
          </h2>
          <p className="mt-2 text-sm text-neutral-400">
            {isError
              ? tab.errorMessage || 'Open Craft failed. Please retry or close this pending craft.'
              : 'Allocating the craft and preparing its workspace view…'}
          </p>
          {isError && (
            <div className="mt-5 flex justify-center gap-2">
              <button
                type="button"
                className="rounded-md border border-red-400/60 bg-red-500/10 px-3 py-2 text-sm font-medium text-red-100 transition-colors hover:bg-red-500/20"
                onClick={onRetry}
              >
                Retry
              </button>
              <button
                type="button"
                className="rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm font-medium text-neutral-200 transition-colors hover:bg-neutral-800"
                onClick={onClose}
              >
                Close
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function VoyageBarView({
  items,
  activeVoyageEntryId,
  isPendingOpenCraftActive,
  voyagePlusMenuOpen,
  pendingOpenCraftTab,
  onOpenSidebar,
  onToggleVoyageActions,
  onHide,
  onSelectItem,
  onContextMenuItem,
  onDragStartItem,
  onDragOver,
  onDropItem,
  onRetryPendingOpenCraft,
  onClosePendingOpenCraft,
  getEmoji,
}: {
  items: WorkspaceShellVoyageItem[];
  activeVoyageEntryId?: string;
  isPendingOpenCraftActive: boolean;
  voyagePlusMenuOpen: boolean;
  pendingOpenCraftTab?: PendingOpenCraftDisplayTab | null;
  onOpenSidebar: () => void;
  onToggleVoyageActions: (event: React.MouseEvent<HTMLButtonElement>) => void;
  onHide: () => void;
  onSelectItem: (item: WorkspaceShellVoyageItem) => void;
  onContextMenuItem: (event: React.MouseEvent<HTMLButtonElement>, item: WorkspaceShellVoyageItem) => void;
  onDragStartItem: (event: React.DragEvent<HTMLDivElement>, entryId: string) => void;
  onDragOver: (event: React.DragEvent) => void;
  onDropItem: (event: React.DragEvent<HTMLDivElement>, entryId: string) => void;
  onRetryPendingOpenCraft: () => void;
  onClosePendingOpenCraft: () => void;
  getEmoji: (tabGroup: TabGroup) => string;
}) {
  return (
    <div className="hidden md:flex h-9 border-b border-neutral-600 bg-neutral-900 items-stretch shrink-0 [&_button]:cursor-pointer">
      <button
        className="inline-flex h-full w-9 shrink-0 cursor-pointer items-center justify-center border-r border-b-2 border-neutral-600 bg-neutral-900 text-sm text-neutral-200 transition-colors hover:bg-neutral-800/80"
        onClick={onOpenSidebar}
        title="Open sidebar"
        aria-label="Open sidebar"
      >
        <IconMenu2 size={16} stroke={2} aria-hidden="true" />
      </button>
      <button
        className="inline-flex h-full w-9 shrink-0 cursor-pointer items-center justify-center border-r border-b-2 border-neutral-600 bg-neutral-900 text-sm text-neutral-200 transition-colors hover:bg-neutral-800/80"
        onClick={onToggleVoyageActions}
        data-voyage-plus-trigger="true"
        title="Voyage actions"
        aria-label="Voyage actions"
        aria-haspopup="menu"
        aria-expanded={voyagePlusMenuOpen}
      >
        <IconUfo size={16} stroke={2} aria-hidden="true" />
      </button>
      <div className="flex-1 min-w-0 overflow-x-auto scrollbar-hide">
        <div className="flex h-full items-stretch whitespace-nowrap">
          {items.map((item) => {
            const isActive =
              !isPendingOpenCraftActive && item.entry.id === activeVoyageEntryId;

            return (
              <div
                key={item.entry.id}
                draggable
                onDragStart={(event) => onDragStartItem(event, item.entry.id)}
                onDragOver={onDragOver}
                onDrop={(event) => onDropItem(event, item.entry.id)}
                className={`shrink-0 inline-flex h-full cursor-pointer select-none items-center border-r border-neutral-600 border-b-2 text-xs text-neutral-200 transition-colors ${
                  isActive
                    ? 'border-b-primary-400 bg-neutral-900'
                    : 'bg-neutral-900 hover:bg-neutral-800/80'
                }`}
                title={`${item.space.name} / ${item.tabGroup.label}`}
              >
                <button
                  className="inline-flex h-full cursor-pointer items-center gap-2 px-3 text-inherit"
                  onClick={() => onSelectItem(item)}
                  onContextMenu={(event) => onContextMenuItem(event, item)}
                  aria-label={`Open ${item.tabGroup.label} in ${item.space.name}`}
                  aria-haspopup="menu"
                >
                  <span aria-hidden="true">{getEmoji(item.tabGroup)}</span>
                  <span>{item.tabGroup.label}</span>
                </button>
              </div>
            );
          })}
          {pendingOpenCraftTab && (
            <PendingOpenCraftVoyageTab
              tab={pendingOpenCraftTab}
              compact={false}
              active
              onRetry={onRetryPendingOpenCraft}
              onClose={onClosePendingOpenCraft}
            />
          )}
        </div>
      </div>
      <button
        className="inline-flex h-full w-9 shrink-0 cursor-pointer items-center justify-center border-l border-b-2 border-neutral-600 bg-neutral-900 text-neutral-300 transition-colors hover:bg-neutral-800/80"
        onClick={onHide}
        title="Hide voyage bar"
        aria-label="Hide voyage bar"
      >
        <IconChevronUp size={16} stroke={2} aria-hidden="true" />
      </button>
    </div>
  );
}

export function ExpandedCraftStrip({
  items,
  mobile = false,
  onSelect,
}: {
  items: ExpandedCraftItem[];
  mobile?: boolean;
  onSelect: (item: ExpandedCraftItem) => void;
}) {
  if (mobile) {
    return (
      <div
        className="md:hidden fixed inset-x-0 z-[64] border-y border-neutral-700 bg-neutral-900/95"
        style={{
          bottom: 'var(--mobile-footer-height)',
          maxHeight: 'min(50vh, calc(100dvh - 8rem - env(safe-area-inset-bottom)))',
        }}
      >
        <div className="max-h-full overflow-y-auto flex flex-col gap-px bg-neutral-700 px-2 py-2">
          {items.map((item) => (
            <button
              key={item.id}
              className={`min-w-0 rounded-sm px-3 py-2 text-left text-xs transition-colors ${
                item.isActive
                  ? 'bg-neutral-700 text-neutral-100'
                  : 'bg-neutral-900 text-neutral-300'
              }`}
              onClick={() => onSelect(item)}
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
    );
  }

  return (
    <div className="hidden md:flex h-9 border-b border-neutral-600 bg-neutral-900 items-stretch shrink-0 [&_button]:cursor-pointer">
      <div className="flex-1 min-w-0 overflow-x-auto scrollbar-hide">
        <div className="flex h-full items-stretch whitespace-nowrap">
          {items.map((item) => (
            <button
              key={item.id}
              className={`shrink-0 inline-flex h-full cursor-pointer items-center border-r border-b-2 border-neutral-600 px-3 text-xs text-neutral-200 transition-colors ${
                item.isActive
                  ? 'border-b-primary-400 bg-neutral-900'
                  : 'bg-neutral-900 hover:bg-neutral-800/80'
              }`}
              onClick={() => onSelect(item)}
              title={item.label}
            >
              <span className="max-w-[24rem] truncate">{item.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export function MobileCraftStrip({
  items,
  activeVoyageEntryId,
  activeTabGroupLabel,
  isPendingOpenCraftActive,
  voyagePlusMenuOpen,
  pendingOpenCraftTab,
  onOpenSidebar,
  onToggleVoyageActions,
  onSelectItem,
  onOpenItemMenu,
  onPointerDownItem,
  onPointerMove,
  onClearLongPress,
  onRetryPendingOpenCraft,
  onClosePendingOpenCraft,
  getLabel,
  getEmoji,
}: {
  items: WorkspaceShellVoyageItem[];
  activeVoyageEntryId?: string;
  activeTabGroupLabel?: string;
  isPendingOpenCraftActive: boolean;
  voyagePlusMenuOpen: boolean;
  pendingOpenCraftTab?: PendingOpenCraftDisplayTab | null;
  onOpenSidebar: () => void;
  onToggleVoyageActions: (event: React.MouseEvent<HTMLButtonElement>) => void;
  onSelectItem: (item: WorkspaceShellVoyageItem) => void;
  onOpenItemMenu: (item: WorkspaceShellVoyageItem) => void;
  onPointerDownItem: (event: React.PointerEvent<HTMLButtonElement>, item: WorkspaceShellVoyageItem) => void;
  onPointerMove: (event: React.PointerEvent<HTMLButtonElement>) => void;
  onClearLongPress: () => void;
  onRetryPendingOpenCraft: () => void;
  onClosePendingOpenCraft: () => void;
  getLabel: (tabGroup: TabGroup) => string;
  getEmoji: (tabGroup: TabGroup) => string;
}) {
  return (
    <div
      className="md:hidden fixed inset-x-0 bottom-0 z-[65] border-t border-neutral-700 bg-neutral-900 flex items-stretch shrink-0"
      style={{ height: 'var(--mobile-footer-height)', paddingBottom: 'env(safe-area-inset-bottom)', boxSizing: 'border-box' }}
    >
      <button
        className="h-full px-3 text-neutral-200 hover:bg-neutral-800 transition-colors flex items-center justify-center shrink-0 border-r border-neutral-700"
        onClick={onOpenSidebar}
        title="Open sidebar"
        aria-label="Open sidebar"
      >
        ☰
      </button>
      <button
        className="h-full px-3 text-neutral-200 hover:bg-neutral-800 transition-colors flex items-center justify-center shrink-0 border-r border-neutral-700"
        onClick={onToggleVoyageActions}
        data-voyage-plus-trigger="true"
        title="Voyage actions"
        aria-label="Voyage actions"
        aria-haspopup="menu"
        aria-expanded={voyagePlusMenuOpen}
      >
        <IconUfo size={18} stroke={2} aria-hidden="true" />
      </button>
      <div className="flex-1 min-w-0 overflow-x-auto scrollbar-hide">
        <div className="flex h-full items-stretch whitespace-nowrap">
          {items.length > 0 ? (
            <>
              {items.map((item) => {
                const isActive =
                  !isPendingOpenCraftActive && item.entry.id === activeVoyageEntryId;

                return (
                  <button
                    key={item.entry.id}
                    className={`shrink-0 inline-flex h-full select-none items-center gap-2 border-r border-neutral-700 px-3 text-xs text-neutral-200 transition-colors ${
                      isActive
                        ? 'bg-neutral-800'
                        : 'bg-neutral-900 hover:bg-neutral-800/80'
                    }`}
                    style={{ touchAction: 'manipulation' }}
                    onClick={() => onSelectItem(item)}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      onOpenItemMenu(item);
                    }}
                    onPointerDown={(event) => onPointerDownItem(event, item)}
                    onPointerMove={onPointerMove}
                    onPointerUp={onClearLongPress}
                    onPointerCancel={onClearLongPress}
                    onPointerLeave={onClearLongPress}
                    title={`${item.space.name} / ${item.tabGroup.label}`}
                    aria-label={`Open ${item.tabGroup.label} in ${item.space.name}`}
                    aria-haspopup="dialog"
                  >
                    <span aria-hidden="true">{getEmoji(item.tabGroup)}</span>
                    <span>{getLabel(item.tabGroup)}</span>
                  </button>
                );
              })}
              {pendingOpenCraftTab && (
                <PendingOpenCraftVoyageTab
                  tab={pendingOpenCraftTab}
                  compact
                  active
                  onRetry={onRetryPendingOpenCraft}
                  onClose={onClosePendingOpenCraft}
                />
              )}
            </>
          ) : (
            <>
              <div className="h-full inline-flex items-center px-3 text-xs text-neutral-500 border-r border-neutral-700">
                {activeTabGroupLabel || 'No craft'}
              </div>
              {pendingOpenCraftTab && (
                <PendingOpenCraftVoyageTab
                  tab={pendingOpenCraftTab}
                  compact
                  active
                  onRetry={onRetryPendingOpenCraft}
                  onClose={onClosePendingOpenCraft}
                />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export const VoyageActionsMenu = forwardRef<HTMLDivElement, {
  position?: { left: number; top: number } | null;
  onNewCraft: () => void;
  onOpenCraft: () => void;
  onSwitchVoyage: () => void;
}>(function VoyageActionsMenu({ position, onNewCraft, onOpenCraft, onSwitchVoyage }, ref) {
  return (
    <div
      ref={ref}
      role="menu"
      aria-label="Voyage actions"
      className="fixed z-[92] w-44 rounded-lg border border-neutral-700 bg-neutral-900 py-1 shadow-2xl"
      style={{
        left: position?.left ?? 12,
        top: position?.top ?? 44,
      }}
    >
      <button
        role="menuitem"
        className="block w-full px-4 py-2 text-left text-sm text-neutral-200 transition-colors hover:bg-neutral-800"
        onClick={onNewCraft}
      >
        New Craft
      </button>
      <button
        role="menuitem"
        className="block w-full px-4 py-2 text-left text-sm text-neutral-200 transition-colors hover:bg-neutral-800"
        onClick={onOpenCraft}
      >
        Open Craft
      </button>
      <button
        role="menuitem"
        className="block w-full px-4 py-2 text-left text-sm text-neutral-200 transition-colors hover:bg-neutral-800"
        onClick={onSwitchVoyage}
      >
        Switch Voyage
      </button>
    </div>
  );
});

export function NewVoyagePromptDialog({
  name,
  isNameInvalid,
  onNameChange,
  onCancel,
  onCreateNewCraft,
  onOpenExistingCraft,
  onBackdropClick,
}: {
  name: string;
  isNameInvalid: boolean;
  onNameChange: (name: string) => void;
  onCancel: () => void;
  onCreateNewCraft: () => void;
  onOpenExistingCraft: () => void;
  onBackdropClick: (event: React.MouseEvent<HTMLDivElement>) => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[94] flex items-center justify-center bg-black/60 p-4"
      onClick={onBackdropClick}
    >
      <div className="w-full max-w-md rounded-xl border border-neutral-700 bg-neutral-900 p-5 shadow-2xl">
        <div className="text-base font-semibold text-neutral-100">New Voyage</div>
        <p className="mt-2 text-sm text-neutral-400">
          Name this voyage, then choose how you want to start it.
        </p>

        <label className="mt-4 block text-xs font-semibold uppercase tracking-wide text-neutral-500">
          Voyage name
        </label>
        <input
          value={name}
          onChange={(event) => onNameChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              onCancel();
            }
          }}
          placeholder="Required voyage name"
          autoFocus
          className="mt-2 w-full rounded-md border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-neutral-100 outline-none placeholder:text-neutral-500"
        />

        <div className="mt-5 grid gap-2 sm:grid-cols-2">
          <button
            className="rounded-md border border-blue-400/70 bg-blue-500/20 px-3 py-2 text-sm text-neutral-50 transition-colors hover:bg-blue-500/30 disabled:cursor-not-allowed disabled:border-neutral-700 disabled:bg-neutral-800 disabled:text-neutral-500"
            disabled={isNameInvalid}
            onClick={onCreateNewCraft}
          >
            Create New Craft
          </button>
          <button
            className="rounded-md border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-neutral-200 transition-colors hover:bg-neutral-700 disabled:cursor-not-allowed disabled:text-neutral-500 disabled:hover:bg-neutral-800"
            disabled={isNameInvalid}
            onClick={onOpenExistingCraft}
          >
            Open Existing Craft
          </button>
        </div>

        <div className="mt-5 flex justify-end">
          <button
            className="rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-300 transition-colors hover:bg-neutral-800"
            onClick={onCancel}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

export function VoyageSwitcherDialog({
  sessions,
  currentSessionId,
  renamingSessionId,
  renameDraft,
  onRenameDraftChange,
  onSelect,
  onGoHome,
  onStartRename,
  onCancelRename,
  onSubmitRename,
  onNewVoyage,
  onCancel,
  onBackdropClick,
  getVoyageDisplayName,
  isRenameInvalid,
}: {
  sessions: SavedWorkspaceSession[];
  currentSessionId: string;
  renamingSessionId: string | null;
  renameDraft: string;
  onRenameDraftChange: (value: string) => void;
  onSelect: (sessionId: string) => void;
  onGoHome: () => void;
  onStartRename: (session: SavedWorkspaceSession) => void;
  onCancelRename: () => void;
  onSubmitRename: (sessionId: string) => void;
  onNewVoyage: () => void;
  onCancel: () => void;
  onBackdropClick: (event: React.MouseEvent<HTMLDivElement>) => void;
  getVoyageDisplayName: (session: SavedWorkspaceSession) => string;
  isRenameInvalid: (draft: string) => boolean;
}) {
  return (
    <div
      className="fixed inset-0 z-[94] flex items-center justify-center bg-black/60 p-4"
      onClick={onBackdropClick}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Switch Voyage"
        className="flex max-h-[85dvh] w-full max-w-lg flex-col rounded-xl border border-neutral-700 bg-neutral-900 p-5 shadow-2xl"
      >
        <div className="text-base font-semibold text-neutral-100">Switch Voyage</div>
        <p className="mt-2 text-sm text-neutral-400">
          Choose a voyage, sorted by recent activity, or open Home in the current voyage.
        </p>

        <div className="mt-4 flex justify-start">
          <button
            className="rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm font-medium text-neutral-200 transition-colors hover:bg-neutral-800"
            onClick={onGoHome}
          >
            Go Home
          </button>
        </div>

        <div className="mt-3 min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
          {sessions.length > 0 ? (
            sessions.map((savedSession) => {
              const isCurrent = savedSession.id === currentSessionId;
              const isRenaming = renamingSessionId === savedSession.id;
              const renameIsInvalid = isRenameInvalid(renameDraft);
              return (
                <div
                  key={savedSession.id}
                  className={`w-full rounded-md border px-3 py-2 text-sm transition-colors ${
                    isCurrent
                      ? 'border-blue-400/70 bg-blue-500/20 text-neutral-50'
                      : 'border-neutral-700 bg-neutral-800 text-neutral-200'
                  }`}
                >
                  {isRenaming ? (
                    <form
                      className="space-y-2"
                      onSubmit={(event) => {
                        event.preventDefault();
                        onSubmitRename(savedSession.id);
                      }}
                    >
                      <label className="block text-xs font-semibold uppercase tracking-wide text-neutral-500">
                        Voyage name
                      </label>
                      <input
                        value={renameDraft}
                        onChange={(event) => onRenameDraftChange(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Escape') {
                            event.preventDefault();
                            onCancelRename();
                          }
                        }}
                        autoFocus
                        className="w-full rounded-md border border-neutral-600 bg-neutral-950 px-2 py-1.5 text-sm text-neutral-100 outline-none focus:border-blue-400"
                      />
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          className="rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs text-neutral-300 transition-colors hover:bg-neutral-800"
                          onClick={onCancelRename}
                        >
                          Cancel
                        </button>
                        <button
                          type="submit"
                          disabled={renameIsInvalid}
                          className="rounded-md border border-blue-400/70 bg-blue-500/20 px-2 py-1 text-xs text-neutral-50 transition-colors hover:bg-blue-500/30 disabled:cursor-not-allowed disabled:border-neutral-700 disabled:bg-neutral-800 disabled:text-neutral-500"
                        >
                          Save
                        </button>
                      </div>
                    </form>
                  ) : (
                    <div className="flex items-start justify-between gap-3">
                      <button
                        className="min-w-0 flex-1 rounded-sm text-left transition-colors hover:text-white"
                        onClick={() => onSelect(savedSession.id)}
                      >
                        <span className="block truncate font-medium">
                          {getVoyageDisplayName(savedSession)}
                        </span>
                        <span className="mt-1 block text-xs text-neutral-500">
                          Updated {new Date(savedSession.updatedAt).toLocaleString()}
                        </span>
                      </button>
                      <div className="flex shrink-0 items-center gap-2">
                        {isCurrent && (
                          <span className="text-xs text-blue-100">Current</span>
                        )}
                        <button
                          className="rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs text-neutral-300 transition-colors hover:bg-neutral-800"
                          onClick={() => onStartRename(savedSession)}
                        >
                          Rename
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          ) : (
            <div className="rounded-md border border-neutral-800 bg-neutral-950/40 px-3 py-4 text-sm text-neutral-500">
              No saved voyages yet.
            </div>
          )}
        </div>

        <div className="mt-5 flex justify-between gap-3">
          <button
            className="rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm font-medium text-neutral-200 transition-colors hover:bg-neutral-800"
            onClick={onNewVoyage}
          >
            New Voyage
          </button>
          <button
            className="rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-300 transition-colors hover:bg-neutral-800"
            onClick={onCancel}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

export function DuplicateCraftPromptDialog({
  craftLabel,
  currentEntries,
  activeVoyageEntryId,
  otherVoyages,
  onSwitchCurrent,
  onSwitchOtherVoyage,
  onOpenInNewVoyage,
  onCancel,
}: {
  craftLabel: string;
  currentEntries: VoyageEntry[];
  activeVoyageEntryId?: string;
  otherVoyages: Array<{ session: SavedWorkspaceSession; entryId?: string }>;
  onSwitchCurrent: (entryId: string) => void;
  onSwitchOtherVoyage: (sessionId: string, entryId?: string) => void;
  onOpenInNewVoyage: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-lg rounded-xl border border-neutral-700 bg-neutral-900 p-5 shadow-2xl">
        <div className="text-base font-semibold text-neutral-100">
          {craftLabel} is already embarked
        </div>
        <p className="mt-2 text-sm text-neutral-400">
          This craft is already in a Voyage. Switch to the existing embarked craft or open it in a new Voyage.
        </p>

        {currentEntries.length > 0 && (
          <div className="mt-4 space-y-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
              This voyage
            </div>
            {currentEntries.map((entry, index) => (
              <button
                key={entry.id}
                className="block w-full rounded-md border border-neutral-700 bg-neutral-800 px-3 py-2 text-left text-sm text-neutral-200 transition-colors hover:bg-neutral-700"
                onClick={() => onSwitchCurrent(entry.id)}
              >
                Switch to embarked craft {index + 1}
                {entry.id === activeVoyageEntryId ? ' (active)' : ''}
              </button>
            ))}
          </div>
        )}

        {otherVoyages.length > 0 && (
          <div className="mt-4 space-y-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
              Other voyages
            </div>
            {otherVoyages.map(({ session: savedSession, entryId }) => (
              <button
                key={`${savedSession.id}-${entryId || 'legacy'}`}
                className="block w-full rounded-md border border-neutral-700 bg-neutral-800 px-3 py-2 text-left text-sm text-neutral-200 transition-colors hover:bg-neutral-700"
                onClick={() => onSwitchOtherVoyage(savedSession.id, entryId)}
              >
                Switch to {savedSession.name || savedSession.slug || 'untitled voyage'}
              </button>
            ))}
          </div>
        )}

        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            className="rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-300 transition-colors hover:bg-neutral-800"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            className="rounded-md border border-blue-400/70 bg-blue-500/20 px-3 py-2 text-sm text-neutral-50 transition-colors hover:bg-blue-500/30"
            onClick={onOpenInNewVoyage}
          >
            Open in new Voyage
          </button>
        </div>
      </div>
    </div>
  );
}

export function MobileCraftMenu({
  tabGroup,
  draftLabel,
  draftEmoji,
  emojiChoices,
  canMoveToAnotherVoyage,
  closeWarning,
  onDraftLabelChange,
  onDraftEmojiChange,
  onChooseEmoji,
  onCancel,
  onSave,
  onMoveToVoyage,
  onRemoveFromVoyage,
  onCloseCraft,
  onCloseOverlay,
}: {
  tabGroup: TabGroup;
  draftLabel: string;
  draftEmoji: string;
  emojiChoices: string[];
  canMoveToAnotherVoyage: boolean;
  closeWarning: string;
  onDraftLabelChange: (value: string) => void;
  onDraftEmojiChange: (value: string) => void;
  onChooseEmoji: (emoji: string) => void;
  onCancel: () => void;
  onSave: () => void;
  onMoveToVoyage: () => void;
  onRemoveFromVoyage: () => void;
  onCloseCraft: () => void;
  onCloseOverlay: () => void;
}) {
  return (
    <div className="md:hidden fixed inset-0 z-[90] bg-black/60 flex items-end">
      <button
        className="absolute inset-0"
        aria-label="Close mobile tab menu"
        onClick={onCloseOverlay}
      />
      <div className="relative w-full rounded-t-2xl border-t border-neutral-700 bg-neutral-900 p-4 space-y-4">
        <div>
          <div className="text-sm font-semibold text-neutral-100">Edit Mobile Craft</div>
          <div className="text-xs text-neutral-500 mt-1">
            Long press opens this menu. Tap still switches craft. Closing here closes the whole craft.
          </div>
        </div>

        <div className="space-y-3">
          <label className="block">
            <span className="text-xs text-neutral-400">Mobile name</span>
            <input
              type="text"
              value={draftLabel}
              onChange={(event) => onDraftLabelChange(event.target.value)}
              placeholder={tabGroup.label}
              className="mt-1 w-full rounded-md border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-400"
            />
          </label>

          <label className="block">
            <span className="text-xs text-neutral-400">Emoji</span>
            <input
              type="text"
              value={draftEmoji}
              onChange={(event) => onDraftEmojiChange(event.target.value)}
              placeholder={draftEmoji}
              className="mt-1 w-full rounded-md border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-400"
            />
            <div className="mt-2 flex flex-wrap gap-2">
              {emojiChoices.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  className={`rounded-md border px-2 py-1 text-base ${
                    draftEmoji === emoji
                      ? 'border-blue-400 bg-blue-500/25'
                      : 'border-neutral-700 bg-neutral-800'
                  }`}
                  onClick={() => onChooseEmoji(emoji)}
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
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            className="rounded-md border border-blue-400/70 bg-blue-500/20 px-3 py-2 text-sm text-neutral-50"
            onClick={onSave}
          >
            Save
          </button>
          <button
            className="rounded-md border border-amber-500/40 bg-amber-500/15 px-3 py-2 text-sm text-amber-300 disabled:cursor-not-allowed disabled:border-neutral-700 disabled:bg-neutral-800 disabled:text-neutral-500"
            disabled={!canMoveToAnotherVoyage}
            title={
              canMoveToAnotherVoyage
                ? 'Move this craft to another Voyage'
                : 'Cannot move the only craft in a Voyage'
            }
            onClick={onMoveToVoyage}
          >
            Move to Voyage
          </button>
          <button
            className="rounded-md border border-amber-500/40 bg-amber-500/15 px-3 py-2 text-sm text-amber-300"
            onClick={onRemoveFromVoyage}
          >
            Remove From Voyage
          </button>
        </div>
        <button
          className="w-full rounded-md border border-red-500/40 bg-red-500/15 px-3 py-2 text-sm text-red-300"
          title={closeWarning}
          onClick={onCloseCraft}
        >
          Close Craft
        </button>
      </div>
    </div>
  );
}

export function CreateFirstVoyageScene({
  onCreateNewCraft,
  onOpenExistingCraft,
}: {
  onCreateNewCraft: () => void;
  onOpenExistingCraft: () => void;
}) {
  return (
    <div className="flex min-h-[360px] items-center justify-center bg-neutral-950 p-6 text-center text-neutral-100">
      <div className="w-full max-w-md rounded-xl border border-neutral-800 bg-neutral-900 p-6 shadow-2xl">
        <div className="text-lg font-semibold">Create your first Voyage</div>
        <p className="mt-2 text-sm text-neutral-400">
          Start a new craft or embark an existing craft to build your first Voyage.
        </p>
        <div className="mt-5 grid gap-2 sm:grid-cols-2">
          <button
            className="rounded-md border border-blue-400/70 bg-blue-500/20 px-3 py-2 text-sm text-neutral-50 transition-colors hover:bg-blue-500/30"
            onClick={onCreateNewCraft}
          >
            Create New Craft
          </button>
          <button
            className="rounded-md border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-neutral-200 transition-colors hover:bg-neutral-700"
            onClick={onOpenExistingCraft}
          >
            Open Existing Craft
          </button>
        </div>
      </div>
    </div>
  );
}

export function VoyageNotFoundScene({
  voyageName,
  onGoHome,
  onSwitchVoyage,
}: {
  voyageName?: string;
  onGoHome: () => void;
  onSwitchVoyage: () => void;
}) {
  return (
    <div className="flex min-h-[360px] items-center justify-center bg-neutral-950 p-6 text-center text-neutral-100">
      <div className="w-full max-w-md rounded-xl border border-neutral-800 bg-neutral-900 p-6 shadow-2xl">
        <div className="text-lg font-semibold">Voyage not found</div>
        <p className="mt-2 text-sm text-neutral-400">
          {voyageName
            ? `We could not find “${voyageName}”. Choose another Voyage or return Home.`
            : 'Choose another Voyage or return Home.'}
        </p>
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-center">
          <button
            className="rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-300 transition-colors hover:bg-neutral-800"
            onClick={onGoHome}
          >
            Go Home
          </button>
          <button
            className="rounded-md border border-blue-400/70 bg-blue-500/20 px-3 py-2 text-sm text-neutral-50 transition-colors hover:bg-blue-500/30"
            onClick={onSwitchVoyage}
          >
            Switch Voyage
          </button>
        </div>
      </div>
    </div>
  );
}
