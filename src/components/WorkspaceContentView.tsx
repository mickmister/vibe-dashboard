import React, { useMemo, useState } from 'react';
import { UnifiedTabView } from './UnifiedTabView';
import { AddressBar } from './AddressBar';
import { IframePanel } from './IframePanel';
import type {
  SavedWorkspaceSession,
  SubVoyageCell,
  TabGroup,
  VoyageLayout,
  WorkspaceState,
} from '../types';
import type { SubVoyageDropTarget } from '../sessionState';
import type { WorkspaceActions, SessionActions } from './WorkspaceShell';

interface WorkspaceContentViewProps {
  activeTabGroups: TabGroup[];
  activeTabGroupId: string;
  actions: WorkspaceActions;
  sessionActions: SessionActions;
  voyageLayout: VoyageLayout;
  activeSubVoyageCellId: string;
  activeItemsByVoyageEntryId: Record<string, string>;
  disableSplitViews?: boolean;
  onDragOver: (e: React.DragEvent) => void;
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
  voyageLayout,
  activeSubVoyageCellId,
  activeItemsByVoyageEntryId,
  disableSplitViews,
  onDragOver,
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
  const [dropTarget, setDropTarget] = useState<SubVoyageDropTarget | null>(null);

  if (activeTabGroups.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-neutral-500">
        <p>
          No craft in this space. Hover left to switch spaces.
        </p>
      </div>
    );
  }

  const handleTileDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    onDragOver(event);
    if (!hasVoyageEntryDragPayload(event.dataTransfer)) {
      setDropTarget(null);
      return;
    }
    const target = getSubVoyageDropTarget(event.currentTarget.getBoundingClientRect(), {
      x: event.clientX,
      y: event.clientY,
    });
    setDropTarget(target);
  };

  const handleTileDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const voyageEntryId = event.dataTransfer.getData('text/plain');
    const target =
      dropTarget ||
      getSubVoyageDropTarget(event.currentTarget.getBoundingClientRect(), {
        x: event.clientX,
        y: event.clientY,
      });
    if (voyageEntryId && target) {
      sessionActions.tileVoyageEntry(voyageEntryId, target);
    }
    setDropTarget(null);
  };

  if (voyageLayout.cells.length > 1) {
    return (
      <SubVoyageGridView
        actions={actions}
        sessionActions={sessionActions}
        voyageLayout={voyageLayout}
        activeSubVoyageCellId={activeSubVoyageCellId}
        activeItemsByVoyageEntryId={activeItemsByVoyageEntryId}
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
        onDragOver={handleTileDragOver}
        onDragLeave={() => setDropTarget(null)}
        onDrop={handleTileDrop}
        dropTarget={dropTarget}
      />
    );
  }

  return (
    <div
      className="flex-1 min-h-0 relative"
      onDragOver={handleTileDragOver}
      onDragLeave={() => setDropTarget(null)}
      onDrop={handleTileDrop}
    >
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
      {dropTarget && <SubVoyageDropPreview target={dropTarget} />}
    </div>
  );
}

type Point = { x: number; y: number };

function hasVoyageEntryDragPayload(dataTransfer: DataTransfer): boolean {
  return Array.from(dataTransfer.types).includes('text/plain');
}

export function getSubVoyageDropTarget(
  rect: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>,
  point: Point,
): SubVoyageDropTarget {
  const relativeX = rect.width ? (point.x - rect.left) / rect.width : 0.5;
  const relativeY = rect.height ? (point.y - rect.top) / rect.height : 0.5;
  const horizontal = relativeX < 1 / 3 ? 'left' : relativeX > 2 / 3 ? 'right' : '';
  const vertical = relativeY < 1 / 3 ? 'top' : relativeY > 2 / 3 ? 'bottom' : '';

  if (vertical && horizontal) return `${vertical}-${horizontal}` as SubVoyageDropTarget;
  if (horizontal) return horizontal as SubVoyageDropTarget;
  if (vertical) return vertical as SubVoyageDropTarget;
  return 'right';
}

