import type {
  SavedWorkspaceSession,
  SavedWorkspaceSessionState,
  SavedWorkspaceSessionV1,
  SavedWorkspaceSessionV2,
  VoyageEntry,
  WorkspaceState,
} from '../types';
import { normalizeVoyageLayout } from '../sessionState';
import { buildVoyageSlug } from './voyageUrl';

type SavedWorkspaceSessionState_v1 = {
  sessions?: unknown;
};

type LegacySavedWorkspaceSession =
  | SavedWorkspaceSessionV1
  | SavedWorkspaceSessionV2
  | SavedWorkspaceSession;

type NormalizeSavedWorkspaceSessionOptions = {
  workspace?: Pick<WorkspaceState, 'tabGroups'>;
};

export const SAVED_WORKSPACE_SESSION_STATE_VERSION = 3;

export function createSavedWorkspaceSessionState(
  data: SavedWorkspaceSession[] = [],
): SavedWorkspaceSessionState {
  return {
    version: SAVED_WORKSPACE_SESSION_STATE_VERSION,
    data,
  };
}

export function getSavedWorkspaceSessions(
  state: SavedWorkspaceSessionState | SavedWorkspaceSessionState_v1 | unknown,
): SavedWorkspaceSession[] {
  return getSavedWorkspaceSessionsWithOptions(state);
}

function getSavedWorkspaceSessionsWithOptions(
  state: SavedWorkspaceSessionState | SavedWorkspaceSessionState_v1 | unknown,
  options: NormalizeSavedWorkspaceSessionOptions = {},
): SavedWorkspaceSession[] {
  if (Array.isArray(state)) {
    return normalizeSavedWorkspaceSessionList(state, options);
  }

  if (
    state &&
    typeof state === 'object' &&
    'version' in state &&
    (state.version === 2 || state.version === SAVED_WORKSPACE_SESSION_STATE_VERSION) &&
    'data' in state &&
    Array.isArray(state.data)
  ) {
    return normalizeSavedWorkspaceSessionList(state.data, options);
  }

  if (
    state &&
    typeof state === 'object' &&
    'sessions' in state &&
    Array.isArray((state as SavedWorkspaceSessionState_v1).sessions)
  ) {
    return normalizeSavedWorkspaceSessionList(
      (state as { sessions: unknown[] }).sessions,
      options,
    );
  }

  return [];
}

function isLegacySavedWorkspaceSession(
  value: unknown,
): value is LegacySavedWorkspaceSession {
  return (
    value != null &&
    typeof value === 'object' &&
    'id' in value &&
    typeof value.id === 'string' &&
    'createdAt' in value &&
    typeof value.createdAt === 'string' &&
    'updatedAt' in value &&
    typeof value.updatedAt === 'string' &&
    'activeSpaceId' in value &&
    typeof value.activeSpaceId === 'string' &&
    'activeTabGroupId' in value &&
    typeof value.activeTabGroupId === 'string' &&
    'visitedTabGroupIds' in value &&
    Array.isArray(value.visitedTabGroupIds)
  );
}

function normalizeSavedWorkspaceSessionList(
  sessions: unknown[],
  options: NormalizeSavedWorkspaceSessionOptions,
): SavedWorkspaceSession[] {
  return sessions
    .filter(isLegacySavedWorkspaceSession)
    .map((session) => normalizeSavedWorkspaceSession(session, options));
}

export function migrateSavedWorkspaceSessionState(
  state: SavedWorkspaceSessionState | SavedWorkspaceSessionState_v1 | unknown,
  options: {
    workspace?: Pick<WorkspaceState, 'tabGroups'>;
  } = {},
): SavedWorkspaceSessionState {
  return migrateSavedWorkspaceSessionStateWithCleanup(state, options).state;
}

/**
 * Migrates all pre-v3 saved voyage shapes into the v3 persisted schema.
 *
 * Version 3 records the post-cleanup saved Voyage schema while continuing to
 * read legacy array, {sessions}, and v2 data shapes.
 */
export function migrateSavedWorkspaceSessionStateWithCleanup(
  state: SavedWorkspaceSessionState | SavedWorkspaceSessionState_v1 | unknown,
  options: {
    workspace?: Pick<WorkspaceState, 'tabGroups'>;
  } = {},
): {
  state: SavedWorkspaceSessionState;
} {
  const tabGroupLabelsById = new Map(
    (options.workspace?.tabGroups || []).map((tabGroup) => [
      tabGroup.id,
      tabGroup.label || '',
    ]),
  );
  const referencedSessionIds = new Set<string>();

  const nonHomeSessions = getSavedWorkspaceSessionsWithOptions(state, options).filter(
    (session) => !isHomeVoyage(session, tabGroupLabelsById),
  );
  const validSessionIds = new Set(nonHomeSessions.map((session) => session.id));
  const removedToKept = getDuplicateVoyageReplacementMap(
    nonHomeSessions,
    referencedSessionIds,
  );
  const migratedSessions = nonHomeSessions.filter(
    (session) => !removedToKept.has(session.id),
  );

  return {
    state: createSavedWorkspaceSessionState(migratedSessions),
  };
}

