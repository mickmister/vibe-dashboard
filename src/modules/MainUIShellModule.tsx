import '@vitejs/plugin-react/preamble';
import '../styles';

import React, { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { HeroUIProvider } from '@heroui/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AppLoadingScreen } from '../components/AppLoadingScreen';
import { WorkspaceShell } from '../components/WorkspaceShell';
import {
  createNewBrowserSessionId,
  getOrCreateBrowserSessionId,
  getStoredBrowserSessionId,
  setBrowserSessionId,
  useSessionWorkspaceNav,
} from '../sessionState';
import type { NewSessionInitialSelection } from '../sessionState';
import { resolveWorkspaceContainerRef } from '../lib/vkWorkspaceOpen';
import {
  buildCanonicalDashboardPath,
  buildCraftParam,
  buildViewParam,
  buildVoyageSlug,
  getVoyageSlug,
  parseCraftParam,
  parseViewsParam,
} from '../lib/voyageUrl';
import {
  resolvePreferredVoyageSessionId,
  resolveRequestedVoyageSessionId,
} from '../lib/voyageSession';
import { getSavedWorkspaceSessions } from '../lib/savedVoyageState';

// Ensure dark class is on the document root so portaled elements (modals, popovers)
// inherit dark mode styles
document.documentElement.classList.add('dark');
springboard.registerSplashScreen(AppLoadingScreen);

import springboard from 'springboard';
import type {
  WorkspaceState,
  SavedWorkspaceSession,
} from '../types';
import { useModule } from '../hooks/useModule';

const URL_PARSE_BASE = 'https://workspace.local';
const MOBILE_TAB_EMOJIS = [
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
  return '';
}

function isHomeVoyageDisplayName(displayName: string): boolean {
  return displayName.trim().toLowerCase() === 'home';
}

function isDefaultHomeOverviewCraft(
  workspace: WorkspaceState,
  activeSpaceId: string,
  activeTabGroupId: string,
): boolean {
  const activeSpace = workspace.spaces.find((space) => space.id === activeSpaceId);
  const activeTabGroup = workspace.tabGroups.find(
    (tabGroup) => tabGroup.id === activeTabGroupId,
  );

  return Boolean(
    activeSpace?.isSystem &&
      activeTabGroup &&
      activeSpace.tabGroupIds[0] === activeTabGroup.id &&
      activeTabGroup.tabs.some((tab) => tab.url === 'internal://spaces-overview'),
  );
}

function getDraftVoyageNameForActiveCraft(
  workspace: WorkspaceState,
  activeTabGroupId: string,
): string {
  return (
    workspace.tabGroups.find((tabGroup) => tabGroup.id === activeTabGroupId)?.label.trim() ||
    'Untitled voyage'
  );
}

function getIdSuffix(id: string): string {
  const parts = id.split(/[_-]/).filter(Boolean);
  return parts[parts.length - 1] || id;
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
      getIdSuffix(entry.id) === parsedCraft.entrySuffix &&
      getIdSuffix(entry.tabGroupId) === parsedCraft.tabGroupSuffix,
  );
  if (!matchingEntry) return {};

  const tabGroup = workspace.tabGroups.find((entry) => entry.id === matchingEntry.tabGroupId);
  if (!tabGroup) return {};

  const viewSuffixes = parseViewsParam(viewParam);
  const viewIds = viewSuffixes
    .map((suffix) => tabGroup.tabs.find((tab) => getIdSuffix(tab.id) === suffix)?.id)
    .filter((id): id is string => Boolean(id));
  const resolvedViewIds = viewIds.length ? viewIds : matchingEntry.viewIds;
  const itemId =
    resolvedViewIds.length > 1
      ? tabGroup.pairs.find(
          (pair) =>
            pair.tabIds.length === resolvedViewIds.length &&
            pair.tabIds.every((tabId, index) => tabId === resolvedViewIds[index]),
        )?.id || resolvedViewIds[0]
      : resolvedViewIds[0];

  return {
    spaceId: workspace.spaces.find((space) => space.tabGroupIds.includes(tabGroup.id))?.id,
    tabGroupId: tabGroup.id,
    itemId,
    voyageEntryId: matchingEntry.id,
    viewIds: resolvedViewIds,
  };
}

