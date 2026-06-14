import type { SavedWorkspaceSession } from '../types';
import { getVoyageKeyFromDashboardUrl, getVoyageSlug } from './voyageUrl';

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

export function resolveLastDashboardVoyageSessionId({
  savedSessions,
  storedDashboardUrl,
}: {
  savedSessions: SavedWorkspaceSession[];
  storedDashboardUrl?: string;
}): string | undefined {
  const storedVoyageKey = getVoyageKeyFromDashboardUrl(storedDashboardUrl);
  if (!storedVoyageKey) return undefined;

  return resolveRequestedVoyageSessionId({
    savedSessions,
    requestedVoyageKey: storedVoyageKey,
  });
}

export type DashboardVoyageResolution =
  | { status: 'resolved'; sessionId: string }
  | { status: 'missing-param'; sessionId?: string }
  | { status: 'not-found'; requestedVoyageKey: string };

export function resolveDashboardVoyage({
  savedSessions,
  requestedVoyageKey,
  storedDashboardUrl,
}: {
  savedSessions: SavedWorkspaceSession[];
  requestedVoyageKey?: string;
  storedDashboardUrl?: string;
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
    sessionId: resolveLastDashboardVoyageSessionId({
      savedSessions,
      storedDashboardUrl,
    }),
  };
}
