import { describe, expect, it } from 'vitest';
import { PreviewProcessLinkStore } from './preview-process-link-store';
import type { PreviewProcessLink } from './vk-client';

const link = (process: string, run = 'run-1', slot?: string): PreviewProcessLink => ({
  id: `link-${process}`, workspace_id: 'ws-1', repo_id: 'repo-1', run_config_id: run,
  preview_slot_id: slot, execution_process_id: process, assigned_port: 4000,
  status_snapshot: process.includes('fail') ? 'failed' : 'stopped', started_at: '', updated_at: '',
});

describe('PreviewProcessLinkStore', () => {
  it('reconstructs completed and failed run and slot links after remount/listing', () => {
    const store = new PreviewProcessLinkStore();
    for (const item of [link('complete-run'), link('fail-run', 'run-2'), link('complete-slot', 'run-3', 'slot-1'), link('fail-slot', 'run-4', 'slot-2')]) store.remember('ws-1', item);
    expect(store.merge('ws-1', []).map((item) => item.execution_process_id)).toEqual(['fail-slot', 'complete-slot', 'fail-run', 'complete-run']);
  });

  it('lets authoritative links supersede retained run-config and slot identities', () => {
    const store = new PreviewProcessLinkStore();
    store.remember('ws-1', link('old-run'));
    store.remember('ws-1', link('old-slot', 'run-2', 'slot-1'));
    const authoritative = [link('new-run'), link('new-slot', 'run-2', 'slot-1')];
    expect(store.merge('ws-1', authoritative)).toEqual(authoritative);
  });

  it('preserves a terminal sibling slot while authoritative links lead shared run-config resolution', () => {
    const store = new PreviewProcessLinkStore();
    store.remember('ws-1', link('slot-a-complete', 'shared-run', 'slot-a'));
    const authoritativeSlotB = link('slot-b-active', 'shared-run', 'slot-b');

    const merged = store.merge('ws-1', [authoritativeSlotB]);
    const runProcess = merged.find((item) => item.run_config_id === 'shared-run');
    const slotAProcess = merged.find((item) => item.preview_slot_id === 'slot-a');
    const slotBProcess = merged.find((item) => item.preview_slot_id === 'slot-b');

    expect(merged).toEqual([authoritativeSlotB, link('slot-a-complete', 'shared-run', 'slot-a')]);
    expect(runProcess?.execution_process_id).toBe('slot-b-active');
    expect(slotAProcess?.execution_process_id).toBe('slot-a-complete');
    expect(slotBProcess?.execution_process_id).toBe('slot-b-active');
  });

  it('replaces a retained slot only with an authoritative link for that same slot', () => {
    const store = new PreviewProcessLinkStore();
    store.remember('ws-1', link('slot-a-complete', 'shared-run', 'slot-a'));
    const authoritativeSlotA = link('slot-a-active', 'shared-run', 'slot-a');
    expect(store.merge('ws-1', [authoritativeSlotA])).toEqual([authoritativeSlotA]);
  });

  it('expires links and evicts the oldest beyond 1000 entries', () => {
    let now = 0;
    const store = new PreviewProcessLinkStore({ now: () => now, ttlMs: 10, maxEntries: 1000 });
    for (let index = 0; index <= 1000; index++) store.remember('ws-1', link(`p-${index}`, `r-${index}`));
    expect(store.has('ws-1', 'p-0')).toBe(false);
    expect(store.merge('ws-1', [])).toHaveLength(1000);
    now = 11;
    expect(store.merge('ws-1', [])).toEqual([]);
  });
});
