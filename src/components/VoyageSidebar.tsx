/* eslint-disable formatjs/no-literal-string-in-jsx -- Existing dashboard chrome is not yet localized; this component follows the current sidebar pattern. */
import React, { useMemo, useState } from 'react';
import {
  IconAlertTriangle,
  IconChevronDown,
  IconChevronRight,
  IconCircleCheck,
  IconForms,
  IconHome,
  IconLayoutDashboard,
  IconPlayerPlay,
  IconPlug,
  IconPlus,
  IconRocket,
  IconX,
} from '@tabler/icons-react';
import { Button } from '@heroui/react';
import type { SavedWorkspaceSession, TabGroup, ViewPair, VoyageEntry, WorkspaceState } from '../types';
import type { WorkspaceSummary } from '../lib/vk-client';
import { getBuiltInWorkspaceMetadata } from '../modules/plugins/vibe-dashboard/craft-surfaces';

type AttentionKind = 'needs-attention' | 'running';

export interface VoyageSidebarCraftPanel {
  id: string;
  title: string;
  kind: 'view' | 'pair';
}

export interface VoyageSidebarCraft {
  entry: VoyageEntry;
  tabGroup: TabGroup;
  workspaceId?: string;
  panels: VoyageSidebarCraftPanel[];
  attention: AttentionKind[];
}

export interface VoyageSidebarVoyage {
  session: SavedWorkspaceSession;
  active: boolean;
  crafts: VoyageSidebarCraft[];
  attentionCounts: Record<AttentionKind, number>;
}

export interface VoyageSidebarModel {
  voyages: VoyageSidebarVoyage[];
  totals: Record<AttentionKind, number>;
}

export interface VoyageSidebarActionContext {
  sessionId: string;
  activeVoyage: boolean;
  voyageEntryId: string;
}

export interface VoyageSidebarProps {
  workspace: WorkspaceState;
  savedSessions: SavedWorkspaceSession[];
  currentSessionId: string;
  activeVoyageEntryId: string;
  activeItems: Record<string, string>;
  summaries?: WorkspaceSummary[];
  loadingAttention?: boolean;
  onRequestClose?: () => void;
  onOpenHome: () => void;
  onOpenPluginAdmin: () => void;
  onStartNewVoyage: () => void;
  onOpenCraftFlow: () => void;
  onResumeVoyage: (sessionId: string) => void;
  onSelectVoyageEntry: (voyageEntryId: string, context: VoyageSidebarActionContext) => void;
  onSelectTab: (tabGroupId: string, tabId: string, context: VoyageSidebarActionContext) => void;
  onSelectPair: (tabGroupId: string, pairId: string, context: VoyageSidebarActionContext) => void;
}

const ATTENTION_KIND_LABELS: Record<AttentionKind, string> = {
  'needs-attention': 'Needs attention',
  running: 'Running',
};

export function buildVoyageSidebarModel(input: {
  workspace: WorkspaceState;
  savedSessions: SavedWorkspaceSession[];
  currentSessionId: string;
  summaries?: WorkspaceSummary[];
}): VoyageSidebarModel {
  const summaryByWorkspaceId = new Map(
    (input.summaries ?? []).map((summary) => [summary.workspace_id, summary]),
  );
  const tabGroupById = new Map(input.workspace.tabGroups.map((tabGroup) => [tabGroup.id, tabGroup]));
  const voyages = input.savedSessions.filter((session) => !isHomeVoyageSession(session)).map((session): VoyageSidebarVoyage => {
    const crafts = session.voyageEntries
      .map((entry): VoyageSidebarCraft | null => {
        const tabGroup = tabGroupById.get(entry.tabGroupId);
        if (!tabGroup) return null;
        const workspaceId = getBuiltInWorkspaceMetadata(tabGroup)?.workspaceId;
        const summary = workspaceId ? summaryByWorkspaceId.get(workspaceId) : undefined;
        const attention: AttentionKind[] = [];
        if (summary?.has_pending_approval || summary?.has_unseen_turns) {
          attention.push('needs-attention');
        }
        if (summary?.latest_process_status === 'running') {
          attention.push('running');
        }
        return {
          entry,
          tabGroup,
          ...(workspaceId ? { workspaceId } : {}),
          panels: getEntryPanels(tabGroup, entry),
          attention,
        };
      })
      .filter((craft): craft is VoyageSidebarCraft => craft !== null);
    const attentionCounts = countAttention(crafts);
    return {
      session,
      active: session.id === input.currentSessionId,
      crafts,
      attentionCounts,
    };
  });
  return {
    voyages,
    totals: countAttention(voyages.flatMap((voyage) => voyage.crafts)),
  };
}

