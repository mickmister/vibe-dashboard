import type {
  Craft,
  SavedWorkspaceSession,
  Tab,
  VoyageEntry,
  WorkspaceState,
} from '../types';

export const LAST_DASHBOARD_URL_STORAGE_KEY = 'workspace-last-dashboard-url';
export const CANONICAL_DASHBOARD_PATHNAME = '/';
const URL_PARSE_BASE = 'https://workspace.local';

type DashboardUrlStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function slugifyPart(value: string): string {
  const normalized = value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || 'item';
}

function getTrailingIdParts(id: string): string[] {
  return id.split(/[_-]/).filter(Boolean);
}

export function getShortIdToken(id: string, peerIds: string[] = []): string {
  const parts = getTrailingIdParts(id);
  if (!parts.length) return id;

  for (let partCount = 1; partCount <= parts.length; partCount += 1) {
    const candidate = parts.slice(parts.length - partCount).join('_');
    const collision = peerIds.some((peerId) => {
      if (peerId === id) return false;
      const peerParts = getTrailingIdParts(peerId);
      return peerParts.slice(peerParts.length - partCount).join('_') === candidate;
    });
    if (!collision) return candidate;
  }

  return id;
}

export function shortIdTokenMatches(
  id: string,
  token: string | undefined,
  peerIds: string[] = [],
): boolean {
  if (!token) return false;
  return id === token || getShortIdToken(id, peerIds) === token;
}

export function buildVoyageSlug(label: string | undefined, id: string): string {
  return `${slugifyPart(label || 'voyage')}-${getShortIdToken(id)}`;
}

export function getVoyageSlug(session: SavedWorkspaceSession): string {
  return session.slug || buildVoyageSlug(session.name, session.id);
}

export function buildVoyageParam(
  session: SavedWorkspaceSession,
  sessions: SavedWorkspaceSession[] = [session],
): string {
  return `${slugifyPart(session.name || 'voyage')}-${getShortIdToken(
    session.id,
    sessions.map((entry) => entry.id),
  )}`;
}

export function buildCraftParam(
  tabGroup: Craft | undefined,
  entry: VoyageEntry | undefined,
  options: {
    tabGroups?: Craft[];
    voyageEntries?: VoyageEntry[];
  } = {},
): string | null {
  if (!(tabGroup && entry)) return null;
  return `${slugifyPart(tabGroup.label)}-${getShortIdToken(
    tabGroup.id,
    options.tabGroups?.map((candidate) => candidate.id) || [tabGroup.id],
  )}-${getShortIdToken(
    entry.id,
    options.voyageEntries?.map((candidate) => candidate.id) || [entry.id],
  )}`;
}

export function parseCraftParam(value: string | null | undefined): {
  tabGroupSuffix: string;
  entrySuffix: string;
} | null {
  if (!value) return null;
  const parts = value.split('-').filter(Boolean);
  if (parts.length < 3) return null;
  const entrySuffix = parts[parts.length - 1];
  const tabGroupSuffix = parts[parts.length - 2];
  if (!(tabGroupSuffix && entrySuffix)) return null;
  return { tabGroupSuffix, entrySuffix };
}

export function buildViewParam(label: string, id: string, peerIds: string[] = [id]): string {
  return `${slugifyPart(label)}-${getShortIdToken(id, peerIds)}`;
}

function encodeRuntimeViewTokenPart(value: string): string {
  return encodeURIComponent(value).replaceAll('%2F', '/');
}

export function getRuntimeCraftSurfaceViewToken(
  tab: Pick<Tab, 'ephemeral'> | undefined,
): string | null {
  if (tab?.ephemeral?.kind !== 'craft-surface') return null;
  const sourceKey = tab.ephemeral.sourceKey || tab.ephemeral.surfaceKey;
  if (!(tab.ephemeral.pluginId && sourceKey)) return null;
  return `runtime:${encodeRuntimeViewTokenPart(tab.ephemeral.pluginId)}/${encodeRuntimeViewTokenPart(sourceKey)}`;
}

export function buildViewParamForTab(
  tab: Pick<Tab, 'id' | 'title' | 'ephemeral'>,
  peerTabs: Array<Pick<Tab, 'id'>>,
): string {
  return (
    getRuntimeCraftSurfaceViewToken(tab) ||
    buildViewParam(
      tab.title,
      tab.id,
      peerTabs.map((candidate) => candidate.id),
    )
  );
}

export function parseViewParam(value: string | null | undefined): string | null {
  if (!value) return null;
  if (value.startsWith('runtime:')) return value;
  const parts = value.split('-').filter(Boolean);
  return parts[parts.length - 1] || null;
}

export function parseViewsParam(value: string | null | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((entry) => parseViewParam(entry.trim()))
    .filter((entry): entry is string => Boolean(entry));
}

export function resolveViewIdsFromViewParam(
  tabs: Array<Pick<Tab, 'id' | 'title' | 'ephemeral'>>,
  value: string | null | undefined,
): string[] {
  const tokens = parseViewsParam(value);
  if (!tokens.length) return [];

  const tabIds = tabs.map((tab) => tab.id);
  return tokens
    .map((token) => {
      const runtimeMatch = tabs.find(
        (tab) => getRuntimeCraftSurfaceViewToken(tab) === token,
      );
      if (runtimeMatch) return runtimeMatch.id;
      if (token.startsWith('runtime:')) return undefined;

      return tabs.find((tab) => {
        if (getRuntimeCraftSurfaceViewToken(tab)) return false;
        return shortIdTokenMatches(tab.id, token, tabIds);
      })?.id;
    })
    .filter((id): id is string => Boolean(id));
}