function SubVoyageGridView({
  actions,
  sessionActions,
  voyageLayout,
  activeSubVoyageCellId,
  activeItemsByVoyageEntryId,
  disableSplitViews,
  workspace,
  showAddressBar,
  savedSessions,
  currentSessionId,
  onResumeSession,
  onRenameSession,
  onDeleteSession,
  onStartNewSession,
  onNavigateToTabGroup,
  onDragOver,
  onDragLeave,
  onDrop,
  dropTarget,
}: Omit<
  WorkspaceContentViewProps,
  'activeTabGroups' | 'activeTabGroupId' | 'onDragOver'
> & {
  onDragOver: (event: React.DragEvent<HTMLDivElement>) => void;
  onDragLeave: () => void;
  onDrop: (event: React.DragEvent<HTMLDivElement>) => void;
  dropTarget: SubVoyageDropTarget | null;
}) {
  const visibleTabIds = useMemo(
    () => getVisibleTabIds(workspace, voyageLayout, activeItemsByVoyageEntryId, disableSplitViews),
    [activeItemsByVoyageEntryId, disableSplitViews, voyageLayout, workspace],
  );
  const gridColsClass =
    voyageLayout.cols >= 3
      ? 'md:grid-cols-3'
      : voyageLayout.cols === 2
        ? 'md:grid-cols-2'
        : 'md:grid-cols-1';

  return (
    <div
      className="flex flex-1 min-h-0 flex-col relative p-1"
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div className="md:hidden mb-1 flex shrink-0 gap-1 overflow-x-auto">
        {voyageLayout.cells.map((cell, index) => {
          const activeEntry =
            cell.voyageEntries.find((entry) => entry.id === cell.activeVoyageEntryId) ||
            cell.voyageEntries[0];
          const tabGroup = activeEntry
            ? workspace.tabGroups.find((group) => group.id === activeEntry.tabGroupId)
            : undefined;
          return (
            <button
              key={cell.id}
              type="button"
              className={`shrink-0 rounded px-2 py-1 text-xs ${
                cell.id === activeSubVoyageCellId
                  ? 'bg-sky-600 text-white'
                  : 'bg-neutral-800 text-neutral-300'
              }`}
              onClick={() => sessionActions.selectSubVoyageCell(cell.id)}
            >
              {tabGroup?.label || `Pane ${index + 1}`}
            </button>
          );
        })}
      </div>
      <div className={`grid min-h-0 flex-1 grid-cols-1 ${gridColsClass} gap-1`}>
        {voyageLayout.cells.map((cell) => (
          <SubVoyageCellView
            key={cell.id}
            cell={cell}
            isActive={cell.id === activeSubVoyageCellId}
            isMobileVisible={cell.id === activeSubVoyageCellId}
            activeItemsByVoyageEntryId={activeItemsByVoyageEntryId}
            disableSplitViews={disableSplitViews}
            actions={actions}
            sessionActions={sessionActions}
            workspace={workspace}
            showAddressBar={showAddressBar}
            savedSessions={savedSessions}
            currentSessionId={currentSessionId}
            onResumeSession={onResumeSession}
            onRenameSession={onRenameSession}
            onDeleteSession={onDeleteSession}
            onStartNewSession={onStartNewSession}
            onNavigateToTabGroup={onNavigateToTabGroup}
            retainedVisibleTabIds={visibleTabIds}
          />
        ))}
      </div>
      {dropTarget && <SubVoyageDropPreview target={dropTarget} />}
    </div>
  );
}