function getEntryPanels(tabGroup: TabGroup, entry: VoyageEntry): VoyageSidebarCraftPanel[] {
  const viewIds = entry.viewIds.length ? entry.viewIds : tabGroup.tabs.map((tab) => tab.id);
  return viewIds
    .map((viewId) => {
      const tab = tabGroup.tabs.find((candidate) => candidate.id === viewId);
      if (tab) return { id: tab.id, title: tab.title, kind: 'view' as const };
      const pair = tabGroup.pairs.find((candidate) => candidate.id === viewId);
      if (pair) return { id: pair.id, title: getPairTitle(tabGroup, pair), kind: 'pair' as const };
      return null;
    })
    .filter((panel): panel is VoyageSidebarCraftPanel => panel !== null);
}

function getPairTitle(tabGroup: TabGroup, pair: ViewPair): string {
  const title = pair.tabIds
    .map((tabId) => tabGroup.tabs.find((tab) => tab.id === tabId)?.title)
    .filter((title): title is string => Boolean(title))
    .join(' + ');
  return title || 'Panel pair';
}

function countAttention(crafts: VoyageSidebarCraft[]): Record<AttentionKind, number> {
  return {
    'needs-attention': crafts.filter((craft) => craft.attention.includes('needs-attention')).length,
    running: crafts.filter((craft) => craft.attention.includes('running')).length,
  };
}

function getVoyageDisplayName(session: SavedWorkspaceSession): string {
  return session.name?.trim() || 'Untitled Voyage';
}

function isHomeVoyageSession(session: SavedWorkspaceSession): boolean {
  return session.name?.trim().toLowerCase() === 'home';
}

