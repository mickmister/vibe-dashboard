import { describe, expect, it, vi } from 'vitest';
import { ServerModuleLifecycle } from './server-module-lifecycle';

describe('server module lifecycle', () => {
  it('runs each instance cleanup exactly once across repeated teardown', () => {
    const lifecycle = new ServerModuleLifecycle();
    const first = vi.fn();
    const second = vi.fn();
    lifecycle.register(first);
    const disposeSecond = lifecycle.register(second);
    disposeSecond();
    lifecycle.dispose();
    lifecycle.dispose();
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });
});
