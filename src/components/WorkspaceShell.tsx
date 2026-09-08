import React, { useState, useEffect, useRef, useMemo } from "react";
import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { Sidebar } from "./Sidebar";
import { WorkspaceContentView } from "./WorkspaceContentView";
import {
  DuplicateCraftPromptDialog,
  ExpandedCraftStrip,
  MobileCraftMenu,
  MobileCraftStrip,
  NewVoyagePromptDialog,
  PendingOpenCraftContent,
  VoyageActionsMenu,
  VoyageBarView,
  VoyageSwitcherDialog,
} from "./WorkspaceShellScenes";
import { hasKnownIframeMessageSource } from "./IframePanel";
import { hasSameBaseOrigin } from "../lib/originTrust";
import { AddTabModal } from "./AddTabModal";
import {
  AddVKWorkspaceModal,
  prefetchVKWorkspaceSearchResults,
} from "./dialogs/AddVKWorkspaceModal";
import type {
  WorkspaceState,
  TabGroup,
  SavedWorkspaceSession,
  VoyageEntry,
} from "../types";
import type {
  NewSessionInitialSelection,
  SessionWorkspaceNav,
} from "../sessionState";
import type { PluginRegistryState } from "../modules/plugins/vibe-dashboard/types";
import type { ResolvedWorkspaceComposition } from "../modules/plugins/vibe-dashboard/workspace-composition";
import { resolveWorkspaceFactoryComposition } from "../modules/plugins/vibe-dashboard/workspace-composition";
import {
  createEffectiveWorkspaceWithCraftSurfaces,
  filterEphemeralCraftSurfaceActiveItems,
  tabGroupHasEphemeralCraftSurfaceTab,
} from "../modules/plugins/vibe-dashboard/craft-surfaces";
import { getVoyageEntryIdAfterClosingCraft } from "../lib/voyageFallback";

const MOBILE_TAB_EMOJI_CHOICES = [
  "🚀",
  "🧠",
  "💻",
  "🛠️",
  "📚",
  "🔬",
  "🧪",
  "🎯",
  "🗂️",
  "🌟",
  "⚡",
  "🛰️",
];
const VOYAGE_SWITCH_THROTTLE_MS = 1000;

function isReservedVoyageName(name: string): boolean {
  return name.trim().toLowerCase() === "home";
}

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
  createCreateWorkspaceCraft: (args: {
    label?: string;
  }) => Promise<
    { spaceId: string; tabGroupId: string; tabId: string } | undefined
  >;
  createCreateWorkspaceSavedSession: (args: {
    name: string;
    label?: string;
  }) => Promise<SavedWorkspaceSession | undefined>;
  createSavedSessionForSelection: (args: {
    name: string;
    spaceId: string;
    tabGroupId: string;
    tabId?: string;
  }) => Promise<SavedWorkspaceSession | undefined>;
  createSavedSessionFromVoyageEntry: (args: {
    name: string;
    sourceSessionId?: string;
    voyageEntry: VoyageEntry;
    activeItemId?: string;
  }) => Promise<
    | {
        sourceSession?: SavedWorkspaceSession;
        targetSession: SavedWorkspaceSession;
      }
    | undefined
  >;
  addSelectionToSavedSession: (args: {
    sessionId: string;
    spaceId: string;
    tabGroupId: string;
    voyageEntryId?: string;
    tabId?: string;
    viewIds?: string[];
  }) => Promise<SavedWorkspaceSession | undefined>;
  activateSavedVoyageEntry: (args: {
    sessionId: string;
    voyageEntryId: string;
  }) => Promise<SavedWorkspaceSession | undefined>;
  removeVoyageEntryFromSavedSession: (args: {
    sessionId: string;
    voyageEntryId: string;
  }) => Promise<SavedWorkspaceSession | undefined>;
  reorderSavedVoyageEntries: (args: {
    sessionId: string;
    sourceEntryId: string;
    targetEntryId: string;
  }) => Promise<SavedWorkspaceSession | undefined>;
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
    composition: ResolvedWorkspaceComposition;
  }) => Promise<
    { tabGroupId: string; pairId?: string; agentTabId: string } | undefined
  >;
  openFormsForBead: (args: {
    tabGroupId: string;
    agentTabId: string;
    beadId: string;
  }) => Promise<{ tabGroupId: string; formsTabId: string } | undefined>;
  openBeadFormsSplit?: (args: {
    tabGroupId: string;
    agentTabId: string;
    beadId: string;
    dir: string;
    formId?: string;
    returnTo?: string;
  }) => Promise<{ tabGroupId: string; pairId: string; formsTabId: string } | undefined>;
  createSavedSessionForVKWorkspace: (args: {
    voyageName: string;
    taskAttemptId: string;
    workspaceName: string;
    containerRef: string;
    activeSpaceId: string;
    composition: ResolvedWorkspaceComposition;
  }) => Promise<
    | {
        savedSession: SavedWorkspaceSession;
        selection: VoyageCraftSelection;
      }
    | undefined
  >;
  openVKWorkspaceInSavedSession: (args: {
    sessionId: string;
    taskAttemptId: string;
    name: string;
    containerRef: string;
    activeSpaceId: string;
    composition: ResolvedWorkspaceComposition;
  }) => Promise<
    | {
        savedSession: SavedWorkspaceSession;
        selection: VoyageCraftSelection;
      }
    | undefined
  >;
  updateTabUrl: (args: {
    tabGroupId: string;
    tabId: string;
    newUrl: string;
  }) => void;
  touchTabGroup: (args: { tabGroupId: string }) => void;
  toggleStarTabGroup: (args: { tabGroupId: string }) => void;
  reorderSpaces: (args: { sourceId: string; targetId: string }) => void;
  moveVoyageEntryBetweenSavedSessions: (args: {
    sourceSessionId: string;
    targetSessionId: string;
    voyageEntryId: string;
    activeItemId?: string;
  }) => Promise<
    | {
        sourceSession: SavedWorkspaceSession;
        targetSession: SavedWorkspaceSession;
      }
    | undefined
  >;
};

export type SessionActions = {
  selectSpace: (spaceId: string) => void;
  selectSessionTabGroup: (spaceId: string, tabGroupId: string) => void;
  selectSessionTab: (
    spaceId: string,
    tabGroupId: string,
    tabId: string,
  ) => void;
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
  activateSavedSession: (session: SavedWorkspaceSession) => void;
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
  pluginRegistry: PluginRegistryState;
  savedSessions: SavedWorkspaceSession[];
  currentSessionId: string;
}

