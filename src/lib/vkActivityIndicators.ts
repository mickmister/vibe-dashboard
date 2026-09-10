import type { TabGroup } from '../types';
import type { ActivitySnapshot, ActivitySession, ActivitySessionStatus } from './vk-client';

export type CraftActivityLevel = 'active' | 'queued' | 'waiting' | 'idle';

export interface CraftActivityIndicator {
  workspaceId: string;
  level: CraftActivityLevel;
  label: string;
  activeTurnCount: number;
  queuedCount: number;
  callbackStateAvailable: boolean;
  updatedAt: string | null;
}

export function extractWorkspaceIdFromTabGroup(tabGroup: TabGroup): string | null {
  if (tabGroup.workspace?.workspaceId) return tabGroup.workspace.workspaceId;
  for (const tab of tabGroup.tabs) {
    const match = tab.url.match(/\/workspaces\/([^/?#]+)/);
    if (match?.[1]) return decodeURIComponent(match[1]);
  }
  return null;
}

export function buildWorkspaceActivityMap(snapshot: ActivitySnapshot | null): Map<string, CraftActivityIndicator> {
  const map = new Map<string, CraftActivityIndicator>();
  if (!snapshot) return map;
  for (const workspace of snapshot.workspaces) {
    const sessions = workspace.sessions;
    const status = chooseWorkspaceStatus(sessions);
    const queuedCount = workspace.queued_count || sessions.reduce((total, session) => total + session.queue.count, 0);
    const callbackAvailable = sessions.some((session) => session.callback.available);
    const indicator: CraftActivityIndicator = {
      workspaceId: workspace.workspace_id,
      level: activityLevel(status, queuedCount),
      label: activityLabel(status, workspace.active_turn_count, queuedCount, callbackAvailable),
      activeTurnCount: workspace.active_turn_count,
      queuedCount,
      callbackStateAvailable: callbackAvailable,
      updatedAt: workspace.updated_at ?? null,
    };
    if (indicator.level !== 'idle') map.set(workspace.workspace_id, indicator);
  }
  return map;
}

export function getTabGroupActivity(tabGroup: TabGroup, activityByWorkspaceId: Map<string, CraftActivityIndicator>): CraftActivityIndicator | null {
  const workspaceId = extractWorkspaceIdFromTabGroup(tabGroup);
  return workspaceId ? activityByWorkspaceId.get(workspaceId) ?? null : null;
}

function chooseWorkspaceStatus(sessions: ActivitySession[]): ActivitySessionStatus {
  if (sessions.some((session) => session.status === 'running')) return 'running';
  if (sessions.some((session) => session.status === 'queued')) return 'queued';
  if (sessions.some((session) => session.status === 'callback_waiting')) return 'callback_waiting';
  return 'idle';
}

function activityLevel(status: ActivitySessionStatus, queuedCount: number): CraftActivityLevel {
  if (status === 'running') return 'active';
  if (status === 'queued' || queuedCount > 0) return 'queued';
  if (status === 'callback_waiting') return 'waiting';
  return 'idle';
}

function activityLabel(status: ActivitySessionStatus, activeTurnCount: number, queuedCount: number, callbackAvailable: boolean): string {
  if (status === 'running') return `${activeTurnCount || 1} active turn${(activeTurnCount || 1) === 1 ? '' : 's'}`;
  if (status === 'queued' || queuedCount > 0) return `${queuedCount || 1} queued`;
  if (status === 'callback_waiting') return callbackAvailable ? 'Waiting on callback' : 'Callback state unavailable';
  return 'Idle';
}
