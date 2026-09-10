/**
 * Returns the configured app base origin when provided.
 * Falls back to a relative origin so generated URLs stay deployment-agnostic.
 */
export function getBaseOrigin(): string {
  const env = (import.meta as ImportMeta & {
    env?: Record<string, string | undefined>;
  }).env;

  return env?.VITE_VK_BASE_ORIGIN || '';
}

export function applyUrlTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => values[key] ?? '');
}

export function buildVkSessionUrl(args: {
  workspaceId?: string | null;
  sessionId?: string | null;
}): string | null {
  const sessionId = args.sessionId?.trim();
  if (!sessionId) return null;

  const baseOrigin = getBaseOrigin().replace(/\/+$/, '');

  if (args.workspaceId?.trim()) {
    const workspaceId = encodeURIComponent(args.workspaceId.trim());
    const encodedSessionId = encodeURIComponent(sessionId);
    return `${baseOrigin}/workspaces/${workspaceId}?sessionId=${encodedSessionId}`;
  }

  return `${baseOrigin}/sessions/${encodeURIComponent(sessionId)}`;
}
