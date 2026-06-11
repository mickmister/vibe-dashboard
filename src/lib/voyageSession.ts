import type { SavedWorkspaceSession } from '../types';
import { getVoyageSlug } from './voyageUrl';

export function resolveRequestedVoyageSessionId({
  savedSessions,
  requestedVoyageKey,
}: {
  savedSessions: SavedWorkspaceSession[];
  requestedVoyageKey?: string;
}): string | undefined {
  const matchedRequestedVoyage = requestedVoyageKey
    ? savedSessions.find(
        (session) =>
          session.id === requestedVoyageKey ||
          getVoyageSlug(session) === requestedVoyageKey,
      )
    : undefined;
  const requestedStableId = requestedVoyageKey
    ? savedSessions.find((session) => requestedVoyageKey.endsWith(`-${session.id}`))?.id
    : undefined;

  return (
    matchedRequestedVoyage?.id ||
    requestedStableId
  );
}

export function resolvePreferredVoyageSessionId({
  savedSessions,
  requestedVoyageKey,
  storedBrowserSessionId,
  originDefaultSessionId,
}: {
  savedSessions: SavedWorkspaceSession[];
  requestedVoyageKey?: string;
  storedBrowserSessionId?: string | null;
  originDefaultSessionId?: string;
}): string | undefined {
  const savedSessionIds = new Set(savedSessions.map((session) => session.id));
  const requestedSessionId = resolveRequestedVoyageSessionId({
    savedSessions,
    requestedVoyageKey,
  });

  return (
    requestedSessionId ||
    (storedBrowserSessionId && savedSessionIds.has(storedBrowserSessionId)
      ? storedBrowserSessionId
      : undefined) ||
    (originDefaultSessionId && savedSessionIds.has(originDefaultSessionId)
      ? originDefaultSessionId
      : undefined) ||
    storedBrowserSessionId ||
    undefined
  );
}

export type DashboardVoyageResolution =
  | { status: 'resolved'; sessionId: string }
  | { status: 'missing-param'; sessionId?: string }
  | { status: 'not-found'; requestedVoyageKey: string };

export function resolveDashboardVoyage({
  savedSessions,
  requestedVoyageKey,
  storedBrowserSessionId,
  originDefaultSessionId,
}: {
  savedSessions: SavedWorkspaceSession[];
  requestedVoyageKey?: string;
  storedBrowserSessionId?: string | null;
  originDefaultSessionId?: string;
}): DashboardVoyageResolution {
  if (requestedVoyageKey) {
    const requestedSessionId = resolveRequestedVoyageSessionId({
      savedSessions,
      requestedVoyageKey,
    });
    return requestedSessionId
      ? { status: 'resolved', sessionId: requestedSessionId }
      : { status: 'not-found', requestedVoyageKey };
  }

  return {
    status: 'missing-param',
    sessionId: resolvePreferredVoyageSessionId({
      savedSessions,
      storedBrowserSessionId,
      originDefaultSessionId,
    }),
  };
}
