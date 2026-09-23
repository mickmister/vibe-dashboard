export type RuntimeVisibility = 'visible' | 'inactive';

export interface RuntimeHostToken {
  voyageId: string;
  panelId: string;
  hostId: string;
  generation: number;
}

export interface RuntimeEntry {
  runtimeId: string;
  voyageId: string;
  panelId: string;
  url: string;
  iframe: HTMLIFrameElement | null;
  bootId: string;
  visibility: RuntimeVisibility;
  lastUsed: number;
  disposed: boolean;
  leasedBy: symbol | null;
  host: RuntimeHostToken | null;
  reloadDisclosure: string | null;
}

export interface RuntimeLease {
  token: symbol;
  runtimeIds: string[];
  attach(runtimeId: string, host: RuntimeHostToken): void;
  release(): void;
}

export interface RuntimeRegistryStatus {
  runtimeCount: number;
  visibleRuntimeIds: string[];
  inactiveRuntimeIds: string[];
  lruRuntimeIds: string[];
  evictedRuntimeIds: string[];
  overBudget: boolean;
  leases: Array<{ runtimeId: string; leaseId: string }>;
  bootIds: Record<string, string>;
  reloadDisclosures: Record<string, string>;
}

export class DockviewRuntimeRegistry {
  private readonly entries = new Map<string, RuntimeEntry>();
  private readonly hosts = new Map<string, RuntimeHostToken>();
  private readonly leaseNames = new Map<symbol, string>();
  private readonly evictedRuntimeIds: string[] = [];
  private clock = 0;
  private boot = 0;

  constructor(private iframeLimit = 5) {}

  setIframeLimit(limit: number): void {
    this.iframeLimit = Math.max(0, limit);
    this.reconcileBudget();
  }

  registerRuntime(input: {
    runtimeId: string;
    voyageId: string;
    panelId: string;
    url: string;
    iframe?: HTMLIFrameElement | null;
    visibility?: RuntimeVisibility;
  }): RuntimeEntry {
    const existing = this.entries.get(input.runtimeId);
    if (existing) {
      if (existing.voyageId !== input.voyageId || existing.panelId !== input.panelId) {
        throw new Error('runtime-identity-mismatch');
      }
      existing.url = input.url;
      existing.visibility = input.visibility ?? existing.visibility;
      existing.lastUsed = ++this.clock;
      if (input.iframe) existing.iframe = input.iframe;
      this.reconcileBudget();
      return existing;
    }
    const entry: RuntimeEntry = {
      runtimeId: input.runtimeId,
      voyageId: input.voyageId,
      panelId: input.panelId,
      url: input.url,
      iframe: input.iframe ?? null,
      bootId: `boot-${++this.boot}`,
      visibility: input.visibility ?? 'inactive',
      lastUsed: ++this.clock,
      disposed: false,
      leasedBy: null,
      host: null,
      reloadDisclosure: null,
    };
    this.entries.set(input.runtimeId, entry);
    this.reconcileBudget();
    return entry;
  }

  requireRuntime(runtimeId: string): RuntimeEntry {
    const entry = this.entries.get(runtimeId);
    if (!entry || entry.disposed) throw new Error('runtime-unavailable');
    return entry;
  }

  setVisibility(runtimeId: string, visibility: RuntimeVisibility): void {
    const entry = this.requireRuntime(runtimeId);
    entry.visibility = visibility;
    entry.lastUsed = ++this.clock;
    this.reconcileBudget();
  }

  registerHost(host: RuntimeHostToken): RuntimeHostToken {
    this.hosts.set(hostKey(host), { ...host });
    return host;
  }

  removeHost(host: RuntimeHostToken): void {
    this.hosts.delete(hostKey(host));
    for (const entry of this.entries.values()) {
      if (entry.host && hostKey(entry.host) === hostKey(host)) this.disposeRuntime(entry.runtimeId, 'host-removed');
    }
  }

  attach(runtimeId: string, host: RuntimeHostToken, leaseToken?: symbol): void {
    const entry = this.requireRuntime(runtimeId);
    const currentHost = this.hosts.get(hostKey(host));
    if (!currentHost || currentHost.generation !== host.generation) throw new Error('stale-host-generation');
    if (entry.leasedBy && entry.leasedBy !== leaseToken) throw new Error('runtime-leased');
    if (leaseToken && !entry.leasedBy) entry.leasedBy = leaseToken;
    entry.host = { ...host };
    entry.lastUsed = ++this.clock;
  }

  acquireLeases(runtimeIds: string[]): RuntimeLease {
    const sorted = [...new Set(runtimeIds)].sort();
    const token = Symbol(`lease-${this.leaseNames.size + 1}`);
    const acquired: RuntimeEntry[] = [];
    try {
      for (const runtimeId of sorted) {
        const entry = this.requireRuntime(runtimeId);
        if (entry.leasedBy) throw new Error('runtime-leased');
        entry.leasedBy = token;
        acquired.push(entry);
      }
    } catch (error) {
      for (const entry of acquired.reverse()) entry.leasedBy = null;
      throw error;
    }
    this.leaseNames.set(token, `lease-${this.leaseNames.size + 1}`);
    let released = false;
    return {
      token,
      runtimeIds: sorted,
      attach: (runtimeId, host) => this.attach(runtimeId, host, token),
      release: () => {
        if (released) return;
        released = true;
        for (const runtimeId of sorted) {
          const entry = this.entries.get(runtimeId);
          if (entry?.leasedBy === token) entry.leasedBy = null;
        }
        this.leaseNames.delete(token);
        this.reconcileBudget();
      },
    };
  }

