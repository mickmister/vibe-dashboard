import { describe, expect, it } from 'vitest';
import {
  buildLocalCaddyDashboardUrl,
  buildLocalCaddyEnv,
  buildLocalPreviewUrl,
  normalizeLocalCaddyStartOptions,
} from './preview-local-caddy.js';

describe('preview-local-caddy', () => {
  it('builds loopback Caddy env for localhost-subdomain Preview URLs', () => {
    expect(
      buildLocalCaddyEnv({
        backendPort: 3007,
        caddyPort: 55743,
        dashboardPort: 3005,
        pluginsCaddyPath: '/tmp/plugins.caddy',
        accessLogPath: '/tmp/access.log',
      }),
    ).toMatchObject({
      CADDY_ADMIN: 'off',
      CADDY_PORT: '55743',
      BACKEND_PORT: '3007',
      DASHBOARD_PORT: '3005',
      PREVIEW_BASE_DOMAIN: 'localhost',
      PREVIEW_RESOLVER_URL: 'http://127.0.0.1:3005/internal/preview/resolve',
      CADDY_PLUGINS_CADDY: '/tmp/plugins.caddy',
      CADDY_ACCESS_LOG: '/tmp/access.log',
    });
  });

  it('rewrites canonical localhost Preview URL parts to the local Caddy port', () => {
    expect(
      buildLocalPreviewUrl(
        {
          host: '0123456789abcdef-vibekanban-web-preview.localhost',
        },
        55743,
      ),
    ).toBe(
      'http://0123456789abcdef-vibekanban-web-preview.localhost:55743/',
    );
  });

  it('normalizes command options to explicit ports and localhost base domain', () => {
    expect(
      normalizeLocalCaddyStartOptions({
        backendPort: '3007',
        caddyPort: '55743',
        dashboardPort: '3005',
      }),
    ).toMatchObject({
      backendPort: 3007,
      caddyPort: 55743,
      dashboardPort: 3005,
      baseDomain: 'localhost',
    });
  });

  it('documents the local Caddy VD marker in command URLs', () => {
    expect(buildLocalCaddyDashboardUrl(55743)).toBe(
      'http://localhost:55743/?previewLocalCaddy=1',
    );
  });
});