export function VoyageSidebar({
  workspace,
  savedSessions,
  currentSessionId,
  activeVoyageEntryId,
  activeItems,
  summaries,
  loadingAttention = false,
  onRequestClose,
  onOpenHome,
  onOpenPluginAdmin,
  onStartNewVoyage,
  onOpenCraftFlow,
  onResumeVoyage,
  onSelectVoyageEntry,
  onSelectTab,
  onSelectPair,
}: VoyageSidebarProps) {
  const model = useMemo(
    () => buildVoyageSidebarModel({ workspace, savedSessions, currentSessionId, summaries }),
    [currentSessionId, savedSessions, summaries, workspace],
  );
  const [attentionExpanded, setAttentionExpanded] = useState(true);
  const [voyagesExpanded, setVoyagesExpanded] = useState(true);
  const [expandedVoyageIds, setExpandedVoyageIds] = useState(() => new Set([currentSessionId]));

  const toggleVoyage = (sessionId: string) => {
    setExpandedVoyageIds((current) => {
      const next = new Set(current);
      if (next.has(sessionId)) {
        next.delete(sessionId);
      } else {
        next.add(sessionId);
      }
      return next;
    });
  };

  return (
    <aside
      className="flex h-full w-80 shrink-0 flex-col border-r border-neutral-800 bg-neutral-900 text-neutral-100"
      aria-label="Voyage navigation"
    >
      <header className="border-b border-neutral-800 p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-neutral-500">
              Workbench
            </div>
            <h2 className="truncate text-sm font-semibold text-neutral-100">
              Home / Voyages
            </h2>
          </div>
          <button
            type="button"
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-neutral-300 transition-colors hover:bg-neutral-800 hover:text-white focus:outline-none focus:ring-2 focus:ring-primary-400"
            title="Close sidebar"
            aria-label="Close sidebar"
            onClick={onRequestClose}
          >
            <IconX size={17} stroke={2} aria-hidden="true" />
          </button>
        </div>
        <button
          type="button"
          aria-label="Home"
          className="mt-3 flex w-full items-center gap-2 rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-left text-sm text-neutral-200 transition-colors hover:bg-neutral-800 focus:outline-none focus:ring-2 focus:ring-primary-400"
          onClick={onOpenHome}
        >
          <IconHome size={16} stroke={2} aria-hidden="true" />
          <span className="font-medium">Home</span>
          <span className="ml-auto text-xs text-neutral-500">Landing</span>
        </button>
      </header>

      <div className="border-b border-neutral-800 p-2">
        <div className="grid grid-cols-2 gap-2">
          <Button size="sm" color="primary" onPress={onStartNewVoyage}>
            <IconPlus size={15} stroke={2} aria-hidden="true" />
            New Voyage
          </Button>
          <Button size="sm" variant="flat" onPress={onOpenCraftFlow}>
            <IconRocket size={15} stroke={2} aria-hidden="true" />
            Open Craft
          </Button>
        </div>
        <Button size="sm" variant="flat" className="mt-2 w-full" onPress={onOpenPluginAdmin}>
          <IconPlug size={15} stroke={2} aria-hidden="true" />
          Plugins
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <section className="border-b border-neutral-800" aria-labelledby="voyage-sidebar-attention-heading">
          <button
            type="button"
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-neutral-500 transition-colors hover:text-neutral-300 focus:outline-none focus:ring-2 focus:ring-primary-400"
            onClick={() => setAttentionExpanded((current) => !current)}
            aria-expanded={attentionExpanded}
            aria-controls="voyage-sidebar-attention-content"
          >
            {attentionExpanded ? (
              <IconChevronDown size={14} stroke={2} aria-hidden="true" />
            ) : (
              <IconChevronRight size={14} stroke={2} aria-hidden="true" />
            )}
            <span id="voyage-sidebar-attention-heading">Attention</span>
            <span className="ml-auto rounded-full bg-neutral-800 px-2 py-0.5 text-[10px] text-neutral-300">
              {model.totals['needs-attention'] + model.totals.running}
            </span>
          </button>
          {attentionExpanded && (
            <div id="voyage-sidebar-attention-content" className="px-2 pb-2">
              {loadingAttention ? (
                <div className="rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-neutral-400">
                  Loading attention signals…
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  <AttentionSummaryCard kind="needs-attention" count={model.totals['needs-attention']} />
                  <AttentionSummaryCard kind="running" count={model.totals.running} />
                </div>
              )}
              {!loadingAttention && model.totals['needs-attention'] + model.totals.running === 0 && (
                <div className="mt-2 rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-neutral-400">
                  No recognized signals right now.
                </div>
              )}
            </div>
          )}
        </section>

        <section aria-labelledby="voyage-sidebar-voyages-heading">
          <button
            type="button"
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-neutral-500 transition-colors hover:text-neutral-300 focus:outline-none focus:ring-2 focus:ring-primary-400"
            onClick={() => setVoyagesExpanded((current) => !current)}
            aria-expanded={voyagesExpanded}
            aria-controls="voyage-sidebar-voyages-content"
          >
            {voyagesExpanded ? (
              <IconChevronDown size={14} stroke={2} aria-hidden="true" />
            ) : (
              <IconChevronRight size={14} stroke={2} aria-hidden="true" />
            )}
            <span id="voyage-sidebar-voyages-heading">Voyages</span>
            <span className="ml-auto rounded-full bg-neutral-800 px-2 py-0.5 text-[10px] text-neutral-300">
              {model.voyages.length}
            </span>
          </button>

          {voyagesExpanded && (
            <div id="voyage-sidebar-voyages-content" className="space-y-1 px-2 pb-3">
              {model.voyages.length === 0 ? (
                <div className="rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-4 text-sm text-neutral-400">
                  Create a Voyage to start organizing Crafts and Panels.
                </div>
              ) : (
                model.voyages.map((voyage) => {
                  const expanded = expandedVoyageIds.has(voyage.session.id) || voyage.active;
                  return (
                    <div
                      key={voyage.session.id}
                      className={`rounded-lg border ${
                        voyage.active
                          ? 'border-primary-500/40 bg-primary-500/10'
                          : 'border-neutral-800 bg-neutral-950/40'
                      }`}
                    >
                      <div className="flex items-start gap-1 p-1">
                        <button
                          type="button"
                          className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-neutral-200 focus:outline-none focus:ring-2 focus:ring-primary-400"
                          aria-label={`${expanded ? 'Collapse' : 'Expand'} ${getVoyageDisplayName(voyage.session)}`}
                          aria-expanded={expanded}
                          onClick={() => toggleVoyage(voyage.session.id)}
                        >
                          {expanded ? (
                            <IconChevronDown size={15} stroke={2} aria-hidden="true" />
                          ) : (
                            <IconChevronRight size={15} stroke={2} aria-hidden="true" />
                          )}
                        </button>
                        <button
                          type="button"
                          className="min-w-0 flex-1 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-neutral-800/80 focus:outline-none focus:ring-2 focus:ring-primary-400"
                          onClick={() => onResumeVoyage(voyage.session.id)}
                          aria-current={voyage.active ? 'page' : undefined}
                        >
                          <div className="flex items-center gap-2">
                            <span className="truncate text-sm font-medium text-neutral-100">
                              {getVoyageDisplayName(voyage.session)}
                            </span>
                            {voyage.active && (
                              <span className="shrink-0 rounded-full bg-primary-500/20 px-2 py-0.5 text-[10px] font-medium text-primary-200">
                                Active
                              </span>
                            )}
                          </div>
                          <div className="mt-0.5 text-xs text-neutral-500">
                            {voyage.crafts.length} Craft{voyage.crafts.length === 1 ? '' : 's'} ·{' '}
                            {voyage.crafts.reduce((count, craft) => count + craft.panels.length, 0)} Panel
                            {voyage.crafts.reduce((count, craft) => count + craft.panels.length, 0) === 1 ? '' : 's'}
                          </div>
                        </button>
                      </div>

                      {expanded && (
                        <div className="space-y-1 border-t border-neutral-800/80 px-2 pb-2 pt-1">
                          {voyage.crafts.length === 0 ? (
                            <div className="px-3 py-3 text-sm text-neutral-500">
                              No Crafts in this Voyage yet.
                            </div>
                          ) : (
                            voyage.crafts.map((craft) => (
                              <CraftNavigationItem
                                key={craft.entry.id}
                                craft={craft}
                                sessionId={voyage.session.id}
                                activeVoyage={voyage.active}
                                active={voyage.active && craft.entry.id === activeVoyageEntryId}
                                activeItemId={activeItems[craft.tabGroup.id]}
                                onSelectVoyageEntry={onSelectVoyageEntry}
                                onSelectTab={onSelectTab}
                                onSelectPair={onSelectPair}
                              />
                            ))
                          )}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          )}
        </section>
      </div>
    </aside>
  );
}

function AttentionSummaryCard({ kind, count }: { kind: AttentionKind; count: number }) {
  const icon =
    kind === 'needs-attention' ? (
      <IconAlertTriangle size={15} stroke={2} aria-hidden="true" />
    ) : (
      <IconPlayerPlay size={15} stroke={2} aria-hidden="true" />
    );
  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2" aria-label={`${ATTENTION_KIND_LABELS[kind]}: ${count}`}>
      <div className="flex items-center gap-2 text-xs text-neutral-400">
        {icon}
        <span>{ATTENTION_KIND_LABELS[kind]}</span>
      </div>
      <div className="mt-1 text-lg font-semibold text-neutral-100">{count}</div>
    </div>
  );
}

function CraftNavigationItem({
  craft,
  sessionId,
  activeVoyage,
  active,
  activeItemId,
  onSelectVoyageEntry,
  onSelectTab,
  onSelectPair,
}: {
  craft: VoyageSidebarCraft;
  sessionId: string;
  activeVoyage: boolean;
  active: boolean;
  activeItemId?: string;
  onSelectVoyageEntry: (voyageEntryId: string, context: VoyageSidebarActionContext) => void;
  onSelectTab: (tabGroupId: string, tabId: string, context: VoyageSidebarActionContext) => void;
  onSelectPair: (tabGroupId: string, pairId: string, context: VoyageSidebarActionContext) => void;
}) {
  const context = {
    sessionId,
    activeVoyage,
    voyageEntryId: craft.entry.id,
  } satisfies VoyageSidebarActionContext;

  return (
    <div className="rounded-md">
      <button
        type="button"
        className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors focus:outline-none focus:ring-2 focus:ring-primary-400 ${
          active ? 'bg-primary-500/20 text-primary-200' : 'text-neutral-300 hover:bg-neutral-800'
        }`}
        onClick={() => onSelectVoyageEntry(craft.entry.id, context)}
        aria-label={craft.tabGroup.label}
      >
        <IconLayoutDashboard size={15} stroke={2} aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{craft.tabGroup.label}</span>
        <AttentionBadges attention={craft.attention} />
      </button>
      <div className="ml-4 border-l border-neutral-800 pl-2">
        {craft.panels.length === 0 ? (
          <div className="px-2 py-1.5 text-xs text-neutral-500">No Panels</div>
        ) : (
          craft.panels.map((panel) => {
            const selected = active && activeItemId === panel.id;
            return (
              <button
                key={panel.id}
                type="button"
                className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs transition-colors focus:outline-none focus:ring-2 focus:ring-primary-400 ${
                  selected
                    ? 'bg-primary-500/20 text-primary-200'
                    : 'text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200'
                }`}
                onClick={() => {
                  if (panel.kind === 'pair') {
                    onSelectPair(craft.tabGroup.id, panel.id, context);
                  } else {
                    onSelectTab(craft.tabGroup.id, panel.id, context);
                  }
                }}
              >
                {panel.kind === 'pair' ? (
                  <IconLayoutDashboard size={13} stroke={2} aria-hidden="true" />
                ) : (
                  <IconForms size={13} stroke={2} aria-hidden="true" />
                )}
                <span className="truncate">{panel.title}</span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

function AttentionBadges({ attention }: { attention: AttentionKind[] }) {
  if (attention.length === 0) {
    return <IconCircleCheck className="shrink-0 text-neutral-600" size={14} stroke={2} aria-label="No attention signal" />;
  }
  return (
    <span className="inline-flex shrink-0 items-center gap-1">
      {attention.includes('needs-attention') && (
        <span className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-300">
          Needs
        </span>
      )}
      {attention.includes('running') && (
        <span className="rounded-full bg-green-500/15 px-1.5 py-0.5 text-[10px] font-medium text-green-300">
          Running
        </span>
      )}
    </span>
  );
}
