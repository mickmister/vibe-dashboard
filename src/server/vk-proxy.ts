import type { Hono } from 'hono';
import {serverRegistry} from 'springboard/server/register';
import { resolveVibeApiBaseUrl } from './vk-client';

const PROXY_PREFIX = '/vk-api';

export function registerVkProxyRoutes(hono: Hono): void {
  hono.get('/vk-api/*', async c => {
    const requestUrl = new URL(c.req.url);
    const proxyPath = c.req.path.slice(PROXY_PREFIX.length);
    const response = await fetch(`${resolveVibeApiBaseUrl()}${proxyPath}${requestUrl.search}`);
    const headers = new Headers(response.headers);
    headers.delete('content-encoding');
    headers.delete('content-length');
    headers.delete('transfer-encoding');

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  });
}

serverRegistry.registerServerModule(({hono}) => {
  registerVkProxyRoutes(hono);
});
