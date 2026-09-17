import { describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { getProductionPanelTargetRouterAuthoritySnapshot } from '../server/panelTargetRouterAuthority';

const captured = vi.hoisted(() => ({ callback: null as null | ((api: { hono: Hono }) => void) }));
vi.mock('springboard/server/register', () => ({
  serverRegistry: { registerServerModule: (callback: (api: { hono: Hono }) => void) => { captured.callback = callback; } },
}));

describe('Workflow server module delivery-owner lifecycle', () => {
  it('publishes authority during actual module startup and revokes it safely on teardown', async () => {
    process.env.VITE_VK_BASE_ORIGIN = 'https://vk.test';
    const module = await import('./WorkflowServerModule');
    const lifecycle = await import('../server/server-module-lifecycle');
    captured.callback?.({ hono: new Hono() });
    expect(getProductionPanelTargetRouterAuthoritySnapshot().status).toBe('ready');
    captured.callback?.({ hono: new Hono() });
    expect(getProductionPanelTargetRouterAuthoritySnapshot().status).toBe('ready');
    lifecycle.disposeProductionServerModules();
    lifecycle.disposeProductionServerModules();
    expect(getProductionPanelTargetRouterAuthoritySnapshot()).toEqual({ status: 'not-ready' });
    captured.callback?.({ hono: new Hono() });
    expect(getProductionPanelTargetRouterAuthoritySnapshot().status).toBe('ready');
    module.disposeWorkflowServerModule();
    expect(getProductionPanelTargetRouterAuthoritySnapshot()).toEqual({ status: 'not-ready' });
  });
});
