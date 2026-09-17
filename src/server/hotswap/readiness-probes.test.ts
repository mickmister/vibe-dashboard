import { describe, expect, it, vi } from 'vitest';
import { HttpReadinessProbe } from './readiness-probes';

describe('HttpReadinessProbe', () => {
  it('checks VK health and info endpoints using the /api base', async () => {
    const calls: string[] = [];
    const probe = new HttpReadinessProbe({
      vkBaseUrl: 'http://vk.local',
      fetch: vi.fn(async (url: string) => {
        calls.push(url);
        return new Response('{}', { status: 200 });
      }),
      sleep: async () => undefined,
    });

    await probe.waitForVkReady();

    expect(calls).toEqual([
      'http://vk.local/api/health',
      'http://vk.local/api/info',
    ]);
  });

  it('checks VD workflow health endpoint', async () => {
    const calls: string[] = [];
    const probe = new HttpReadinessProbe({
      vdBaseUrl: 'http://vd.local/',
      fetch: vi.fn(async (url: string) => {
        calls.push(url);
        return new Response('{}', { status: 200 });
      }),
      sleep: async () => undefined,
    });

    await probe.waitForVdReady();

    expect(calls).toEqual(['http://vd.local/dashboard/api/workflows/health']);
  });

  it('retries until readiness succeeds', async () => {
    const statuses = [503, 200, 200];
    const probe = new HttpReadinessProbe({
      vkBaseUrl: 'http://vk.local/api',
      fetch: vi.fn(async () => new Response('{}', { status: statuses.shift() ?? 200 })),
      sleep: async () => undefined,
    });

    await expect(probe.waitForVkReady()).resolves.toBeUndefined();
  });

  it('times out with the last readiness error', async () => {
    const probe = new HttpReadinessProbe({
      vdBaseUrl: 'http://vd.local',
      fetch: vi.fn(async () => new Response('nope', { status: 503 })),
      sleep: (ms) => new Promise(resolve => setTimeout(resolve, ms)),
      timeoutMs: 1,
      pollIntervalMs: 2,
    });

    await expect(probe.waitForVdReady()).rejects.toThrow('Timed out waiting for VD readiness');
  });
});