  disposeRuntime(runtimeId: string, reason = 'evicted'): void {
    const entry = this.entries.get(runtimeId);
    if (!entry || entry.disposed) return;
    entry.disposed = true;
    entry.reloadDisclosure = reason;
    entry.iframe?.remove();
    this.entries.delete(runtimeId);
    this.evictedRuntimeIds.push(runtimeId);
  }

  reconcileBudget(): RuntimeRegistryStatus {
    while (this.entries.size > this.iframeLimit) {
      const evictable = [...this.entries.values()]
        .filter((entry) => entry.visibility !== 'visible' && !entry.leasedBy)
        .sort((left, right) => left.lastUsed - right.lastUsed || left.runtimeId.localeCompare(right.runtimeId))[0];
      if (!evictable) break;
      this.disposeRuntime(evictable.runtimeId, 'budget-evicted');
    }
    return this.status();
  }

  status(): RuntimeRegistryStatus {
    const entries = [...this.entries.values()];
    const leases = entries.flatMap((entry) => entry.leasedBy
      ? [{ runtimeId: entry.runtimeId, leaseId: this.leaseNames.get(entry.leasedBy) ?? 'lease' }]
      : []);
    return {
      runtimeCount: entries.length,
      visibleRuntimeIds: entries.filter((entry) => entry.visibility === 'visible').map(({ runtimeId }) => runtimeId).sort(),
      inactiveRuntimeIds: entries.filter((entry) => entry.visibility !== 'visible').map(({ runtimeId }) => runtimeId).sort(),
      lruRuntimeIds: [...entries].sort((left, right) => left.lastUsed - right.lastUsed || left.runtimeId.localeCompare(right.runtimeId))
        .map(({ runtimeId }) => runtimeId),
      evictedRuntimeIds: [...this.evictedRuntimeIds],
      overBudget: entries.length > this.iframeLimit,
      leases,
      bootIds: Object.fromEntries(entries.map((entry) => [entry.runtimeId, entry.bootId])),
      reloadDisclosures: Object.fromEntries(this.evictedRuntimeIds.map((runtimeId) => [runtimeId, 'Runtime reloaded after eviction'])),
    };
  }

  reset(): void {
    for (const runtimeId of [...this.entries.keys()]) this.disposeRuntime(runtimeId, 'reset');
    this.entries.clear();
    this.hosts.clear();
    this.leaseNames.clear();
    this.evictedRuntimeIds.length = 0;
  }
}

export interface WarmController {
  voyageId: string;
  flush?: (reason: string) => Promise<unknown>;
  dispose?: () => void;
}

export function createWarmVoyageControllerCache<T extends WarmController>(input: {
  warmLimit: number;
  create: (voyageId: string) => T;
  onDispose?: (controller: T) => void;
}) {
  const controllers = new Map<string, T>();
  const pins = new Map<string, number>();
  const limit = () => Math.max(0, input.warmLimit);
  const dispose = async (controller: T) => {
    await controller.flush?.('warm-controller-evict');
    controller.dispose?.();
    input.onDispose?.(controller);
  };
  const evict = async () => {
    while (controllers.size > limit()) {
      const candidate = [...controllers.keys()].find((voyageId) => !pins.get(voyageId));
      if (!candidate) break;
      const controller = controllers.get(candidate);
      controllers.delete(candidate);
      if (controller) await dispose(controller);
    }
  };
  return {
    async get(voyageId: string) {
      const existing = controllers.get(voyageId);
      if (existing) {
        controllers.delete(voyageId);
        controllers.set(voyageId, existing);
        return existing;
      }
      const controller = input.create(voyageId);
      controllers.set(voyageId, controller);
      await evict();
      return controller;
    },
    pin(voyageId: string) {
      pins.set(voyageId, (pins.get(voyageId) ?? 0) + 1);
      let released = false;
      return {
        release: async () => {
          if (released) return;
          released = true;
          const next = (pins.get(voyageId) ?? 1) - 1;
          if (next > 0) pins.set(voyageId, next);
          else pins.delete(voyageId);
          await evict();
        },
      };
    },
    async evictNow() {
      await evict();
    },
    ids() {
      return [...controllers.keys()];
    },
    pinnedIds() {
      return [...pins.keys()].sort();
    },
  };
}

export function getWindowDockviewRuntimeRegistry(): DockviewRuntimeRegistry {
  const globalKey = '__vdDockviewRuntimeRegistry';
  const target = globalThis as typeof globalThis & { [globalKey]?: DockviewRuntimeRegistry };
  target[globalKey] ??= new DockviewRuntimeRegistry();
  return target[globalKey];
}

function hostKey(host: RuntimeHostToken): string {
  return `${host.voyageId}:${host.panelId}:${host.hostId}`;
}
