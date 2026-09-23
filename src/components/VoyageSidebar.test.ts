/* eslint-disable formatjs/no-literal-string-in-object -- component contract fixtures */
// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SavedWorkspaceSession, WorkspaceState } from '../types';
import type { WorkspaceSummary } from '../lib/vk-client';
import { Sidebar, type SidebarPanelFocus } from './Sidebar';
import { buildVoyageSidebarModel, VoyageSidebar } from './VoyageSidebar';

vi.mock('../lib/vk-client', () => ({
  vkClient: {
    getWorkspaceSummaries: vi.fn(async () => ({ summaries: [] })),
  },
}));

const workspace = {
  spaces: [
    { id: 'legacy-space', name: 'Legacy Space Name', icon: 'home', tabGroupIds: ['craft-a', 'craft-b'] },
  ],
  tabGroups: [
    {
      id: 'craft-a',
      label: 'API Craft',
      workspace: { workspaceId: 'ws-a', workspaceDir: '/repo/api' },
      tabs: [
        { id: 'agent', title: 'Agent', url: '/workspaces/ws-a', pinned: true },
        { id: 'code', title: 'Code', url: '/workspaces/ws-a/code', pinned: true },
      ],
      pairs: [{ id: 'agent+code', tabIds: ['agent', 'code'], ratios: [50, 50] }],
      order: 0,
    },
    {
      id: 'craft-b',
      label: 'Forms Craft',
      workspace: { workspaceId: 'ws-b', workspaceDir: '/repo/forms' },
      tabs: [
        { id: 'forms', title: 'Forms', url: '/workspaces/ws-b/forms', pinned: true },
      ],
      pairs: [],
      order: 1,
    },
  ],
  nextId: 3,
} satisfies WorkspaceState;

const currentVoyage = {
  id: 'voyage-current',
  slug: 'current',
  name: '2026-09-23',
  createdAt: '2026-09-23T00:00:00.000Z',
  updatedAt: '2026-09-23T10:00:00.000Z',
  activeVoyageEntryId: 'entry-a',
  voyageEntries: [
    { id: 'entry-a', tabGroupId: 'craft-a', viewIds: ['agent', 'code'] },
    { id: 'entry-b', tabGroupId: 'craft-b', viewIds: ['forms'] },
  ],
  activeSpaceId: 'legacy-space',
  activeTabGroupId: 'craft-a',
  activeItemsByVoyageEntryId: { 'entry-a': 'agent', 'entry-b': 'forms' },
  visitedTabGroupIds: ['craft-a'],
} satisfies SavedWorkspaceSession;

const otherVoyage = {
  ...currentVoyage,
  id: 'voyage-other',
  slug: 'other',
  name: 'Review queue',
  activeVoyageEntryId: 'entry-c',
  voyageEntries: [{ id: 'entry-c', tabGroupId: 'craft-b', viewIds: ['forms'] }],
  activeTabGroupId: 'craft-b',
} satisfies SavedWorkspaceSession;

const pairVoyage = {
  ...currentVoyage,
  id: 'voyage-pair',
  slug: 'pair',
  name: 'Pair review',
  activeVoyageEntryId: 'entry-d',
  voyageEntries: [{ id: 'entry-d', tabGroupId: 'craft-a', viewIds: ['agent+code'] }],
  activeTabGroupId: 'craft-a',
  activeItemsByVoyageEntryId: { 'entry-d': 'agent+code' },
} satisfies SavedWorkspaceSession;

const summaries = [
  {
    workspace_id: 'ws-a',
    has_pending_approval: true,
    files_changed: null,
    lines_added: null,
    lines_removed: null,
    latest_process_status: 'running',
    has_running_dev_server: false,
    has_unseen_turns: false,
    pr_status: null,
  },
  {
    workspace_id: 'ws-b',
    has_pending_approval: false,
    files_changed: null,
    lines_added: null,
    lines_removed: null,
    latest_process_status: 'completed',
    has_running_dev_server: false,
    has_unseen_turns: true,
    pr_status: null,
  },
] satisfies WorkspaceSummary[];

afterEach(() => {
  cleanup();
});

