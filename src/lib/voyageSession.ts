import type { SavedWorkspaceSession } from '../types';
import {
  buildVoyageParam,
  getVoyageKeyFromDashboardUrl,
  getVoyageSlug,
  shortIdTokenMatches,
} from './voyageUrl';

function getTrailingToken(value: string): string {
  const parts = value.split('-').filter(Boolean);
  return parts[parts.length - 1] || value;
}

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
          getVoyageSlug(session) === requestedVoyageKey ||
          buildVoyageParam(session, savedSessions) === requestedVoyageKey,
      )
    : undefined;
  const requestedStableId = requestedVoyageKey
    ? savedSessions.find((session) => requestedVoyageKey.endsWith(`-${session.id}`))?.id
    : undefined;
  const requestedShortId = requestedVoyageKey
    ? savedSessions.find((session) =>
        shortIdTokenMatches(
          session.id,
          getTrailingToken(requestedVoyageKey),
          savedSessions.map((entry) => entry.id),
        ),
      )?.id
    : undefined;

  return (
    matchedRequestedVoyage?.id ||
    requestedStableId ||
    requestedShortId
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