function SubVoyageCellView({
  cell,
  isActive,
  isMobileVisible,
  activeItemsByVoyageEntryId,
  disableSplitViews,
  actions,
  sessionActions,
  workspace,
  showAddressBar,
  savedSessions,
  currentSessionId,
  onResumeSession,
  onRenameSession,
  onDeleteSession,
  onStartNewSession,
  onNavigateToTabGroup,
  retainedVisibleTabIds,
}: {
  cell: SubVoyageCell;
  isActive: boolean;
  isMobileVisible: boolean;
  activeItemsByVoyageEntryId: Record<string, string>;
  disableSplitViews?: boolean;
  actions: WorkspaceActions;
  sessionActions: SessionActions;
  workspace: WorkspaceState;
  showAddressBar: boolean;
  savedSessions: SavedWorkspaceSession[];
  currentSessionId: string;
  onResumeSession: (sessionId: string) => void;
  onRenameSession: (sessionId: string, name: string) => void;
  onDeleteSession: (sessionId: string) => void;
  onStartNewSession: () => void;
  onNavigateToTabGroup: (spaceId: string, tabGroupId: string) => void;
  retainedVisibleTabIds: Set<string>;
}) {
  const activeEntry =
    cell.voyageEntries.find((entry) => entry.id === cell.activeVoyageEntryId) ||
    cell.voyageEntries[0];
  const activeTabGroup = activeEntry
    ? workspace.tabGroups.find((group) => group.id === activeEntry.tabGroupId)
    : undefined;
  const activeItemId = activeTabGroup && activeEntry
    ? getSingleViewActiveItemId(
        activeTabGroup,
        activeItemsByVoyageEntryId[activeEntry.id] ||
          activeEntry.viewIds[0] ||
          activeTabGroup.tabs[0]?.id ||
          '',
        disableSplitViews,
      )
    : '';

  return (
    <section
      className={`${isMobileVisible ? 'flex' : 'hidden'} min-h-0 flex-col overflow-hidden rounded-md border bg-neutral-950 md:flex ${
        isActive ? 'border-sky-500/80 shadow-[0_0_0_1px_rgba(14,165,233,0.35)]' : 'border-neutral-800'
      }`}
      onPointerDown={() => sessionActions.selectSubVoyageCell(cell.id)}
    >
      <div className="flex h-9 shrink-0 items-center gap-1 overflow-x-auto border-b border-neutral-800 bg-neutral-900 px-1">
        {cell.voyageEntries.map((entry) => {
          const tabGroup = workspace.tabGroups.find((group) => group.id === entry.tabGroupId);
          return (
            <button
              key={entry.id}
              type="button"
              draggable
              onDragStart={(event) => {
                event.dataTransfer.effectAllowed = 'move';
                event.dataTransfer.setData('text/plain', entry.id);
              }}
              onClick={(event) => {
                event.stopPropagation();
                sessionActions.selectSubVoyageCellEntry(cell.id, entry.id);
              }}
              className={`max-w-48 shrink-0 truncate rounded px-2 py-1 text-left text-xs transition-colors ${
                entry.id === activeEntry?.id
                  ? 'bg-neutral-700 text-neutral-100'
                  : 'bg-neutral-900 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100'
              }`}
              title={tabGroup?.label || 'Missing craft'}
            >
              {tabGroup?.label || 'Missing craft'}
            </button>
          );
        })}
      </div>
      {showAddressBar && activeTabGroup && (
        <AddressBar
          tabGroup={activeTabGroup}
          activeItemId={activeItemId}
          onNavigate={(tabId, newUrl) =>
            actions.updateTabUrl({
              tabGroupId: activeTabGroup.id,
              tabId,
              newUrl,
            })
          }
        />
      )}
      <div className="min-h-0 flex-1">
        {activeTabGroup ? (
          <IframePanel
            tabGroup={activeTabGroup}
            activeItemId={activeItemId}
            onUpdatePairRatios={(pairId, ratios) =>
              actions.updatePairRatios({
                tabGroupId: activeTabGroup.id,
                pairId,
                ratios,
              })
            }
            retainedVisibleTabIds={retainedVisibleTabIds}
            workspace={workspace}
            savedSessions={savedSessions}
            currentSessionId={currentSessionId}
            onResumeSession={onResumeSession}
            onRenameSession={onRenameSession}
            onDeleteSession={onDeleteSession}
            onStartNewSession={onStartNewSession}
            onNavigateToTabGroup={onNavigateToTabGroup}
            onOpenVKWorkspace={async (taskAttemptId, name, containerRef, spaceId) => {
              const result = await actions.addVKWorkspace({
                taskAttemptId,
                name,
                containerRef,
                activeSpaceId: spaceId,
              });
              if (result) {
                sessionActions.selectSubVoyageCellTab(
                  cell.id,
                  activeEntry?.id || cell.activeVoyageEntryId,
                  result.tabGroupId,
                  result.agentTabId,
                );
              }
            }}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-neutral-500">
            No craft selected
          </div>
        )}
      </div>
    </section>
  );
}