springboard.registerModule(
  'MainUIShell',
  {},
  async (moduleAPI) => {
    // Redirect component for root path (dev server case)
    const RootRedirect = () => {
      const navigate = useNavigate();
      const location = useLocation();
      useEffect(() => {
        navigate(`/dashboard${location.search}`, { replace: true });
      }, [location.search, navigate]);
      return null;
    };

    // Shared route component with canonical voyage query-param support
    const WorkspaceRoute = () => {
      const workspaceModule = useModule('workspace');

      const workspace = workspaceModule.states.workspace.useState();
      const savedSessions = workspaceModule.states.savedVoyages.useState();
      const savedVoyages = getSavedWorkspaceSessions(savedSessions);
      const originSessionResume = workspaceModule.states.originVoyageResumeState.useState();

      const actions = workspaceModule.actions;

      const location = useLocation();
      const navigate = useNavigate();
      const sessionSearchParams = new URLSearchParams(location.search);
      const initialBrowserSessionRef = useRef<{
        initialized: boolean;
        sessionId: string;
      }>({ initialized: false, sessionId: 'server-session' });
      const requestedVoyageKey = (() => {
        if (typeof window === 'undefined') return undefined;
        const value = sessionSearchParams.get('voyage')?.trim();
        return value || undefined;
      })();
      const queryCraftParam = sessionSearchParams.get('craft')?.trim() || undefined;
      const queryViewsParam = sessionSearchParams.get('views')?.trim() || undefined;
      const currentOrigin =
        typeof window === 'undefined' ? undefined : window.location.origin;
      const originDefaultSessionId =
        currentOrigin
          ? originSessionResume.lastSessionByOrigin[currentOrigin]
          : undefined;
      const requestedSessionId = resolveRequestedVoyageSessionId({
        savedSessions: savedVoyages,
        requestedVoyageKey,
      });
      if (!initialBrowserSessionRef.current.initialized) {
        const storedBrowserSessionId =
          typeof window === 'undefined'
            ? null
            : getStoredBrowserSessionId();
        const preferredSessionId = resolvePreferredVoyageSessionId({
          savedSessions: savedVoyages,
          storedBrowserSessionId,
          originDefaultSessionId,
        });
        initialBrowserSessionRef.current = {
          initialized: true,
          sessionId:
            typeof window === 'undefined'
              ? 'server-session'
              : getOrCreateBrowserSessionId(preferredSessionId),
        };
      }
      const browserSessionId =
        typeof window === 'undefined'
          ? 'server-session'
          : requestedVoyageKey
            ? requestedSessionId
              ? getOrCreateBrowserSessionId(requestedSessionId)
              : requestedVoyageKey
            : initialBrowserSessionRef.current.sessionId;
      const activeSavedSession = savedVoyages.find(
        (session) => session.id === browserSessionId,
      );
      const previousActiveSavedSessionIdRef = useRef(activeSavedSession?.id);
      const pendingSavedSessionActivationIdRef = useRef<string | null>(null);
      const activeSavedSessionJustChanged =
        previousActiveSavedSessionIdRef.current !== activeSavedSession?.id;

      const querySelection = resolveQueryCraftSelection(
        workspace,
        activeSavedSession,
        queryCraftParam,
        queryViewsParam,
      );
      const sessionNav = useSessionWorkspaceNav(
        workspace,
        {
          spaceId: querySelection.spaceId,
          tabGroupId: querySelection.tabGroupId,
          itemId: querySelection.itemId,
          voyageEntryId: querySelection.voyageEntryId,
          viewIds: querySelection.viewIds,
        },
        activeSavedSession,
      );

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
        workspace.tabGroups,
      ]);

      // Record visit timestamp when active tab group changes
      useEffect(() => {
        if (sessionNav.activeTabGroupId) {
          actions.touchTabGroup({ tabGroupId: sessionNav.activeTabGroupId });
        }
      }, [sessionNav.activeTabGroupId]);

      useEffect(() => {
        if (!(sessionNav.activeSpaceId && sessionNav.activeTabGroupId)) return;
        const pendingSavedSessionActivationId =
          pendingSavedSessionActivationIdRef.current;
        if (pendingSavedSessionActivationId) {
          if (
            browserSessionId !== pendingSavedSessionActivationId ||
            activeSavedSession?.id !== pendingSavedSessionActivationId
          ) {
            return;
          }
          pendingSavedSessionActivationIdRef.current = null;
        }
        if (activeSavedSessionJustChanged && activeSavedSession) return;

        const now = new Date().toISOString();
        const shouldPersistDraftVoyage =
          !activeSavedSession &&
          !isDefaultHomeOverviewCraft(
            workspace,
            sessionNav.activeSpaceId,
            sessionNav.activeTabGroupId,
          );
        if (!shouldPersistDraftVoyage) return;

        const voyageName = getDraftVoyageNameForActiveCraft(
          workspace,
          sessionNav.activeTabGroupId,
        );
        if (!voyageName || isHomeVoyageDisplayName(voyageName)) return;

        void actions.upsertSavedSession({
          id: browserSessionId,
          slug: buildVoyageSlug(voyageName, browserSessionId),
          name: voyageName,
          createdAt: now,
          updatedAt: now,
          activeVoyageEntryId: sessionNav.activeVoyageEntryId,
          voyageEntries: sessionNav.voyageEntries,
          activeSpaceId: sessionNav.activeSpaceId,
          activeTabGroupId: sessionNav.activeTabGroupId,
          activeItemsByVoyageEntryId: sessionNav.activeItemsByVoyageEntryId,
          visitedTabGroupIds: sessionNav.visitedTabGroupIds,
        });
      }, [
        activeSavedSession?.createdAt,
        activeSavedSession?.id,
        activeSavedSession?.name,
        activeSavedSession?.slug,
        activeSavedSessionJustChanged,
        actions,
        browserSessionId,
        sessionNav.activeSpaceId,
        sessionNav.activeTabGroupId,
        sessionNav.activeVoyageEntryId,
        sessionNav.activeItemsByVoyageEntryId,
        sessionNav.voyageEntries,
        sessionNav.visitedTabGroupIds,
        workspace.spaces,
        workspace.tabGroups,
      ]);

      useEffect(() => {
        if (!(currentOrigin && browserSessionId)) return;
        const activeVoyageName = activeSavedSession?.name?.trim();
        if (!activeVoyageName || isHomeVoyageDisplayName(activeVoyageName)) return;

        void actions.setOriginDefaultSession({
          origin: currentOrigin,
          sessionId: browserSessionId,
        });
      }, [
        actions,
        activeSavedSession?.name,
        browserSessionId,
        currentOrigin,
        sessionNav.activeTabGroupId,
      ]);

      // Sync URL to match canonical voyage/craft/views query params
      useEffect(() => {
        const currentPath = `${location.pathname}${location.search}`;
        const currentTabGroup = workspace.tabGroups.find(
          (tg) => tg.id === sessionNav.activeTabGroupId,
        );
        const activeVoyageEntry = sessionNav.voyageEntries.find(
          (entry) => entry.id === sessionNav.activeVoyageEntryId,
        );
        const voyageName = activeSavedSession?.name?.trim();
        if (!voyageName || isHomeVoyageDisplayName(voyageName)) {
          if (requestedVoyageKey && !activeSavedSession) return;
          const nextPath = buildCanonicalDashboardPath(location.search, undefined);
          if (nextPath !== currentPath) {
            navigate(nextPath, { replace: true });
          }
          return;
        }
        const currentVoyageSlug = buildVoyageSlug(voyageName, browserSessionId);

        const craftParam = buildCraftParam(currentTabGroup, activeVoyageEntry);

        const activeViewIds = activeVoyageEntry?.viewIds || [];
        const viewTokens = activeViewIds
          .map((viewId) => {
            const tab = currentTabGroup?.tabs.find((entry) => entry.id === viewId);
            return tab ? buildViewParam(tab.title, tab.id) : null;
          })
          .filter((token): token is string => Boolean(token));

        const nextPath = buildCanonicalDashboardPath(location.search, {
          slug: currentVoyageSlug,
          craftParam,
          viewTokens,
        });
        if (nextPath !== currentPath) {
          navigate(nextPath, { replace: true });
        }
      }, [
        activeSavedSession?.name,
        activeSavedSession?.slug,
        activeSavedSessionJustChanged,
        browserSessionId,
        location.search,
        location.pathname,
        navigate,
        requestedVoyageKey,
        sessionNav.activeTabGroupId,
        sessionNav.activeVoyageEntryId,
        sessionNav.voyageEntries,
        workspace.tabGroups,
      ]);

      useEffect(() => {
        previousActiveSavedSessionIdRef.current = activeSavedSession?.id;
      }, [activeSavedSession?.id]);

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
            sessionNav.selectTab(
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
            sessionNav.selectTab(result.tabGroupId, result.tabId);
          }
        },
        createPair: async (args: { tabGroupId: string; tabIds: string[] }) => {
          const result = await actions.createPair(args);
          // Auto-select the newly created pair
          if (result?.pairId) {
            sessionNav.selectPair(result.tabGroupId, result.pairId);
          }
        },
        deletePair: async (args: { tabGroupId: string; pairId: string }) => {
          const result = await actions.deletePair(args);
          // Auto-select the first tab from the deleted pair
          if (result?.firstTabId) {
            sessionNav.selectTab(result.tabGroupId, result.firstTabId);
          }
        },
        addVKWorkspace: async (args: {
          taskAttemptId: string;
          name: string;
          containerRef: string;
          activeSpaceId: string;
        }) => {
          const baseOrigin = getBaseOrigin();
          const containerRef = await resolveWorkspaceContainerRef(
            args.taskAttemptId,
            args.containerRef,
          );
          return actions.addVKWorkspace({ ...args, containerRef, baseOrigin });
        },
        createSavedSessionForVKWorkspace: async (args: {
          voyageName: string;
          taskAttemptId: string;
          workspaceName: string;
          containerRef: string;
          activeSpaceId: string;
        }) => {
          const baseOrigin = getBaseOrigin();
          const containerRef = await resolveWorkspaceContainerRef(
            args.taskAttemptId,
            args.containerRef,
          );
          return actions.createSavedSessionForVKWorkspace({
            ...args,
            containerRef,
            baseOrigin,
          });
        },
        openVKWorkspaceInSavedSession: async (args: {
          sessionId: string;
          taskAttemptId: string;
          name: string;
          containerRef: string;
          activeSpaceId: string;
        }) => {
          const baseOrigin = getBaseOrigin();
          const containerRef = await resolveWorkspaceContainerRef(
            args.taskAttemptId,
            args.containerRef,
          );
          return actions.openVKWorkspaceInSavedSession({
            ...args,
            containerRef,
            baseOrigin,
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

      const updateBookmarkedSessionSearch = (sessionId: string, name?: string) => {
        const nextSearchParams = new URLSearchParams(location.search);
        const session = savedVoyages.find((entry) => entry.id === sessionId);
        const voyageName = session?.name?.trim() || name?.trim();
        nextSearchParams.delete('session');

        if (!voyageName || isHomeVoyageDisplayName(voyageName)) {
          nextSearchParams.delete('voyage');
          const nextSearch = nextSearchParams.toString();
          navigate(`${location.pathname}${nextSearch ? `?${nextSearch}` : ''}`, {
            replace: true,
          });
          return;
        }

        nextSearchParams.set(
          'voyage',
          session ? getVoyageSlug(session) : buildVoyageSlug(voyageName, sessionId),
        );
        navigate(`${location.pathname}?${nextSearchParams.toString()}`, {
          replace: true,
        });
      };

      const persistSavedSelection = (args: {
        spaceId: string;
        tabGroupId: string;
        tabId?: string;
        viewIds?: string[];
      }) => {
        if (!activeSavedSession) return;
        const activeEntry = sessionNav.voyageEntries.find(
          (entry) =>
            entry.id === sessionNav.activeVoyageEntryId &&
            entry.tabGroupId === args.tabGroupId,
        ) || sessionNav.voyageEntries.find(
          (entry) => entry.tabGroupId === args.tabGroupId,
        );
        void actions.addSelectionToSavedSession({
          sessionId: activeSavedSession.id,
          spaceId: args.spaceId,
          tabGroupId: args.tabGroupId,
          ...(activeEntry ? { voyageEntryId: activeEntry.id } : {}),
          ...(args.tabId ? { tabId: args.tabId } : {}),
          ...(args.viewIds ? { viewIds: args.viewIds } : {}),
        });
      };

      const sessionActions = {
        selectSpace: sessionNav.selectSpace,
        selectSessionTabGroup: (spaceId: string, tabGroupId: string) => {
          sessionNav.selectSessionTabGroup(spaceId, tabGroupId);
          persistSavedSelection({ spaceId, tabGroupId });
        },
        selectSessionTab: (spaceId: string, tabGroupId: string, tabId: string) => {
          sessionNav.selectSessionTab(spaceId, tabGroupId, tabId);
          persistSavedSelection({ spaceId, tabGroupId, tabId });
        },
        selectSessionPair: (spaceId: string, tabGroupId: string, pairId: string) => {
          sessionNav.selectSessionPair(spaceId, tabGroupId, pairId);
          const pair = workspace.tabGroups
            .find((tabGroup) => tabGroup.id === tabGroupId)
            ?.pairs.find((candidate) => candidate.id === pairId);
          persistSavedSelection({
            spaceId,
            tabGroupId,
            ...(pair ? { viewIds: pair.tabIds } : {}),
          });
        },
        selectVoyageEntry: (voyageEntryId: string) => {
          sessionNav.selectVoyageEntry(voyageEntryId);
          if (activeSavedSession) {
            void actions.activateSavedVoyageEntry({
              sessionId: activeSavedSession.id,
              voyageEntryId,
            });
          }
        },
        selectTab: (tabGroupId: string, tabId: string) => {
          const spaceId =
            workspace.spaces.find((space) => space.tabGroupIds.includes(tabGroupId))?.id ||
            sessionNav.activeSpaceId;
          sessionActions.selectSessionTab(spaceId, tabGroupId, tabId);
        },
        selectPair: (tabGroupId: string, pairId: string) => {
          const spaceId =
            workspace.spaces.find((space) => space.tabGroupIds.includes(tabGroupId))?.id ||
            sessionNav.activeSpaceId;
          sessionActions.selectSessionPair(spaceId, tabGroupId, pairId);
        },
        setActiveTabGroup: (tabGroupId: string) => {
          sessionNav.setActiveTabGroup(tabGroupId);
        },
        getActiveItem: sessionNav.getActiveItem,
        resumeSession: (sessionId: string, voyageEntryId?: string) => {
          const sessionToResume = savedVoyages.find(
            (session) => session.id === sessionId,
          );
          if (!sessionToResume) return;
          pendingSavedSessionActivationIdRef.current = sessionId;
          if (typeof window !== 'undefined') {
            setBrowserSessionId(sessionId);
          }
          updateBookmarkedSessionSearch(sessionId);
          if (voyageEntryId) {
            sessionNav.resumeSession(sessionToResume, voyageEntryId);
          }
        },
        activateSavedSession: (session: SavedWorkspaceSession) => {
          pendingSavedSessionActivationIdRef.current = session.id;
          if (typeof window !== 'undefined') {
            setBrowserSessionId(session.id);
          }
          sessionNav.resumeSession(session);
          const nextSearchParams = new URLSearchParams(location.search);
          nextSearchParams.delete('session');
          nextSearchParams.set('voyage', session.id);
          navigate(`${location.pathname}?${nextSearchParams.toString()}`, {
            replace: true,
          });
        },
        renameSession: (sessionId: string, name: string) => {
          void actions.renameSavedSession({ id: sessionId, name });
        },
        deleteSession: (sessionId: string) => {
          if (sessionId === browserSessionId) {
            const nextSessionId = createNewBrowserSessionId();
            if (typeof window !== 'undefined') {
              setBrowserSessionId(nextSessionId);
            }
            updateBookmarkedSessionSearch(nextSessionId);
            sessionNav.startNewSession();
          }
          void actions.deleteSavedSession({ id: sessionId });
        },
        addTabGroupToSession: (
          tabGroupId: string,
          options?: { allowDuplicate?: boolean; select?: boolean },
        ) => {
          sessionNav.addTabGroupToSession(tabGroupId, options);
        },
        removeVoyageEntryFromSession: (voyageEntryId: string) => {
          if (activeSavedSession) {
            void actions.removeVoyageEntryFromSavedSession({
              sessionId: activeSavedSession.id,
              voyageEntryId,
            });
          }
          sessionNav.removeVoyageEntryFromSession(voyageEntryId);
        },
        removeTabGroupFromSession: (tabGroupId: string) => {
          if (activeSavedSession) {
            activeSavedSession.voyageEntries
              ?.filter((entry) => entry.tabGroupId === tabGroupId)
              .forEach((entry) => {
                void actions.removeVoyageEntryFromSavedSession({
                  sessionId: activeSavedSession.id,
                  voyageEntryId: entry.id,
                });
              });
          }
          sessionNav.removeTabGroupFromSession(tabGroupId);
        },
        reorderVoyageEntries: (sourceEntryId: string, targetEntryId: string) => {
          if (activeSavedSession) {
            void actions.reorderSavedVoyageEntries({
              sessionId: activeSavedSession.id,
              sourceEntryId,
              targetEntryId,
            });
          }
          sessionNav.reorderVoyageEntries(sourceEntryId, targetEntryId);
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
          }
          sessionNav.reorderSessionTabGroups(sourceId, targetId);
        },
      };

      return (
        <>
          <div className="dark w-screen h-screen fixed inset-0">
            <WorkspaceShell
              workspace={workspace}
              session={sessionNav}
              actions={normalizeActionReturns(wrappedActions)}
              sessionActions={sessionActions}
              savedSessions={savedVoyages}
              currentSessionId={browserSessionId}
            />
          </div>
        </>
      );
    };

    // Root redirects to /dashboard (for dev server case)
    moduleAPI.registerRoute('/', { hideApplicationShell: true }, RootRedirect);

    // Canonical dashboard route. Craft/view deep links use query params.
    moduleAPI.registerRoute(
      '/dashboard',
      { hideApplicationShell: true },
      WorkspaceRoute,
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
  },
);

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
