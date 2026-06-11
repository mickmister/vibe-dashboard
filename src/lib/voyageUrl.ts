import type {
  Craft,
  SavedWorkspaceSession,
  VoyageEntry,
  WorkspaceState,
} from '../types';

function slugifyPart(value: string): string {
  const normalized = value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || 'item';
}

function getIdSuffix(id: string): string {
  const parts = id.split(/[_-]/).filter(Boolean);
  return parts[parts.length - 1] || id;
}

export function buildVoyageSlug(label: string | undefined, id: string): string {
  return `${slugifyPart(label || 'voyage')}-${id}`;
}

export function getVoyageSlug(session: SavedWorkspaceSession): string {
  return session.slug || buildVoyageSlug(session.name, session.id);
}

export function buildCraftParam(
  tabGroup: Craft | undefined,
  entry: VoyageEntry | undefined,
): string | null {
  if (!(tabGroup && entry)) return null;
  return `${slugifyPart(tabGroup.label)}-${getIdSuffix(tabGroup.id)}-${getIdSuffix(entry.id)}`;
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

export function buildViewParam(label: string, id: string): string {
  return `${slugifyPart(label)}-${getIdSuffix(id)}`;
}

export function parseViewParam(value: string | null | undefined): string | null {
  if (!value) return null;
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
  return `/dashboard${nextSearch ? `?${nextSearch}` : ''}`;
}

export function buildSavedVoyageDashboardPath({
  currentSearch,
  workspace,
  session,
  voyageEntryId,
  tabId,
  viewIds,
}: {
  currentSearch: string;
  workspace: Pick<WorkspaceState, 'tabGroups'>;
  session: SavedWorkspaceSession;
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
            return tab ? buildViewParam(tab.title, tab.id) : null;
          })
          .filter((token): token is string => Boolean(token))
      : undefined;

  return buildCanonicalDashboardPath(currentSearch, {
    slug: getVoyageSlug(session),
    craftParam: buildCraftParam(tabGroup, entry),
    viewTokens,
  });
}
