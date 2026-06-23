import type {
  SavedWorkspaceSession,
  SavedWorkspaceSessionState,
  WorkspaceState,
} from '../types';
import { buildVoyageSlug } from './voyageUrl';

type SavedWorkspaceSessionState_v1 = {
  sessions?: unknown;
};

export const SAVED_WORKSPACE_SESSION_STATE_VERSION = 2;

export function createSavedWorkspaceSessionState(
  data: SavedWorkspaceSession[] = [],
): SavedWorkspaceSessionState {
  return {
    version: SAVED_WORKSPACE_SESSION_STATE_VERSION,
    data,
  };
}

export function upsertSavedWorkspaceSessionState(
  state: SavedWorkspaceSessionState | SavedWorkspaceSessionState_v1 | unknown,
  session: SavedWorkspaceSession,
): SavedWorkspaceSessionState {
  const name = session.name?.trim();
  const sessions = getSavedWorkspaceSessions(state).map((entry) => ({
    ...entry,
  }));

  if (
    !name ||
    name.toLowerCase() === 'home' ||
    !session.activeTabGroupId ||
    !(session.voyageEntries?.length)
  ) {
    return createSavedWorkspaceSessionState(sessions);
  }

  const existing = sessions.find((entry) => entry.id === session.id);
  const slug = buildVoyageSlug(name, session.id);

  if (existing) {
    existing.slug = slug;
    existing.name = name;
    existing.updatedAt = session.updatedAt;
    existing.activeVoyageEntryId = session.activeVoyageEntryId;
    existing.voyageEntries = session.voyageEntries;
    existing.activeSpaceId = session.activeSpaceId;
    existing.activeTabGroupId = session.activeTabGroupId;
    existing.activeItemsByVoyageEntryId = session.activeItemsByVoyageEntryId;
    existing.activeItems = session.activeItems;
    existing.visitedTabGroupIds = session.visitedTabGroupIds;
    existing.flowModeType = session.flowModeType;
    return createSavedWorkspaceSessionState(sessions);
  }

  sessions.unshift({ ...session, slug, name });
  return createSavedWorkspaceSessionState(sessions);
}

export function getSavedWorkspaceSessions(
  state: SavedWorkspaceSessionState | SavedWorkspaceSessionState_v1 | unknown,
): SavedWorkspaceSession[] {
  if (Array.isArray(state)) {
    return state as SavedWorkspaceSession[];
  }

  if (
    state &&
    typeof state === 'object' &&
    'version' in state &&
    state.version === SAVED_WORKSPACE_SESSION_STATE_VERSION &&
    'data' in state &&
    Array.isArray(state.data)
  ) {
    return state.data as SavedWorkspaceSession[];
  }

  if (
    state &&
    typeof state === 'object' &&
    'sessions' in state &&
    Array.isArray((state as SavedWorkspaceSessionState_v1).sessions)
  ) {
    return (state as { sessions: SavedWorkspaceSession[] }).sessions;
  }

  return [];
}

export function migrateSavedWorkspaceSessionState(
  state: SavedWorkspaceSessionState | SavedWorkspaceSessionState_v1 | unknown,
  options: {
    workspace?: Pick<WorkspaceState, 'tabGroups'>;
    originResumeState?: { lastSessionByOrigin: Record<string, string> };
  } = {},
): SavedWorkspaceSessionState {
  return migrateSavedWorkspaceSessionStateWithCleanup(state, options).state;
}

/**
 * Migrates all pre-v2 saved voyage shapes into the v2 persisted schema.
 *
 * Version 2 is intentionally the first persisted migration boundary for saved
 * voyages in this app: it normalizes legacy array/{sessions} shapes, removes
 * transient Home voyages, deduplicates identical voyages, and rewrites origin
 * resume pointers as one atomic cleanup.
 */
export function migrateSavedWorkspaceSessionStateWithCleanup(
  state: SavedWorkspaceSessionState | SavedWorkspaceSessionState_v1 | unknown,
  options: {
    workspace?: Pick<WorkspaceState, 'tabGroups'>;
    originResumeState?: { lastSessionByOrigin: Record<string, string> };
  } = {},
): {
  state: SavedWorkspaceSessionState;
  originResumeState?: { lastSessionByOrigin: Record<string, string> };
} {
  const tabGroupLabelsById = new Map(
    (options.workspace?.tabGroups || []).map((tabGroup) => [
      tabGroup.id,
      tabGroup.label || '',
    ]),
  );
  const originResumeState = options.originResumeState
    ? {
        lastSessionByOrigin: {
          ...options.originResumeState.lastSessionByOrigin,
        },
      }
    : undefined;
  const referencedSessionIds = new Set(
    Object.values(originResumeState?.lastSessionByOrigin || {}).filter(Boolean),
  );

  const nonHomeSessions = getSavedWorkspaceSessions(state).filter(
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

  if (originResumeState) {
    for (const [origin, sessionId] of Object.entries(
      originResumeState.lastSessionByOrigin,
    )) {
      const replacementId = removedToKept.get(sessionId);
      if (replacementId) {
        originResumeState.lastSessionByOrigin[origin] = replacementId;
      } else if (!validSessionIds.has(sessionId)) {
        delete originResumeState.lastSessionByOrigin[origin];
      }
    }
  }

  return {
    state: createSavedWorkspaceSessionState(migratedSessions),
    ...(originResumeState ? { originResumeState } : {}),
  };
}

export function isSavedWorkspaceSessionStateMigrated(
  state: SavedWorkspaceSessionState | SavedWorkspaceSessionState_v1 | unknown,
): state is Extract<SavedWorkspaceSessionState, { version: 2 }> {
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
  return JSON.stringify({
    name: session.name || '',
    activeSpaceId: session.activeSpaceId || '',
    activeTabGroupId: session.activeTabGroupId || '',
    activeVoyageEntryId: session.activeVoyageEntryId || '',
    voyageEntries: (session.voyageEntries || []).map((entry) => ({
      tabGroupId: entry.tabGroupId,
      viewIds: entry.viewIds || [],
    })),
    activeItemsByVoyageEntryId: canonicalObjectEntries(
      session.activeItemsByVoyageEntryId,
    ),
    activeItems: canonicalObjectEntries(session.activeItems),
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
