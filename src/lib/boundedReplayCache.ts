export class BoundedReplayCache<T> {
  private readonly entries = new Map<string, { expiresAt: number; value: T }>();
  private readonly maxEntries: number;
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(options: { maxEntries: number; ttlMs: number; now?: () => number }) {
    this.maxEntries = options.maxEntries;
    this.ttlMs = options.ttlMs;
    this.now = options.now ?? Date.now;
  }

  get size(): number {
    this.pruneExpired();
    return this.entries.size;
  }

  get(key: string): T | undefined {
    this.pruneExpired();
    const entry = this.entries.get(key);
    return entry ? structuredClone(entry.value) : undefined;
  }

  set(key: string, value: T): void {
    this.pruneExpired();
    this.entries.delete(key);
    this.entries.set(key, { expiresAt: this.now() + this.ttlMs, value: structuredClone(value) });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  clear(): void {
    this.entries.clear();
  }

  private pruneExpired(): void {
    const now = this.now();
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(key);
    }
  }
}
