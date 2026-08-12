export type PendingQueueSentinel = {
  version: number;
  updatedAt: string;
  scopes: Record<string, number>;
};

export const initialPendingQueueSentinel: PendingQueueSentinel = {
  version: 0,
  updatedAt: '',
  scopes: {},
};

export function touchPendingQueueSentinel(
  current: PendingQueueSentinel,
  scopeKeys: readonly string[] = [],
  now: Date = new Date(),
): PendingQueueSentinel {
  const version = current.version + 1;
  const scopes = { ...current.scopes };
  for (const scopeKey of scopeKeys) {
    if (scopeKey.trim()) scopes[scopeKey] = version;
  }
  return {
    version,
    updatedAt: now.toISOString(),
    scopes,
  };
}

export function shouldRefreshPendingQueueForSentinel(input: {
  previousVersion: number | undefined;
  sentinel: PendingQueueSentinel;
  scopeKey?: string;
}): boolean {
  if (input.previousVersion === undefined) return false;
  if (input.sentinel.version <= input.previousVersion) return false;
  if (!input.scopeKey) return true;
  return (input.sentinel.scopes[input.scopeKey] ?? input.sentinel.version) > input.previousVersion;
}
