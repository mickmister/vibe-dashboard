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

export function resolvePendingVoyageSessionId({
  requestedVoyageKey,
  pendingVoyageSlugSessionIds,
}: {
  requestedVoyageKey?: string;
  pendingVoyageSlugSessionIds?: Record<string, string>;
}): string | undefined {
  if (!requestedVoyageKey) return undefined;
  return pendingVoyageSlugSessionIds?.[requestedVoyageKey];
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
