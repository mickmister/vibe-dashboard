import type { PreviewProcessLink } from './vk-client';

type RetainedLink = { link: PreviewProcessLink; expiresAt: number };

export class PreviewProcessLinkStore {
  private readonly links = new Map<string, RetainedLink>();
  private readonly now: () => number;
  private readonly ttlMs: number;
  private readonly maxEntries: number;

  constructor(options: { now?: () => number; ttlMs?: number; maxEntries?: number } = {}) {
    this.now = options.now ?? Date.now;
    this.ttlMs = options.ttlMs ?? 24 * 60 * 60 * 1000;
    this.maxEntries = options.maxEntries ?? 1_000;
  }

  remember(workspaceId: string, link: PreviewProcessLink): void {
    if (link.workspace_id !== workspaceId || !link.execution_process_id) return;
    this.prune();
    this.links.delete(link.execution_process_id);
    while (this.links.size >= this.maxEntries) {
      const oldest = this.links.keys().next().value as string | undefined;
      if (!oldest) break;
      this.links.delete(oldest);
    }
    this.links.set(link.execution_process_id, { link: { ...link }, expiresAt: this.now() + this.ttlMs });
  }

  has(workspaceId: string, processId: string): boolean {
    this.prune();
    return this.links.get(processId)?.link.workspace_id === workspaceId;
  }

  merge(workspaceId: string, authoritative: PreviewProcessLink[]): PreviewProcessLink[] {
    this.prune();
    const authoritativeRuns = new Set(authoritative.map((item) => item.run_config_id));
    const authoritativeSlots = new Set(authoritative.flatMap((item) => item.preview_slot_id ? [item.preview_slot_id] : []));
    const retained = [...this.links.values()].reverse().map(({ link }) => link).filter((item) =>
      item.workspace_id === workspaceId &&
      (item.preview_slot_id
        ? !authoritativeSlots.has(item.preview_slot_id)
        : !authoritativeRuns.has(item.run_config_id)),
    );
    return [...authoritative, ...retained];
  }

  private prune(): void {
    const now = this.now();
    for (const [processId, retained] of this.links) {
      if (retained.expiresAt <= now) this.links.delete(processId);
    }
  }
}
