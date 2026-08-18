import "@vitejs/plugin-react/preamble";
import "../styles";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { HeroUIProvider } from "@heroui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AppLoadingScreen } from "../components/AppLoadingScreen";
import { WorkspaceShell } from "../components/WorkspaceShell";
import { AgentTeamsDashboard } from "../components/AgentTeamsDashboard";
import { WorkflowPresentationPage } from "../components/WorkflowPresentationPage";
import { WorkspaceWorkflowsPage } from "./plugins/workflows/components/WorkspaceWorkflowsPage";
import { WorkflowBatchDetailPage } from "./plugins/workflows/components/WorkflowBatchDetailPage";
import { WorkflowCreationWizardPage } from "./plugins/workflows/components/WorkflowCreationWizardPage";
import { WorkflowGraphEditorPage } from "./plugins/workflows/components/WorkflowGraphEditorPage";
import { WorkflowRoadmapPage } from "./plugins/workflows/components/WorkflowRoadmapPage";
import { WorkflowMetaRunsPage } from "./plugins/workflows/components/WorkflowMetaRunsPage";
import { WorkflowLibraryPage } from "./plugins/workflows/components/WorkflowLibraryPage";
import { useSessionWorkspaceNav } from "../sessionState";
import type { NewSessionInitialSelection } from "../sessionState";
import { resolveWorkspaceContainerRef } from "../lib/vkWorkspaceOpen";
import {
  buildCanonicalDashboardPath,
  buildSavedVoyageDashboardPath,
  buildVoyageParam,
  getStoredLastDashboardUrl,
  parseCraftParam,
  parseViewsParam,
  setStoredLastDashboardUrl,
  shortIdTokenMatches,
} from "../lib/voyageUrl";
import { resolveDashboardVoyage } from "../lib/voyageSession";
import { getSavedWorkspaceSessions } from "../lib/savedVoyageState";
import { getRenderedPairViewIds } from "../lib/renderedWorkspaceSelection";
import {
  fetchPluginAdminStatuses,
  setPluginAdminDesiredEnabled,
  type PluginAdminStatus,
} from "../lib/pluginAdminApi";
import { usePluginRegistry } from "./plugins/vibe-dashboard/registry";
import type { ResolvedWorkspaceComposition } from "./plugins/vibe-dashboard/workspace-composition";
import { createEffectiveWorkspaceWithCraftSurfaces } from "./plugins/vibe-dashboard/craft-surfaces";

// Ensure dark class is on the document root so portaled elements (modals, popovers)
// inherit dark mode styles
document.documentElement.classList.add("dark");
springboard.registerSplashScreen(AppLoadingScreen);

import springboard from "springboard";
import type { WorkspaceState, SavedWorkspaceSession } from "../types";
import { useModule } from "../hooks/useModule";

