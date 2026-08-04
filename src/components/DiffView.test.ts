import { describe, expect, it } from 'vitest';
import { createDiffLoadGuard } from './DiffView';

describe('createDiffLoadGuard', () => {
  it('only treats the newest load request as current', () => {
    const guard = createDiffLoadGuard();
    const firstRequestId = guard.nextRequestId();
    const secondRequestId = guard.nextRequestId();

    expect(guard.isCurrent(firstRequestId)).toBe(false);
    expect(guard.isCurrent(secondRequestId)).toBe(true);
  });

  it('invalidates an in-flight request when the view unmounts or dependencies change', () => {
    const guard = createDiffLoadGuard();
    const requestId = guard.nextRequestId();

    guard.invalidate();

    expect(guard.isCurrent(requestId)).toBe(false);
  });
});
