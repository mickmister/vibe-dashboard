import '@vitejs/plugin-react/preamble';
import '../styles';

import React, { useEffect } from 'react';
import { useLocation, useParams, useNavigate } from 'react-router';
import { HeroUIProvider } from '@heroui/react';
import { AppLoadingScreen } from '../components/AppLoadingScreen';
import { WorkspaceShell } from '../components/WorkspaceShell';
import {
  createNewBrowserSessionId,
  getOrCreateBrowserSessionId,
  getStoredBrowserSessionId,
  setBrowserSessionId,
  useSessionWorkspaceNav,
} from '../sessionState';
import { resolveWorkspaceContainerRef } from '../lib/vkWorkspaceOpen';
import {
  buildCraftParam,
  buildViewParam,
  buildVoyageSlug,
  getVoyageSlug,
  parseCraftParam,
  parseViewsParam,
} from '../lib/voyageUrl';
import { resolvePreferredVoyageSessionId } from '../lib/voyageSession';

// Ensure dark class is on the document root so portaled elements (modals, popovers)
// inherit dark mode styles
document.documentElement.classList.add('dark');
springboard.registerSplashScreen(AppLoadingScreen);

import springboard from 'springboard';
import type {
  WorkspaceState,
  SavedWorkspaceSession,
  SavedWorkspaceSessionState,
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

function getSavedSessionDisplayName(
  sessionName: string | undefined,
  tabGroupLabel: string | undefined,
): string {
  return sessionName?.trim() || tabGroupLabel || 'Saved voyage';
}

function isHomeVoyageDisplayName(displayName: string): boolean {
  return displayName.trim().toLowerCase() === 'home';
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

    // Shared route component with legacy path-params plus canonical voyage query-param support
    const WorkspaceRoute = () => {
      const workspaceModule = useModule('workspace');

      const workspace = workspaceModule.states.workspace.useState();
      const savedSessions = workspaceModule.states.savedVoyages.useState();
      const originSessionResume = workspaceModule.states.originVoyageResumeState.useState();

      const actions = workspaceModule.actions;

      const { spaceId, tabGroupId, itemId } = useParams<{
        spaceId?: string;
        tabGroupId?: string;
        itemId?: string;
      }>();
      const location = useLocation();
      const navigate = useNavigate();
      const sessionSearchParams = new URLSearchParams(location.search);
      const requestedVoyageKey = (() => {
        if (typeof window === 'undefined') return undefined;
        const value =
          sessionSearchParams.get('voyage')?.trim() ||
          sessionSearchParams.get('session')?.trim();
        return value || undefined;
      })();
      const requestedLegacySessionId =
        sessionSearchParams.get('session')?.trim() || undefined;
      const queryCraftParam = sessionSearchParams.get('craft')?.trim() || undefined;
      const queryViewsParam = sessionSearchParams.get('views')?.trim() || undefined;
      const hasVoyageBookmarkParam = requestedVoyageKey != null;
      const currentOrigin =
        typeof window === 'undefined' ? undefined : window.location.origin;
      const originDefaultSessionId =
        currentOrigin
          ? originSessionResume.lastSessionByOrigin[currentOrigin]
          : undefined;
      const storedBrowserSessionId =
        typeof window === 'undefined'
          ? null
          : getStoredBrowserSessionId();
      const preferredSessionId = resolvePreferredVoyageSessionId({
        savedSessions: savedSessions.sessions,
        requestedVoyageKey,
        requestedLegacySessionId,
        storedBrowserSessionId,
        originDefaultSessionId,
      });
      const browserSessionId =
        typeof window === 'undefined'
          ? 'server-session'
          : getOrCreateBrowserSessionId(preferredSessionId);
      const activeSavedSession = savedSessions.sessions.find(
        (session) => session.id === browserSessionId,
      );
      const querySelection = resolveQueryCraftSelection(
        workspace,
        activeSavedSession,
        queryCraftParam,
        queryViewsParam,
      );
      const sessionNav = useSessionWorkspaceNav(
        workspace,
        {
          spaceId: querySelection.spaceId || spaceId,
          tabGroupId: querySelection.tabGroupId || tabGroupId,
          itemId: querySelection.itemId || itemId,
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

        const now = new Date().toISOString();
        const currentTabGroup = workspace.tabGroups.find(
          (tg) => tg.id === sessionNav.activeTabGroupId,
        );
        const currentVoyageDisplayName = getSavedSessionDisplayName(
          activeSavedSession?.name,
          currentTabGroup?.label,
        );
        if (isHomeVoyageDisplayName(currentVoyageDisplayName)) return;

        void actions.upsertSavedSession({
          id: browserSessionId,
          slug:
            activeSavedSession?.slug ||
            buildVoyageSlug(
              activeSavedSession?.name || currentTabGroup?.label || 'voyage',
              browserSessionId,
            ),
          name: activeSavedSession?.name,
          createdAt: activeSavedSession?.createdAt || now,
          updatedAt: now,
          activeVoyageEntryId: sessionNav.activeVoyageEntryId,
          voyageEntries: sessionNav.voyageEntries,
          activeSpaceId: sessionNav.activeSpaceId,
          activeTabGroupId: sessionNav.activeTabGroupId,
          activeItemsByVoyageEntryId: sessionNav.activeItemsByVoyageEntryId,
          activeItems: sessionNav.activeItems,
          visitedTabGroupIds: sessionNav.visitedTabGroupIds,
        });
      }, [
        activeSavedSession?.createdAt,
        activeSavedSession?.name,
        activeSavedSession?.slug,
        actions,
        browserSessionId,
        sessionNav.activeItems,
        sessionNav.activeSpaceId,
        sessionNav.activeTabGroupId,
        sessionNav.activeVoyageEntryId,
        sessionNav.activeItemsByVoyageEntryId,
        sessionNav.voyageEntries,
        sessionNav.visitedTabGroupIds,
        workspace.tabGroups,
      ]);

      useEffect(() => {
        if (!(currentOrigin && browserSessionId)) return;
        const currentTabGroup = workspace.tabGroups.find(
          (tg) => tg.id === sessionNav.activeTabGroupId,
        );
        const currentVoyageDisplayName = getSavedSessionDisplayName(
          activeSavedSession?.name,
          currentTabGroup?.label,
        );
        if (isHomeVoyageDisplayName(currentVoyageDisplayName)) return;

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
        workspace.tabGroups,
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
        const currentVoyageSlug =
          activeSavedSession?.slug ||
          buildVoyageSlug(
            activeSavedSession?.name || currentTabGroup?.label || 'voyage',
            browserSessionId,
          );
        const currentVoyageDisplayName = getSavedSessionDisplayName(
          activeSavedSession?.name,
          currentTabGroup?.label,
        );
        if (isHomeVoyageDisplayName(currentVoyageDisplayName)) {
          const nextPath = '/dashboard';
          if (nextPath !== currentPath) {
            navigate(nextPath, { replace: true });
          }
          return;
        }

        const nextSearchParams = new URLSearchParams();
        nextSearchParams.set('voyage', currentVoyageSlug);

        const craftParam = buildCraftParam(currentTabGroup, activeVoyageEntry);
        if (craftParam) {
          nextSearchParams.set('craft', craftParam);
        }

        const activeViewIds = activeVoyageEntry?.viewIds || [];
        const viewTokens = activeViewIds
          .map((viewId) => {
            const tab = currentTabGroup?.tabs.find((entry) => entry.id === viewId);
            return tab ? buildViewParam(tab.title, tab.id) : null;
          })
          .filter((token): token is string => Boolean(token));
        if (viewTokens.length) {
          nextSearchParams.set('views', viewTokens.join(','));
        }

        const nextPath = `/dashboard?${nextSearchParams.toString()}`;
        if (nextPath !== currentPath) {
          navigate(nextPath, { replace: true });
        }
      }, [
        activeSavedSession?.name,
        activeSavedSession?.slug,
        browserSessionId,
        location.search,
        location.pathname,
        navigate,
        sessionNav.activeTabGroupId,
        sessionNav.activeVoyageEntryId,
        sessionNav.voyageEntries,
        workspace.tabGroups,
      ]);

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
        addVSCodeView: async (args: {
          tabGroupId: string;
          target: 'repos' | 'worktree-parent';
        }) => {
          return actions.addVSCodeView({
            ...args,
            baseOrigin: getBaseOrigin(),
          });
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
        ensureCreateWorkspaceTab: () => {
          const baseOrigin = getBaseOrigin();
          return actions.ensureCreateWorkspaceTab({ baseOrigin });
        },
      };

      const updateBookmarkedSessionSearch = (sessionId: string) => {
        if (!hasVoyageBookmarkParam) return;
        const nextSearchParams = new URLSearchParams(location.search);
        const session = savedSessions.sessions.find((entry) => entry.id === sessionId);
        nextSearchParams.set(
          'voyage',
          session ? getVoyageSlug(session) : buildVoyageSlug(undefined, sessionId),
        );
        nextSearchParams.delete('session');
        navigate(`${location.pathname}?${nextSearchParams.toString()}`, {
          replace: true,
        });
      };

      const sessionActions = {
        selectSpace: sessionNav.selectSpace,
        selectSessionTabGroup: sessionNav.selectSessionTabGroup,
        selectSessionTab: sessionNav.selectSessionTab,
        selectSessionPair: sessionNav.selectSessionPair,
        selectVoyageEntry: sessionNav.selectVoyageEntry,
        selectTab: sessionNav.selectTab,
        selectPair: sessionNav.selectPair,
        setActiveTabGroup: sessionNav.setActiveTabGroup,
        getActiveItem: sessionNav.getActiveItem,
        resumeSession: (sessionId: string, voyageEntryId?: string) => {
          const sessionToResume = savedSessions.sessions.find(
            (session) => session.id === sessionId,
          );
          if (!sessionToResume) return;
          if (typeof window !== 'undefined') {
            setBrowserSessionId(sessionId);
          }
          updateBookmarkedSessionSearch(sessionId);
          sessionNav.resumeSession(sessionToResume, voyageEntryId);
        },
        startNewSession: () => {
          const nextSessionId = createNewBrowserSessionId();
          if (typeof window !== 'undefined') {
            setBrowserSessionId(nextSessionId);
          }
          updateBookmarkedSessionSearch(nextSessionId);
          sessionNav.startNewSession();
          return nextSessionId;
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
          sessionNav.removeVoyageEntryFromSession(voyageEntryId);
        },
        removeTabGroupFromSession: (tabGroupId: string) => {
          sessionNav.removeTabGroupFromSession(tabGroupId);
        },
        reorderVoyageEntries: (sourceEntryId: string, targetEntryId: string) => {
          sessionNav.reorderVoyageEntries(sourceEntryId, targetEntryId);
        },
        reorderSessionTabGroups: (sourceId: string, targetId: string) => {
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
              savedSessions={savedSessions.sessions}
              currentSessionId={browserSessionId}
            />
          </div>
        </>
      );
    };

    // Root redirects to /dashboard (for dev server case)
    moduleAPI.registerRoute('/', { hideApplicationShell: true }, RootRedirect);

    // Register dashboard routes with increasing specificity
    moduleAPI.registerRoute(
      '/dashboard',
      { hideApplicationShell: true },
      WorkspaceRoute,
    );
    moduleAPI.registerRoute(
      '/dashboard/spaces/:spaceId',
      { hideApplicationShell: true },
      WorkspaceRoute,
    );
    moduleAPI.registerRoute(
      '/dashboard/spaces/:spaceId/:tabGroupId',
      { hideApplicationShell: true },
      WorkspaceRoute,
    );
    moduleAPI.registerRoute(
      '/dashboard/spaces/:spaceId/:tabGroupId/:itemId',
      { hideApplicationShell: true },
      WorkspaceRoute,
    );

    return {
      Provider: (props: React.PropsWithChildren) => {
        return <HeroUIProvider>{props.children}</HeroUIProvider>;
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
