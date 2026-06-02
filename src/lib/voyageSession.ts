import type { SavedWorkspaceSession } from '../types';
import { getVoyageSlug } from './voyageUrl';

export function resolvePreferredVoyageSessionId({
  savedSessions,
  requestedVoyageKey,
  requestedLegacySessionId,
  storedBrowserSessionId,
  originDefaultSessionId,
}: {
  savedSessions: SavedWorkspaceSession[];
  requestedVoyageKey?: string;
  requestedLegacySessionId?: string;
  storedBrowserSessionId?: string | null;
  originDefaultSessionId?: string;
}): string | undefined {
  const savedSessionIds = new Set(savedSessions.map((session) => session.id));
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
    requestedStableId ||
    (requestedLegacySessionId && savedSessionIds.has(requestedLegacySessionId)
      ? requestedLegacySessionId
      : undefined) ||
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