function getDefaultVKWorkspaceFactoryKey(
  pluginRegistry: PluginRegistryState,
): string {
  const factories = Object.values(pluginRegistry.tabGroupFactories)
    .filter((factory) => factory.launchMode === "vk-workspace")
    .sort(
      (left, right) =>
        (left.order ?? 0) - (right.order ?? 0) ||
        left.key.localeCompare(right.key),
    );
  const factory = factories[0];
  if (!factory) throw new Error("No VK workspace factory is registered");
  return factory.key;
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

type MoveVoyageEntryPrompt = {
  voyageEntryId: string;
  tabGroupId: string;
  activeItemId?: string;
};

type VoyageCraftSelection = Required<
  Pick<NewSessionInitialSelection, "spaceId" | "tabGroupId">
> &
  Pick<NewSessionInitialSelection, "tabId">;

type OpenCraftMutationInput =
  | {
      kind: "add";
      workspaceId: string;
      name: string;
      containerRef: string;
      spaceId?: string;
      factoryKey?: string;
    }
  | {
      kind: "navigate";
      workspaceId: string;
      name: string;
      spaceId: string;
      tabGroupId: string;
    };

type PendingOpenCraftTab = {
  operationId: string;
  label: string;
  status: "pending" | "error";
  errorMessage?: string;
  request: OpenCraftMutationInput;
};

type PendingWorkspaceSelection =
  | {
      kind: "current";
      originSessionId: string;
      selection: VoyageCraftSelection;
    }
  | {
      kind: "saved";
      originSessionId: string;
      savedSession: SavedWorkspaceSession;
      selection: VoyageCraftSelection;
    };

type OpenCraftMutationContext = {
  operationId: string;
  originSessionId: string;
};

export function WorkspaceShell({
  workspace,
  session,
  actions,
  sessionActions,
  pluginRegistry,
  savedSessions,
  currentSessionId,
}: WorkspaceShellProps) {
  const navigate = useNavigate();
  const [addTabModalOpen, setAddTabModalOpen] = useState(false);
  const [workspaceSearchOpen, setWorkspaceSearchOpen] = useState(false);
  const [workspaceSearchMode, setWorkspaceSearchMode] = useState<
    "general" | "session-add"
  >("general");
  const [addTabTargetGroupId, setAddTabTargetGroupId] = useState<string>("");
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);
  const [isDesktopVoyageBarHidden, setIsDesktopVoyageBarHidden] =
    useState(false);
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
  const [newVoyagePromptOpen, setNewVoyagePromptOpen] = useState(false);
  const [newVoyageName, setNewVoyageName] = useState("");
  const [pendingOpenCraftSessionId, setPendingOpenCraftSessionId] = useState<
    string | null
  >(null);
  const [pendingNewVoyageCraftName, setPendingNewVoyageCraftName] = useState<
    string | null
  >(null);
  const [pendingWorkspaceSelection, setPendingWorkspaceSelection] =
    useState<PendingWorkspaceSelection | null>(null);
  const [pendingOpenCraftTab, setPendingOpenCraftTab] =
    useState<PendingOpenCraftTab | null>(null);
  const currentSessionIdRef = useRef(currentSessionId);
  currentSessionIdRef.current = currentSessionId;
  const pendingOpenCraftOperationIdRef = useRef<string | null>(null);
  const effectiveWorkspace = useMemo(
    () =>
      createEffectiveWorkspaceWithCraftSurfaces({
        workspace,
        craftSurfaces: Object.values(pluginRegistry.craftSurfaces),
        origin: typeof window === "undefined" ? "" : window.location.origin,
      }),
    [pluginRegistry.craftSurfaces, workspace],
  );

  const openCraftMutation = useMutation<
    void,
    Error,
    OpenCraftMutationInput,
    OpenCraftMutationContext
  >({
    mutationFn: async (request) => {
      if (request.kind === "add") {
        await performWorkspaceSearchAdd(
          request.workspaceId,
          request.name,
          request.containerRef,
          request.spaceId,
          request.factoryKey,
        );
        return;
      }

      await performNavigateToWorkspaceTabGroup(
        request.spaceId,
        request.tabGroupId,
      );
    },
    onMutate: (request) => {
      const originSessionId = currentSessionIdRef.current;
      const operationId = getOpenCraftOperationId(originSessionId, request);
      pendingOpenCraftOperationIdRef.current = operationId;
      setPendingOpenCraftTab({
        operationId,
        label: request.name,
        status: "pending",
        request,
      });
      return { operationId, originSessionId };
    },
    onError: (error, request, context) => {
      if (
        context &&
        !openCraftCompletionStillOwnsNavigation(context.originSessionId)
      ) {
        if (pendingOpenCraftOperationIdRef.current === context.operationId) {
          clearCompletedOpenCraftWithoutNavigation();
        }
        return;
      }

      const operationId =
        context?.operationId ||
        getOpenCraftOperationId(currentSessionIdRef.current, request);
      pendingOpenCraftOperationIdRef.current = operationId;
      setPendingOpenCraftTab({
        operationId,
        label: request.name,
        status: "error",
        errorMessage: getErrorMessage(error),
        request,
      });
    },
  });
  const [voyagePlusMenuOpen, setVoyagePlusMenuOpen] = useState(false);
  const [voyagePlusMenuPosition, setVoyagePlusMenuPosition] = useState<{
    left: number;
    top: number;
  } | null>(null);
  const [voyageSwitcherOpen, setVoyageSwitcherOpen] = useState(false);
  const [voyageSwitcherRenameSessionId, setVoyageSwitcherRenameSessionId] =
    useState<string | null>(null);
  const [voyageSwitcherRenameDraft, setVoyageSwitcherRenameDraft] =
    useState("");
  const [moveVoyageEntryPrompt, setMoveVoyageEntryPrompt] =
    useState<MoveVoyageEntryPrompt | null>(null);
  const [mobileTabDraftLabel, setMobileTabDraftLabel] = useState("");
  const [mobileTabDraftEmoji, setMobileTabDraftEmoji] = useState("");
  const dragGroupRef = useRef<string | null>(null);
  const dragSessionTabGroupRef = useRef<string | null>(null);
  const sidebarRef = useRef<HTMLDivElement | null>(null);
  const voyagePlusMenuRef = useRef<HTMLDivElement | null>(null);
  const voyageBarRevealTimerRef = useRef<number | null>(null);
  const lastVoyageSwitchAtRef = useRef(0);
  const longPressTimerRef = useRef<number | null>(null);
  const longPressStartedAtRef = useRef<{ x: number; y: number } | null>(null);
  const suppressMobileTabClickRef = useRef(false);

  const LONG_PRESS_MS = 450;
  const LONG_PRESS_MOVE_TOLERANCE_PX = 10;
  const VOYAGE_PLUS_MENU_WIDTH = 176;
  const VOYAGE_PLUS_MENU_HEIGHT = 132;

  // --- Drag-and-drop for crafts ---
  const handleDragStart = (e: React.DragEvent, tabGroupId: string) => {
    dragGroupRef.current = tabGroupId;
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
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
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", voyageEntryId);
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
    sessionActions.resumeSession(sessionId, voyageEntryId);
  };

  const openCraftCompletionStillOwnsNavigation = (originSessionId: string) =>
    currentSessionIdRef.current === originSessionId;

  const clearCompletedOpenCraftWithoutNavigation = () => {
    pendingOpenCraftOperationIdRef.current = null;
    setPendingWorkspaceSelection(null);
    setPendingOpenCraftTab(null);
    setPendingOpenCraftSessionId(null);
    setPendingNewVoyageCraftName(null);
    setWorkspaceSearchMode("general");
  };

  const createAndActivateSavedVoyage = async (
    name: string,
    initialSelection: VoyageCraftSelection,
    originSessionId = currentSessionId,
  ) => {
    const trimmedName = name.trim();
    if (!trimmedName || isReservedVoyageName(trimmedName)) return undefined;

    const savedSession = await actions.createSavedSessionForSelection({
      name: trimmedName,
      spaceId: initialSelection.spaceId,
      tabGroupId: initialSelection.tabGroupId,
      ...(initialSelection.tabId ? { tabId: initialSelection.tabId } : {}),
    });
    if (!savedSession) return undefined;

    activateSavedSessionWhenWorkspaceReady(
      savedSession,
      initialSelection,
      originSessionId,
    );
    return savedSession;
  };

  const addAndActivateSelectionInSavedVoyage = async (
    sessionId: string,
    selection: VoyageCraftSelection,
    originSessionId = currentSessionId,
  ) => {
    const savedSession = await actions.addSelectionToSavedSession({
      sessionId,
      spaceId: selection.spaceId,
      tabGroupId: selection.tabGroupId,
      ...(selection.tabId ? { tabId: selection.tabId } : {}),
    });
    if (!savedSession) return undefined;

    activateSavedSessionWhenWorkspaceReady(
      savedSession,
      selection,
      originSessionId,
    );
    return savedSession;
  };

  const addOrSelectCraftInCurrentVoyage = async (
    selection: VoyageCraftSelection,
    originSessionId = currentSessionId,
  ): Promise<boolean> => {
    if (!openCraftCompletionStillOwnsNavigation(originSessionId)) {
      clearCompletedOpenCraftWithoutNavigation();
      return true;
    }

    const existingEntry = session.voyageEntries.find(
      (entry) => entry.tabGroupId === selection.tabGroupId,
    );
    if (existingEntry) {
      const currentSavedSession = savedSessions.find(
        (entry) => entry.id === currentSessionId,
      );
      if (currentSavedSession) {
        sessionActions.selectVoyageEntry(existingEntry.id);
        void actions.activateSavedVoyageEntry({
          sessionId: currentSavedSession.id,
          voyageEntryId: existingEntry.id,
        });
        setPendingOpenCraftTab(null);
        return true;
      }

      sessionActions.selectVoyageEntry(existingEntry.id);
      setPendingOpenCraftTab(null);
      return true;
    }

    const currentSavedSession = savedSessions.find(
      (entry) => entry.id === currentSessionId,
    );
    if (currentSavedSession) {
      const savedSession = await actions.addSelectionToSavedSession({
        sessionId: currentSavedSession.id,
        spaceId: selection.spaceId,
        tabGroupId: selection.tabGroupId,
        ...(selection.tabId ? { tabId: selection.tabId } : {}),
      });
      if (savedSession) {
        activateSavedSessionWhenWorkspaceReady(
          savedSession,
          selection,
          originSessionId,
        );
        return true;
      }
    }

    selectCurrentVoyageWhenWorkspaceReady(selection, originSessionId);
    return true;
  };

  const isWorkspaceSelectionReady = (selection: VoyageCraftSelection) => {
    const space = effectiveWorkspace.spaces.find(
      (entry) => entry.id === selection.spaceId,
    );
    if (!space?.tabGroupIds.includes(selection.tabGroupId)) return false;

    if (!selection.tabId) return true;

    return Boolean(
      effectiveWorkspace.tabGroups
        .find((entry) => entry.id === selection.tabGroupId)
        ?.tabs.some((tab) => tab.id === selection.tabId),
    );
  };

  const applyCurrentVoyageSelection = (
    selection: VoyageCraftSelection,
    originSessionId = currentSessionId,
  ) => {
    if (!openCraftCompletionStillOwnsNavigation(originSessionId)) {
      clearCompletedOpenCraftWithoutNavigation();
      return;
    }

    if (selection.tabId) {
      sessionActions.selectSessionTab(
        selection.spaceId,
        selection.tabGroupId,
        selection.tabId,
      );
    } else {
      sessionActions.addTabGroupToSession(selection.tabGroupId, {
        select: true,
      });
      sessionActions.selectSessionTabGroup(
        selection.spaceId,
        selection.tabGroupId,
      );
    }
    setPendingOpenCraftTab(null);
  };

  const selectCurrentVoyageWhenWorkspaceReady = (
    selection: VoyageCraftSelection,
    originSessionId = currentSessionId,
  ) => {
    if (isWorkspaceSelectionReady(selection)) {
      applyCurrentVoyageSelection(selection, originSessionId);
      return;
    }

    setPendingWorkspaceSelection({
      kind: "current",
      originSessionId,
      selection,
    });
  };

  const activateSavedSessionWhenWorkspaceReady = (
    savedSession: SavedWorkspaceSession,
    selection: VoyageCraftSelection,
    originSessionId = currentSessionId,
  ) => {
    if (!openCraftCompletionStillOwnsNavigation(originSessionId)) {
      clearCompletedOpenCraftWithoutNavigation();
      return;
    }

    if (isWorkspaceSelectionReady(selection)) {
      sessionActions.activateSavedSession(savedSession);
      setPendingOpenCraftTab(null);
      return;
    }

    setPendingWorkspaceSelection({
      kind: "saved",
      originSessionId,
      savedSession,
      selection,
    });
  };

  const closeTransientOverlays = () => {
    setIsSidebarOpen(false);
    setVoyagePlusMenuOpen(false);
    setDesktopTabMenuTarget(null);
  };

  const clearVoyageBarRevealTimer = () => {
    if (voyageBarRevealTimerRef.current != null) {
      window.clearTimeout(voyageBarRevealTimerRef.current);
      voyageBarRevealTimerRef.current = null;
    }
  };

  const startVoyageBarRevealTimer = () => {
    clearVoyageBarRevealTimer();
    voyageBarRevealTimerRef.current = window.setTimeout(() => {
      setIsDesktopVoyageBarHidden(false);
      voyageBarRevealTimerRef.current = null;
    }, 700);
  };

  const toggleVoyagePlusMenu = (event: React.MouseEvent<HTMLButtonElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const left = Math.max(
      8,
      Math.min(rect.left, window.innerWidth - VOYAGE_PLUS_MENU_WIDTH - 8),
    );
    const opensUp =
      rect.bottom + VOYAGE_PLUS_MENU_HEIGHT + 8 > window.innerHeight;
    const top = opensUp
      ? Math.max(8, rect.top - VOYAGE_PLUS_MENU_HEIGHT - 4)
      : rect.bottom + 4;

    setVoyagePlusMenuPosition({ left, top });
    setVoyagePlusMenuOpen((value) => !value);
  };

  // --- Cmd+W / Cmd+Q exit confirmation ---
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();

      if ((e.metaKey || e.ctrlKey) && key === "s") {
        if (document.activeElement instanceof HTMLIFrameElement) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }
      }

      if (
        (e.metaKey || e.ctrlKey) &&
        key === "k" &&
        !isEditableTarget(e.target)
      ) {
        e.preventDefault();
        e.stopPropagation();
        setAddTabModalOpen(false);
        setPendingOpenCraftSessionId(null);
        setPendingNewVoyageCraftName(null);
        setWorkspaceSearchMode("general");
        setWorkspaceSearchOpen(true);
        setIsSidebarOpen(false);
        return;
      }

      if (key === "escape") {
        setVoyagePlusMenuOpen(false);
        return;
      }

      if (e.ctrlKey && !e.metaKey && !e.altKey && !isEditableTarget(e.target)) {
        if (key === "[" || key === "]") {
          e.preventDefault();
          e.stopPropagation();
          cycleSessionTabGroup(key === "]" ? 1 : -1);
          return;
        }
      }

      if ((e.metaKey || e.ctrlKey) && (key === "w" || key === "q")) {
        e.preventDefault();
        e.stopPropagation();
        if (confirm("Are you sure you want to exit the app?")) {
          window.close();
        }
      }
    };

    window.addEventListener("keydown", handler, { capture: true });
    return () =>
      window.removeEventListener("keydown", handler, { capture: true });
  }, [cycleSessionTabGroup]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const mediaQuery = window.matchMedia("(min-width: 768px)");
    const handleViewportChange = (event: MediaQueryListEvent) => {
      setIsDesktop(event.matches);
      setIsSidebarOpen(false);
    };

    setIsDesktop(mediaQuery.matches);
    mediaQuery.addEventListener("change", handleViewportChange);
    return () => mediaQuery.removeEventListener("change", handleViewportChange);
  }, []);

  useEffect(() => {
    void prefetchVKWorkspaceSearchResults();
  }, []);

  useEffect(() => {
    if (!pendingWorkspaceSelection) return;
    if (!isWorkspaceSelectionReady(pendingWorkspaceSelection.selection)) return;

    if (
      !openCraftCompletionStillOwnsNavigation(
        pendingWorkspaceSelection.originSessionId,
      )
    ) {
      clearCompletedOpenCraftWithoutNavigation();
      return;
    }

    if (pendingWorkspaceSelection.kind === "saved") {
      sessionActions.activateSavedSession(
        pendingWorkspaceSelection.savedSession,
      );
    } else {
      applyCurrentVoyageSelection(
        pendingWorkspaceSelection.selection,
        pendingWorkspaceSelection.originSessionId,
      );
    }

    setPendingWorkspaceSelection(null);
    setPendingOpenCraftTab(null);
  }, [
    pendingWorkspaceSelection,
    sessionActions,
    effectiveWorkspace.spaces,
    effectiveWorkspace.tabGroups,
  ]);

  // --- Add tab modal handler ---
  const openAddTabModal = (tabGroupId: string) => {
    setAddTabTargetGroupId(tabGroupId);
    setAddTabModalOpen(true);
  };

  const handleAddTab = (title: string, url: string) => {
    actions.addTab({ tabGroupId: addTabTargetGroupId, title, url });
  };

  const handleOpenCreateWorkspaceTab = async () => {
    const originSessionId = currentSessionId;
    setVoyagePlusMenuOpen(false);
    setWorkspaceSearchOpen(false);
    setVoyageSwitcherOpen(false);
    closeNewVoyagePrompt();

    const result = await actions.createCreateWorkspaceCraft({
      label: "Create Workspace",
    });
    if (!result) return;

    await addOrSelectCraftInCurrentVoyage(
      {
        spaceId: result.spaceId,
        tabGroupId: result.tabGroupId,
        tabId: result.tabId,
      },
      originSessionId,
    );
  };

  const resolveVKWorkspaceComposition = (args: {
    workspaceId: string;
    name: string;
    containerRef: string;
    factoryKey?: string;
  }) => {
    const resolvedFactoryKey =
      args.factoryKey || getDefaultVKWorkspaceFactoryKey(pluginRegistry);
    const factory = pluginRegistry.tabGroupFactories[resolvedFactoryKey];
    if (!factory) {
      throw new Error(`Unknown VK workspace factory: ${resolvedFactoryKey}`);
    }

    return resolveWorkspaceFactoryComposition({
      factory,
      context: {
        origin: typeof window === "undefined" ? "" : window.location.origin,
        workspaceId: args.workspaceId,
        workspaceName: args.name,
        containerRef: args.containerRef,
      },
    });
  };

  const handleAddVKWorkspace = async (
    workspaceId: string,
    name: string,
    containerRef: string,
    factoryKey: string,
  ) => {
    await runOpenCraftMutation({
      kind: "add",
      workspaceId,
      name,
      containerRef,
      factoryKey,
    });
  };

  const handleAddVKWorkspaceToSpace = async (
    workspaceId: string,
    name: string,
    containerRef: string,
    spaceId: string,
    factoryKey: string = "",
  ) => {
    await runOpenCraftMutation({
      kind: "add",
      workspaceId,
      name,
      containerRef,
      spaceId,
      factoryKey,
    });
  };

  const performWorkspaceSearchAdd = async (
    taskAttemptId: string,
    name: string,
    containerRef: string,
    spaceId?: string,
    factoryKey?: string,
  ) => {
    const originSessionId = currentSessionId;
    const destinationSessionId = pendingOpenCraftSessionId;
    const destinationSession =
      destinationSessionId && destinationSessionId !== currentSessionId
        ? savedSessions.find((entry) => entry.id === destinationSessionId)
        : undefined;
    const destinationSpaceId =
      spaceId || destinationSession?.activeSpaceId || session.activeSpaceId;
    const composition = resolveVKWorkspaceComposition({
      workspaceId: taskAttemptId,
      name,
      containerRef,
      factoryKey,
    });

    if (workspaceSearchMode === "session-add") {
      if (pendingNewVoyageCraftName) {
        const result = await actions.createSavedSessionForVKWorkspace({
          voyageName: pendingNewVoyageCraftName,
          taskAttemptId,
          workspaceName: name,
          containerRef,
          activeSpaceId: destinationSpaceId,
          composition,
        });
        if (!result) {
          throw new Error(`Could not create voyage for ${name || "craft"}.`);
        }
        activateSavedSessionWhenWorkspaceReady(
          result.savedSession,
          result.selection,
          originSessionId,
        );
        setPendingNewVoyageCraftName(null);
      } else if (
        destinationSessionId &&
        destinationSessionId !== currentSessionId
      ) {
        const result = await actions.openVKWorkspaceInSavedSession({
          sessionId: destinationSessionId,
          taskAttemptId,
          name,
          containerRef,
          activeSpaceId: destinationSpaceId,
          composition,
        });
        if (!result) {
          throw new Error(`Could not add ${name || "craft"} to that voyage.`);
        }
        activateSavedSessionWhenWorkspaceReady(
          result.savedSession,
          result.selection,
          originSessionId,
        );
      } else {
        const currentSavedSession = savedSessions.find(
          (entry) => entry.id === currentSessionId,
        );
        if (currentSavedSession) {
          const result = await actions.openVKWorkspaceInSavedSession({
            sessionId: currentSavedSession.id,
            taskAttemptId,
            name,
            containerRef,
            activeSpaceId: destinationSpaceId,
            composition,
          });
          if (!result) {
            throw new Error(
              `Could not select ${name || "craft"} in this voyage.`,
            );
          }
          activateSavedSessionWhenWorkspaceReady(
            result.savedSession,
            result.selection,
            originSessionId,
          );
        } else {
          const result = await actions.addVKWorkspace({
            taskAttemptId,
            name,
            containerRef,
            activeSpaceId: destinationSpaceId,
            composition,
          });
          if (!result) {
            throw new Error(`Could not open ${name || "craft"} in the voyage.`);
          }

          const selected = await addOrSelectCraftInCurrentVoyage(
            {
              spaceId: destinationSpaceId,
              tabGroupId: result.tabGroupId,
              tabId: result.agentTabId,
            },
            originSessionId,
          );
          if (!selected) {
            throw new Error(
              `Could not select ${name || "craft"} in this voyage.`,
            );
          }
        }
      }
      setPendingOpenCraftSessionId(null);
      setWorkspaceSearchMode("general");
      return;
    }

    const currentSavedSession = savedSessions.find(
      (entry) => entry.id === currentSessionId,
    );
    if (currentSavedSession) {
      const result = await actions.openVKWorkspaceInSavedSession({
        sessionId: currentSavedSession.id,
        taskAttemptId,
        name,
        containerRef,
        activeSpaceId: destinationSpaceId,
        composition,
      });
      if (!result) {
        throw new Error(`Could not select ${name || "craft"} in this voyage.`);
      }
      activateSavedSessionWhenWorkspaceReady(
        result.savedSession,
        result.selection,
        originSessionId,
      );
      setPendingOpenCraftSessionId(null);
      setWorkspaceSearchMode("general");
      return;
    }

    const result = await actions.addVKWorkspace({
      taskAttemptId,
      name,
      containerRef,
      activeSpaceId: destinationSpaceId,
      composition,
    });
    if (!result) {
      throw new Error(`Could not open ${name || "craft"}.`);
    }

    if (!openCraftCompletionStillOwnsNavigation(originSessionId)) {
      clearCompletedOpenCraftWithoutNavigation();
      return;
    }

    sessionActions.selectSessionTab(
      destinationSpaceId,
      result.tabGroupId,
      result.agentTabId,
    );
    setPendingOpenCraftTab(null);
  };

  const runOpenCraftMutation = async (request: OpenCraftMutationInput) => {
    const originSessionId = currentSessionIdRef.current;

    try {
      await openCraftMutation.mutateAsync(request);
    } catch (error) {
      if (!openCraftCompletionStillOwnsNavigation(originSessionId)) {
        clearCompletedOpenCraftWithoutNavigation();
        openCraftMutation.reset();
        return;
      }

      throw error;
    }
  };

  const handleWorkspaceSearchAdd = async (
    workspaceId: string,
    name: string,
    containerRef: string,
  ) => {
    await runOpenCraftMutation({
      kind: "add",
      workspaceId,
      name,
      containerRef,
    });
  };

  const handleWorkspaceSearchAddToSpace = async (
    workspaceId: string,
    name: string,
    containerRef: string,
    spaceId: string,
  ) => {
    await runOpenCraftMutation({
      kind: "add",
      workspaceId,
      name,
      containerRef,
      spaceId,
    });
  };

  const performNavigateToWorkspaceTabGroup = async (
    spaceId: string,
    tabGroupId: string,
  ) => {
    const originSessionId = currentSessionId;
    const destinationSessionId = pendingOpenCraftSessionId;
    if (workspaceSearchMode === "session-add" && pendingNewVoyageCraftName) {
      const savedSession = await createAndActivateSavedVoyage(
        pendingNewVoyageCraftName,
        {
          spaceId,
          tabGroupId,
        },
        originSessionId,
      );
      if (!savedSession) {
        throw new Error("Could not create voyage for this craft.");
      }
      setPendingNewVoyageCraftName(null);
      setPendingOpenCraftSessionId(null);
      setWorkspaceSearchMode("general");
      return;
    }

    if (workspaceSearchMode === "session-add" && destinationSessionId) {
      if (destinationSessionId !== currentSessionId) {
        const savedSession = await addAndActivateSelectionInSavedVoyage(
          destinationSessionId,
          {
            spaceId,
            tabGroupId,
          },
          originSessionId,
        );
        if (!savedSession) {
          throw new Error("Could not add this craft to that voyage.");
        }
      } else {
        const selected = await addOrSelectCraftInCurrentVoyage(
          { spaceId, tabGroupId },
          originSessionId,
        );
        if (!selected) {
          throw new Error("Could not select this craft in the current voyage.");
        }
      }
      setPendingOpenCraftSessionId(null);
      setWorkspaceSearchMode("general");
      return;
    }

    if (workspaceSearchMode === "session-add") {
      const selected = await addOrSelectCraftInCurrentVoyage(
        { spaceId, tabGroupId },
        originSessionId,
      );
      if (!selected) {
        throw new Error("Could not select this craft in the current voyage.");
      }
      setPendingOpenCraftSessionId(null);
      setWorkspaceSearchMode("general");
      return;
    }

    const destinationSession =
      destinationSessionId && destinationSessionId !== currentSessionId
        ? savedSessions.find((entry) => entry.id === destinationSessionId)
        : undefined;
    const targetEntries =
      destinationSession?.voyageEntries ||
      (destinationSessionId && destinationSessionId !== currentSessionId
        ? []
        : session.voyageEntries);
    const currentEntries = targetEntries.filter(
      (entry) => entry.tabGroupId === tabGroupId,
    );

    if (destinationSessionId && destinationSessionId !== currentSessionId) {
      const existingEntry = currentEntries[0];
      if (existingEntry) {
        if (openCraftCompletionStillOwnsNavigation(originSessionId)) {
          switchToVoyage(destinationSessionId, existingEntry.id);
        }
        setPendingOpenCraftTab(null);
      } else {
        const savedSession = await addAndActivateSelectionInSavedVoyage(
          destinationSessionId,
          {
            spaceId,
            tabGroupId,
          },
          originSessionId,
        );
        if (!savedSession) {
          throw new Error("Could not add this craft to that voyage.");
        }
      }
      setPendingOpenCraftSessionId(null);
      setWorkspaceSearchMode("general");
      return;
    }

    const otherVoyages = savedSessions
      .filter((savedSession) => savedSession.id !== currentSessionId)
      .map((savedSession) => {
        const matchingEntry = savedSession.voyageEntries?.find(
          (entry) => entry.tabGroupId === tabGroupId,
        );
        const hasLegacyMembership =
          !matchingEntry &&
          savedSession.visitedTabGroupIds.includes(tabGroupId);
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
      setPendingOpenCraftTab(null);
      setDuplicateCraftPrompt({
        spaceId,
        tabGroupId,
        currentEntries,
        otherVoyages,
      });
      return;
    }

    if (!openCraftCompletionStillOwnsNavigation(originSessionId)) {
      clearCompletedOpenCraftWithoutNavigation();
      return;
    }

    sessionActions.selectSessionTabGroup(spaceId, tabGroupId);
    setPendingOpenCraftSessionId(null);
    setWorkspaceSearchMode("general");
    setPendingOpenCraftTab(null);
  };

  const handleNavigateToWorkspaceTabGroup = async (
    spaceId: string,
    tabGroupId: string,
  ) => {
    await performNavigateToWorkspaceTabGroup(spaceId, tabGroupId);
  };

  const handleAddTabModalNavigateToWorkspaceTabGroup = async (
    spaceId: string,
    tabGroupId: string,
    workspaceOption?: { id: string; name: string },
  ) => {
    const tabGroup = workspace.tabGroups.find(
      (entry) => entry.id === tabGroupId,
    );
    await runOpenCraftMutation({
      kind: "navigate",
      workspaceId: workspaceOption?.id || tabGroupId,
      name: workspaceOption?.name || tabGroup?.label || "craft",
      spaceId,
      tabGroupId,
    });
  };

  const handleWorkspaceSearchNavigate = async (
    spaceId: string,
    tabGroupId: string,
    workspaceOption?: { id: string; name: string },
  ) => {
    const tabGroup = workspace.tabGroups.find(
      (entry) => entry.id === tabGroupId,
    );
    await runOpenCraftMutation({
      kind: "navigate",
      workspaceId: workspaceOption?.id || tabGroupId,
      name: workspaceOption?.name || tabGroup?.label || "craft",
      spaceId,
      tabGroupId,
    });
  };

  const closeDuplicateCraftPrompt = () => {
    setDuplicateCraftPrompt(null);
    setPendingOpenCraftSessionId(null);
    setWorkspaceSearchMode("general");
    setWorkspaceSearchOpen(false);
  };

  const openCraftInNewVoyage = () => {
    if (!duplicateCraftPrompt) return;
    const voyageName = window.prompt("Voyage name");
    if (!voyageName?.trim() || isReservedVoyageName(voyageName)) return;
    void createAndActivateSavedVoyage(voyageName, {
      spaceId: duplicateCraftPrompt.spaceId,
      tabGroupId: duplicateCraftPrompt.tabGroupId,
    });
    closeDuplicateCraftPrompt();
  };

  const switchToExistingCraftInCurrentVoyage = (voyageEntryId: string) => {
    sessionActions.selectVoyageEntry(voyageEntryId);
    closeDuplicateCraftPrompt();
  };

  const switchToCraftInOtherVoyage = (
    sessionId: string,
    voyageEntryId?: string,
  ) => {
    if (voyageEntryId) {
      switchToVoyage(sessionId, voyageEntryId);
    } else if (duplicateCraftPrompt) {
      void addAndActivateSelectionInSavedVoyage(sessionId, {
        spaceId: duplicateCraftPrompt.spaceId,
        tabGroupId: duplicateCraftPrompt.tabGroupId,
      });
    }
    closeDuplicateCraftPrompt();
  };

  const openNewVoyagePrompt = () => {
    setVoyagePlusMenuOpen(false);
    setVoyageSwitcherOpen(false);
    setIsSidebarOpen(false);
    setNewVoyagePromptOpen(true);
  };

  const closeNewVoyagePrompt = () => {
    setNewVoyagePromptOpen(false);
    setNewVoyageName("");
  };

  const handleNewVoyagePromptBackdropClick = (
    event: React.MouseEvent<HTMLDivElement>,
  ) => {
    if (event.target === event.currentTarget) {
      closeNewVoyagePrompt();
    }
  };

  const handleCreateNamedVoyage = async (
    nextAction: "new-task" | "open-craft",
  ) => {
    const voyageName = newVoyageName.trim();
    if (!voyageName || isReservedVoyageName(voyageName)) return;

    closeNewVoyagePrompt();

    if (nextAction === "new-task") {
      const savedSession = await actions.createCreateWorkspaceSavedSession({
        name: voyageName,
        label: "Create Workspace",
      });
      if (savedSession) {
        sessionActions.activateSavedSession(savedSession);
      }
      return;
    }

    setPendingOpenCraftSessionId(null);
    setPendingNewVoyageCraftName(voyageName);
    setWorkspaceSearchMode("session-add");
    setWorkspaceSearchOpen(true);
  };

  const handleOpenVoyageSwitcher = () => {
    setVoyageSwitcherOpen(true);
    setVoyagePlusMenuOpen(false);
    setExpandedVoyageEntryId(null);
    setVoyageSwitcherRenameSessionId(null);
    setVoyageSwitcherRenameDraft("");
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
    setVoyageSwitcherRenameSessionId(null);
    setVoyageSwitcherRenameDraft("");
  };

  const handleVoyageSwitcherOpenHome = () => {
    const homeSpace =
      workspace.spaces.find((space) => space.isSystem) ||
      workspace.spaces.find((space) => space.id === "space_home") ||
      workspace.spaces[0];
    const homeTabGroupId = homeSpace?.tabGroupIds.find((tabGroupId) =>
      workspace.tabGroups.some((tabGroup) => tabGroup.id === tabGroupId),
    );

    if (!(homeSpace && homeTabGroupId)) return;

    sessionActions.addTabGroupToSession(homeTabGroupId, { select: true });
    sessionActions.selectSessionTabGroup(homeSpace.id, homeTabGroupId);
    setVoyageSwitcherOpen(false);
    setVoyageSwitcherRenameSessionId(null);
    setVoyageSwitcherRenameDraft("");
  };

  const startVoyageSwitcherRename = (savedSession: SavedWorkspaceSession) => {
    setVoyageSwitcherRenameSessionId(savedSession.id);
    setVoyageSwitcherRenameDraft(getVoyageDisplayName(savedSession));
  };

  const cancelVoyageSwitcherRename = () => {
    setVoyageSwitcherRenameSessionId(null);
    setVoyageSwitcherRenameDraft("");
  };

  const submitVoyageSwitcherRename = (sessionId: string) => {
    const nextName = voyageSwitcherRenameDraft.trim();
    if (nextName && !isReservedVoyageName(nextName)) {
      sessionActions.renameSession(sessionId, nextName);
    }
    cancelVoyageSwitcherRename();
  };

  const handleAddTabGroup = async (
    label: string,
    spaceId = session.activeSpaceId,
  ) => {
    const result = await actions.addTabGroup({
      spaceId,
      label,
    });

    if (result?.tabGroupId) {
      sessionActions.setActiveTabGroup(result.tabGroupId);
    }
  };

  const [ephemeralActiveItems, setEphemeralActiveItems] = useState<
    Record<string, string>
  >({});

  useEffect(() => {
    setEphemeralActiveItems((current) => {
      const next = filterEphemeralCraftSurfaceActiveItems(
        effectiveWorkspace,
        current,
      );
      return Object.keys(next).length === Object.keys(current).length
        ? current
        : next;
    });
  }, [effectiveWorkspace.tabGroups]);

  const selectEffectiveTab = (
    spaceId: string,
    tabGroupId: string,
    tabId: string,
  ) => {
    const tabGroup = effectiveWorkspace.tabGroups.find(
      (candidate) => candidate.id === tabGroupId,
    );
    if (tabGroup && tabGroupHasEphemeralCraftSurfaceTab(tabGroup, tabId)) {
      setEphemeralActiveItems((current) => ({
        ...current,
        [tabGroupId]: tabId,
      }));
      return;
    }

    setEphemeralActiveItems((current) => {
      if (!(tabGroupId in current)) return current;
      const { [tabGroupId]: _removed, ...rest } = current;
      return rest;
    });
    sessionActions.selectSessionTab(spaceId, tabGroupId, tabId);
  };

  const selectEffectivePair = (
    spaceId: string,
    tabGroupId: string,
    pairId: string,
  ) => {
    setEphemeralActiveItems((current) => {
      if (!(tabGroupId in current)) return current;
      const { [tabGroupId]: _removed, ...rest } = current;
      return rest;
    });
    sessionActions.selectSessionPair(spaceId, tabGroupId, pairId);
  };

  const effectiveActiveItems = useMemo(
    () => ({ ...session.activeItems, ...ephemeralActiveItems }),
    [ephemeralActiveItems, session.activeItems],
  );

  const effectiveSessionActions = useMemo<SessionActions>(
    () => ({
      ...sessionActions,
      getActiveItem: (tabGroupId: string) =>
        ephemeralActiveItems[tabGroupId] ||
        sessionActions.getActiveItem(tabGroupId),
      selectTab: (tabGroupId: string, tabId: string) => {
        const activeSpaceId =
          effectiveWorkspace.spaces.find((space) =>
            space.tabGroupIds.includes(tabGroupId),
          )?.id || session.activeSpaceId;
        selectEffectiveTab(activeSpaceId, tabGroupId, tabId);
      },
      selectSessionTab: selectEffectiveTab,
      selectPair: (tabGroupId: string, pairId: string) => {
        const activeSpaceId =
          effectiveWorkspace.spaces.find((space) =>
            space.tabGroupIds.includes(tabGroupId),
          )?.id || session.activeSpaceId;
        selectEffectivePair(activeSpaceId, tabGroupId, pairId);
      },
      selectSessionPair: selectEffectivePair,
    }),
    [
      effectiveWorkspace.spaces,
      effectiveWorkspace.tabGroups,
      ephemeralActiveItems,
      session.activeSpaceId,
      sessionActions,
    ],
  );

  const activeSpace = effectiveWorkspace.spaces.find(
    (s) => s.id === session.activeSpaceId,
  );
  const activeTabGroups = activeSpace
    ? activeSpace.tabGroupIds
        .map((id) => effectiveWorkspace.tabGroups.find((tg) => tg.id === id))
        .filter((tg): tg is TabGroup => tg != null)
    : [];
  const activeTabGroup = activeTabGroups.find(
    (tg) => tg.id === session.activeTabGroupId,
  );
  const mobileSessionTabGroups = session.voyageEntries
    .map((entry) => {
      const tabGroupId = entry.tabGroupId;
      const tabGroup = effectiveWorkspace.tabGroups.find(
        (tg) => tg.id === tabGroupId,
      );
      if (!tabGroup) return null;

      const space = effectiveWorkspace.spaces.find((candidate) =>
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
        space: WorkspaceState["spaces"][number];
        tabGroup: TabGroup;
      } => item != null,
    );
  const isNewVoyageNameInvalid =
    !newVoyageName.trim() || isReservedVoyageName(newVoyageName);

  const sortedVoyageSwitcherSessions = useMemo(() => {
    return [...savedSessions].sort((left, right) => {
      const leftTime = Date.parse(left.updatedAt || left.createdAt || "");
      const rightTime = Date.parse(right.updatedAt || right.createdAt || "");
      return (
        (Number.isFinite(rightTime) ? rightTime : 0) -
        (Number.isFinite(leftTime) ? leftTime : 0)
      );
    });
  }, [savedSessions]);
  const moveVoyageTargets = sortedVoyageSwitcherSessions.filter(
    (savedSession) => {
      if (savedSession.id === currentSessionId) return false;
      if (!moveVoyageEntryPrompt) return true;
      return !savedSession.voyageEntries.some(
        (entry) => entry.tabGroupId === moveVoyageEntryPrompt.tabGroupId,
      );
    },
  );
  const canMoveVoyageEntryToAnotherVoyage = session.voyageEntries.length > 1;
  const currentSavedSession = savedSessions.find(
    (savedSession) => savedSession.id === currentSessionId,
  );
  const isPendingOpenCraftActive = pendingOpenCraftTab != null;
  const getVoyageDisplayName = (savedSession: SavedWorkspaceSession) =>
    savedSession.name?.trim() || "Untitled voyage";

  const mobileTabMenuTabGroup = mobileTabMenuTarget
    ? effectiveWorkspace.tabGroups.find(
        (tg) => tg.id === mobileTabMenuTarget.tabGroupId,
      )
    : undefined;
  const mobileTabMenuSpace = mobileTabMenuTarget
    ? effectiveWorkspace.spaces.find(
        (space) => space.id === mobileTabMenuTarget.spaceId,
      )
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
        | { kind: "tab"; id: string; label: string; isActive: boolean }
        | { kind: "pair"; id: string; label: string; isActive: boolean }
      >;
    }

    const activeViewIds =
      !isDesktop && expandedSessionTabGroup.entry.viewIds.length > 1
        ? [expandedSessionTabGroup.tabGroup.tabs[0]?.id].filter(
            (id): id is string => Boolean(id),
          )
        : expandedSessionTabGroup.entry.viewIds;
    const tabItems = expandedSessionTabGroup.tabGroup.tabs.map((tab) => ({
      kind: "tab" as const,
      id: tab.id,
      label: tab.title,
      isActive: activeViewIds.length === 1 && activeViewIds[0] === tab.id,
    }));
    const pairItems = expandedSessionTabGroup.tabGroup.pairs.map(
      (pair, index) => {
        const labels = pair.tabIds
          .map(
            (tabId) =>
              expandedSessionTabGroup.tabGroup.tabs.find(
                (tab) => tab.id === tabId,
              )?.title || "Untitled",
          )
          .join(" + ");
        return {
          kind: "pair" as const,
          id: pair.id,
          label: labels || `Split ${index + 1}`,
          isActive:
            pair.tabIds.length === activeViewIds.length &&
            pair.tabIds.every(
              (tabId, tabIndex) => tabId === activeViewIds[tabIndex],
            ),
        };
      },
    );

    return isDesktop ? [...tabItems, ...pairItems] : tabItems;
  }, [expandedSessionTabGroup, isDesktop]);

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
    setMobileTabDraftLabel(tabGroup.mobileLabel || "");
    setMobileTabDraftEmoji(tabGroup.mobileEmoji || "");
  };

  const handleMobileTabPointerDown = (
    event: React.PointerEvent<HTMLButtonElement>,
    voyageEntryId: string,
    spaceId: string,
    tabGroup: TabGroup,
  ) => {
    if (event.pointerType === "mouse") return;

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
    if (
      deltaX > LONG_PRESS_MOVE_TOLERANCE_PX ||
      deltaY > LONG_PRESS_MOVE_TOLERANCE_PX
    ) {
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
    const voyageFallbackEntryId = getVoyageEntryIdAfterClosingCraft({
      voyageEntries: session.voyageEntries,
      activeVoyageEntryId: session.activeVoyageEntryId,
      closedTabGroupId: tabGroupId,
    });
    const result = await actions.deleteTabGroup({ spaceId, tabGroupId });
    setDesktopTabMenuTarget(null);
    setMobileTabMenuTarget(null);
    setExpandedVoyageEntryId((current) => {
      const expandedEntry = session.voyageEntries.find(
        (entry) => entry.id === current,
      );
      return expandedEntry?.tabGroupId === tabGroupId ? null : current;
    });

    if (
      result?.wasDeleted &&
      session.activeTabGroupId === tabGroupId &&
      result.nextTabGroupId
    ) {
      if (voyageFallbackEntryId) {
        sessionActions.selectVoyageEntry(voyageFallbackEntryId);
      } else {
        sessionActions.selectSessionTabGroup(spaceId, result.nextTabGroupId);
      }
    }
  };

  const handleToggleSessionTabGroup = (
    voyageEntryId: string,
    spaceId: string,
    tabGroupId: string,
  ) => {
    clearSettledPendingOpenCraftTab();

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
    item: { kind: "tab" | "pair"; id: string },
  ) => {
    if (item.kind === "pair") {
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

  const handleOpenMoveVoyageEntryPrompt = (
    voyageEntryId: string,
    tabGroupId: string,
  ) => {
    if (!canMoveVoyageEntryToAnotherVoyage) {
      setMobileTabMenuTarget(null);
      setDesktopTabMenuTarget(null);
      return;
    }

    const activeItemId =
      session.activeItemsByVoyageEntryId[voyageEntryId] ||
      session.activeItems[tabGroupId];
    setMoveVoyageEntryPrompt({ voyageEntryId, tabGroupId, activeItemId });
    setMobileTabMenuTarget(null);
    setDesktopTabMenuTarget(null);
  };

  const handleMoveVoyageEntryToSession = async (targetSessionId: string) => {
    if (!moveVoyageEntryPrompt || targetSessionId === currentSessionId) return;
    const sourceSession = savedSessions.find(
      (savedSession) => savedSession.id === currentSessionId,
    );

    if (!sourceSession) {
      setMoveVoyageEntryPrompt(null);
      return;
    }

    const moveResult = await actions.moveVoyageEntryBetweenSavedSessions({
      sourceSessionId: currentSessionId,
      targetSessionId,
      voyageEntryId: moveVoyageEntryPrompt.voyageEntryId,
      activeItemId: moveVoyageEntryPrompt.activeItemId,
    });
    if (!moveResult) {
      setMoveVoyageEntryPrompt(null);
      return;
    }

    sessionActions.activateSavedSession(moveResult.sourceSession);
    setExpandedVoyageEntryId((current) => {
      if (current === moveVoyageEntryPrompt.voyageEntryId) return null;
      return moveResult.sourceSession.voyageEntries.some(
        (entry) => entry.id === current,
      )
        ? current
        : null;
    });

    setMoveVoyageEntryPrompt(null);
  };

  const handleMoveVoyageEntryToNewSession = async () => {
    if (!moveVoyageEntryPrompt) return;

    const voyageEntry = session.voyageEntries.find(
      (entry) => entry.id === moveVoyageEntryPrompt.voyageEntryId,
    );
    if (!voyageEntry) {
      setMoveVoyageEntryPrompt(null);
      return;
    }

    const voyageName = window.prompt("Voyage name");
    if (!voyageName?.trim() || isReservedVoyageName(voyageName)) return;

    const result = await actions.createSavedSessionFromVoyageEntry({
      name: voyageName,
      ...(currentSavedSession
        ? { sourceSessionId: currentSavedSession.id }
        : {}),
      voyageEntry,
      activeItemId: moveVoyageEntryPrompt.activeItemId,
    });
    if (!result) {
      setMoveVoyageEntryPrompt(null);
      return;
    }

    if (result.sourceSession) {
      sessionActions.activateSavedSession(result.sourceSession);
    } else {
      sessionActions.removeVoyageEntryFromSession(voyageEntry.id);
    }
    setExpandedVoyageEntryId((current) =>
      current === voyageEntry.id ? null : current,
    );
    setMoveVoyageEntryPrompt(null);
  };

  const openSessionWorkspaceSearch = () => {
    setDesktopTabMenuTarget(null);
    setMobileTabMenuTarget(null);
    setPendingOpenCraftSessionId(null);
    setWorkspaceSearchMode("session-add");
    setWorkspaceSearchOpen(true);
  };

  const handleWorkspaceSearchClose = () => {
    setWorkspaceSearchOpen(false);
    if (pendingOpenCraftTab) {
      return;
    }

    setWorkspaceSearchMode("general");
    setPendingOpenCraftSessionId(null);
    setPendingNewVoyageCraftName(null);
  };

  const retryPendingOpenCraft = () => {
    if (!pendingOpenCraftTab) return;
    openCraftMutation.mutate(pendingOpenCraftTab.request);
  };

  const resetOpenCraftPendingContext = () => {
    pendingOpenCraftOperationIdRef.current = null;
    setPendingOpenCraftTab(null);
    setPendingWorkspaceSelection(null);
    setPendingOpenCraftSessionId(null);
    setPendingNewVoyageCraftName(null);
    setWorkspaceSearchMode("general");
    openCraftMutation.reset();
  };

  const closePendingOpenCraftTab = () => {
    resetOpenCraftPendingContext();
  };

  const clearSettledPendingOpenCraftTab = () => {
    if (!pendingOpenCraftTab || openCraftMutation.isPending) return;
    resetOpenCraftPendingContext();
  };

  useEffect(() => {
    return () => {
      clearLongPress();
      clearVoyageBarRevealTimer();
    };
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

    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
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

    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, [voyagePlusMenuOpen]);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setDesktopTabMenuTarget(null);
        setExpandedVoyageEntryId(null);
      }
    };

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, []);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const data = event.data as { type?: string; action?: string } | undefined;
      if (data?.type !== "vk-iframe-shortcut") return;
      if (!hasSameBaseOrigin(event.origin, window.location.origin)) return;
      if (!hasKnownIframeMessageSource(event.source)) return;

      if (data.action === "cycle-next") {
        cycleSessionTabGroup(1);
      } else if (data.action === "cycle-prev") {
        cycleSessionTabGroup(-1);
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [cycleSessionTabGroup]);

  useEffect(() => {
    if (!isSidebarOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (sidebarRef.current?.contains(target)) return;
      setIsSidebarOpen(false);
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [isSidebarOpen]);

  useEffect(() => {
    if (!(isSidebarOpen || voyagePlusMenuOpen || desktopTabMenuTarget)) return;

    const handleWindowBlur = () => {
      window.setTimeout(() => {
        if (document.activeElement instanceof HTMLIFrameElement) {
          closeTransientOverlays();
        }
      }, 0);
    };

    window.addEventListener("blur", handleWindowBlur);
    return () => window.removeEventListener("blur", handleWindowBlur);
  }, [desktopTabMenuTarget, isSidebarOpen, voyagePlusMenuOpen]);

  return (
    <div className="w-full h-full flex bg-neutral-950">
      {isSidebarOpen && (
        <button
          className="fixed inset-0 z-[60] cursor-default bg-black/40 md:bg-transparent"
          onClick={() => setIsSidebarOpen(false)}
          aria-label="Close sidebar overlay"
        />
      )}

      <div
        ref={sidebarRef}
        className={`fixed inset-y-0 left-0 z-[70] transform transition-transform duration-200 ${
          isSidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <Sidebar
          workspace={effectiveWorkspace}
          activeSpaceId={session.activeSpaceId}
          activeTabGroupId={session.activeTabGroupId}
          activeItems={effectiveActiveItems}
          spaceTypes={pluginRegistry.spaceTypes}
          visitedTabGroupIds={session.visitedTabGroupIds}
          voyageEntries={session.voyageEntries}
          activeVoyageEntryId={session.activeVoyageEntryId}
          savedSessions={savedSessions}
          currentSessionId={currentSessionId}
          onRequestClose={() => setIsSidebarOpen(false)}
          onOpenPluginAdmin={() => {
            setIsSidebarOpen(false);
            navigate("/dashboard/admin/plugins");
          }}
          onSelectTabGroup={(tabGroupId) => {
            const space = effectiveWorkspace.spaces.find((entry) =>
              entry.tabGroupIds.includes(tabGroupId),
            );
            if (space) {
              handleNavigateToWorkspaceTabGroup(space.id, tabGroupId);
            } else {
              sessionActions.setActiveTabGroup(tabGroupId);
            }
          }}
          onSelectTab={(tabGroupId, tabId) => {
            effectiveSessionActions.selectTab(tabGroupId, tabId);
          }}
          onSelectPair={(tabGroupId, pairId) => {
            effectiveSessionActions.selectPair(tabGroupId, pairId);
          }}
          onSelectVoyageEntry={(voyageEntryId) => {
            sessionActions.selectVoyageEntry(voyageEntryId);
          }}
          onAddSpace={async (name) => {
            const result = await actions.addSpace({ name });
            return result;
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
          onOpenCreateWorkspaceTab={async () => {
            await handleOpenCreateWorkspaceTab();
            setIsSidebarOpen(false);
          }}
          onOpenCraftFlow={() => {
            setPendingOpenCraftSessionId(null);
            setWorkspaceSearchMode("session-add");
            setWorkspaceSearchOpen(true);
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
            openNewVoyagePrompt();
          }}
          onRenameSession={(sessionId, name) => {
            sessionActions.renameSession(sessionId, name);
          }}
        />
      </div>

      <div className="flex-1 flex flex-col min-h-0 min-w-0 relative">
        {isDesktopVoyageBarHidden && (
          <div
            className="hidden md:block absolute inset-x-0 top-0 z-[80] h-3 cursor-n-resize"
            onMouseEnter={startVoyageBarRevealTimer}
            onMouseLeave={clearVoyageBarRevealTimer}
            title="Hover to show voyage bar"
            aria-hidden="true"
          />
        )}
        {!isDesktopVoyageBarHidden && (
          <VoyageBarView
            items={mobileSessionTabGroups}
            activeVoyageEntryId={session.activeVoyageEntryId}
            isPendingOpenCraftActive={isPendingOpenCraftActive}
            voyagePlusMenuOpen={voyagePlusMenuOpen}
            pendingOpenCraftTab={pendingOpenCraftTab}
            onOpenSidebar={() => setIsSidebarOpen(true)}
            onToggleVoyageActions={toggleVoyagePlusMenu}
            onHide={() => setIsDesktopVoyageBarHidden(true)}
            onSelectItem={({ entry, space, tabGroup }) => {
              handleToggleSessionTabGroup(entry.id, space.id, tabGroup.id);
            }}
            onContextMenuItem={(event, { entry, space, tabGroup }) => {
              event.preventDefault();
              event.stopPropagation();
              setDesktopTabMenuTarget({
                voyageEntryId: entry.id,
                spaceId: space.id,
                tabGroupId: tabGroup.id,
                position: { x: event.clientX, y: event.clientY },
              });
            }}
            onDragStartItem={handleSessionTabGroupDragStart}
            onDragOver={handleDragOver}
            onDropItem={handleSessionTabGroupDrop}
            onRetryPendingOpenCraft={retryPendingOpenCraft}
            onClosePendingOpenCraft={closePendingOpenCraftTab}
            getEmoji={getMobileTabGroupEmoji}
          />
        )}
        {!isDesktopVoyageBarHidden &&
          !isPendingOpenCraftActive &&
          expandedSessionTabGroup && (
            <ExpandedCraftStrip
              items={expandedSessionItems}
              onSelect={(item) =>
                handleSelectExpandedSessionItem(
                  expandedSessionTabGroup.space.id,
                  expandedSessionTabGroup.tabGroup.id,
                  item,
                )
              }
            />
          )}

        {pendingOpenCraftTab ? (
          <PendingOpenCraftContent
            tab={pendingOpenCraftTab}
            onRetry={retryPendingOpenCraft}
            onClose={closePendingOpenCraftTab}
          />
        ) : (
          <WorkspaceContentView
            activeTabGroups={activeTabGroups}
            activeTabGroupId={session.activeTabGroupId}
            actions={actions}
            sessionActions={effectiveSessionActions}
            disableSplitViews={!isDesktop}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            workspace={effectiveWorkspace}
            showAddressBar={showAddressBar}
            savedSessions={savedSessions}
            currentSessionId={currentSessionId}
            onResumeSession={switchToVoyage}
            onRenameSession={sessionActions.renameSession}
            onDeleteSession={sessionActions.deleteSession}
            onStartNewSession={() => {
              openNewVoyagePrompt();
            }}
            onNavigateToTabGroup={handleNavigateToWorkspaceTabGroup}
            onOpenVKWorkspace={handleWorkspaceSearchAddToSpace}
          />
        )}
        {!isPendingOpenCraftActive && expandedSessionTabGroup && (
          <ExpandedCraftStrip
            items={expandedSessionItems}
            mobile
            onSelect={(item) =>
              handleSelectExpandedSessionItem(
                expandedSessionTabGroup.space.id,
                expandedSessionTabGroup.tabGroup.id,
                item,
              )
            }
          />
        )}

        <MobileCraftStrip
          items={mobileSessionTabGroups}
          activeVoyageEntryId={session.activeVoyageEntryId}
          activeTabGroupLabel={activeTabGroup?.label}
          isPendingOpenCraftActive={isPendingOpenCraftActive}
          voyagePlusMenuOpen={voyagePlusMenuOpen}
          pendingOpenCraftTab={pendingOpenCraftTab}
          onOpenSidebar={() => setIsSidebarOpen(true)}
          onToggleVoyageActions={toggleVoyagePlusMenu}
          onSelectItem={({ entry, space, tabGroup }) => {
            if (suppressMobileTabClickRef.current) {
              suppressMobileTabClickRef.current = false;
              return;
            }
            handleToggleSessionTabGroup(entry.id, space.id, tabGroup.id);
          }}
          onOpenItemMenu={({ entry, space, tabGroup }) => {
            openMobileTabMenu(entry.id, space.id, tabGroup);
          }}
          onPointerDownItem={(event, { entry, space, tabGroup }) =>
            handleMobileTabPointerDown(event, entry.id, space.id, tabGroup)
          }
          onPointerMove={handleMobileTabPointerMove}
          onClearLongPress={clearLongPress}
          onRetryPendingOpenCraft={retryPendingOpenCraft}
          onClosePendingOpenCraft={closePendingOpenCraftTab}
          getLabel={getMobileTabGroupLabel}
          getEmoji={getMobileTabGroupEmoji}
        />
      </div>

      {addTabModalOpen && (
        <AddTabModal
          isOpen={addTabModalOpen}
          onClose={() => setAddTabModalOpen(false)}
          tabPresets={Object.values(pluginRegistry.tabPresets)}
          tabGroupFactories={Object.values(pluginRegistry.tabGroupFactories)}
          onAdd={handleAddTab}
          onAddVKWorkspace={handleAddVKWorkspace}
          onAddVKWorkspaceToSpace={handleAddVKWorkspaceToSpace}
          onNavigateToTabGroup={handleAddTabModalNavigateToWorkspaceTabGroup}
          onAddTabGroup={handleAddTabGroup}
          workspace={effectiveWorkspace}
          pendingWorkspaceId={
            openCraftMutation.isPending
              ? (openCraftMutation.variables?.workspaceId ?? null)
              : null
          }
          isActionPending={openCraftMutation.isPending}
          actionError={
            openCraftMutation.isError
              ? getErrorMessage(openCraftMutation.error)
              : null
          }
          onResetAction={() => openCraftMutation.reset()}
        />
      )}

      {voyageSwitcherOpen && (
        <VoyageSwitcherDialog
          sessions={sortedVoyageSwitcherSessions}
          currentSessionId={currentSessionId}
          renamingSessionId={voyageSwitcherRenameSessionId}
          renameDraft={voyageSwitcherRenameDraft}
          onRenameDraftChange={setVoyageSwitcherRenameDraft}
          onSelect={handleVoyageSwitcherSelect}
          onGoHome={handleVoyageSwitcherOpenHome}
          onStartRename={startVoyageSwitcherRename}
          onCancelRename={cancelVoyageSwitcherRename}
          onSubmitRename={submitVoyageSwitcherRename}
          onNewVoyage={openNewVoyagePrompt}
          onCancel={() => {
            setVoyageSwitcherOpen(false);
            cancelVoyageSwitcherRename();
          }}
          onBackdropClick={handleVoyageSwitcherBackdropClick}
          getVoyageDisplayName={getVoyageDisplayName}
          isRenameInvalid={(draft) =>
            !draft.trim() || isReservedVoyageName(draft)
          }
        />
      )}

      {voyagePlusMenuOpen && (
        <button
          className="fixed inset-0 z-[91] cursor-default bg-transparent"
          aria-label="Close voyage menu"
          onClick={() => setVoyagePlusMenuOpen(false)}
        />
      )}

      {voyagePlusMenuOpen && (
        <VoyageActionsMenu
          ref={voyagePlusMenuRef}
          position={voyagePlusMenuPosition}
          onNewCraft={() => {
            setVoyagePlusMenuOpen(false);
            void handleOpenCreateWorkspaceTab();
          }}
          onOpenCraft={() => {
            setVoyagePlusMenuOpen(false);
            setPendingOpenCraftSessionId(null);
            setWorkspaceSearchMode("session-add");
            setWorkspaceSearchOpen(true);
          }}
          onSwitchVoyage={handleOpenVoyageSwitcher}
        />
      )}

      {newVoyagePromptOpen && (
        <NewVoyagePromptDialog
          name={newVoyageName}
          isNameInvalid={isNewVoyageNameInvalid}
          onNameChange={setNewVoyageName}
          onCancel={closeNewVoyagePrompt}
          onCreateNewCraft={() => {
            void handleCreateNamedVoyage("new-task");
          }}
          onOpenExistingCraft={() => {
            void handleCreateNamedVoyage("open-craft");
          }}
          onBackdropClick={handleNewVoyagePromptBackdropClick}
        />
      )}

      {workspaceSearchOpen && (
        <AddVKWorkspaceModal
          isOpen={workspaceSearchOpen}
          onClose={handleWorkspaceSearchClose}
          onAdd={handleWorkspaceSearchAdd}
          onAddToSpace={
            workspaceSearchMode === "session-add"
              ? undefined
              : handleWorkspaceSearchAddToSpace
          }
          onNavigateToTabGroup={handleWorkspaceSearchNavigate}
          workspaceState={effectiveWorkspace}
          allowCustomPath={false}
          pendingWorkspaceId={
            openCraftMutation.isPending
              ? (pendingOpenCraftTab?.request.workspaceId ?? null)
              : null
          }
          isActionPending={openCraftMutation.isPending}
          actionError={
            openCraftMutation.isError
              ? getErrorMessage(openCraftMutation.error)
              : null
          }
        />
      )}

      {moveVoyageEntryPrompt && (
        <div
          className="fixed inset-0 z-[94] flex items-center justify-center bg-black/60 p-4"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              setMoveVoyageEntryPrompt(null);
            }
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Move to Voyage"
            className="flex max-h-[85dvh] w-full max-w-lg flex-col rounded-xl border border-neutral-700 bg-neutral-900 p-5 shadow-2xl"
          >
            <div className="text-base font-semibold text-neutral-100">
              Move to Voyage
            </div>
            <p className="mt-2 text-sm text-neutral-400">
              Choose the voyage that should receive this craft.
            </p>

            <div className="mt-4 min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
              {moveVoyageTargets.length > 0 ? (
                moveVoyageTargets.map((savedSession) => (
                  <button
                    key={savedSession.id}
                    className="block w-full rounded-md border border-neutral-700 bg-neutral-800 px-3 py-2 text-left text-sm text-neutral-200 transition-colors hover:bg-neutral-700"
                    onClick={() => {
                      void handleMoveVoyageEntryToSession(savedSession.id);
                    }}
                  >
                    <span className="font-medium">
                      {getVoyageDisplayName(savedSession)}
                    </span>
                    <span className="mt-1 block text-xs text-neutral-500">
                      Updated{" "}
                      {new Date(savedSession.updatedAt).toLocaleString()}
                    </span>
                  </button>
                ))
              ) : (
                <div className="rounded-md border border-neutral-800 bg-neutral-950/40 px-3 py-4 text-sm text-neutral-400">
                  <div>No other saved voyages yet.</div>
                  <button
                    className="mt-3 rounded-md border border-blue-400/70 bg-blue-500/20 px-3 py-2 text-sm text-neutral-50 transition-colors hover:bg-blue-500/30"
                    onClick={() => {
                      void handleMoveVoyageEntryToNewSession();
                    }}
                  >
                    Create New Voyage
                  </button>
                </div>
              )}
            </div>

            <div className="mt-5 flex justify-end">
              <button
                className="rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-300 transition-colors hover:bg-neutral-800"
                onClick={() => setMoveVoyageEntryPrompt(null)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {duplicateCraftPrompt &&
        (() => {
          const tabGroup = effectiveWorkspace.tabGroups.find(
            (candidate) => candidate.id === duplicateCraftPrompt.tabGroupId,
          );
          const craftLabel = tabGroup?.label || "This craft";

          return (
            <DuplicateCraftPromptDialog
              craftLabel={craftLabel}
              currentEntries={duplicateCraftPrompt.currentEntries}
              activeVoyageEntryId={session.activeVoyageEntryId}
              otherVoyages={duplicateCraftPrompt.otherVoyages}
              onSwitchCurrent={switchToExistingCraftInCurrentVoyage}
              onSwitchOtherVoyage={switchToCraftInOtherVoyage}
              onOpenInNewVoyage={openCraftInNewVoyage}
              onCancel={closeDuplicateCraftPrompt}
            />
          );
        })()}

      {desktopTabMenuTarget && (
        <button
          className="hidden md:block fixed inset-0 z-[89] cursor-default bg-transparent"
          aria-label="Close craft menu"
          onClick={() => setDesktopTabMenuTarget(null)}
        />
      )}

      {desktopTabMenuTarget &&
        (() => {
          const space = effectiveWorkspace.spaces.find(
            (candidate) => candidate.id === desktopTabMenuTarget.spaceId,
          );
          const tabGroup = effectiveWorkspace.tabGroups.find(
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
                className="block w-full px-4 py-2 text-left text-sm text-neutral-200 transition-colors hover:bg-neutral-800 disabled:cursor-not-allowed disabled:text-neutral-500 disabled:hover:bg-transparent"
                disabled={!canMoveVoyageEntryToAnotherVoyage}
                title={
                  canMoveVoyageEntryToAnotherVoyage
                    ? "Move this craft to another Voyage"
                    : "Cannot move the only craft in a Voyage"
                }
                onClick={() => {
                  handleOpenMoveVoyageEntryPrompt(
                    desktopTabMenuTarget.voyageEntryId,
                    desktopTabMenuTarget.tabGroupId,
                  );
                }}
              >
                Move to Voyage
              </button>
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
                        ? `Close "${tabGroup?.label || "this craft"}" everywhere? Because it's the last craft in this space, a replacement craft will be created automatically.`
                        : `Close "${tabGroup?.label || "this craft"}" everywhere? This deletes the craft, not just from the current voyage.`,
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
        <MobileCraftMenu
          tabGroup={mobileTabMenuTabGroup}
          draftLabel={mobileTabDraftLabel}
          draftEmoji={mobileTabDraftEmoji}
          emojiChoices={MOBILE_TAB_EMOJI_CHOICES}
          canMoveToAnotherVoyage={canMoveVoyageEntryToAnotherVoyage}
          closeWarning={
            mobileTabMenuSpace?.tabGroupIds.length === 1
              ? `Close "${mobileTabMenuTabGroup.label}" everywhere? Because it's the last craft in this space, a replacement craft will be created automatically.`
              : `Close "${mobileTabMenuTabGroup.label}" everywhere? This deletes the craft, not just from the current voyage.`
          }
          onDraftLabelChange={setMobileTabDraftLabel}
          onDraftEmojiChange={(value) => setMobileTabDraftEmoji(getFirstGrapheme(value))}
          onChooseEmoji={setMobileTabDraftEmoji}
          onCancel={() => setMobileTabMenuTarget(null)}
          onSave={handleSaveMobileTabDisplay}
          onMoveToVoyage={() => {
            handleOpenMoveVoyageEntryPrompt(
              mobileTabMenuTarget.voyageEntryId,
              mobileTabMenuTarget.tabGroupId,
            );
          }}
          onRemoveFromVoyage={() => {
            handleRemoveVoyageEntryFromSession(mobileTabMenuTarget.voyageEntryId);
          }}
          onCloseCraft={() => {
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
          onCloseOverlay={() => setMobileTabMenuTarget(null)}
        />
      )}
    </div>
  );
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;

  const tagName = target.tagName.toLowerCase();
  return (
    tagName === "input" ||
    tagName === "textarea" ||
    tagName === "select" ||
    target.isContentEditable
  );
}

function getOpenCraftOperationId(
  currentSessionId: string,
  request: OpenCraftMutationInput,
): string {
  const destination =
    request.kind === "add" ? request.spaceId || "" : request.tabGroupId;
  return `open-craft:${currentSessionId}:${request.kind}:${request.workspaceId}:${destination}`;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  if (typeof error === "string" && error.trim()) {
    return error;
  }
  return "Open Craft failed. Please retry or close this pending craft.";
}

function getMobileTabGroupLabel(tabGroup: TabGroup): string {
  const custom = tabGroup.mobileLabel?.trim();
  if (custom) return custom;

  const compact = tabGroup.label.trim();
  if (!compact) return "Tab";
  if (compact.length <= 4) return compact;

  return compact.slice(0, 4);
}

function getMobileTabGroupEmoji(tabGroup: TabGroup): string {
  if (tabGroup.mobileEmoji?.trim()) return tabGroup.mobileEmoji.trim();

  const normalized = tabGroup.label.toLowerCase();

  if (normalized.includes("overview") || normalized.includes("home"))
    return "🏠";

  return MOBILE_TAB_EMOJI_CHOICES[getStableEmojiIndex(tabGroup.id)] || "📁";
}

function getFirstGrapheme(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";

  if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
    const segmenter = new Intl.Segmenter(undefined, {
      granularity: "grapheme",
    });
    const iterator = segmenter.segment(trimmed)[Symbol.iterator]();
    const first = iterator.next();
    return first.done ? "" : first.value.segment;
  }

  return Array.from(trimmed)[0] || "";
}

function getStableEmojiIndex(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash % MOBILE_TAB_EMOJI_CHOICES.length;
}
