import { describe, expect, it } from 'vitest';
import {
  buildLocalCaddyDashboardUrl,
  buildLocalCaddyEnv,
  buildLocalPreviewUrl,
  getLocalCaddyOptionMismatches,
  normalizeLocalCaddyStartOptions,
  renderLocalPreviewCaddyfile,
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
      readinessTimeoutMs: 5000,
    });
  });

  it('documents the local Caddy VD marker in command URLs', () => {
    expect(buildLocalCaddyDashboardUrl(55743)).toBe(
      'http://localhost:55743/?previewLocalCaddy=1',
    );
  });

  it('renders a local-only Caddyfile bound to loopback', () => {
    const caddyfile = renderLocalPreviewCaddyfile();

    expect(caddyfile).toContain('http://127.0.0.1:{$CADDY_PORT:3001}');
    expect(caddyfile).not.toContain('\n:{$CADDY_PORT');
    expect(caddyfile).toContain('vk_preview_resolver');
    expect(caddyfile).toContain('resolver_url {$PREVIEW_RESOLVER_URL}');
    expect(caddyfile).toContain('base_domain {$PREVIEW_BASE_DOMAIN:localhost}');
  });

  it('detects option mismatches before reusing a running local Caddy process', () => {
    expect(
      getLocalCaddyOptionMismatches(
        {
          backendPort: 3007,
          caddyPort: 3001,
          dashboardPort: 3005,
          baseDomain: 'localhost',
          caddyBin: 'caddy',
        },
        {
          backendPort: 3007,
          caddyPort: 55743,
          dashboardPort: 3005,
          baseDomain: 'localhost',
          caddyBin: 'caddy',
        },
      ),
    ).toEqual(['caddyPort=3001 (requested 55743)']);
  });
});