function getVisibleTabIds(
  workspace: WorkspaceState,
  voyageLayout: VoyageLayout,
  activeItemsByVoyageEntryId: Record<string, string>,
  disableSplitViews: boolean | undefined,
): Set<string> {
  const ids = new Set<string>();
  for (const cell of voyageLayout.cells) {
    const entry =
      cell.voyageEntries.find((candidate) => candidate.id === cell.activeVoyageEntryId) ||
      cell.voyageEntries[0];
    const tabGroup = entry
      ? workspace.tabGroups.find((group) => group.id === entry.tabGroupId)
      : undefined;
    if (!entry || !tabGroup) continue;
    const itemId = getSingleViewActiveItemId(
      tabGroup,
      activeItemsByVoyageEntryId[entry.id] ||
        entry.viewIds[0] ||
        tabGroup.tabs[0]?.id ||
        '',
      disableSplitViews,
    );
    const pair = tabGroup.pairs.find((candidate) => candidate.id === itemId);
    if (pair) {
      pair.tabIds.forEach((id) => ids.add(id));
    } else if (tabGroup.tabs.some((tab) => tab.id === itemId)) {
      ids.add(itemId);
    }
  }
  return ids;
}

function getSingleViewActiveItemId(
  tabGroup: TabGroup,
  activeItemId: string,
  disableSplitViews: boolean | undefined,
): string {
  if (!disableSplitViews) return activeItemId;
  const activePair = tabGroup.pairs.find((pair) => pair.id === activeItemId);
  if (!activePair) return activeItemId;
  return tabGroup.tabs[0]?.id || activePair.tabIds[0] || activeItemId;
}

function SubVoyageDropPreview({ target }: { target: SubVoyageDropTarget }) {
  const positionClass = getDropPreviewClass(target);
  return (
    <div className="pointer-events-none absolute inset-0 z-20 rounded-lg border border-sky-400/40 bg-sky-400/5">
      <div
        className={`absolute rounded-md border-2 border-sky-300 bg-sky-400/30 shadow-[0_0_24px_rgba(56,189,248,0.45)] ${positionClass}`}
      />
    </div>
  );
}

function getDropPreviewClass(target: SubVoyageDropTarget): string {
  switch (target) {
    case 'top-left':
      return 'left-3 top-3 h-[calc(50%-0.75rem)] w-[calc(50%-0.75rem)]';
    case 'top-right':
      return 'right-3 top-3 h-[calc(50%-0.75rem)] w-[calc(50%-0.75rem)]';
    case 'bottom-left':
      return 'bottom-3 left-3 h-[calc(50%-0.75rem)] w-[calc(50%-0.75rem)]';
    case 'bottom-right':
      return 'bottom-3 right-3 h-[calc(50%-0.75rem)] w-[calc(50%-0.75rem)]';
    case 'left':
      return 'bottom-3 left-3 top-3 w-[calc(50%-0.75rem)]';
    case 'right':
      return 'bottom-3 right-3 top-3 w-[calc(50%-0.75rem)]';
    case 'top':
      return 'left-3 right-3 top-3 h-[calc(50%-0.75rem)]';
    case 'bottom':
      return 'bottom-3 left-3 right-3 h-[calc(50%-0.75rem)]';
  }
}
