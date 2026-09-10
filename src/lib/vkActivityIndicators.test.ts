import { describe, expect, it } from 'vitest';
import { buildWorkspaceActivityMap, extractWorkspaceIdFromTabGroup, getTabGroupActivity } from './vkActivityIndicators';
import type { ActivitySnapshot } from './vk-client';
import type { TabGroup } from '../types';

describe('VK activity indicators', () => {
  it('extracts workspace ids from metadata before URLs', () => {
    expect(extractWorkspaceIdFromTabGroup(tabGroup({ workspaceId: 'ws-meta', urlWorkspaceId: 'ws-url' }))).toBe('ws-meta');
    expect(extractWorkspaceIdFromTabGroup(tabGroup({ urlWorkspaceId: 'ws%2Fencoded' }))).toBe('ws/encoded');
  });

  it('builds active/queued indicators without pretending callback state exists', () => {
    const map = buildWorkspaceActivityMap(snapshot());
    expect(map.get('ws-running')).toMatchObject({ level: 'active', label: '2 active turns', callbackStateAvailable: false });
    expect(map.get('ws-queued')).toMatchObject({ level: 'queued', label: '3 queued' });
    expect(map.has('ws-idle')).toBe(false);
  });

  it('matches tab groups to workspace activity', () => {
    const map = buildWorkspaceActivityMap(snapshot());
    expect(getTabGroupActivity(tabGroup({ workspaceId: 'ws-running' }), map)).toMatchObject({ level: 'active' });
    expect(getTabGroupActivity(tabGroup({ workspaceId: 'missing' }), map)).toBeNull();
  });
});

function tabGroup(args: { workspaceId?: string; urlWorkspaceId?: string }): TabGroup {
  return {
    id: 'craft-1',
    label: 'Craft',
    workspace: args.workspaceId ? { workspaceId: args.workspaceId, workspaceDir: '/tmp/ws' } : undefined,
    tabs: [{ id: 'tab-1', title: 'Agent', url: args.urlWorkspaceId ? `/workspaces/${args.urlWorkspaceId}` : '/other' }],
    pairs: [],
    order: 0,
  };
}

function snapshot(): ActivitySnapshot {
  return {
    generated_at: '2026-08-04T00:00:00.000Z',
    workspaces: [
      workspace('ws-running', 'running', { activeTurnCount: 2 }),
      workspace('ws-queued', 'queued', { queuedCount: 3 }),
      workspace('ws-idle', 'idle'),
    ],
  };
}

function workspace(workspaceId: string, status: 'running' | 'queued' | 'idle', options: { activeTurnCount?: number; queuedCount?: number } = {}): ActivitySnapshot['workspaces'][number] {
  const queuedCount = options.queuedCount ?? (status === 'queued' ? 1 : 0);
  const activeTurnCount = options.activeTurnCount ?? (status === 'running' ? 1 : 0);
  return {
    workspace_id: workspaceId,
    active_turn_count: activeTurnCount,
    running_turn_count: activeTurnCount,
    running_dev_server_count: 0,
    queued_count: queuedCount,
    updated_at: '2026-08-04T00:00:00.000Z',
    sessions: [{
      workspace_id: workspaceId,
      session_id: `session-${workspaceId}`,
      status,
      active_turn_count: activeTurnCount,
      running_execution_processes: [],
      queue: { count: queuedCount, queued_count: queuedCount, leased_count: 0, starting_count: 0, running_count: 0, first_item_id: queuedCount ? 'queue-1' : null, updated_at: queuedCount ? '2026-08-04T00:00:00.000Z' : null },
      callback: { available: false, waiting_count: 0 },
      updated_at: '2026-08-04T00:00:00.000Z',
    }],
  };
}
