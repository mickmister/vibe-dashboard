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

  return (
    matchedRequestedVoyage?.id ||
    (requestedLegacySessionId && savedSessionIds.has(requestedLegacySessionId)
      ? requestedLegacySessionId
      : undefined) ||
    (storedBrowserSessionId && savedSessionIds.has(storedBrowserSessionId)
      ? storedBrowserSessionId
      : undefined) ||
    (originDefaultSessionId && savedSessionIds.has(originDefaultSessionId)
      ? originDefaultSessionId
      : undefined) ||
    // If the browser has a stale/local session id that has not shown up in
    // persisted workspace-sessions yet, keep it stable and let the normal
    // upsert path recreate that Voyage. Generating a replacement here is
    // render-unsafe: Home page data fetching and URL canonicalization can
    // re-render before the first upsert is reflected in savedSessions, causing
    // a new Voyage id to be generated and persisted on each render.
    storedBrowserSessionId ||
    undefined
  );
}
