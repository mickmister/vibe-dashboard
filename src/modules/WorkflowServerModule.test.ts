import { describe, expect, it } from 'vitest';
import { initApp } from 'springboard/server/hono_app';
import type { KVStore, Springboard } from 'springboard/core';
import { getProductionPanelTargetRouterAuthoritySnapshot } from '../server/panelTargetRouterAuthority';

const kv = (): KVStore => ({ get: async () => null, set: async () => {}, getAll: async () => ({}) });
const resources = { engine: {} as Springboard, getEnvValue: () => undefined, serveStaticFile: async () => new Response() };

describe('Workflow server module lifecycle', () => {
  it('binds route authority cleanup to the real Springboard application instance', async () => {
    process.env.VITE_VK_BASE_ORIGIN = 'https://vk.test';
    await import('./WorkflowServerModule');
    const lifecycle = initApp({ remoteKV: kv(), userAgentKV: kv(), broadcastMessage: () => {} });
    await lifecycle.injectResources(resources);
    expect(getProductionPanelTargetRouterAuthoritySnapshot().status).toBe('ready');
    await lifecycle.disposeServerModules();
    await lifecycle.disposeServerModules();
    expect(getProductionPanelTargetRouterAuthoritySnapshot()).toEqual({ status: 'not-ready' });
  });
});