export function isSavedWorkspaceSessionStateMigrated(
  state: SavedWorkspaceSessionState | SavedWorkspaceSessionState_v1 | unknown,
): state is Extract<SavedWorkspaceSessionState, { version: 3 }> {
  return (
    state != null &&
    typeof state === 'object' &&
    'version' in state &&
    state.version === SAVED_WORKSPACE_SESSION_STATE_VERSION &&
    'data' in state &&
    Array.isArray(state.data)
  );
}

function canonicalObjectEntries(value: Record<string, unknown> | undefined) {
  return Object.fromEntries(
    Object.entries(value || {}).sort(([left], [right]) =>
      left.localeCompare(right),
    ),
  );
}

function createVoyageEntryIdForTabGroup(tabGroupId: string, index = 0): string {
  return `ve_${tabGroupId}${index > 0 ? `_${index}` : ''}`;
}

function getLegacyActiveItems(
  session: LegacySavedWorkspaceSession,
): Record<string, string> {
  if ('activeItems' in session && session.activeItems) {
    return session.activeItems;
  }

  const activeItemsByVoyageEntryId =
    'activeItemsByVoyageEntryId' in session
      ? session.activeItemsByVoyageEntryId || {}
      : {};
  const voyageEntries =
    'voyageEntries' in session ? session.voyageEntries || [] : [];
  return Object.fromEntries(
    voyageEntries
      .map((entry) => [
        entry.tabGroupId,
        activeItemsByVoyageEntryId[entry.id] || entry.viewIds[0] || '',
      ])
      .filter(([, activeItemId]) => Boolean(activeItemId)),
  );
}

function getLegacyActiveItemViewIds(
  tabGroupId: string,
  activeItemId: string | undefined,
  options: NormalizeSavedWorkspaceSessionOptions,
): string[] {
  if (!activeItemId) return [];
  const tabGroup = options.workspace?.tabGroups.find(
    (candidate) => candidate.id === tabGroupId,
  );
  if (!tabGroup) return [activeItemId];

  const pair = tabGroup.pairs.find((candidate) => candidate.id === activeItemId);
  if (pair?.tabIds.length) return [...pair.tabIds];

  return tabGroup.tabs.some((tab) => tab.id === activeItemId)
    ? [activeItemId]
    : [];
}

function normalizeSavedWorkspaceSession(
  session: LegacySavedWorkspaceSession,
  options: NormalizeSavedWorkspaceSessionOptions = {},
): SavedWorkspaceSession {
  const activeItems = getLegacyActiveItems(session);
  const legacyEntries =
    'voyageEntries' in session ? session.voyageEntries || [] : [];
  const voyageEntries: VoyageEntry[] = legacyEntries.length
    ? legacyEntries.map((entry) => ({
        id: entry.id,
        tabGroupId: entry.tabGroupId,
        viewIds: [...(entry.viewIds || [])],
      }))
    : (session.visitedTabGroupIds?.length
        ? session.visitedTabGroupIds
        : session.activeTabGroupId
          ? [session.activeTabGroupId]
          : []
      ).map((tabGroupId, index) => ({
        id: createVoyageEntryIdForTabGroup(tabGroupId, index),
        tabGroupId,
        viewIds: getLegacyActiveItemViewIds(
          tabGroupId,
          activeItems[tabGroupId],
          options,
        ),
      }));
  const activeVoyageEntryId =
    ('activeVoyageEntryId' in session &&
      voyageEntries.some((entry) => entry.id === session.activeVoyageEntryId) &&
      session.activeVoyageEntryId) ||
    voyageEntries.find((entry) => entry.tabGroupId === session.activeTabGroupId)
      ?.id ||
    voyageEntries[0]?.id ||
    '';
  const legacyActiveItemsByVoyageEntryId =
    'activeItemsByVoyageEntryId' in session
      ? session.activeItemsByVoyageEntryId || {}
      : {};
  const activeItemsByVoyageEntryId = Object.fromEntries(
    voyageEntries.map((entry) => [
      entry.id,
      legacyActiveItemsByVoyageEntryId[entry.id] ||
        activeItems[entry.tabGroupId] ||
        entry.viewIds[0] ||
        '',
    ]),
  );
  const visitedTabGroupIds = Array.from(
    new Set([
      ...(session.visitedTabGroupIds || []),
      ...voyageEntries.map((entry) => entry.tabGroupId),
    ]),
  );
  const name = (session.name || '').trim();
  const slug = session.slug || buildVoyageSlug(name || 'saved-voyage', session.id);
  const voyageLayout =
    'voyageLayout' in session && session.voyageLayout
      ? options.workspace
        ? normalizeVoyageLayout(
            { spaces: [], tabGroups: options.workspace.tabGroups, nextId: 0 },
            session.voyageLayout,
            voyageEntries,
            activeVoyageEntryId,
          )
        : {
            ...session.voyageLayout,
            cells: session.voyageLayout.cells.map((cell) => ({
              ...cell,
              voyageEntries: cell.voyageEntries.map((entry) => ({
                ...entry,
                viewIds: [...(entry.viewIds || [])],
              })),
            })),
          }
      : undefined;

  return {
    id: session.id,
    slug,
    name,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    activeVoyageEntryId,
    voyageEntries,
    ...(voyageLayout ? { voyageLayout } : {}),
    activeSpaceId: session.activeSpaceId,
    activeTabGroupId:
      voyageEntries.find((entry) => entry.id === activeVoyageEntryId)?.tabGroupId ||
      session.activeTabGroupId,
    activeItemsByVoyageEntryId,
    visitedTabGroupIds,
  };
}

