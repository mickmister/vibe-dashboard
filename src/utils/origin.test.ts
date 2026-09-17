import { describe, expect, it } from 'vitest';
import { buildVkSessionUrl } from './origin';

describe('buildVkSessionUrl', () => {
  it('builds workspace session deep links when workspace id is available', () => {
    expect(buildVkSessionUrl({ workspaceId: 'workspace 1', sessionId: 'session/1' })).toBe(
      '/workspaces/workspace%201?sessionId=session%2F1',
    );
  });

  it('falls back to a session-only deep link when workspace id is missing', () => {
    expect(buildVkSessionUrl({ sessionId: 'session-1' })).toBe('/sessions/session-1');
  });

  it('returns null without a session id', () => {
    expect(buildVkSessionUrl({ workspaceId: 'workspace-1', sessionId: null })).toBeNull();
  });
});
