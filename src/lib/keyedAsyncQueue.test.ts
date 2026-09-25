import { describe, expect, it } from 'vitest';
import { KeyedAsyncQueue } from './keyedAsyncQueue';

describe('KeyedAsyncQueue', () => {
  it('runs same-key work fairly in arrival order while unrelated keys proceed', async () => {
    const queue = new KeyedAsyncQueue();
    const events: string[] = [];
    let releaseFirst!: () => void;
    const blocked = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const first = queue.run('a', async () => { events.push('a1:start'); await blocked; events.push('a1:end'); });
    const second = queue.run('a', async () => { events.push('a2'); });
    const other = queue.run('b', async () => { events.push('b1'); });
    await other;
    expect(events).toEqual(['a1:start', 'b1']);
    releaseFirst();
    await Promise.all([first, second]);
    expect(events).toEqual(['a1:start', 'b1', 'a1:end', 'a2']);
    expect(queue.size).toBe(0);
  });

  it('isolates rejection and cleans up after every path', async () => {
    const queue = new KeyedAsyncQueue();
    const failed = queue.run('a', async () => { throw new Error('failed'); });
    const recovered = queue.run('a', async () => 'recovered');
    await expect(failed).rejects.toThrow('failed');
    await expect(recovered).resolves.toBe('recovered');
    expect(queue.size).toBe(0);
  });
});