function getVoyageDisplayName(
  session: SavedWorkspaceSession,
  tabGroupLabelsById: Map<string, string>,
): string {
  const explicitName = session.name?.trim();
  if (explicitName) return explicitName;
  return tabGroupLabelsById.get(session.activeTabGroupId) || 'Saved voyage';
}

function isHomeVoyage(
  session: SavedWorkspaceSession,
  tabGroupLabelsById: Map<string, string>,
): boolean {
  return getVoyageDisplayName(session, tabGroupLabelsById)
    .trim()
    .toLowerCase() === 'home';
}

function sessionSignature(session: SavedWorkspaceSession): string {
  const hasTiledLayout = (session.voyageLayout?.cells?.length || 0) > 1;
  return JSON.stringify({
    name: session.name || '',
    activeSpaceId: session.activeSpaceId || '',
    activeTabGroupId: session.activeTabGroupId || '',
    activeVoyageEntryId: session.activeVoyageEntryId || '',
    voyageEntries: (session.voyageEntries || []).map((entry) => ({
      tabGroupId: entry.tabGroupId,
      viewIds: entry.viewIds || [],
    })),
    voyageLayout: hasTiledLayout
      ? {
          activeCellId: session.voyageLayout?.activeCellId || '',
          rows: session.voyageLayout?.rows || 1,
          cols: session.voyageLayout?.cols || 1,
          cells: (session.voyageLayout?.cells || []).map((cell) => ({
            row: cell.row,
            col: cell.col,
            activeVoyageEntryId: cell.activeVoyageEntryId,
            voyageEntries: (cell.voyageEntries || []).map((entry) => ({
              tabGroupId: entry.tabGroupId,
              viewIds: entry.viewIds || [],
            })),
          })),
        }
      : null,
    activeItemsByVoyageEntryId: canonicalObjectEntries(
      session.activeItemsByVoyageEntryId,
    ),
    visitedTabGroupIds: session.visitedTabGroupIds || [],
  });
}

function timestampValue(value: string | undefined): number {
  const time = Date.parse(value || '');
  return Number.isFinite(time) ? time : 0;
}

function chooseKeeper(
  group: SavedWorkspaceSession[],
  referencedSessionIds: Set<string>,
): SavedWorkspaceSession {
  return [...group].sort((left, right) => {
    const leftReferenced = referencedSessionIds.has(left.id) ? 1 : 0;
    const rightReferenced = referencedSessionIds.has(right.id) ? 1 : 0;
    if (leftReferenced !== rightReferenced) {
      return rightReferenced - leftReferenced;
    }

    const leftNamed = left.name ? 1 : 0;
    const rightNamed = right.name ? 1 : 0;
    if (leftNamed !== rightNamed) return rightNamed - leftNamed;

    const updatedDiff =
      timestampValue(right.updatedAt) - timestampValue(left.updatedAt);
    if (updatedDiff !== 0) return updatedDiff;

    const createdDiff =
      timestampValue(right.createdAt) - timestampValue(left.createdAt);
    if (createdDiff !== 0) return createdDiff;

    return left.id.localeCompare(right.id);
  })[0]!;
}

function getDuplicateVoyageReplacementMap(
  sessions: SavedWorkspaceSession[],
  referencedSessionIds: Set<string>,
): Map<string, string> {
  const groupsBySignature = new Map<string, SavedWorkspaceSession[]>();
  for (const session of sessions) {
    const signature = sessionSignature(session);
    const group = groupsBySignature.get(signature) || [];
    group.push(session);
    groupsBySignature.set(signature, group);
  }

  const removedToKept = new Map<string, string>();
  for (const group of groupsBySignature.values()) {
    if (group.length <= 1) continue;
    const keeper = chooseKeeper(group, referencedSessionIds);
    for (const session of group) {
      if (session.id !== keeper.id) {
        removedToKept.set(session.id, keeper.id);
      }
    }
  }
  return removedToKept;
}
