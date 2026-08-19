import { describe, expect, it, vi, beforeEach } from 'vitest';
import { clearBeadsBoardCache, fetchBeadsBoardView, parseBdStatuses, type RunBdCommand } from './beadsAdapter';

beforeEach(() => {
  clearBeadsBoardCache();
});

describe('Beads board adapter', () => {
  it('parses actual bd statuses output', () => {
    expect(parseBdStatuses('○ open           [active]\n○ in_progress    [wip]\n○ closed         [done]\n')).toEqual([
      { id: 'open', title: 'Open', category: 'active' },
      { id: 'in_progress', title: 'In Progress', category: 'wip' },
      { id: 'closed', title: 'Closed', category: 'done' },
    ]);
  });

  it('renders a default read-only status board and hides completed-like statuses by default', async () => {
    const runBd: RunBdCommand = vi.fn(async (args) => {
      if (args.includes('statuses')) return { stdout: '○ open           [active]\n○ in_progress    [wip]\n○ closed         [done]\n' };
      return {
        stdout: [
          JSON.stringify({ id: 'vkvw-1', title: 'Open work', status: 'open', labels: ['impl'], dependency_count: 2, dependent_count: 1, metadata: { 'agent-role': 'implementation' } }),
          JSON.stringify({ id: 'vkvw-2', title: 'Closed work', status: 'closed' }),
        ].join('\n'),
      };
    });

    const result = await fetchBeadsBoardView({ sourceDirectory: '/repos/vd', runBd });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.boardView.provider).toBe('beads');
    expect(result.boardView.columns.map((column) => column.id)).toEqual(['open', 'in_progress']);
    expect(result.boardView.cards.map((card) => card.key)).toEqual(['vkvw-1']);
    expect(result.boardView.cards[0]).toMatchObject({
      title: 'Open work',
      metadata: { dependencyCount: 2, dependentCount: 1, 'agent-role': 'implementation' },
    });
    expect(result.boardView.diagnostics?.hiddenCompletedCount).toBe(1);
  });

  it('uses a 30 second TTL cache, supports manual refresh, and serves stale data on refresh error', async () => {
    let now = 1_000;
    const runBd: RunBdCommand = vi.fn(async (args) => {
      if (args.includes('statuses')) return { stdout: '○ open           [active]\n' };
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
