import type { SavedWorkspaceSession } from '../types';
import {
  buildVoyageParam,
  getVoyageKeyFromDashboardUrl,
  getVoyageSlug,
  isHomepageLegacyToken,
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
  if (!requestedVoyageKey || isHomepageLegacyToken(requestedVoyageKey)) return undefined;
  const matches = new Set<string>();
  const matchedRequestedVoyage = savedSessions.find(
    (session) =>
      session.id === requestedVoyageKey ||
      getVoyageSlug(session) === requestedVoyageKey ||
      buildVoyageParam(session, savedSessions) === requestedVoyageKey,
  );
  if (matchedRequestedVoyage) matches.add(matchedRequestedVoyage.id);
  const requestedStableId = savedSessions.find((session) => requestedVoyageKey.endsWith(`-${session.id}`))?.id;
  if (requestedStableId) matches.add(requestedStableId);
  for (const session of savedSessions) {
    if (
      shortIdTokenMatches(
        session.id,
        getTrailingToken(requestedVoyageKey),
        savedSessions.map((entry) => entry.id),
      )
    ) matches.add(session.id);
  }

  return matches.size === 1 ? [...matches][0] : undefined;
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
    if (isHomepageLegacyToken(requestedVoyageKey)) return { status: 'missing-param' };
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
