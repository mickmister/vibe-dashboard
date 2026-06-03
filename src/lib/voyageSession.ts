import type { SavedWorkspaceSession } from '../types';
import { getVoyageSlug } from './voyageUrl';

export function resolveRequestedVoyageSessionId({
  savedSessions,
  requestedVoyageKey,
  requestedLegacySessionId,
}: {
  savedSessions: SavedWorkspaceSession[];
  requestedVoyageKey?: string;
  requestedLegacySessionId?: string;
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
      : undefined)
  );
}

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
  const requestedSessionId = resolveRequestedVoyageSessionId({
    savedSessions,
    requestedVoyageKey,
    requestedLegacySessionId,
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