export function buildCanonicalDashboardPath(
  currentSearch: string,
  voyage:
    | {
        slug: string;
        craftParam?: string | null;
        viewTokens?: string[];
      }
    | undefined,
): string {
  const searchParams = new URLSearchParams(currentSearch);
  searchParams.delete('session');
  searchParams.delete('voyage');
  searchParams.delete('craft');
  searchParams.delete('views');

  if (voyage?.slug) {
    searchParams.set('voyage', voyage.slug);
    if (voyage.craftParam) {
      searchParams.set('craft', voyage.craftParam);
    }
    if (voyage.viewTokens?.length) {
      searchParams.set('views', voyage.viewTokens.join(','));
    }
  }

  const nextSearch = searchParams.toString();
  return `${CANONICAL_DASHBOARD_PATHNAME}${nextSearch ? `?${nextSearch}` : ''}`;
}

export function buildSavedVoyageDashboardPath({
  currentSearch,
  workspace,
  session,
  savedSessions,
  voyageEntryId,
  tabId,
  viewIds,
}: {
  currentSearch: string;
  workspace: Pick<WorkspaceState, 'tabGroups'>;
  session: SavedWorkspaceSession;
  savedSessions?: SavedWorkspaceSession[];
  voyageEntryId?: string;
  tabId?: string;
  viewIds?: string[];
}): string {
  const requestedEntry = session.voyageEntries.find(
    (entry) => entry.id === voyageEntryId,
  );
  const activeEntry = session.voyageEntries.find(
    (entry) => entry.id === session.activeVoyageEntryId,
  );
  const entry = requestedEntry || activeEntry || session.voyageEntries[0];
  const tabGroup = workspace.tabGroups.find(
    (candidate) => candidate.id === entry?.tabGroupId,
  );
  const selectedViewIds = viewIds?.length
    ? viewIds
    : tabId
      ? [tabId]
      : entry?.viewIds;
  const viewTokens =
    tabGroup && selectedViewIds?.length
      ? selectedViewIds
          .map((viewId) => {
            const tab = tabGroup.tabs.find((candidate) => candidate.id === viewId);
            return tab ? buildViewParamForTab(tab, tabGroup.tabs) : null;
          })
          .filter((token): token is string => Boolean(token))
      : undefined;

  return buildCanonicalDashboardPath(currentSearch, {
    slug: buildVoyageParam(session, savedSessions),
    craftParam: buildCraftParam(tabGroup, entry, {
      tabGroups: workspace.tabGroups,
      voyageEntries: session.voyageEntries,
    }),
    viewTokens,
  });
}

export function normalizeStoredDashboardUrl(value: string | null | undefined): string | undefined {
  if (!value) return undefined;

  try {
    const url = new URL(value, URL_PARSE_BASE);
    const voyageKey = url.searchParams.get('voyage')?.trim();
    if (
      !(
        url.pathname === CANONICAL_DASHBOARD_PATHNAME ||
        url.pathname === '/dashboard'
      ) ||
      !voyageKey
    ) return undefined;

    const cachedSearch = new URLSearchParams();
    cachedSearch.set('voyage', voyageKey);
    const craft = url.searchParams.get('craft')?.trim();
    if (craft) cachedSearch.set('craft', craft);
    const views = url.searchParams.get('views')?.trim();
    if (views) cachedSearch.set('views', views);

    return `${CANONICAL_DASHBOARD_PATHNAME}?${cachedSearch.toString()}`;
  } catch {
    return undefined;
  }
}

export function getStoredLastDashboardUrl(
  storage: DashboardUrlStorage | undefined =
    typeof window === 'undefined' ? undefined : window.localStorage,
): string | undefined {
  if (!storage) return undefined;
  try {
    return normalizeStoredDashboardUrl(
      storage.getItem(LAST_DASHBOARD_URL_STORAGE_KEY),
    );
  } catch {
    return undefined;
  }
}

export function setStoredLastDashboardUrl(
  url: string,
  storage: DashboardUrlStorage | undefined =
    typeof window === 'undefined' ? undefined : window.localStorage,
): void {
  if (!storage) return;
  try {
    const normalizedUrl = normalizeStoredDashboardUrl(url);
    if (normalizedUrl) {
      storage.setItem(LAST_DASHBOARD_URL_STORAGE_KEY, normalizedUrl);
    } else {
      storage.removeItem(LAST_DASHBOARD_URL_STORAGE_KEY);
    }
  } catch {
    // Ignore storage errors
  }
}

export function getVoyageKeyFromDashboardUrl(value: string | null | undefined): string | undefined {
  const normalizedUrl = normalizeStoredDashboardUrl(value);
  if (!normalizedUrl) return undefined;

  try {
    return new URL(normalizedUrl, URL_PARSE_BASE).searchParams.get('voyage')?.trim() || undefined;
  } catch {
    return undefined;
  }
}
