import { describe, expect, it, vi, beforeEach } from 'vitest';
import { clearBeadsBoardCache, fetchBeadsBoardView, parseBdStatuses, parseBdStatusesJson, type RunBdCommand } from './beadsAdapter';

beforeEach(() => {
  clearBeadsBoardCache();
});

describe('Beads board adapter', () => {
  const actualTextStatuses = `Built-in statuses:
  ○ open           [active]  Available to work (default)
  ◐ in_progress    [wip   ]  Actively being worked on
  ● blocked        [wip   ]  Blocked by a dependency
  ❄ deferred       [frozen]  Deliberately put on ice for later
  ✓ closed         [done  ]  Completed
  📌 pinned         [frozen]  Persistent, stays open indefinitely
  ◇ hooked         [wip   ]  Attached to an agent's hook

No custom statuses configured.
Configure with: bd config set status.custom "name:category,..."
Categories: active, wip, done, frozen
`;

  const actualJsonStatuses = JSON.stringify({
    built_in_statuses: [
      { category: 'active', description: 'Available to work (default)', icon: '○', name: 'open' },
      { category: 'wip', description: 'Actively being worked on', icon: '◐', name: 'in_progress' },
      { category: 'wip', description: 'Blocked by a dependency', icon: '●', name: 'blocked' },
      { category: 'frozen', description: 'Deliberately put on ice for later', icon: '❄', name: 'deferred' },
      { category: 'done', description: 'Completed', icon: '✓', name: 'closed' },
      { category: 'frozen', description: 'Persistent, stays open indefinitely', icon: '📌', name: 'pinned' },
      { category: 'wip', description: "Attached to an agent's hook", icon: '◇', name: 'hooked' },
    ],
    schema_version: 1,
  });

  it('parses actual bd statuses text output including unicode icons', () => {
    expect(parseBdStatuses(actualTextStatuses)).toEqual([
      { id: 'open', title: 'Open', category: 'active' },
      { id: 'in_progress', title: 'In Progress', category: 'wip' },
      { id: 'blocked', title: 'Blocked', category: 'wip' },
      { id: 'deferred', title: 'Deferred', category: 'frozen' },
      { id: 'closed', title: 'Closed', category: 'done' },
      { id: 'pinned', title: 'Pinned', category: 'frozen' },
      { id: 'hooked', title: 'Hooked', category: 'wip' },
    ]);
  });

  it('parses bd statuses --json output as the preferred shape', () => {
    expect(parseBdStatusesJson(actualJsonStatuses)).toEqual([
      { id: 'open', title: 'Open', category: 'active' },
      { id: 'in_progress', title: 'In Progress', category: 'wip' },
      { id: 'blocked', title: 'Blocked', category: 'wip' },
      { id: 'deferred', title: 'Deferred', category: 'frozen' },
      { id: 'closed', title: 'Closed', category: 'done' },
      { id: 'pinned', title: 'Pinned', category: 'frozen' },
      { id: 'hooked', title: 'Hooked', category: 'wip' },
    ]);
  });

  it('renders all actual statuses as columns with showCompleted=true', async () => {
    const runBd: RunBdCommand = vi.fn(async (args) => {
      if (args.includes('statuses')) return { stdout: actualJsonStatuses };
      return {
        stdout: [
          JSON.stringify({ id: 'vkvw-open', title: 'Open work', status: 'open' }),
          JSON.stringify({ id: 'vkvw-in-progress', title: 'In progress work', status: 'in_progress' }),
          JSON.stringify({ id: 'vkvw-blocked', title: 'Blocked work', status: 'blocked' }),
          JSON.stringify({ id: 'vkvw-deferred', title: 'Deferred work', status: 'deferred' }),
          JSON.stringify({ id: 'vkvw-closed', title: 'Closed work', status: 'closed' }),
          JSON.stringify({ id: 'vkvw-pinned', title: 'Pinned work', status: 'pinned' }),
          JSON.stringify({ id: 'vkvw-hooked', title: 'Hooked work', status: 'hooked' }),
        ].join('\n'),
      };
    });

    const result = await fetchBeadsBoardView({ sourceDirectory: '/repos/vd', runBd, showCompleted: true });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.boardView.columns.map((column) => column.id)).toEqual([
      'open',
      'in_progress',
      'blocked',
      'deferred',
      'closed',
      'pinned',
      'hooked',
    ]);
    const columnIds = new Set(result.boardView.columns.map((column) => column.id));
    for (const card of result.boardView.cards) {
      expect(columnIds.has(card.columnId!)).toBe(true);
    }
  });

  it('hides done-category closed status by default without unmapped active/frozen/wip statuses', async () => {
    const runBd: RunBdCommand = vi.fn(async (args) => {
      if (args.includes('--json')) throw new Error('older bd without json statuses');
      if (args.includes('statuses')) return { stdout: actualTextStatuses };
      return {
        stdout: [
          JSON.stringify({ id: 'vkvw-1', title: 'Open work', status: 'open', labels: ['impl'], dependency_count: 2, dependent_count: 1, metadata: { 'agent-role': 'implementation' } }),
          JSON.stringify({ id: 'vkvw-2', title: 'Closed work', status: 'closed' }),
          JSON.stringify({ id: 'vkvw-3', title: 'Deferred work', status: 'deferred' }),
          JSON.stringify({ id: 'vkvw-4', title: 'Pinned work', status: 'pinned' }),
          JSON.stringify({ id: 'vkvw-5', title: 'Hooked work', status: 'hooked' }),
          JSON.stringify({ id: 'vkvw-6', title: 'In progress work', status: 'in_progress' }),
        ].join('\n'),
      };
    });

    const result = await fetchBeadsBoardView({ sourceDirectory: '/repos/vd', runBd });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.boardView.columns.map((column) => column.id)).toEqual(['open', 'in_progress', 'blocked', 'deferred', 'pinned', 'hooked']);
    expect(result.boardView.cards.map((card) => card.key)).toEqual(['vkvw-1', 'vkvw-3', 'vkvw-4', 'vkvw-5', 'vkvw-6']);
    expect(result.boardView.diagnostics?.hiddenCompletedCount).toBe(1);
    const columnIds = new Set(result.boardView.columns.map((column) => column.id));
    for (const card of result.boardView.cards) {
      expect(columnIds.has(card.columnId!)).toBe(true);
    }
  });

  it('uses a 30 second TTL cache, supports manual refresh, and serves stale data on refresh error', async () => {
    let now = 1_000;
    const runBd: RunBdCommand = vi.fn(async (args) => {
      if (args.includes('statuses')) return { stdout: '{"built_in_statuses":[{"name":"open","category":"active"}]}' };
      return { stdout: `${JSON.stringify({ id: `vkvw-${(runBd as ReturnType<typeof vi.fn>).mock.calls.length}`, title: 'Cached work', status: 'open' })}\n` };
    });

    const first = await fetchBeadsBoardView({ sourceDirectory: '/repos/vd', runBd, now: () => now });
    const second = await fetchBeadsBoardView({ sourceDirectory: '/repos/vd', runBd, now: () => now + 20_000 });
    expect(first.ok && first.boardView.diagnostics?.cache).toBe('fresh');
    expect(second.ok && second.boardView.diagnostics?.cache).toBe('cached');
    expect(runBd).toHaveBeenCalledTimes(2);

    const failingRunBd: RunBdCommand = vi.fn(async () => {
      throw new Error('bd timeout');
    });
    const stale = await fetchBeadsBoardView({ sourceDirectory: '/repos/vd', runBd: failingRunBd, refresh: true, now: () => now + 31_000 });
    expect(stale.ok && stale.boardView.diagnostics?.cache).toBe('stale');
    expect(stale.ok && stale.boardView.cards).toHaveLength(1);
  });

  it('does not cache export failures as empty successful boards', async () => {
    const runBd: RunBdCommand = vi.fn(async () => {
      throw new Error('bd unavailable');
    });

    const result = await fetchBeadsBoardView({ sourceDirectory: '/repos/vd', runBd });

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'beads_export_failed',
        message: 'Could not load Beads for this Kanban view.',
        userAction: 'Verify this source directory has a Beads database and try again.',
      },
    });
  });
});