describe('VoyageSidebar', () => {
  it('builds a Voyage/Craft/Panel model without using legacy Space labels as navigation concepts', () => {
    const homeSession = { ...currentVoyage, id: 'home-session', name: 'Home' };
    const model = buildVoyageSidebarModel({
      workspace,
      savedSessions: [homeSession, currentVoyage],
      currentSessionId: currentVoyage.id,
      summaries,
    });

    expect(model.voyages).toHaveLength(1);
    expect(model.voyages[0]!.session.id).toBe(currentVoyage.id);
    expect(model.voyages[0]!.crafts.map((craft) => craft.tabGroup.label)).toEqual([
      'API Craft',
      'Forms Craft',
    ]);
    expect(model.voyages[0]!.crafts[0]!.panels.map((panel) => panel.title)).toEqual([
      'Agent',
      'Code',
    ]);
    expect(JSON.stringify(model)).not.toContain('Legacy Space Name');
    expect(model.totals).toEqual({ 'needs-attention': 2, running: 1 });
  });

  it('renders accessible Attention and Voyage hierarchy and focuses Panels through callbacks', () => {
    const onSelectTab = vi.fn();
    const onSelectPair = vi.fn();
    const onSelectVoyageEntry = vi.fn();
    render(
      React.createElement(VoyageSidebar, {
        workspace,
        savedSessions: [currentVoyage, otherVoyage],
        currentSessionId: currentVoyage.id,
        activeVoyageEntryId: 'entry-a',
        activeItems: { 'craft-a': 'agent', 'craft-b': 'forms' },
        summaries,
        onRequestClose: vi.fn(),
        onOpenHome: vi.fn(),
        onOpenPluginAdmin: vi.fn(),
        onStartNewVoyage: vi.fn(),
        onOpenCraftFlow: vi.fn(),
        onResumeVoyage: vi.fn(),
        onSelectVoyageEntry,
        onSelectTab,
        onSelectPair,
      }),
    );

    expect(screen.getByRole('complementary', { name: 'Voyage navigation' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Home' })).toBeTruthy();
    expect(screen.getByText('Attention')).toBeTruthy();
    expect(screen.getByLabelText('Needs attention: 3')).toBeTruthy();
    expect(screen.getByLabelText('Running: 1')).toBeTruthy();
    expect(screen.getByText('2026-09-23')).toBeTruthy();
    expect(screen.getByText('API Craft')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Code' }));
    expect(onSelectTab).toHaveBeenCalledWith('craft-a', 'code', {
      activeVoyage: true,
      sessionId: 'voyage-current',
      voyageEntryId: 'entry-a',
    });

    fireEvent.click(screen.getByRole('button', { name: 'API Craft' }));
    expect(onSelectVoyageEntry).toHaveBeenCalledWith('entry-a', {
      activeVoyage: true,
      sessionId: 'voyage-current',
      voyageEntryId: 'entry-a',
    });
  });

  it('keeps Voyage navigation collapsible without removing Home or Attention access', () => {
    render(
      React.createElement(VoyageSidebar, {
        workspace,
        savedSessions: [currentVoyage],
        currentSessionId: currentVoyage.id,
        activeVoyageEntryId: 'entry-a',
        activeItems: { 'craft-a': 'agent' },
        onRequestClose: vi.fn(),
        onOpenHome: vi.fn(),
        onOpenPluginAdmin: vi.fn(),
        onStartNewVoyage: vi.fn(),
        onOpenCraftFlow: vi.fn(),
        onResumeVoyage: vi.fn(),
        onSelectVoyageEntry: vi.fn(),
        onSelectTab: vi.fn(),
        onSelectPair: vi.fn(),
      }),
    );

    const voyagesToggle = screen.getByRole('button', { name: /Voyages/ });
    fireEvent.click(voyagesToggle);
    expect(screen.queryByText('API Craft')).toBeNull();
    expect(screen.getByRole('button', { name: 'Home' })).toBeTruthy();
    expect(within(screen.getByRole('complementary', { name: 'Voyage navigation' })).getByText('Attention')).toBeTruthy();
  });

  it('resumes a non-active Voyage before focusing its Craft', () => {
    const onResumeSession = vi.fn();
    const onSelectTab = vi.fn();
    const onSelectPair = vi.fn();
    const onSelectVoyageEntry = vi.fn();
    renderSidebar({
      onResumeSession,
      onSelectTab,
      onSelectPair,
      onSelectVoyageEntry,
    });

    fireEvent.click(screen.getByRole('button', { name: 'Expand Review queue' }));
    const foreignCraftButton = screen.getAllByRole('button', { name: 'Forms Craft' }).at(-1);
    expect(foreignCraftButton).toBeTruthy();
    fireEvent.click(foreignCraftButton!);

    expect(onResumeSession).toHaveBeenCalledWith('voyage-other', 'entry-c');
    expect(onSelectVoyageEntry).not.toHaveBeenCalled();
    expect(onSelectTab).not.toHaveBeenCalled();
    expect(onSelectPair).not.toHaveBeenCalled();
  });

  it('keeps active Voyage Craft and Panel actions on direct current-session handlers', () => {
    const onResumeSession = vi.fn();
    const onSelectTab = vi.fn();
    const onSelectPair = vi.fn();
    const onSelectVoyageEntry = vi.fn();
    renderSidebar({
      onResumeSession,
      onSelectTab,
      onSelectPair,
      onSelectVoyageEntry,
    });

    fireEvent.click(screen.getByRole('button', { name: 'API Craft' }));
    fireEvent.click(screen.getByRole('button', { name: 'Code' }));

    expect(onSelectVoyageEntry).toHaveBeenCalledWith('entry-a');
    expect(onSelectTab).toHaveBeenCalledWith('craft-a', 'code');
    expect(onResumeSession).not.toHaveBeenCalled();
    expect(onSelectPair).not.toHaveBeenCalled();
  });

  it('resumes a non-active Voyage with deterministic Panel focus instead of selecting in the active Voyage', () => {
    const onResumeSession = vi.fn();
    const onSelectTab = vi.fn();
    const onSelectPair = vi.fn();
    const onSelectVoyageEntry = vi.fn();
    renderSidebar({
      onResumeSession,
      onSelectTab,
      onSelectPair,
      onSelectVoyageEntry,
    });

    fireEvent.click(screen.getByRole('button', { name: 'Expand Review queue' }));
    const foreignPanelButton = screen.getAllByRole('button', { name: 'Forms' }).at(-1);
    expect(foreignPanelButton).toBeTruthy();
    fireEvent.click(foreignPanelButton!);

    expect(onResumeSession).toHaveBeenCalledWith('voyage-other', 'entry-c', {
      kind: 'view',
      tabGroupId: 'craft-b',
      panelId: 'forms',
    });
    expect(onSelectVoyageEntry).not.toHaveBeenCalled();
    expect(onSelectTab).not.toHaveBeenCalled();
    expect(onSelectPair).not.toHaveBeenCalled();
  });

  it('resumes a non-active Voyage with pair Panel focus instead of selecting a pair in the active Voyage', () => {
    const onResumeSession = vi.fn();
    const onSelectTab = vi.fn();
    const onSelectPair = vi.fn();
    const onSelectVoyageEntry = vi.fn();
    renderSidebar({
      onResumeSession,
      onSelectTab,
      onSelectPair,
      onSelectVoyageEntry,
      savedSessions: [currentVoyage, pairVoyage],
    });

    fireEvent.click(screen.getByRole('button', { name: 'Expand Pair review' }));
    fireEvent.click(screen.getByRole('button', { name: 'Agent + Code' }));

    expect(onResumeSession).toHaveBeenCalledWith('voyage-pair', 'entry-d', {
      kind: 'pair',
      tabGroupId: 'craft-a',
      panelId: 'agent+code',
    });
    expect(onSelectVoyageEntry).not.toHaveBeenCalled();
    expect(onSelectTab).not.toHaveBeenCalled();
    expect(onSelectPair).not.toHaveBeenCalled();
  });
});

function renderSidebar(overrides: {
  onResumeSession: (sessionId: string, voyageEntryId?: string, panelFocus?: SidebarPanelFocus) => void;
  onSelectTab: (tabGroupId: string, tabId: string) => void;
  onSelectPair: (tabGroupId: string, pairId: string) => void;
  onSelectVoyageEntry: (voyageEntryId: string) => void;
  savedSessions?: SavedWorkspaceSession[];
}) {
  return render(
    React.createElement(Sidebar, {
      workspace,
      activeSpaceId: 'legacy-space',
      activeTabGroupId: 'craft-a',
      activeItems: { 'craft-a': 'agent', 'craft-b': 'forms' },
      spaceTypes: {},
      visitedTabGroupIds: ['craft-a'],
      voyageEntries: currentVoyage.voyageEntries,
      activeVoyageEntryId: 'entry-a',
      savedSessions: overrides.savedSessions || [currentVoyage, otherVoyage],
      currentSessionId: currentVoyage.id,
      onRequestClose: vi.fn(),
      onOpenHome: vi.fn(),
      onOpenPluginAdmin: vi.fn(),
      onSelectTabGroup: vi.fn(),
      onSelectTab: overrides.onSelectTab,
      onSelectPair: overrides.onSelectPair,
      onSelectVoyageEntry: overrides.onSelectVoyageEntry,
      onAddSpace: vi.fn(),
      onDeleteSpace: vi.fn(),
      onRenameSpace: vi.fn(),
      onDeleteTabGroup: vi.fn(),
      onRenameTabGroup: vi.fn(),
      onAddTabGroup: vi.fn(),
      onOpenCreateWorkspaceTab: vi.fn(),
      onOpenCraftFlow: vi.fn(),
      onCreatePair: vi.fn(),
      onCloseTab: vi.fn(),
      onSplitPair: vi.fn(),
      onRenameTab: vi.fn(),
      onOpenAddTabModal: vi.fn(),
      onToggleStarTabGroup: vi.fn(),
      onReorderTabGroups: vi.fn(),
      onReorderSpaces: vi.fn(),
      showAddressBar: false,
      onToggleAddressBar: vi.fn(),
      onResumeSession: overrides.onResumeSession,
      onStartNewSession: vi.fn(),
      onRenameSession: vi.fn(),
    }),
  );
}
