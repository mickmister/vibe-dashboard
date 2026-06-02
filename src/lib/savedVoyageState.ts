import type {
  SavedWorkspaceSession,
  SavedWorkspaceSessionState,
} from '../types';

type LegacySavedWorkspaceSessionState = {
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

export function getSavedWorkspaceSessions(
  state: SavedWorkspaceSessionState | LegacySavedWorkspaceSessionState | unknown,
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
    Array.isArray((state as LegacySavedWorkspaceSessionState).sessions)
  ) {
    return (state as { sessions: SavedWorkspaceSession[] }).sessions;
  }

  return [];
}

export function migrateSavedWorkspaceSessionState(
  state: SavedWorkspaceSessionState | LegacySavedWorkspaceSessionState | unknown,
): SavedWorkspaceSessionState {
  return createSavedWorkspaceSessionState(getSavedWorkspaceSessions(state));
}

export function isSavedWorkspaceSessionStateMigrated(
  state: SavedWorkspaceSessionState | LegacySavedWorkspaceSessionState | unknown,
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
