import React, { useState, useEffect, useRef, useMemo } from 'react';
import { IconMenu2, IconUfo } from '@tabler/icons-react';
import { Sidebar } from './Sidebar';
import { WorkspaceContentView } from './WorkspaceContentView';
import { hasKnownIframeMessageSource } from './IframePanel';
import { hasSameBaseOrigin } from '../lib/originTrust';
import { AddTabModal } from './AddTabModal';
import {
  AddVKWorkspaceModal,
  prefetchVKWorkspaceSearchResults,
} from './dialogs/AddVKWorkspaceModal';
import type {
  WorkspaceState,
  TabGroup,
  SavedWorkspaceSession,
  VoyageEntry,
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
const VOYAGE_SWITCH_THROTTLE_MS = 1000;
type VSCodeViewTarget = 'repos' | 'worktree-parent';

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
  addVSCodeView: (args: {
    tabGroupId: string;
    target: VSCodeViewTarget;
  }) => Promise<{ tabId: string; tabGroupId: string } | undefined>;
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
  selectSessionTabGroup: (spaceId: string, tabGroupId: string) => void;
  selectSessionTab: (spaceId: string, tabGroupId: string, tabId: string) => void;
  selectSessionPair: (
    spaceId: string,
    tabGroupId: string,
    pairId: string,
  ) => void;
  selectVoyageEntry: (voyageEntryId: string) => void;
  selectTab: (tabGroupId: string, tabId: string) => void;
  selectPair: (tabGroupId: string, pairId: string) => void;
  setActiveTabGroup: (tabGroupId: string) => void;
  getActiveItem: (tabGroupId: string) => string;
  resumeSession: (sessionId: string, voyageEntryId?: string) => void;
  startNewSession: () => string;
  renameSession: (sessionId: string, name: string) => void;
  deleteSession: (sessionId: string) => void;
  addTabGroupToSession: (
    tabGroupId: string,
    options?: { allowDuplicate?: boolean; select?: boolean },
  ) => void;
  removeVoyageEntryFromSession: (voyageEntryId: string) => void;
  removeTabGroupFromSession: (tabGroupId: string) => void;
  reorderVoyageEntries: (sourceEntryId: string, targetEntryId: string) => void;
  reorderSessionTabGroups: (sourceId: string, targetId: string) => void;
};

interface WorkspaceShellProps {
  workspace: WorkspaceState;
  session: SessionWorkspaceNav;
  actions: WorkspaceActions;
  sessionActions: SessionActions;
  savedSessions: SavedWorkspaceSession[];
  currentSessionId: string;
}

type DuplicateCraftPrompt = {
  spaceId: string;
  tabGroupId: string;
  currentEntries: VoyageEntry[];
  otherVoyages: Array<{
    session: SavedWorkspaceSession;
    entryId?: string;
  }>;
};

