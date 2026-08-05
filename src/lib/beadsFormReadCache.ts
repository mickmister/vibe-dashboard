export type BeadsFormCacheMetadata = {
  key: string;
  status: 'cached' | 'fresh';
  loadedAt: string;
  ageMs: number;
  stale: boolean;
};

export type BeadsFormCachedResult<T extends object> = T & {
  cache: BeadsFormCacheMetadata;
};

export type BeadsFormReadCacheOptions = {
  now?: () => number;
  maxEntries?: number;
  ttlMs?: number;
};

type CacheEntry<T> = {
  value: T;
  loadedAtMs: number;
};

const DEFAULT_MAX_ENTRIES = 100;
const DEFAULT_TTL_MS = 30_000;

export class BeadsFormReadCache {
  private readonly now: () => number;
  private readonly maxEntries: number;
  private readonly ttlMs: number;
  private readonly entries = new Map<string, CacheEntry<unknown>>();
  private readonly inFlight = new Map<string, Promise<unknown>>();

  constructor(options: BeadsFormReadCacheOptions = {}) {
    this.now = options.now ?? (() => Date.now());
    this.maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  }

  async cachedOrLoad<T extends object>(key: string, load: () => Promise<T>): Promise<BeadsFormCachedResult<T>> {
    const cached = this.get<T>(key);
    if (cached) return cached;
    return this.refresh(key, load);
  }

  get<T extends object>(key: string): BeadsFormCachedResult<T> | undefined {
    const existing = this.entries.get(key);
    if (!existing) return undefined;
    return this.withMetadata<T>(key, existing, 'cached');
  }

  set<T extends object>(key: string, value: T, loadedAtMs = this.now()): BeadsFormCachedResult<T> {
    const entry = { value, loadedAtMs };
    this.entries.set(key, entry);
    this.evictOldestIfNeeded();
    return this.withMetadata<T>(key, entry, 'cached');
  }

  async refresh<T extends object>(key: string, load: () => Promise<T>): Promise<BeadsFormCachedResult<T>> {
    const existing = this.inFlight.get(key);
    if (existing) {
      const value = await existing as T;
      const entry = this.entries.get(key) ?? { value, loadedAtMs: this.now() };
      return this.withMetadata(key, entry, 'fresh');
    }

    const promise = load();
    this.inFlight.set(key, promise);
    try {
      const value = await promise;
      const entry = { value, loadedAtMs: this.now() };
      this.entries.set(key, entry);
      this.evictOldestIfNeeded();
      return this.withMetadata(key, entry, 'fresh');
    } finally {
      if (this.inFlight.get(key) === promise) this.inFlight.delete(key);
    }
  }

  invalidate(key: string): void {
    this.entries.delete(key);
    this.inFlight.delete(key);
  }

  invalidateAll(): void {
    this.entries.clear();
    this.inFlight.clear();
  }

  size(): number {
    return this.entries.size;
  }

  private withMetadata<T extends object>(
    key: string,
    entry: CacheEntry<unknown>,
    status: BeadsFormCacheMetadata['status'],
  ): BeadsFormCachedResult<T> {
    const ageMs = Math.max(0, this.now() - entry.loadedAtMs);
    return {
      ...(structuredClone(entry.value) as T),
      cache: {
        key,
        status,
        loadedAt: new Date(entry.loadedAtMs).toISOString(),
        ageMs,
        stale: ageMs > this.ttlMs,
      },
    };
  }

  private evictOldestIfNeeded(): void {
    while (this.entries.size > this.maxEntries) {
      const oldestKey = this.entries.keys().next().value as string | undefined;
      if (!oldestKey) return;
      this.entries.delete(oldestKey);
    }
  }
}

export function directBeadFormsCacheKey(input: { dir: string; beadId: string; formId?: string }): string {
  return `direct:${JSON.stringify({
    dir: input.dir,
    beadId: input.beadId,
    formId: input.formId ?? '',
  })}`;
}

export function workspaceBeadFormsCacheKey(input: {
  workspaceId: string;
  beadId?: string;
  formId?: string;
  includeOtherWorkspaces?: boolean;
}): string {
  return `workspace:${JSON.stringify({
    workspaceId: input.workspaceId,
    beadId: input.beadId ?? '',
    formId: input.formId ?? '',
    includeOtherWorkspaces: input.includeOtherWorkspaces ?? false,
  })}`;
}

export function pendingBeadsFormsCacheKey(input: { reposRoot?: string; repoLimit?: number }): string {
  return `pending:${JSON.stringify({
    reposRoot: input.reposRoot ?? '',
    repoLimit: input.repoLimit ?? 80,
  })}`;
}
