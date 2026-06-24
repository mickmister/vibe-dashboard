import '@vitejs/plugin-react/preamble';
import '../styles';

import React, { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
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
import type { NewSessionInitialSelection } from '../sessionState';
import { resolveWorkspaceContainerRef } from '../lib/vkWorkspaceOpen';
import {
  fetchPluginAdminStatuses,
  setPluginAdminDesiredEnabled,
  type PluginAdminStatus,
} from '../lib/pluginAdminApi';
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
import { usePluginRegistry } from './plugins/vibe-dashboard/registry';
import type { ResolvedWorkspaceComposition } from './plugins/vibe-dashboard/workspace-composition';

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
      const pluginRegistryState = usePluginRegistry();
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
        if (activeSavedSessionJustChanged) return;

        const now = new Date().toISOString();
        const pendingVoyageName =
          typeof window === 'undefined'
            ? undefined
            : ((window as any).__pendingVoyageNames?.[browserSessionId] as
                | string
                | undefined);
        const voyageName = activeSavedSession?.name?.trim() || pendingVoyageName?.trim();
        if (!voyageName || isHomeVoyageDisplayName(voyageName)) return;

        void actions.upsertSavedSession({
          id: browserSessionId,
          slug: buildVoyageSlug(voyageName, browserSessionId),
          name: voyageName,
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
        activeSavedSessionJustChanged,
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
        if (activeSavedSessionJustChanged) return;
        const currentTabGroup = workspace.tabGroups.find(
          (tg) => tg.id === sessionNav.activeTabGroupId,
        );
        const activeVoyageEntry = sessionNav.voyageEntries.find(
          (entry) => entry.id === sessionNav.activeVoyageEntryId,
        );
        const pendingVoyageName =
          typeof window === 'undefined'
            ? undefined
            : ((window as any).__pendingVoyageNames?.[browserSessionId] as
                | string
                | undefined);
        const voyageName = activeSavedSession?.name?.trim() || pendingVoyageName?.trim();
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
          workspaceId: string;
          name: string;
          containerRef: string;
          activeSpaceId: string;
          composition: ResolvedWorkspaceComposition;
        }) => {
          const containerRef = await resolveWorkspaceContainerRef(
            args.workspaceId,
            args.containerRef,
          );
          return actions.addVKWorkspace({ ...args, containerRef });
        },
        ensureCreateWorkspaceTab: () => {
          const baseOrigin = getBaseOrigin();
          return actions.ensureCreateWorkspaceTab({ baseOrigin });
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
          const sessionToResume = savedVoyages.find(
            (session) => session.id === sessionId,
          );
          if (!sessionToResume) return;
          if (typeof window !== 'undefined') {
            setBrowserSessionId(sessionId);
          }
          updateBookmarkedSessionSearch(sessionId);
          if (voyageEntryId) {
            sessionNav.resumeSession(sessionToResume, voyageEntryId);
          }
        },
        startNewSession: (options?: { name?: string; initialSelection?: NewSessionInitialSelection }) => {
          const nextSessionId = createNewBrowserSessionId();
          if (typeof window !== 'undefined') {
            setBrowserSessionId(nextSessionId);
            (window as any).__pendingVoyageNames = {
              ...((window as any).__pendingVoyageNames || {}),
              [nextSessionId]: options?.name || '',
            };
          }
          updateBookmarkedSessionSearch(nextSessionId, options?.name);
          sessionNav.startNewSession(options?.initialSelection);
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
      const [updatingPluginId, setUpdatingPluginId] = useState<string | null>(null);

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
          setPlugins((current) => current.map((entry) => entry.pluginId === plugin.pluginId ? plugin : entry));
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
                  Persistent desired state controls sync runtime Supervisor and Caddy exposure.
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
              <div role="alert" className="mt-6 rounded-md border border-red-800 bg-red-950/40 p-4 text-sm text-red-200">
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
                      <td className="px-4 py-6 text-zinc-400" colSpan={5}>Loading plugin status…</td>
                    </tr>
                  ) : plugins.length === 0 ? (
                    <tr>
                      <td className="px-4 py-6 text-zinc-400" colSpan={5}>No plugins are configured.</td>
                    </tr>
                  ) : plugins.map((plugin) => (
                    <tr key={plugin.pluginId} className="border-t border-zinc-800">
                      <td className="px-4 py-3">
                        <div className="font-medium">{plugin.name}</div>
                        <div className="text-xs text-zinc-500">{plugin.pluginId} · {plugin.version}</div>
                      </td>
                      <td className="px-4 py-3">{plugin.desiredEnabled ? 'Enabled' : 'Disabled'}</td>
                      <td className="px-4 py-3">
                        <div>{plugin.observedState}</div>
                        {plugin.error ? <div className="mt-1 text-xs text-red-300">{plugin.error}</div> : null}
                      </td>
                      <td className="max-w-md truncate px-4 py-3 text-xs text-zinc-400" title={plugin.installPath ?? plugin.pluginPath}>
                        {plugin.installPath ?? plugin.pluginPath ?? 'Unavailable'}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          className="rounded-md border border-zinc-700 px-3 py-2 hover:bg-zinc-900 disabled:opacity-50"
                          disabled={updatingPluginId !== null}
                          onClick={() => void updatePluginEnabled(plugin.pluginId, !plugin.desiredEnabled)}
                        >
                          {updatingPluginId === plugin.pluginId
                            ? 'Applying…'
                            : plugin.desiredEnabled
                              ? 'Disable'
                              : 'Enable'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </main>
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

    moduleAPI.registerRoute(
      '/dashboard/admin/plugins',
      { hideApplicationShell: true },
      AdminPluginsRoute,
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