const URL_PARSE_BASE = "https://workspace.local";
const MOBILE_TAB_EMOJIS = [
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
const queryClient = new QueryClient();

/**
 * Get the base URL without port prefix for creating tab URLs.
 * If running on port-{num}.domain.com, returns just the origin without the prefix.
 */
function getBaseOrigin(): string {
  const { protocol, host } = window.location;

  // Check if host matches port-{num}.domain.com pattern
  const portPrefixMatch = host.match(/^port-\d+\.(.+)$/);

  if (portPrefixMatch) {
    // Return base domain without the port prefix (different origin)
    return `${protocol}//${portPrefixMatch[1]}`;
  }

  // Same origin — use relative paths so URLs aren't tied to a specific host
  return "";
}

function isHomeVoyageDisplayName(displayName: string): boolean {
  return displayName.trim().toLowerCase() === "home";
}

function resolveQueryCraftSelection(
  workspace: WorkspaceState,
  session: SavedWorkspaceSession | undefined,
  craftParam: string | undefined,
  viewParam: string | undefined,
): {
  spaceId?: string;
  tabGroupId?: string;
  itemId?: string;
  voyageEntryId?: string;
  viewIds?: string[];
} {
  if (!(session && craftParam)) return {};
  const parsedCraft = parseCraftParam(craftParam);
  if (!parsedCraft) return {};

  const matchingEntry = session.voyageEntries?.find(
    (entry) =>
      shortIdTokenMatches(
        entry.id,
        parsedCraft.entrySuffix,
        session.voyageEntries.map((candidate) => candidate.id),
      ) &&
      shortIdTokenMatches(
        entry.tabGroupId,
        parsedCraft.tabGroupSuffix,
        workspace.tabGroups.map((candidate) => candidate.id),
      ),
  );
  if (!matchingEntry) return {};

  const tabGroup = workspace.tabGroups.find(
    (entry) => entry.id === matchingEntry.tabGroupId,
  );
  if (!tabGroup) return {};

  const viewSuffixes = parseViewsParam(viewParam);
  const tabIds = tabGroup.tabs.map((tab) => tab.id);
  const viewIds = viewSuffixes
    .map(
      (suffix) =>
        tabGroup.tabs.find((tab) => shortIdTokenMatches(tab.id, suffix, tabIds))
          ?.id,
    )
    .filter((id): id is string => Boolean(id));
  const resolvedViewIds = viewIds.length ? viewIds : matchingEntry.viewIds;
  const itemId =
    resolvedViewIds.length > 1
      ? tabGroup.pairs.find(
          (pair) =>
            pair.tabIds.length === resolvedViewIds.length &&
            pair.tabIds.every(
              (tabId, index) => tabId === resolvedViewIds[index],
            ),
        )?.id || resolvedViewIds[0]
      : resolvedViewIds[0];

  return {
    spaceId: workspace.spaces.find((space) =>
      space.tabGroupIds.includes(tabGroup.id),
    )?.id,
    tabGroupId: tabGroup.id,
    itemId,
    voyageEntryId: matchingEntry.id,
    viewIds: resolvedViewIds,
  };
}

springboard.registerModule("MainUIShell", {}, async (moduleAPI) => {
  // Shared route component with canonical voyage query-param support
  const WorkspaceRoute = () => {
    const workspaceModule = useModule("workspace");

    const workspace = workspaceModule.states.workspace.useState();
    const pluginRegistryState = usePluginRegistry();
    const effectiveWorkspace = useMemo(
      () =>
        createEffectiveWorkspaceWithCraftSurfaces({
          workspace,
          craftSurfaces: Object.values(pluginRegistryState.craftSurfaces),
          origin: typeof window === "undefined" ? "" : window.location.origin,
        }),
      [pluginRegistryState.craftSurfaces, workspace],
    );
    const savedSessions = workspaceModule.states.savedVoyages.useState();
    const savedVoyages = getSavedWorkspaceSessions(savedSessions);
    const actions = workspaceModule.actions;

    const location = useLocation();
    const navigate = useNavigate();
    const sessionSearchParams = new URLSearchParams(location.search);
    const requestedVoyageKey = (() => {
      if (typeof window === "undefined") return undefined;
      const value = sessionSearchParams.get("voyage")?.trim();
      return value || undefined;
    })();
    const queryCraftParam =
      sessionSearchParams.get("craft")?.trim() || undefined;
    const queryViewsParam =
      sessionSearchParams.get("views")?.trim() || undefined;
    const storedDashboardUrl =
      typeof window === "undefined" || location.search
        ? undefined
        : getStoredLastDashboardUrl();
    const dashboardVoyage = resolveDashboardVoyage({
      savedSessions: savedVoyages,
      requestedVoyageKey,
      storedDashboardUrl,
    });
    const requestedSessionId =
      dashboardVoyage.status === "resolved"
        ? dashboardVoyage.sessionId
        : undefined;
    const missingParamFallbackSession =
      dashboardVoyage.status === "missing-param"
        ? savedVoyages.find(
            (session) => session.id === dashboardVoyage.sessionId,
          ) ||
          savedVoyages.find(
            (session) => !isHomeVoyageDisplayName(session.name || ""),
          ) ||
          savedVoyages[0]
        : undefined;
    const missingParamRedirectPath =
      dashboardVoyage.status === "missing-param"
        ? dashboardVoyage.sessionId && storedDashboardUrl
          ? storedDashboardUrl
          : missingParamFallbackSession
            ? buildSavedVoyageDashboardPath({
                currentSearch: location.search,
                workspace: effectiveWorkspace,
                session: missingParamFallbackSession,
                savedSessions: savedVoyages,
              })
            : undefined
        : undefined;
    const browserSessionId =
      typeof window === "undefined"
        ? "server-session"
        : dashboardVoyage.status === "resolved"
          ? requestedSessionId || "server-session"
          : dashboardVoyage.status === "missing-param"
            ? missingParamFallbackSession?.id || "server-session"
            : "server-session";
    const activeSavedSession = savedVoyages.find(
      (session) => session.id === browserSessionId,
    );
    const pendingSavedSessionActivationRef = useRef<
      { sessionId: string; voyageEntryId?: string } | undefined
    >(undefined);
    const [firstVoyageName, setFirstVoyageName] = useState("");
    const [isCreatingFirstVoyage, setIsCreatingFirstVoyage] = useState(false);
    const [createFirstVoyageError, setCreateFirstVoyageError] = useState<
      string | null
    >(null);

    const querySelection = useMemo(
      () =>
        resolveQueryCraftSelection(
          effectiveWorkspace,
          activeSavedSession,
          queryCraftParam,
          queryViewsParam,
        ),
      [
        activeSavedSession,
        effectiveWorkspace,
        queryCraftParam,
        queryViewsParam,
      ],
    );
    const sessionNav = useSessionWorkspaceNav(
      effectiveWorkspace,
      {
        spaceId: querySelection.spaceId,
        tabGroupId: querySelection.tabGroupId,
        itemId: querySelection.itemId,
        voyageEntryId: querySelection.voyageEntryId,
        viewIds: querySelection.viewIds,
      },
      activeSavedSession,
      {
        persistToSessionStorage: false,
      },
    );

    const firstVoyageNameIsInvalid =
      !firstVoyageName.trim() || isHomeVoyageDisplayName(firstVoyageName);

    const createFirstVoyageFromCurrentCraft = async () => {
      const voyageName = firstVoyageName.trim();
      if (!voyageName || isHomeVoyageDisplayName(voyageName)) return;
      if (!(sessionNav.activeSpaceId && sessionNav.activeTabGroupId)) return;

      setIsCreatingFirstVoyage(true);
      setCreateFirstVoyageError(null);
      try {
        const activeTabGroup = workspace.tabGroups.find(
          (tabGroup) => tabGroup.id === sessionNav.activeTabGroupId,
        );
        const activeItemId = sessionNav.getActiveItem(
          sessionNav.activeTabGroupId,
        );
        const activeTabId = activeTabGroup?.tabs.some(
          (tab) => tab.id === activeItemId,
        )
          ? activeItemId
          : undefined;
        const savedSession = await actions.createSavedSessionForSelection({
          name: voyageName,
          spaceId: sessionNav.activeSpaceId,
          tabGroupId: sessionNav.activeTabGroupId,
          ...(activeTabId ? { tabId: activeTabId } : {}),
        });
        if (!savedSession) {
          setCreateFirstVoyageError(
            "Could not create that Voyage. Try another name.",
          );
          return;
        }

        navigate(
          buildSavedVoyageDashboardPath({
            currentSearch: location.search,
            workspace: effectiveWorkspace,
            session: savedSession,
            savedSessions: savedVoyages.some(
              (entry) => entry.id === savedSession.id,
            )
              ? savedVoyages
              : [...savedVoyages, savedSession],
          }),
          { replace: true },
        );
      } finally {
        setIsCreatingFirstVoyage(false);
      }
    };

    useEffect(() => {
      if (dashboardVoyage.status !== "missing-param") return;
      if (!missingParamRedirectPath) return;
      const currentPath = `${location.pathname}${location.search}`;
      if (missingParamRedirectPath !== currentPath) {
        navigate(missingParamRedirectPath, { replace: true });
      }
    }, [
      dashboardVoyage.status,
      location.pathname,
      location.search,
      missingParamRedirectPath,
      navigate,
    ]);

    useEffect(() => {
      if (dashboardVoyage.status !== "resolved") return;
      const currentPath = `${location.pathname}${location.search}`;
      setStoredLastDashboardUrl(currentPath);
    }, [dashboardVoyage.status, location.pathname, location.search]);

    // Update document title to reflect active space and tab group
    useEffect(() => {
      const space = workspace.spaces.find(
        (s) => s.id === sessionNav.activeSpaceId,
      );
      const tabGroup = workspace.tabGroups.find(
        (tg) => tg.id === sessionNav.activeTabGroupId,
      );
      if (space && tabGroup) {
        document.title = `${space.name} - ${tabGroup.label}`;
      }
    }, [
      sessionNav.activeSpaceId,
      sessionNav.activeTabGroupId,
      workspace.spaces,
      effectiveWorkspace.tabGroups,
    ]);

    // Record visit timestamp when active tab group changes
    useEffect(() => {
      if (dashboardVoyage.status === "not-found") return;
      if (sessionNav.activeTabGroupId) {
        actions.touchTabGroup({ tabGroupId: sessionNav.activeTabGroupId });
      }
    }, [actions, dashboardVoyage.status, sessionNav.activeTabGroupId]);

    // Sync URL to match canonical voyage/craft/views query params
    useEffect(() => {
      if (dashboardVoyage.status !== "resolved") return;
      if (!activeSavedSession) return;

      const pendingActivation = pendingSavedSessionActivationRef.current;
      if (pendingActivation) {
        if (pendingActivation.sessionId !== browserSessionId) {
          // A newer/manual URL navigation won. Do not let an old pending activation
          // suppress canonicalization for the currently URL-selected Voyage.
          pendingSavedSessionActivationRef.current = undefined;
        } else {
          const pendingEntryIsReady = pendingActivation.voyageEntryId
            ? activeSavedSession.voyageEntries.some(
                (entry) => entry.id === pendingActivation.voyageEntryId,
              )
            : true;
          if (!pendingEntryIsReady) {
            return;
          }

          // The target entry is visible to route state now; canonicalization can
          // safely resume without racing the Open Craft navigation back to the
          // previous active craft.
          pendingSavedSessionActivationRef.current = undefined;
        }
      }

      const currentPath = `${location.pathname}${location.search}`;
      const voyageName = activeSavedSession?.name?.trim();
      if (!voyageName || isHomeVoyageDisplayName(voyageName)) {
        // Missing/invalid current voyage is handled by the route bootstrap or
        // not-found recovery. Do not clear `voyage` here; that would create a
        // second current-voyage state outside the URL contract.
        return;
      }
      const currentVoyageSlug = buildVoyageParam(
        activeSavedSession,
        savedVoyages,
      );

      if (queryCraftParam && queryViewsParam && querySelection.voyageEntryId) {
        const nextPath = buildCanonicalDashboardPath(location.search, {
          slug: currentVoyageSlug,
          craftParam: queryCraftParam,
          viewTokens: queryViewsParam.split(",").filter(Boolean),
        });
        if (nextPath !== currentPath) {
          navigate(nextPath, { replace: true });
        }
        return;
      }

      const nextPath = buildSavedVoyageDashboardPath({
        currentSearch: location.search,
        workspace: effectiveWorkspace,
        session: activeSavedSession,
        savedSessions: savedVoyages,
        ...(querySelection.voyageEntryId
          ? { voyageEntryId: querySelection.voyageEntryId }
          : {}),
        ...(querySelection.viewIds?.length
          ? { viewIds: querySelection.viewIds }
          : {}),
      });
      if (nextPath !== currentPath) {
        navigate(nextPath, { replace: true });
      }
    }, [
      activeSavedSession,
      browserSessionId,
      dashboardVoyage.status,
      effectiveWorkspace,
      location.pathname,
      location.search,
      navigate,
      queryCraftParam,
      querySelection,
      queryViewsParam,
      savedVoyages,
    ]);

    const updateBookmarkedSessionSearch = (
      sessionId: string,
      name?: string,
      voyageEntryId?: string,
      options: {
        session?: SavedWorkspaceSession;
        tabId?: string;
        viewIds?: string[];
      } = {},
    ) => {
      const session =
        options.session || savedVoyages.find((entry) => entry.id === sessionId);
      const voyageName = session?.name?.trim() || name?.trim();
      if (!session || !voyageName || isHomeVoyageDisplayName(voyageName))
        return;

      const targetVoyageEntryId =
        voyageEntryId || session.activeVoyageEntryId || undefined;
      pendingSavedSessionActivationRef.current = {
        sessionId: session.id,
        ...(targetVoyageEntryId ? { voyageEntryId: targetVoyageEntryId } : {}),
      };
      const savedSessionPeers = savedVoyages.some(
        (entry) => entry.id === session.id,
      )
        ? savedVoyages
        : [...savedVoyages, session];
      const nextPath = buildSavedVoyageDashboardPath({
        currentSearch: location.search,
        workspace: effectiveWorkspace,
        session,
        savedSessions: savedSessionPeers,
        ...(voyageEntryId ? { voyageEntryId } : {}),
        ...(options.tabId ? { tabId: options.tabId } : {}),
        ...(options.viewIds ? { viewIds: options.viewIds } : {}),
      });
      navigate(nextPath, { replace: true });
    };

    const persistSavedSelection = (args: {
      spaceId: string;
      tabGroupId: string;
      tabId?: string;
      viewIds?: string[];
    }): boolean => {
      if (!activeSavedSession) return false;
      const activeEntry =
        sessionNav.voyageEntries.find(
          (entry) =>
            entry.id === sessionNav.activeVoyageEntryId &&
            entry.tabGroupId === args.tabGroupId,
        ) ||
        sessionNav.voyageEntries.find(
          (entry) => entry.tabGroupId === args.tabGroupId,
        );
      if (activeEntry) {
        updateBookmarkedSessionSearch(
          activeSavedSession.id,
          activeSavedSession.name,
          activeEntry.id,
          {
            ...(args.tabId ? { tabId: args.tabId } : {}),
            ...(args.viewIds ? { viewIds: args.viewIds } : {}),
          },
        );
        // URL navigation above is the live source of truth. Persistence mirrors it.
        // The route-derived nav will react to the URL change.
        const persistence =
          activeEntry && !args.tabId && !args.viewIds
            ? actions.activateSavedVoyageEntry({
                sessionId: activeSavedSession.id,
                voyageEntryId: activeEntry.id,
              })
            : actions.addSelectionToSavedSession({
                sessionId: activeSavedSession.id,
                spaceId: args.spaceId,
                tabGroupId: args.tabGroupId,
                voyageEntryId: activeEntry.id,
                ...(args.tabId ? { tabId: args.tabId } : {}),
                ...(args.viewIds ? { viewIds: args.viewIds } : {}),
              });
        void persistence;
        return true;
      }

      void actions
        .addSelectionToSavedSession({
          sessionId: activeSavedSession.id,
          spaceId: args.spaceId,
          tabGroupId: args.tabGroupId,
          ...(args.tabId ? { tabId: args.tabId } : {}),
          ...(args.viewIds ? { viewIds: args.viewIds } : {}),
        })
        .then(async (result) => {
          const updatedSession = await result;
          if (!updatedSession) return;
          updateBookmarkedSessionSearch(
            updatedSession.id,
            updatedSession.name,
            updatedSession.activeVoyageEntryId,
            {
              session: updatedSession,
              ...(args.tabId ? { tabId: args.tabId } : {}),
              ...(args.viewIds ? { viewIds: args.viewIds } : {}),
            },
          );
        });
      return true;
    };

    const sessionActions = {
      selectSpace: (spaceId: string) => {
        const firstTabGroupId = workspace.spaces.find(
          (space) => space.id === spaceId,
        )?.tabGroupIds[0];
        if (
          firstTabGroupId &&
          persistSavedSelection({ spaceId, tabGroupId: firstTabGroupId })
        ) {
          return;
        }
        if (!activeSavedSession) return;
        sessionNav.selectSpace(spaceId);
      },
      selectSessionTabGroup: (spaceId: string, tabGroupId: string) => {
        if (persistSavedSelection({ spaceId, tabGroupId })) return;
        if (!activeSavedSession) return;
        sessionNav.selectSessionTabGroup(spaceId, tabGroupId);
      },
      selectSessionTab: (
        spaceId: string,
        tabGroupId: string,
        tabId: string,
      ) => {
        if (persistSavedSelection({ spaceId, tabGroupId, tabId })) return;
        if (!activeSavedSession) return;
        sessionNav.selectSessionTab(spaceId, tabGroupId, tabId);
      },
      selectSessionPair: (
        spaceId: string,
        tabGroupId: string,
        pairId: string,
      ) => {
        const renderedPairViewIds = getRenderedPairViewIds(
          effectiveWorkspace,
          tabGroupId,
          pairId,
        );
        if (
          persistSavedSelection({
            spaceId,
            tabGroupId,
            ...(renderedPairViewIds ? { viewIds: renderedPairViewIds } : {}),
          })
        )
          return;
        if (!activeSavedSession) return;
        sessionNav.selectSessionPair(spaceId, tabGroupId, pairId);
      },
      selectVoyageEntry: (voyageEntryId: string) => {
        if (activeSavedSession) {
          updateBookmarkedSessionSearch(
            activeSavedSession.id,
            activeSavedSession.name,
            voyageEntryId,
          );
          void actions.activateSavedVoyageEntry({
            sessionId: activeSavedSession.id,
            voyageEntryId,
          });
          return;
        }
        return;
      },
      selectTab: (tabGroupId: string, tabId: string) => {
        const spaceId =
          workspace.spaces.find((space) =>
            space.tabGroupIds.includes(tabGroupId),
          )?.id || sessionNav.activeSpaceId;
        sessionActions.selectSessionTab(spaceId, tabGroupId, tabId);
      },
      selectPair: (tabGroupId: string, pairId: string) => {
        const spaceId =
          workspace.spaces.find((space) =>
            space.tabGroupIds.includes(tabGroupId),
          )?.id || sessionNav.activeSpaceId;
        sessionActions.selectSessionPair(spaceId, tabGroupId, pairId);
      },
      setActiveTabGroup: (tabGroupId: string) => {
        const spaceId =
          workspace.spaces.find((space) =>
            space.tabGroupIds.includes(tabGroupId),
          )?.id || sessionNav.activeSpaceId;
        if (persistSavedSelection({ spaceId, tabGroupId })) return;
        if (!activeSavedSession) return;
        sessionNav.setActiveTabGroup(tabGroupId);
      },
      getActiveItem: sessionNav.getActiveItem,
      resumeSession: (sessionId: string, voyageEntryId?: string) => {
        const sessionToResume = savedVoyages.find(
          (session) => session.id === sessionId,
        );
        if (!sessionToResume) return;
        updateBookmarkedSessionSearch(sessionId, undefined, voyageEntryId);
      },
      activateSavedSession: (session: SavedWorkspaceSession) => {
        updateBookmarkedSessionSearch(session.id, session.name, undefined, {
          session,
        });
      },
      renameSession: (sessionId: string, name: string) => {
        void actions.renameSavedSession({ id: sessionId, name });
      },
      deleteSession: (sessionId: string) => {
        if (sessionId === browserSessionId) {
          const fallbackSession =
            savedVoyages.find(
              (session) =>
                session.id !== sessionId &&
                !isHomeVoyageDisplayName(session.name || ""),
            ) || savedVoyages.find((session) => session.id !== sessionId);
          if (fallbackSession) {
            updateBookmarkedSessionSearch(
              fallbackSession.id,
              fallbackSession.name,
            );
          }
        }
        void actions.deleteSavedSession({ id: sessionId });
      },
      addTabGroupToSession: (
        tabGroupId: string,
        options?: { allowDuplicate?: boolean; select?: boolean },
      ) => {
        if (options?.select && !options.allowDuplicate) {
          const spaceId =
            workspace.spaces.find((space) =>
              space.tabGroupIds.includes(tabGroupId),
            )?.id || sessionNav.activeSpaceId;
          if (persistSavedSelection({ spaceId, tabGroupId })) return;
        }
        if (!activeSavedSession) return;
        sessionNav.addTabGroupToSession(tabGroupId, options);
      },
      removeVoyageEntryFromSession: (voyageEntryId: string) => {
        if (activeSavedSession) {
          if (voyageEntryId === sessionNav.activeVoyageEntryId) {
            const currentIndex = sessionNav.voyageEntries.findIndex(
              (entry) => entry.id === voyageEntryId,
            );
            const fallbackEntry =
              (currentIndex > 0
                ? sessionNav.voyageEntries[currentIndex - 1]
                : undefined) ||
              sessionNav.voyageEntries[currentIndex + 1] ||
              sessionNav.voyageEntries.find(
                (entry) => entry.id !== voyageEntryId,
              );
            if (fallbackEntry) {
              updateBookmarkedSessionSearch(
                activeSavedSession.id,
                activeSavedSession.name,
                fallbackEntry.id,
              );
            }
          }
          void actions.removeVoyageEntryFromSavedSession({
            sessionId: activeSavedSession.id,
            voyageEntryId,
          });
          return;
        }
        return;
      },
      removeTabGroupFromSession: (tabGroupId: string) => {
        if (activeSavedSession) {
          if (tabGroupId === sessionNav.activeTabGroupId) {
            const currentIndex = sessionNav.voyageEntries.findIndex(
              (entry) => entry.tabGroupId === tabGroupId,
            );
            const fallbackEntry =
              (currentIndex > 0
                ? sessionNav.voyageEntries[currentIndex - 1]
                : undefined) ||
              sessionNav.voyageEntries[currentIndex + 1] ||
              sessionNav.voyageEntries.find(
                (entry) => entry.tabGroupId !== tabGroupId,
              );
            if (fallbackEntry) {
              updateBookmarkedSessionSearch(
                activeSavedSession.id,
                activeSavedSession.name,
                fallbackEntry.id,
              );
            }
          }
          activeSavedSession.voyageEntries
            ?.filter((entry) => entry.tabGroupId === tabGroupId)
            .forEach((entry) => {
              void actions.removeVoyageEntryFromSavedSession({
                sessionId: activeSavedSession.id,
                voyageEntryId: entry.id,
              });
            });
        }
        return;
      },
      reorderVoyageEntries: (sourceEntryId: string, targetEntryId: string) => {
        if (activeSavedSession) {
          void actions.reorderSavedVoyageEntries({
            sessionId: activeSavedSession.id,
            sourceEntryId,
            targetEntryId,
          });
          return;
        }
        return;
      },
      reorderSessionTabGroups: (sourceId: string, targetId: string) => {
        if (activeSavedSession) {
          const sourceEntry = sessionNav.voyageEntries.find(
            (entry) => entry.tabGroupId === sourceId,
          );
          const targetEntry = sessionNav.voyageEntries.find(
            (entry) => entry.tabGroupId === targetId,
          );
          if (sourceEntry && targetEntry) {
            void actions.reorderSavedVoyageEntries({
              sessionId: activeSavedSession.id,
              sourceEntryId: sourceEntry.id,
              targetEntryId: targetEntry.id,
            });
          }
          return;
        }
        return;
      },
    };

    // Wrap actions that need session parameters
    const wrappedActions = {
      ...actions,
      reorderTabGroups: (args: { sourceId: string; targetId: string }) => {
        actions.reorderTabGroups({
          ...args,
          activeSpaceId: sessionNav.activeSpaceId,
        });
      },
      closeActiveTab: async () => {
        const activeItemId = sessionNav.getActiveItem(
          sessionNav.activeTabGroupId,
        );
        const result = await actions.closeActiveTab({
          activeTabGroupId: sessionNav.activeTabGroupId,
          activeItemId,
        });
        // If action returned a tab to select, select it
        if (result?.selectTabId) {
          sessionActions.selectTab(
            sessionNav.activeTabGroupId,
            result.selectTabId,
          );
        }
      },
      addTab: async (args: {
        tabGroupId: string;
        title: string;
        url: string;
      }) => {
        const result = await actions.addTab(args);
        // Auto-select the newly added tab
        if (result?.tabId) {
          sessionActions.selectTab(result.tabGroupId, result.tabId);
        }
      },
      createPair: async (args: { tabGroupId: string; tabIds: string[] }) => {
        const result = await actions.createPair(args);
        // Auto-select the newly created pair
        if (result?.pairId) {
          sessionActions.selectPair(result.tabGroupId, result.pairId);
        }
      },
      deletePair: async (args: { tabGroupId: string; pairId: string }) => {
        const result = await actions.deletePair(args);
        // Auto-select the first tab from the deleted pair
        if (result?.firstTabId) {
          sessionActions.selectTab(result.tabGroupId, result.firstTabId);
        }
      },
      addVKWorkspace: async (args: {
        taskAttemptId: string;
        name: string;
        containerRef: string;
        activeSpaceId: string;
        composition: ResolvedWorkspaceComposition;
      }) => {
        const containerRef = await resolveWorkspaceContainerRef(
          args.taskAttemptId,
          args.containerRef,
        );
        return actions.addVKWorkspace({ ...args, containerRef });
      },
      createSavedSessionForVKWorkspace: async (args: {
        voyageName: string;
        taskAttemptId: string;
        workspaceName: string;
        containerRef: string;
        activeSpaceId: string;
        composition: ResolvedWorkspaceComposition;
      }) => {
        const containerRef = await resolveWorkspaceContainerRef(
          args.taskAttemptId,
          args.containerRef,
        );
        return actions.createSavedSessionForVKWorkspace({
          ...args,
          containerRef,
        });
      },
      openVKWorkspaceInSavedSession: async (args: {
        sessionId: string;
        taskAttemptId: string;
        name: string;
        containerRef: string;
        activeSpaceId: string;
        composition: ResolvedWorkspaceComposition;
      }) => {
        const containerRef = await resolveWorkspaceContainerRef(
          args.taskAttemptId,
          args.containerRef,
        );
        return actions.openVKWorkspaceInSavedSession({
          ...args,
          containerRef,
        });
      },
      ensureCreateWorkspaceTab: () => {
        const baseOrigin = getBaseOrigin();
        return actions.ensureCreateWorkspaceTab({ baseOrigin });
      },
      createCreateWorkspaceCraft: (args: { label?: string } = {}) => {
        const baseOrigin = getBaseOrigin();
        return actions.createCreateWorkspaceCraft({ ...args, baseOrigin });
      },
      createCreateWorkspaceSavedSession: (args: {
        name: string;
        label?: string;
      }) => {
        const baseOrigin = getBaseOrigin();
        return actions.createCreateWorkspaceSavedSession({
          ...args,
          baseOrigin,
        });
      },
    };

    if (dashboardVoyage.status === "not-found") {
      const fallbackSession =
        savedVoyages.find(
          (session) => !isHomeVoyageDisplayName(session.name || ""),
        ) || savedVoyages[0];
      const openFallbackVoyage = () => {
        if (!fallbackSession) return;
        navigate(
          buildCanonicalDashboardPath(location.search, {
            slug: buildVoyageParam(fallbackSession, savedVoyages),
            craftParam: undefined,
            viewTokens: undefined,
          }),
          { replace: true },
        );
      };

      return (
        <div className="dark w-screen h-screen fixed inset-0 bg-neutral-950 text-neutral-100 flex items-center justify-center p-6">
          <div className="w-full max-w-md rounded-2xl border border-neutral-800 bg-neutral-900 p-6 shadow-2xl">
            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-neutral-500">
              Voyage not found
            </div>
            <h1 className="mt-3 text-2xl font-semibold">
              This voyage link no longer resolves.
            </h1>
            <p className="mt-3 text-sm leading-6 text-neutral-400">
              The URL requested “{dashboardVoyage.requestedVoyageKey}”, but that
              voyage is not available in this workspace. Choose a working voyage
              to continue.
            </p>
            <div className="mt-6 flex flex-col gap-3">
              {fallbackSession ? (
                <button
                  className="rounded-lg bg-primary-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-primary-400"
                  onClick={openFallbackVoyage}
                >
                  Open {fallbackSession.name?.trim() || "available voyage"}
                </button>
              ) : (
                <div className="rounded-lg border border-neutral-800 bg-neutral-950 px-4 py-3 text-sm text-neutral-400">
                  No saved voyages are available to recover this link.
                </div>
              )}
            </div>
          </div>
        </div>
      );
    }

    if (
      dashboardVoyage.status === "missing-param" &&
      !missingParamFallbackSession
    ) {
      const defaultCraftName =
        workspace.tabGroups.find(
          (tabGroup) => tabGroup.id === sessionNav.activeTabGroupId,
        )?.label || "your first craft";

      return (
        <div className="dark w-screen h-screen fixed inset-0 bg-neutral-950 text-neutral-100 flex items-center justify-center p-6">
          <div className="w-full max-w-lg rounded-2xl border border-neutral-800 bg-neutral-900 p-6 shadow-2xl">
            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-neutral-500">
              Create your first Voyage
            </div>
            <h1 className="mt-3 text-2xl font-semibold">
              Name the Voyage for this workspace.
            </h1>
            <p className="mt-3 text-sm leading-6 text-neutral-400">
              A Voyage is the named set of craft and views you are working with.
              Naming it gives the URL a stable Voyage identity, so the app can
              restore and share this workspace without relying on hidden browser
              state.
            </p>
            <p className="mt-3 text-sm leading-6 text-neutral-400">
              We will start this Voyage with{" "}
              <span className="font-medium text-neutral-200">
                {defaultCraftName}
              </span>
              . You can add or switch craft after it is created.
            </p>

            <form
              className="mt-6 space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                void createFirstVoyageFromCurrentCraft();
              }}
            >
              <label className="block">
                <span className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
                  Voyage name
                </span>
                <input
                  value={firstVoyageName}
                  onChange={(event) => {
                    setFirstVoyageName(event.target.value);
                    setCreateFirstVoyageError(null);
                  }}
                  aria-label="Voyage name"
                  placeholder="e.g. Client launch, Bug triage, Morning build"
                  autoFocus
                  className="mt-2 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 outline-none placeholder:text-neutral-600 focus:border-primary-400"
                />
              </label>
              {createFirstVoyageError && (
                <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
                  {createFirstVoyageError}
                </div>
              )}
              <button
                type="submit"
                disabled={firstVoyageNameIsInvalid || isCreatingFirstVoyage}
                className="w-full rounded-lg bg-primary-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-primary-400 disabled:cursor-not-allowed disabled:bg-neutral-800 disabled:text-neutral-500"
              >
                {isCreatingFirstVoyage ? "Creating Voyage…" : "Create Voyage"}
              </button>
            </form>
          </div>
        </div>
      );
    }

    return (
      <>
        <div className="dark w-screen h-screen fixed inset-0">
          <WorkspaceShell
            workspace={workspace}
            session={sessionNav}
            actions={normalizeActionReturns(wrappedActions)}
            sessionActions={sessionActions}
            pluginRegistry={pluginRegistryState}
            savedSessions={savedVoyages}
            currentSessionId={browserSessionId}
          />
        </div>
      </>
    );
  };

  const AdminPluginsRoute = () => {
    const [plugins, setPlugins] = useState<PluginAdminStatus[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [updatingPluginId, setUpdatingPluginId] = useState<string | null>(
      null,
    );

    const loadStatuses = async () => {
      setLoading(true);
      setError(null);
      try {
        setPlugins(await fetchPluginAdminStatuses());
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : String(caught));
      } finally {
        setLoading(false);
      }
    };

    useEffect(() => {
      void loadStatuses();
    }, []);

    const updatePluginEnabled = async (pluginId: string, enable: boolean) => {
      setUpdatingPluginId(pluginId);
      setError(null);
      try {
        const plugin = await setPluginAdminDesiredEnabled(pluginId, enable);
        setPlugins((current) =>
          current.map((entry) =>
            entry.pluginId === plugin.pluginId ? plugin : entry,
          ),
        );
        await loadStatuses();
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : String(caught));
      } finally {
        setUpdatingPluginId(null);
      }
    };

    return (
      <main className="dark min-h-screen bg-zinc-950 text-zinc-100 p-8">
        <div className="mx-auto max-w-6xl">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold">Plugin Admin</h1>
              <p className="mt-1 text-sm text-zinc-400">
                Persistent desired state controls sync runtime Supervisor and
                Caddy exposure.
              </p>
            </div>
            <button
              type="button"
              className="rounded-md border border-zinc-700 px-3 py-2 text-sm hover:bg-zinc-900 disabled:opacity-50"
              onClick={() => void loadStatuses()}
              disabled={loading || updatingPluginId !== null}
            >
              Refresh
            </button>
          </div>

          {error ? (
            <div
              role="alert"
              className="mt-6 rounded-md border border-red-800 bg-red-950/40 p-4 text-sm text-red-200"
            >
              {error}
            </div>
          ) : null}

          <div className="mt-6 overflow-hidden rounded-lg border border-zinc-800">
            <table className="w-full border-collapse text-left text-sm">
              <thead className="bg-zinc-900 text-xs uppercase tracking-wide text-zinc-400">
                <tr>
                  <th className="px-4 py-3">Plugin</th>
                  <th className="px-4 py-3">Desired</th>
                  <th className="px-4 py-3">Runtime</th>
                  <th className="px-4 py-3">Install path</th>
                  <th className="px-4 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td className="px-4 py-6 text-zinc-400" colSpan={5}>
                      Loading plugin status…
                    </td>
                  </tr>
                ) : plugins.length === 0 ? (
                  <tr>
                    <td className="px-4 py-6 text-zinc-400" colSpan={5}>
                      No plugins are configured.
                    </td>
                  </tr>
                ) : (
                  plugins.map((plugin) => (
                    <tr
                      key={plugin.pluginId}
                      className="border-t border-zinc-800"
                    >
                      <td className="px-4 py-3">
                        <div className="font-medium">{plugin.name}</div>
                        <div className="text-xs text-zinc-500">
                          {plugin.pluginId} · {plugin.version}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {plugin.desiredEnabled ? "Enabled" : "Disabled"}
                      </td>
                      <td className="px-4 py-3">
                        <div>{plugin.observedState}</div>
                        {plugin.error ? (
                          <div className="mt-1 text-xs text-red-300">
                            {plugin.error}
                          </div>
                        ) : null}
                      </td>
                      <td
                        className="max-w-md truncate px-4 py-3 text-xs text-zinc-400"
                        title={plugin.installPath ?? plugin.pluginPath}
                      >
                        {plugin.installPath ??
                          plugin.pluginPath ??
                          "Unavailable"}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          className="rounded-md border border-zinc-700 px-3 py-2 hover:bg-zinc-900 disabled:opacity-50"
                          disabled={updatingPluginId !== null}
                          onClick={() =>
                            void updatePluginEnabled(
                              plugin.pluginId,
                              !plugin.desiredEnabled,
                            )
                          }
                        >
                          {updatingPluginId === plugin.pluginId
                            ? "Applying…"
                            : plugin.desiredEnabled
                              ? "Disable"
                              : "Enable"}
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    );
  };

  // Root is the canonical dashboard route so PWA installs/bookmarks start from
  // a stable app-home path while query params carry Voyage navigation state.
  moduleAPI.registerRoute("/", { hideApplicationShell: true }, WorkspaceRoute);

  // Compatibility dashboard route. It renders the same app and canonical URL
  // sync redirects Voyage links back to root with the query params intact.
  moduleAPI.registerRoute(
    "/dashboard",
    { hideApplicationShell: true },
    WorkspaceRoute,
  );

  moduleAPI.registerRoute(
    "/dashboard/admin/plugins",
    { hideApplicationShell: true },
    AdminPluginsRoute,
  );

  moduleAPI.registerRoute(
    "/dashboard/teams",
    { hideApplicationShell: true },
    AgentTeamsDashboard,
  );

  moduleAPI.registerRoute(
    "/dashboard/workflows",
    { hideApplicationShell: true },
    WorkspaceWorkflowsPage,
  );

  moduleAPI.registerRoute(
    "/dashboard/workflows/new",
    { hideApplicationShell: true },
    WorkflowCreationWizardPage,
  );

  moduleAPI.registerRoute(
    "/dashboard/workflows/roadmap",
    { hideApplicationShell: true },
    WorkflowRoadmapPage,
  );

  moduleAPI.registerRoute(
    "/dashboard/workflows/library",
    { hideApplicationShell: true },
    WorkflowLibraryPage,
  );

  moduleAPI.registerRoute(
    "/dashboard/workflows/meta-runs",
    { hideApplicationShell: true },
    WorkflowMetaRunsPage,
  );

  moduleAPI.registerRoute(
    "/dashboard/workflows/editor/:designId",
    { hideApplicationShell: true },
    WorkflowGraphEditorPage,
  );

  moduleAPI.registerRoute(
    "/dashboard/workflow-batches/:batchId",
    { hideApplicationShell: true },
    WorkflowBatchDetailPage,
  );

  moduleAPI.registerRoute(
    "/dashboard/workflows/:instanceId",
    { hideApplicationShell: true },
    WorkflowPresentationPage,
  );

  return {
    Provider: (props: React.PropsWithChildren) => {
      return (
        <QueryClientProvider client={queryClient}>
          <HeroUIProvider>{props.children}</HeroUIProvider>
        </QueryClientProvider>
      );
    },
  };
});

type FlattenNestedPromise<T> =
  T extends Promise<unknown> ? Promise<Awaited<T>> : T;

type NormalizeActionReturns<T extends Record<string, (...args: any[]) => any>> =
  {
    [K in keyof T]: (
      ...args: Parameters<T[K]>
    ) => FlattenNestedPromise<ReturnType<T[K]>>;
  };

function normalizeActionReturns<
  T extends Record<string, (...args: any[]) => any>,
>(actions: T) {
  return actions as NormalizeActionReturns<T>;
}
