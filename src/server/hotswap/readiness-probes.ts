import type { ReadinessProbe } from './vkvd-hotswap-system';

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface HttpReadinessProbeOptions {
  vkBaseUrl?: string;
  vdBaseUrl?: string;
  fetch?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
  pollIntervalMs?: number;
}

export class HttpReadinessProbe implements ReadinessProbe {
  private readonly vkBaseUrl: string;
  private readonly vdBaseUrl: string;
  private readonly fetchImpl: FetchLike;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly timeoutMs: number;
  private readonly pollIntervalMs: number;

  constructor(options: HttpReadinessProbeOptions = {}) {
    this.vkBaseUrl = trimTrailingSlash(options.vkBaseUrl ?? process.env.VK_API_URL ?? 'http://localhost:3007');
    this.vdBaseUrl = trimTrailingSlash(options.vdBaseUrl ?? process.env.VD_BASE_URL ?? 'http://localhost:3008');
    this.fetchImpl = options.fetch ?? fetch;
    this.sleep = options.sleep ?? ((ms) => new Promise(resolve => setTimeout(resolve, ms)));
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.pollIntervalMs = options.pollIntervalMs ?? 1_000;
  }

  waitForVkReady(): Promise<void> {
    return this.waitFor('VK', async () => {
      await this.fetchOk(`${this.vkApiBaseUrl()}/health`);
      await this.fetchOk(`${this.vkApiBaseUrl()}/info`);
    });
  }

  waitForVdReady(): Promise<void> {
    return this.waitFor('VD', async () => {
      await this.fetchOk(`${this.vdBaseUrl}/dashboard/api/workflows/health`);
    });
  }

  private vkApiBaseUrl(): string {
    return this.vkBaseUrl.endsWith('/api') ? this.vkBaseUrl : `${this.vkBaseUrl}/api`;
  }

  private async waitFor(label: string, check: () => Promise<void>): Promise<void> {
    const started = Date.now();
    let lastError: unknown;
    while (Date.now() - started <= this.timeoutMs) {
      try {
        await check();
        return;
      } catch (error) {
        lastError = error;
        await this.sleep(this.pollIntervalMs);
      }
    }
    throw new Error(`Timed out waiting for ${label} readiness: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
  }

  private async fetchOk(url: string): Promise<void> {
    const response = await this.fetchImpl(url);
    if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  }
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}
