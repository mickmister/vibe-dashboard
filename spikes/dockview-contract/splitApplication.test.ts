import { describe, expect, it, vi } from 'vitest';
import { createSplitApplication, type DurablePortName, type SplitOperation } from './splitApplication';

describe('Split application persistence boundary', () => {
  it('drives every Split operation exclusively through transient ports', () => {
    const names: DurablePortName[] = ['coordinator', 'serializer', 'fromJSON', 'repository', 'revision', 'history', 'autosave'];
    const durable = Object.fromEntries(names.map((name) => [name, vi.fn(() => { throw new Error(`forbidden:${name}`); })])) as unknown as Parameters<typeof createSplitApplication>[0]['durable'];
    const operations: SplitOperation[] = ['enter', 'resize', 'maximize-left', 'maximize-right', 'restore', 'narrow', 'wide', 'invalidate', 'exit'];
    const split = Object.fromEntries(operations.map((operation) => [operation, vi.fn()])) as unknown as Parameters<typeof createSplitApplication>[0]['split'];
    const application = createSplitApplication({ durable, split });
    for (const operation of operations) application.dispatch(operation);
    for (const operation of operations) expect(split[operation]).toHaveBeenCalledOnce();
    for (const name of names) expect(durable[name]).not.toHaveBeenCalled();
    expect(() => application.dispatchDurableForControl('repository', 'control')).toThrow('forbidden:repository');
  });
});