type VoyageActionKind = 'new-task' | 'open-craft' | 'vscode-view';
type PendingVoyageCraftSelection = {
  sessionId: string;
  spaceId: string;
  tabGroupId: string;
  tabId?: string;
};

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
  const [mobileTabMenuTarget, setMobileTabMenuTarget] = useState<{
    voyageEntryId: string;
    spaceId: string;
    tabGroupId: string;
  } | null>(null);
  const [desktopTabMenuTarget, setDesktopTabMenuTarget] = useState<{
    voyageEntryId: string;
    spaceId: string;
    tabGroupId: string;
    position: { x: number; y: number };
  } | null>(null);
  const [expandedVoyageEntryId, setExpandedVoyageEntryId] = useState<
    string | null
  >(null);
  const [duplicateCraftPrompt, setDuplicateCraftPrompt] =
    useState<DuplicateCraftPrompt | null>(null);
  const [voyageActionPrompt, setVoyageActionPrompt] =
    useState<VoyageActionKind | null>(null);
  const [voyageActionNewName, setVoyageActionNewName] = useState('');
  const [pendingOpenCraftSessionId, setPendingOpenCraftSessionId] =
    useState<string | null>(null);
  const [pendingVSCodeViewSessionId, setPendingVSCodeViewSessionId] =
    useState<string | null>(null);
  const [pendingVoyageRename, setPendingVoyageRename] = useState<{
    sessionId: string;
    name: string;
  } | null>(null);
  const [pendingVoyageCraftSelection, setPendingVoyageCraftSelection] =
    useState<PendingVoyageCraftSelection | null>(null);
  const [previousVoyageId, setPreviousVoyageId] = useState<string | null>(null);
  const [voyagePlusMenuOpen, setVoyagePlusMenuOpen] = useState(false);
  const [voyageSwitcherOpen, setVoyageSwitcherOpen] = useState(false);
  const [vscodeViewPromptOpen, setVSCodeViewPromptOpen] = useState(false);
  const [mobileTabDraftLabel, setMobileTabDraftLabel] = useState('');
  const [mobileTabDraftEmoji, setMobileTabDraftEmoji] = useState('');
  const dragGroupRef = useRef<string | null>(null);
  const dragSessionTabGroupRef = useRef<string | null>(null);
  const voyagePlusMenuRef = useRef<HTMLDivElement | null>(null);
  const lastVoyageSwitchAtRef = useRef(0);
  const longPressTimerRef = useRef<number | null>(null);
  const longPressStartedAtRef = useRef<{ x: number; y: number } | null>(null);
  const suppressMobileTabClickRef = useRef(false);

  const LONG_PRESS_MS = 450;
  const LONG_PRESS_MOVE_TOLERANCE_PX = 10;

  // --- Drag-and-drop for crafts ---
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

  const handleSessionTabGroupDragStart = (
    e: React.DragEvent,
    voyageEntryId: string,
  ) => {
    dragSessionTabGroupRef.current = voyageEntryId;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', voyageEntryId);
  };

  const handleSessionTabGroupDrop = (
    e: React.DragEvent,
    targetVoyageEntryId: string,
  ) => {
    e.preventDefault();
    const sourceId = dragSessionTabGroupRef.current;
    if (!sourceId || sourceId === targetVoyageEntryId) return;
    sessionActions.reorderVoyageEntries(sourceId, targetVoyageEntryId);
    dragSessionTabGroupRef.current = null;
  };

  const trySelectVoyageEntry = (voyageEntryId: string): boolean => {
    if (voyageEntryId === session.activeVoyageEntryId) {
      return true;
    }

    const now = Date.now();
    if (now - lastVoyageSwitchAtRef.current < VOYAGE_SWITCH_THROTTLE_MS) {
      return false;
    }

    lastVoyageSwitchAtRef.current = now;
    sessionActions.selectVoyageEntry(voyageEntryId);
    return true;
  };

  const cycleSessionTabGroup = (direction: 1 | -1) => {
    const currentIndex = session.voyageEntries.findIndex(
      (entry) => entry.id === session.activeVoyageEntryId,
    );
    if (currentIndex === -1 || session.voyageEntries.length <= 1) {
      return;
    }

    const nextIndex =
      (currentIndex + direction + session.voyageEntries.length) %
      session.voyageEntries.length;
    const nextEntry = session.voyageEntries[nextIndex];

    if (nextEntry) {
      trySelectVoyageEntry(nextEntry.id);
    }
  };

  const switchToVoyage = (sessionId: string, voyageEntryId?: string) => {
    if (sessionId !== currentSessionId) {
      setPreviousVoyageId(currentSessionId);
    }
    sessionActions.resumeSession(sessionId, voyageEntryId);
  };

  const startNewVoyage = (name?: string): string => {
    const nextSessionId = sessionActions.startNewSession();
    const trimmedName = name?.trim();
    if (trimmedName) {
      sessionActions.renameSession(nextSessionId, trimmedName);
      setPendingVoyageRename({ sessionId: nextSessionId, name: trimmedName });
    }
    setPreviousVoyageId(currentSessionId);
    return nextSessionId;
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
        setPendingOpenCraftSessionId(null);
        setWorkspaceSearchMode('general');
        setWorkspaceSearchOpen(true);
        setIsSidebarOpen(false);
        return;
      }

      if (key === 'escape') {
        setVoyagePlusMenuOpen(false);
        setVoyageActionPrompt(null);
        setVSCodeViewPromptOpen(false);
        setPendingVSCodeViewSessionId(null);
        return;
      }

      if (e.ctrlKey && !e.metaKey && !e.altKey && !isEditableTarget(e.target)) {
        if (key === '[' || key === ']') {
          e.preventDefault();
          e.stopPropagation();
          cycleSessionTabGroup(key === ']' ? 1 : -1);
          return;
        }
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
  }, [
    cycleSessionTabGroup,
  ]);

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

  useEffect(() => {
    if (!pendingVoyageRename) return;
    if (!savedSessions.some((entry) => entry.id === pendingVoyageRename.sessionId)) {
      return;
    }
    sessionActions.renameSession(pendingVoyageRename.sessionId, pendingVoyageRename.name);
    setPendingVoyageRename(null);
  }, [pendingVoyageRename, savedSessions, sessionActions]);

  useEffect(() => {
    if (!pendingVoyageCraftSelection) return;
    if (currentSessionId !== pendingVoyageCraftSelection.sessionId) return;

    if (pendingVoyageCraftSelection.tabId) {
      sessionActions.selectSessionTab(
        pendingVoyageCraftSelection.spaceId,
        pendingVoyageCraftSelection.tabGroupId,
        pendingVoyageCraftSelection.tabId,
      );
    } else {
      sessionActions.addTabGroupToSession(pendingVoyageCraftSelection.tabGroupId, {
        select: true,
      });
      sessionActions.selectSessionTabGroup(
        pendingVoyageCraftSelection.spaceId,
        pendingVoyageCraftSelection.tabGroupId,
      );
    }

    setPendingVoyageCraftSelection(null);
  }, [currentSessionId, pendingVoyageCraftSelection, sessionActions]);

  // --- Add tab modal handler ---
  const openAddTabModal = (tabGroupId: string) => {
    setAddTabTargetGroupId(tabGroupId);
    setAddTabModalOpen(true);
  };

  const handleAddTab = (title: string, url: string) => {
    actions.addTab({ tabGroupId: addTabTargetGroupId, title, url });
  };

  const handleAddVSCodeView = async (target: VSCodeViewTarget) => {
    setVSCodeViewPromptOpen(false);
    const destinationSessionId = pendingVSCodeViewSessionId || currentSessionId;
    const destinationSession =
      destinationSessionId !== currentSessionId
        ? savedSessions.find((entry) => entry.id === destinationSessionId)
        : undefined;
    const destinationTabGroupId =
      destinationSession?.activeTabGroupId || session.activeTabGroupId;
    const destinationSpaceId =
      destinationSession?.activeSpaceId || session.activeSpaceId;

    const result = await actions.addVSCodeView({
      tabGroupId: destinationTabGroupId,
      target,
    });
    setPendingVSCodeViewSessionId(null);

    if (!result?.tabId) return;

    if (destinationSessionId !== currentSessionId) {
      switchToVoyage(destinationSessionId);
      setPendingVoyageCraftSelection({
        sessionId: destinationSessionId,
        spaceId: destinationSpaceId,
        tabGroupId: result.tabGroupId,
        tabId: result.tabId,
      });
      return;
    }

    sessionActions.selectSessionTab(
      destinationSpaceId,
      result.tabGroupId,
      result.tabId,
    );
  };

  const handleOpenCreateWorkspaceTab = async () => {
    const result = await actions.ensureCreateWorkspaceTab();
    if (!result) return;

    sessionActions.selectSessionTab(
      result.spaceId,
      result.tabGroupId,
      result.tabId,
    );
  };

  const handleOpenNewTaskInVoyage = async (sessionId: string) => {
    const result = await actions.ensureCreateWorkspaceTab();
    if (!result) return;

    if (sessionId !== currentSessionId) {
      switchToVoyage(sessionId);
      setPendingVoyageCraftSelection({
        sessionId,
        spaceId: result.spaceId,
        tabGroupId: result.tabGroupId,
        tabId: result.tabId,
      });
      return;
    }

    sessionActions.selectSessionTab(result.spaceId, result.tabGroupId, result.tabId);
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
      sessionActions.selectSessionTab(
        session.activeSpaceId,
        result.tabGroupId,
        result.agentTabId,
      );
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
      sessionActions.selectSessionTab(spaceId, result.tabGroupId, result.agentTabId);
    }
  };

  const handleWorkspaceSearchAdd = async (
    taskAttemptId: string,
    name: string,
    containerRef: string,
  ) => {
    const destinationSessionId = pendingOpenCraftSessionId;
    const destinationSession =
      destinationSessionId && destinationSessionId !== currentSessionId
        ? savedSessions.find((entry) => entry.id === destinationSessionId)
        : undefined;
    const destinationSpaceId =
      destinationSession?.activeSpaceId || session.activeSpaceId;

    if (workspaceSearchMode === 'session-add') {
      const result = await actions.addVKWorkspace({
        taskAttemptId,
        name,
        containerRef,
        activeSpaceId: destinationSpaceId,
      });
      if (result) {
        if (destinationSessionId && destinationSessionId !== currentSessionId) {
          switchToVoyage(destinationSessionId);
          setPendingVoyageCraftSelection({
            sessionId: destinationSessionId,
            spaceId: destinationSpaceId,
            tabGroupId: result.tabGroupId,
            tabId: result.agentTabId,
          });
        } else {
          sessionActions.selectSessionTab(
            destinationSpaceId,
            result.tabGroupId,
            result.agentTabId,
          );
        }
      }
      setPendingOpenCraftSessionId(null);
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
    setPendingOpenCraftSessionId(null);
    setWorkspaceSearchMode('general');
  };

  const handleNavigateToWorkspaceTabGroup = (
    spaceId: string,
    tabGroupId: string,
  ) => {
    const destinationSessionId = pendingOpenCraftSessionId;
    const destinationSession =
      destinationSessionId && destinationSessionId !== currentSessionId
        ? savedSessions.find((entry) => entry.id === destinationSessionId)
        : undefined;
    const targetEntries =
      destinationSession?.voyageEntries ||
      (destinationSessionId && destinationSessionId !== currentSessionId
        ? []
        : session.voyageEntries);
    const currentEntries = targetEntries.filter((entry) => entry.tabGroupId === tabGroupId);

    if (destinationSessionId && destinationSessionId !== currentSessionId) {
      const existingEntry = currentEntries[0];
      switchToVoyage(destinationSessionId, existingEntry?.id);
      if (!existingEntry) {
        setPendingVoyageCraftSelection({
          sessionId: destinationSessionId,
          spaceId,
          tabGroupId,
        });
      }
      setPendingOpenCraftSessionId(null);
      setWorkspaceSearchMode('general');
      return;
    }

    const otherVoyages = savedSessions
      .filter((savedSession) => savedSession.id !== currentSessionId)
      .map((savedSession) => {
        const matchingEntry = savedSession.voyageEntries?.find(
          (entry) => entry.tabGroupId === tabGroupId,
        );
        const hasLegacyMembership =
          !matchingEntry && savedSession.visitedTabGroupIds.includes(tabGroupId);
        return matchingEntry || hasLegacyMembership
          ? { session: savedSession, entryId: matchingEntry?.id }
          : null;
      })
      .filter(
        (
          entry,
        ): entry is {
          session: SavedWorkspaceSession;
          entryId: string | undefined;
        } => entry != null,
      );

    if (currentEntries.length > 0 || otherVoyages.length > 0) {
      setDuplicateCraftPrompt({
        spaceId,
        tabGroupId,
        currentEntries,
        otherVoyages,
      });
      return;
    }

    if (workspaceSearchMode === 'session-add') {
      sessionActions.addTabGroupToSession(tabGroupId, { select: true });
    }
    sessionActions.selectSessionTabGroup(spaceId, tabGroupId);
    setPendingOpenCraftSessionId(null);
    setWorkspaceSearchMode('general');
  };

  const closeDuplicateCraftPrompt = () => {
    setDuplicateCraftPrompt(null);
    setPendingOpenCraftSessionId(null);
    setWorkspaceSearchMode('general');
    setWorkspaceSearchOpen(false);
  };

  const openCraftInNewVoyage = () => {
    if (!duplicateCraftPrompt) return;
    const nextSessionId = startNewVoyage();
    setPendingVoyageCraftSelection({
      sessionId: nextSessionId,
      spaceId: duplicateCraftPrompt.spaceId,
      tabGroupId: duplicateCraftPrompt.tabGroupId,
    });
    closeDuplicateCraftPrompt();
  };

  const openCraftInCurrentVoyage = () => {
    if (!duplicateCraftPrompt) return;
    sessionActions.addTabGroupToSession(duplicateCraftPrompt.tabGroupId, {
      select: true,
    });
    sessionActions.selectSessionTabGroup(
      duplicateCraftPrompt.spaceId,
      duplicateCraftPrompt.tabGroupId,
    );
    closeDuplicateCraftPrompt();
  };

  const switchToExistingCraftInCurrentVoyage = (voyageEntryId: string) => {
    sessionActions.selectVoyageEntry(voyageEntryId);
    closeDuplicateCraftPrompt();
  };

  const switchToCraftInOtherVoyage = (sessionId: string, voyageEntryId?: string) => {
    if (!voyageEntryId && duplicateCraftPrompt) {
      setPendingVoyageCraftSelection({
        sessionId,
        spaceId: duplicateCraftPrompt.spaceId,
        tabGroupId: duplicateCraftPrompt.tabGroupId,
      });
    }
    switchToVoyage(sessionId, voyageEntryId);
    closeDuplicateCraftPrompt();
  };

  const openVoyageActionPrompt = (kind: VoyageActionKind) => {
    setVoyagePlusMenuOpen(false);
    setVoyageActionPrompt(kind);
  };

  const closeVoyageActionPrompt = () => {
    setVoyageActionPrompt(null);
    setVoyageActionNewName('');
  };

  const handleVoyageActionDestination = async (sessionId: string) => {
    const kind = voyageActionPrompt;
    closeVoyageActionPrompt();
    if (!kind) return;

    if (kind === 'new-task') {
      await handleOpenNewTaskInVoyage(sessionId);
      return;
    }

    if (kind === 'open-craft') {
      setPendingOpenCraftSessionId(sessionId);
      setWorkspaceSearchMode('session-add');
      setWorkspaceSearchOpen(true);
      return;
    }

    setPendingVSCodeViewSessionId(sessionId);
    setVSCodeViewPromptOpen(true);
  };

  const handleVoyageActionNewVoyage = async () => {
    const kind = voyageActionPrompt;
    const nextSessionId = startNewVoyage(voyageActionNewName);
    closeVoyageActionPrompt();
    if (kind === 'new-task') {
      await handleOpenNewTaskInVoyage(nextSessionId);
      return;
    }
    if (kind === 'vscode-view') {
      setPendingVSCodeViewSessionId(nextSessionId);
      setVSCodeViewPromptOpen(true);
      return;
    }
    setPendingOpenCraftSessionId(nextSessionId);
    setWorkspaceSearchMode('session-add');
    setWorkspaceSearchOpen(true);
  };

  const handleVoyageActionBackdropClick = (
    event: React.MouseEvent<HTMLDivElement>,
  ) => {
    if (event.target === event.currentTarget) {
      closeVoyageActionPrompt();
    }
  };

  const handleVSCodeViewBackdropClick = (
    event: React.MouseEvent<HTMLDivElement>,
  ) => {
    if (event.target === event.currentTarget) {
      setVSCodeViewPromptOpen(false);
      setPendingVSCodeViewSessionId(null);
    }
  };

  const handleBackToPreviousVoyage = () => {
    if (!previousVoyageId || previousVoyageId === currentSessionId) {
      setPreviousVoyageId(null);
      return;
    }
    const target = previousVoyageId;
    setPreviousVoyageId(currentSessionId);
    sessionActions.resumeSession(target);
  };

  const handleOpenVoyageSwitcher = () => {
    setVoyageSwitcherOpen(true);
    setVoyagePlusMenuOpen(false);
    setExpandedVoyageEntryId(null);
    setIsSidebarOpen(false);
  };

  const handleVoyageSwitcherBackdropClick = (
    event: React.MouseEvent<HTMLDivElement>,
  ) => {
    if (event.target === event.currentTarget) {
      setVoyageSwitcherOpen(false);
    }
  };

  const handleVoyageSwitcherSelect = (sessionId: string) => {
    switchToVoyage(sessionId);
    setVoyageSwitcherOpen(false);
  };

  const handleAddTabGroup = async (label: string) => {
    const result = await actions.addTabGroup({
      spaceId: session.activeSpaceId,
      label,
    });

    // Auto-select the new craft
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
  const mobileSessionTabGroups = session.voyageEntries
    .map((entry) => {
      const tabGroupId = entry.tabGroupId;
      const tabGroup = workspace.tabGroups.find((tg) => tg.id === tabGroupId);
      if (!tabGroup) return null;

      const space = workspace.spaces.find((candidate) =>
        candidate.tabGroupIds.includes(tabGroupId),
      );
      if (!space) return null;

      return { entry, space, tabGroup };
    })
    .filter(
      (
        item,
      ): item is {
        entry: VoyageEntry;
        space: WorkspaceState['spaces'][number];
        tabGroup: TabGroup;
      } => item != null,
    );
  const tabGroupLabelById = useMemo(() => {
    return new Map(workspace.tabGroups.map((tabGroup) => [tabGroup.id, tabGroup.label]));
  }, [workspace.tabGroups]);
  const sortedVoyageSwitcherSessions = useMemo(() => {
    return [...savedSessions].sort((left, right) => {
      const leftTime = Date.parse(left.updatedAt || left.createdAt || '');
      const rightTime = Date.parse(right.updatedAt || right.createdAt || '');
      return (Number.isFinite(rightTime) ? rightTime : 0) -
        (Number.isFinite(leftTime) ? leftTime : 0);
    });
  }, [savedSessions]);
  const getVoyageDisplayName = (savedSession: SavedWorkspaceSession) => {
    return (
      savedSession.name?.trim() ||
      tabGroupLabelById.get(savedSession.activeTabGroupId) ||
      savedSession.slug ||
      'Untitled voyage'
    );
  };

  const mobileTabMenuTabGroup = mobileTabMenuTarget
    ? workspace.tabGroups.find((tg) => tg.id === mobileTabMenuTarget.tabGroupId)
    : undefined;
  const mobileTabMenuSpace = mobileTabMenuTarget
    ? workspace.spaces.find((space) => space.id === mobileTabMenuTarget.spaceId)
    : undefined;

  const expandedSessionTabGroup = useMemo(() => {
    if (!expandedVoyageEntryId) return null;
    return (
      mobileSessionTabGroups.find(
        ({ entry }) => entry.id === expandedVoyageEntryId,
      ) || null
    );
  }, [expandedVoyageEntryId, mobileSessionTabGroups]);

  const expandedSessionItems = useMemo(() => {
    if (!expandedSessionTabGroup) {
      return [] as Array<
        | { kind: 'tab'; id: string; label: string; isActive: boolean }
        | { kind: 'pair'; id: string; label: string; isActive: boolean }
      >;
    }

    const activeViewIds = expandedSessionTabGroup.entry.viewIds;
    const tabItems = expandedSessionTabGroup.tabGroup.tabs.map((tab) => ({
      kind: 'tab' as const,
      id: tab.id,
      label: tab.title,
      isActive: activeViewIds.length === 1 && activeViewIds[0] === tab.id,
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
        isActive:
          pair.tabIds.length === activeViewIds.length &&
          pair.tabIds.every((tabId, tabIndex) => tabId === activeViewIds[tabIndex]),
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

  const openMobileTabMenu = (
    voyageEntryId: string,
    spaceId: string,
    tabGroup: TabGroup,
  ) => {
    setMobileTabMenuTarget({ voyageEntryId, spaceId, tabGroupId: tabGroup.id });
    setMobileTabDraftLabel(tabGroup.mobileLabel || '');
    setMobileTabDraftEmoji(tabGroup.mobileEmoji || '');
  };

  const handleMobileTabPointerDown = (
    event: React.PointerEvent<HTMLButtonElement>,
    voyageEntryId: string,
    spaceId: string,
    tabGroup: TabGroup,
  ) => {
    if (event.pointerType === 'mouse') return;

    clearLongPress();
    longPressStartedAtRef.current = { x: event.clientX, y: event.clientY };
    longPressTimerRef.current = window.setTimeout(() => {
      longPressTimerRef.current = null;
      suppressMobileTabClickRef.current = true;
      openMobileTabMenu(voyageEntryId, spaceId, tabGroup);
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
    setExpandedVoyageEntryId((current) => {
      const expandedEntry = session.voyageEntries.find((entry) => entry.id === current);
      return expandedEntry?.tabGroupId === tabGroupId ? null : current;
    });

    if (
      result?.wasDeleted &&
      session.activeTabGroupId === tabGroupId &&
      result.nextTabGroupId
    ) {
      sessionActions.selectSessionTabGroup(spaceId, result.nextTabGroupId);
    }
  };

  const handleToggleSessionTabGroup = (
    voyageEntryId: string,
    spaceId: string,
    tabGroupId: string,
  ) => {
    if (voyageEntryId === session.activeVoyageEntryId) {
      setExpandedVoyageEntryId((current) =>
        current === voyageEntryId ? null : voyageEntryId,
      );
      return;
    }

    if (trySelectVoyageEntry(voyageEntryId)) {
      setExpandedVoyageEntryId(null);
    }
  };

  const handleSelectExpandedSessionItem = (
    spaceId: string,
    tabGroupId: string,
    item: { kind: 'tab' | 'pair'; id: string },
  ) => {
    if (item.kind === 'pair') {
      sessionActions.selectSessionPair(spaceId, tabGroupId, item.id);
    } else {
      sessionActions.selectSessionTab(spaceId, tabGroupId, item.id);
    }
    setExpandedVoyageEntryId(null);
  };

  const handleRemoveVoyageEntryFromSession = (voyageEntryId: string) => {
    sessionActions.removeVoyageEntryFromSession(voyageEntryId);
    setMobileTabMenuTarget(null);
    setDesktopTabMenuTarget(null);
    setExpandedVoyageEntryId((current) =>
      current === voyageEntryId ? null : current,
    );
  };

  const openSessionWorkspaceSearch = () => {
    setDesktopTabMenuTarget(null);
    setMobileTabMenuTarget(null);
    openVoyageActionPrompt('open-craft');
  };

  const handleWorkspaceSearchClose = () => {
    setWorkspaceSearchOpen(false);
    setWorkspaceSearchMode('general');
    setPendingOpenCraftSessionId(null);
  };

  useEffect(() => {
    return () => clearLongPress();
  }, []);

  useEffect(() => {
    if (!expandedVoyageEntryId) return;
    const exists = mobileSessionTabGroups.some(
      ({ entry }) => entry.id === expandedVoyageEntryId,
    );
    if (!exists || expandedVoyageEntryId !== session.activeVoyageEntryId) {
      setExpandedVoyageEntryId(null);
    }
  }, [
    expandedVoyageEntryId,
    mobileSessionTabGroups,
    session.activeVoyageEntryId,
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
    if (!voyagePlusMenuOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (
        target instanceof Element &&
        target.closest('[data-voyage-plus-trigger="true"]')
      ) {
        return;
      }
      if (
        target instanceof Node &&
        voyagePlusMenuRef.current?.contains(target)
      ) {
        return;
      }
      setVoyagePlusMenuOpen(false);
    };

    window.addEventListener('pointerdown', handlePointerDown);
    return () => window.removeEventListener('pointerdown', handlePointerDown);
  }, [voyagePlusMenuOpen]);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setDesktopTabMenuTarget(null);
        setExpandedVoyageEntryId(null);
      }
    };

    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, []);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const data = event.data as
        | { type?: string; action?: string }
        | undefined;
      if (data?.type !== 'vk-iframe-shortcut') return;
      if (!hasSameBaseOrigin(event.origin, window.location.origin)) return;
      if (!hasKnownIframeMessageSource(event.source)) return;

      if (data.action === 'cycle-next') {
        cycleSessionTabGroup(1);
      } else if (data.action === 'cycle-prev') {
        cycleSessionTabGroup(-1);
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [cycleSessionTabGroup]);

  return (
    <div className="w-full h-full flex bg-neutral-950">
      {isSidebarOpen && (
        <button
          className="fixed inset-0 z-[60] bg-black/40 md:hidden"
          onClick={() => setIsSidebarOpen(false)}
          aria-label="Close sidebar overlay"
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
          voyageEntries={session.voyageEntries}
          activeVoyageEntryId={session.activeVoyageEntryId}
          savedSessions={savedSessions}
          currentSessionId={currentSessionId}
          onRequestClose={() => setIsSidebarOpen(false)}
          onSelectSpace={(spaceId) => {
            sessionActions.selectSpace(spaceId);
          }}
          onSelectTabGroup={(tabGroupId) => {
            const space = workspace.spaces.find((entry) =>
              entry.tabGroupIds.includes(tabGroupId),
            );
            if (space) {
              handleNavigateToWorkspaceTabGroup(space.id, tabGroupId);
            } else {
              sessionActions.setActiveTabGroup(tabGroupId);
            }
          }}
          onSelectTab={(tabGroupId, tabId) => {
            sessionActions.selectTab(tabGroupId, tabId);
          }}
          onSelectPair={(tabGroupId, pairId) => {
            sessionActions.selectPair(tabGroupId, pairId);
          }}
          onSelectVoyageEntry={(voyageEntryId) => {
            sessionActions.selectVoyageEntry(voyageEntryId);
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
          onOpenCraftFlow={() => {
            openVoyageActionPrompt('open-craft');
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
            switchToVoyage(sessionId);
            setIsSidebarOpen(false);
          }}
          onStartNewSession={() => {
            startNewVoyage();
            setIsSidebarOpen(false);
          }}
          onRenameSession={(sessionId, name) => {
            sessionActions.renameSession(sessionId, name);
          }}
        />
      </div>

      {/* Main content area */}
      <div className="flex-1 flex flex-col min-h-0 min-w-0 relative">
        <div className="hidden md:flex h-9 border-b border-neutral-600 bg-neutral-900 items-stretch shrink-0 [&_button]:cursor-pointer">
          <button
            className="shrink-0 h-full w-9 cursor-pointer border-r border-b-2 border-neutral-600 bg-neutral-900 text-sm text-neutral-200 transition-colors hover:bg-neutral-800/80"
            onClick={() => setIsSidebarOpen(true)}
            title="Open sidebar"
            aria-label="Open sidebar"
          >
            <IconMenu2 size={16} stroke={2} aria-hidden="true" />
          </button>
          <button
            className="shrink-0 h-full w-9 cursor-pointer border-r border-b-2 border-neutral-600 bg-neutral-900 text-sm text-neutral-200 transition-colors hover:bg-neutral-800/80"
            onClick={handleOpenVoyageSwitcher}
            title="Open voyage switcher"
            aria-label="Open voyage switcher"
          >
            <IconUfo size={16} stroke={2} aria-hidden="true" />
          </button>
          {previousVoyageId && previousVoyageId !== currentSessionId && (
            <button
              className="shrink-0 h-full cursor-pointer border-r border-b-2 border-neutral-600 bg-neutral-900 px-3 text-xs text-neutral-200 transition-colors hover:bg-neutral-800/80"
              onClick={handleBackToPreviousVoyage}
              title="Back to previous voyage"
              aria-label="Back to previous voyage"
            >
              ← Voyage
            </button>
          )}
          <div className="flex-1 min-w-0 overflow-x-auto scrollbar-hide">
            <div className="flex h-full items-stretch whitespace-nowrap">
              {mobileSessionTabGroups.map(({ entry, space, tabGroup }) => {
                const isActive = entry.id === session.activeVoyageEntryId;

                return (
                  <div
                    key={entry.id}
                    draggable
                    onDragStart={(event) =>
                      handleSessionTabGroupDragStart(event, entry.id)
                    }
                    onDragOver={handleDragOver}
                    onDrop={(event) =>
                      handleSessionTabGroupDrop(event, entry.id)
                    }
                    className={`shrink-0 inline-flex h-full cursor-pointer select-none items-center border-r border-neutral-600 border-b-2 text-xs text-neutral-200 transition-colors ${
                      isActive
                        ? 'border-b-primary-400 bg-neutral-900'
                        : 'bg-neutral-900 hover:bg-neutral-800/80'
                    }`}
                    title={`${space.name} / ${tabGroup.label}`}
                  >
                    <button
                      className="inline-flex h-full cursor-pointer items-center gap-2 px-3 text-inherit"
                      onClick={() => {
                        handleToggleSessionTabGroup(entry.id, space.id, tabGroup.id);
                      }}
                      onContextMenu={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        setDesktopTabMenuTarget({
                          voyageEntryId: entry.id,
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
                className="shrink-0 h-full cursor-pointer border-r border-b-2 border-neutral-600 bg-neutral-900 px-3 text-xs text-neutral-200 transition-colors hover:bg-neutral-800/80"
                onClick={() => setVoyagePlusMenuOpen((value) => !value)}
                data-voyage-plus-trigger="true"
                title="Embark craft in voyage"
                aria-label="Embark craft in voyage"
              >
                +
              </button>
            </div>
          </div>
        </div>
        {expandedSessionTabGroup && (
          <div className="hidden md:flex h-9 border-b border-neutral-600 bg-neutral-900 items-stretch shrink-0 [&_button]:cursor-pointer">
            <div className="flex-1 min-w-0 overflow-x-auto scrollbar-hide">
              <div className="flex h-full items-stretch whitespace-nowrap">
                {expandedSessionItems.map((item) => (
                  <button
                    key={item.id}
                    className={`shrink-0 inline-flex h-full cursor-pointer items-center border-r border-b-2 border-neutral-600 px-3 text-xs text-neutral-200 transition-colors ${
                      item.isActive
                        ? 'border-b-primary-400 bg-neutral-900'
                        : 'bg-neutral-900 hover:bg-neutral-800/80'
                    }`}
                    onClick={() =>
                      handleSelectExpandedSessionItem(
                        expandedSessionTabGroup.space.id,
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
          onResumeSession={switchToVoyage}
          onRenameSession={sessionActions.renameSession}
          onDeleteSession={sessionActions.deleteSession}
          onStartNewSession={() => {
            startNewVoyage();
          }}
          onNavigateToTabGroup={handleNavigateToWorkspaceTabGroup}
        />
        {expandedSessionTabGroup && (
          <div
            className="md:hidden fixed inset-x-0 z-[64] border-y border-neutral-700 bg-neutral-900/95"
            style={{
              bottom: 'var(--mobile-footer-height)',
              maxHeight: 'min(50vh, calc(100dvh - 8rem - env(safe-area-inset-bottom)))',
            }}
          >
            <div className="max-h-full overflow-y-auto flex flex-col gap-px bg-neutral-700 px-2 py-2">
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
                      expandedSessionTabGroup.space.id,
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

        <div
          className="md:hidden fixed inset-x-0 bottom-0 z-[65] border-t border-neutral-700 bg-neutral-900 flex items-stretch shrink-0"
          style={{ height: 'var(--mobile-footer-height)', paddingBottom: 'env(safe-area-inset-bottom)', boxSizing: 'border-box' }}
        >
          <button
            className="h-full px-3 text-neutral-200 hover:bg-neutral-800 transition-colors flex items-center justify-center shrink-0 border-r border-neutral-700"
            onClick={() => setIsSidebarOpen(true)}
            title="Open sidebar"
            aria-label="Open sidebar"
          >
            ☰
          </button>
          <button
            className="h-full px-3 text-neutral-200 hover:bg-neutral-800 transition-colors flex items-center justify-center shrink-0 border-r border-neutral-700"
            onClick={handleOpenVoyageSwitcher}
            title="Open voyage switcher"
            aria-label="Open voyage switcher"
          >
            <IconUfo size={18} stroke={2} aria-hidden="true" />
          </button>
          {previousVoyageId && previousVoyageId !== currentSessionId && (
            <button
              className="h-full px-3 text-neutral-200 hover:bg-neutral-800 transition-colors flex items-center justify-center shrink-0 border-r border-neutral-700"
              onClick={handleBackToPreviousVoyage}
              title="Back to previous voyage"
              aria-label="Back to previous voyage"
            >
              ←
            </button>
          )}
          <div className="flex-1 min-w-0 overflow-x-auto scrollbar-hide">
            <div className="flex h-full items-stretch whitespace-nowrap">
              {mobileSessionTabGroups.length > 0 ? (
                <>
                {mobileSessionTabGroups.map(({ entry, space, tabGroup }) => {
                  const isActive = entry.id === session.activeVoyageEntryId;

                  return (
                    <button
                      key={entry.id}
                      className={`shrink-0 inline-flex h-full select-none items-center gap-2 border-r border-neutral-700 px-3 text-xs text-neutral-200 transition-colors ${
                        isActive
                          ? 'bg-neutral-800'
                          : 'bg-neutral-900 hover:bg-neutral-800/80'
                      }`}
                      style={{ touchAction: 'manipulation' }}
                      onClick={() => {
                        if (suppressMobileTabClickRef.current) {
                          suppressMobileTabClickRef.current = false;
                          return;
                        }
                        handleToggleSessionTabGroup(entry.id, space.id, tabGroup.id);
                      }}
                      onContextMenu={(event) => {
                        event.preventDefault();
                        openMobileTabMenu(entry.id, space.id, tabGroup);
                      }}
                      onPointerDown={(event) =>
                        handleMobileTabPointerDown(event, entry.id, space.id, tabGroup)
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
                      <span>
                        {getMobileTabGroupLabel(tabGroup)}
                      </span>
                    </button>
                  );
                })}
                <button
                  className="shrink-0 h-full border-r border-neutral-700 bg-neutral-900 px-3 text-xs text-neutral-200 transition-colors hover:bg-neutral-800/80"
                  onClick={() => setVoyagePlusMenuOpen((value) => !value)}
                  data-voyage-plus-trigger="true"
                  title="Embark craft in voyage"
                  aria-label="Embark craft in voyage"
                >
                  +
                </button>
                </>
              ) : (
                <>
                  <div className="h-full inline-flex items-center px-3 text-xs text-neutral-500 border-r border-neutral-700">
                    {activeTabGroup?.label || 'No craft'}
                  </div>
                  <button
                    className="shrink-0 h-full border-r border-neutral-700 bg-neutral-900 px-3 text-xs text-neutral-200 transition-colors hover:bg-neutral-800/80"
                    onClick={() => setVoyagePlusMenuOpen((value) => !value)}
                    data-voyage-plus-trigger="true"
                    title="Embark craft in voyage"
                    aria-label="Embark craft in voyage"
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


      {voyageSwitcherOpen && (
        <div
          className="fixed inset-0 z-[94] flex items-center justify-center bg-black/60 p-4"
          onClick={handleVoyageSwitcherBackdropClick}
        >
          <div className="flex max-h-[85dvh] w-full max-w-lg flex-col rounded-xl border border-neutral-700 bg-neutral-900 p-5 shadow-2xl">
            <div className="text-base font-semibold text-neutral-100">
              Switch Voyage
            </div>
            <p className="mt-2 text-sm text-neutral-400">
              Choose a voyage, sorted by recent activity.
            </p>

            <div className="mt-4 min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
              {sortedVoyageSwitcherSessions.length > 0 ? (
                sortedVoyageSwitcherSessions.map((savedSession) => {
                  const isCurrent = savedSession.id === currentSessionId;
                  return (
                    <button
                      key={savedSession.id}
                      className={`block w-full rounded-md border px-3 py-2 text-left text-sm transition-colors ${
                        isCurrent
                          ? 'border-blue-400/70 bg-blue-500/20 text-neutral-50 hover:bg-blue-500/30'
                          : 'border-neutral-700 bg-neutral-800 text-neutral-200 hover:bg-neutral-700'
                      }`}
                      onClick={() => handleVoyageSwitcherSelect(savedSession.id)}
                    >
                      <span className="flex items-center justify-between gap-3">
                        <span className="font-medium">{getVoyageDisplayName(savedSession)}</span>
                        {isCurrent && (
                          <span className="shrink-0 text-xs text-blue-100">Current</span>
                        )}
                      </span>
                      <span className="mt-1 block text-xs text-neutral-500">
                        Updated {new Date(savedSession.updatedAt).toLocaleString()}
                      </span>
                    </button>
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
                className="rounded-md border border-blue-400/70 bg-blue-500/20 px-3 py-2 text-sm text-neutral-50 transition-colors hover:bg-blue-500/30"
                onClick={() => {
                  startNewVoyage();
                  setVoyageSwitcherOpen(false);
                }}
              >
                New Voyage
              </button>
              <button
                className="rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-300 transition-colors hover:bg-neutral-800"
                onClick={() => setVoyageSwitcherOpen(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {voyagePlusMenuOpen && (
        <div
          ref={voyagePlusMenuRef}
          className="fixed bottom-14 right-3 z-[92] w-44 rounded-lg border border-neutral-700 bg-neutral-900 py-1 shadow-2xl md:bottom-auto md:right-4 md:top-11"
        >
          <button
            className="block w-full px-4 py-2 text-left text-sm text-neutral-200 transition-colors hover:bg-neutral-800"
            onClick={() => {
              setVoyagePlusMenuOpen(false);
              void handleOpenCreateWorkspaceTab();
            }}
          >
            New Task
          </button>
          <button
            className="block w-full px-4 py-2 text-left text-sm text-neutral-200 transition-colors hover:bg-neutral-800"
            onClick={() => openVoyageActionPrompt('open-craft')}
          >
            Open Craft
          </button>
          <button
            className="block w-full px-4 py-2 text-left text-sm text-neutral-200 transition-colors hover:bg-neutral-800"
            onClick={() => {
              openVoyageActionPrompt('vscode-view');
            }}
          >
            New VSCode View
          </button>
        </div>
      )}

      {vscodeViewPromptOpen && (
        <div
          className="fixed inset-0 z-[94] flex items-center justify-center bg-black/60 p-4"
          onClick={handleVSCodeViewBackdropClick}
        >
          <div className="w-full max-w-md rounded-xl border border-neutral-700 bg-neutral-900 p-5 shadow-2xl">
            <div className="text-base font-semibold text-neutral-100">
              New VSCode View
            </div>
            <p className="mt-2 text-sm text-neutral-400">
              Choose where to open VSCode.
            </p>

            <div className="mt-4 max-h-[45vh] space-y-2 overflow-y-auto pr-1">
              <button
                className="block w-full rounded-md border border-blue-400/70 bg-blue-500/20 px-3 py-2 text-left text-sm text-neutral-50 transition-colors hover:bg-blue-500/30"
                onClick={() => {
                  void handleAddVSCodeView('repos');
                }}
              >
                ~/repos
              </button>
              <button
                className="block w-full rounded-md border border-neutral-700 bg-neutral-800 px-3 py-2 text-left text-sm text-neutral-200 transition-colors hover:bg-neutral-700"
                onClick={() => {
                  void handleAddVSCodeView('worktree-parent');
                }}
              >
                Workspace parent directory
              </button>
            </div>

            <div className="mt-5 flex justify-end">
              <button
                className="rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-300 transition-colors hover:bg-neutral-800"
                onClick={() => {
                  setVSCodeViewPromptOpen(false);
                  setPendingVSCodeViewSessionId(null);
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {voyageActionPrompt && (
        <div
          className="fixed inset-0 z-[94] flex items-center justify-center bg-black/60 p-4"
          onClick={handleVoyageActionBackdropClick}
        >
          <div className="flex max-h-[85dvh] w-full max-w-lg flex-col rounded-xl border border-neutral-700 bg-neutral-900 p-5 shadow-2xl">
            <div className="text-base font-semibold text-neutral-100">
              {voyageActionPrompt === 'new-task'
                ? 'New Task'
                : voyageActionPrompt === 'open-craft'
                  ? 'Open Craft'
                  : 'New VSCode View'}
            </div>
            <p className="mt-2 text-sm text-neutral-400">
              Choose which Voyage should receive this item.
            </p>

            <div className="mt-4 min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
              <button
                className="block w-full rounded-md border border-blue-400/70 bg-blue-500/20 px-3 py-2 text-left text-sm text-neutral-50 transition-colors hover:bg-blue-500/30"
                onClick={() => {
                  void handleVoyageActionDestination(currentSessionId);
                }}
              >
                Current Voyage
                <span className="mt-1 block text-xs text-blue-100/90">
                  {savedSessions.find((entry) => entry.id === currentSessionId)?.name ||
                    savedSessions.find((entry) => entry.id === currentSessionId)?.slug ||
                    'Current voyage'}
                </span>
              </button>

              {savedSessions
                .filter((entry) => entry.id !== currentSessionId)
                .map((entry) => (
                  <button
                    key={entry.id}
                    className="block w-full rounded-md border border-neutral-700 bg-neutral-800 px-3 py-2 text-left text-sm text-neutral-200 transition-colors hover:bg-neutral-700"
                    onClick={() => {
                      void handleVoyageActionDestination(entry.id);
                    }}
                  >
                    {entry.name || entry.slug || 'Untitled voyage'}
                    <span className="mt-1 block text-xs text-neutral-500">
                      Updated {new Date(entry.updatedAt).toLocaleString()}
                    </span>
                  </button>
                ))}
            </div>

            <div className="mt-4 rounded-lg border border-neutral-700 bg-neutral-950/40 p-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
                New Voyage
              </div>
              <input
                value={voyageActionNewName}
                onChange={(event) => setVoyageActionNewName(event.target.value)}
                placeholder="Optional voyage name"
                className="mt-2 w-full rounded-md border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-neutral-100 outline-none placeholder:text-neutral-500"
              />
              <button
                className="mt-2 w-full rounded-md border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-neutral-200 transition-colors hover:bg-neutral-700"
                onClick={() => {
                  void handleVoyageActionNewVoyage();
                }}
              >
                Create New Voyage
              </button>
            </div>

            <div className="mt-5 flex justify-end">
              <button
                className="rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-300 transition-colors hover:bg-neutral-800"
                onClick={closeVoyageActionPrompt}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
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

      {duplicateCraftPrompt && (() => {
        const tabGroup = workspace.tabGroups.find(
          (candidate) => candidate.id === duplicateCraftPrompt.tabGroupId,
        );
        const craftLabel = tabGroup?.label || 'This craft';

        return (
          <div className="fixed inset-0 z-[95] flex items-center justify-center bg-black/60 p-4">
            <div className="w-full max-w-lg rounded-xl border border-neutral-700 bg-neutral-900 p-5 shadow-2xl">
              <div className="text-base font-semibold text-neutral-100">
                {craftLabel} is already embarked
              </div>
              <p className="mt-2 text-sm text-neutral-400">
                Choose whether to switch to an existing craft or embark another
                copy in this voyage.
              </p>

              {duplicateCraftPrompt.currentEntries.length > 0 && (
                <div className="mt-4 space-y-2">
                  <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
                    This voyage
                  </div>
                  {duplicateCraftPrompt.currentEntries.map((entry, index) => (
                    <button
                      key={entry.id}
                      className="block w-full rounded-md border border-neutral-700 bg-neutral-800 px-3 py-2 text-left text-sm text-neutral-200 transition-colors hover:bg-neutral-700"
                      onClick={() => switchToExistingCraftInCurrentVoyage(entry.id)}
                    >
                      Switch to embarked craft {index + 1}
                      {entry.id === session.activeVoyageEntryId ? ' (active)' : ''}
                    </button>
                  ))}
                </div>
              )}

              {duplicateCraftPrompt.otherVoyages.length > 0 && (
                <div className="mt-4 space-y-2">
                  <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
                    Other voyages
                  </div>
                  {duplicateCraftPrompt.otherVoyages.map(({ session: savedSession, entryId }) => (
                    <button
                      key={`${savedSession.id}-${entryId || 'legacy'}`}
                      className="block w-full rounded-md border border-neutral-700 bg-neutral-800 px-3 py-2 text-left text-sm text-neutral-200 transition-colors hover:bg-neutral-700"
                      onClick={() => switchToCraftInOtherVoyage(savedSession.id, entryId)}
                    >
                      Switch to {savedSession.name || savedSession.slug || 'untitled voyage'}
                    </button>
                  ))}
                </div>
              )}

              <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <button
                  className="rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-300 transition-colors hover:bg-neutral-800"
                  onClick={closeDuplicateCraftPrompt}
                >
                  Cancel
                </button>
                {duplicateCraftPrompt.currentEntries.length === 0 && (
                  <button
                    className="rounded-md border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-neutral-200 transition-colors hover:bg-neutral-700"
                    onClick={openCraftInCurrentVoyage}
                  >
                    Open in current Voyage
                  </button>
                )}
                <button
                  className="rounded-md border border-blue-400/70 bg-blue-500/20 px-3 py-2 text-sm text-neutral-50 transition-colors hover:bg-blue-500/30"
                  onClick={openCraftInNewVoyage}
                >
                  Open in new Voyage
                </button>
              </div>
            </div>
          </div>
        );
      })()}

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
                handleRemoveVoyageEntryFromSession(
                  desktopTabMenuTarget.voyageEntryId,
                );
              }}
            >
              Remove From Voyage
            </button>
            <div className="my-1 border-t border-neutral-700" />
            <button
              className="block w-full px-4 py-2 text-left text-sm text-red-300 transition-colors hover:bg-neutral-800"
              onClick={() => {
                setDesktopTabMenuTarget(null);
                if (
                  confirm(
                    space?.tabGroupIds.length === 1
                      ? `Close "${tabGroup?.label || 'this craft'}" everywhere? Because it's the last craft in this space, a replacement craft will be created automatically.`
                      : `Close "${tabGroup?.label || 'this craft'}" everywhere? This deletes the craft, not just from the current voyage.`,
                  )
                ) {
                  void handleCloseTabGroup(
                    desktopTabMenuTarget.spaceId,
                    desktopTabMenuTarget.tabGroupId,
                  );
                }
              }}
            >
              Close Craft Everywhere
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
                Edit Mobile Craft
              </div>
              <div className="text-xs text-neutral-500 mt-1">
                Long press opens this menu. Tap still switches craft. Closing here closes the whole craft.
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
                  className="mt-1 w-full rounded-md border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-400"
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
                  className="mt-1 w-full rounded-md border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-400"
                />
                <div className="mt-2 flex flex-wrap gap-2">
                  {MOBILE_TAB_EMOJI_CHOICES.map((emoji) => (
                    <button
                      key={emoji}
                      type="button"
                      className={`rounded-md border px-2 py-1 text-base ${
                        mobileTabDraftEmoji === emoji
                          ? 'border-blue-400 bg-blue-500/25'
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
                className="rounded-md border border-blue-400/70 bg-blue-500/20 px-3 py-2 text-sm text-neutral-50"
                onClick={handleSaveMobileTabDisplay}
              >
                Save
              </button>
              <button
                className="rounded-md border border-amber-500/40 bg-amber-500/15 px-3 py-2 text-sm text-amber-300"
                onClick={() => {
                  handleRemoveVoyageEntryFromSession(mobileTabMenuTarget.voyageEntryId);
                }}
              >
                Remove From Voyage
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
                        ? `Close "${mobileTabMenuTabGroup.label}" everywhere? Because it's the last craft in this space, a replacement craft will be created automatically.`
                        : `Close "${mobileTabMenuTabGroup.label}" everywhere? This deletes the craft, not just from the current voyage.`,
                    )
                  ) {
                    void handleCloseTabGroup(spaceId, tabGroupId);
                  }
                }}
              >
                Close Craft
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
  const custom = tabGroup.mobileLabel?.trim();
  if (custom) return custom;

  const compact = tabGroup.label.trim();
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
