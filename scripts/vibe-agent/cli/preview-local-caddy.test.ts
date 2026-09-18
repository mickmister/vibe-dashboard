import { describe, expect, it } from 'vitest';
import {
  buildLocalCaddyDashboardUrl,
  buildLocalCaddyEnv,
  buildLocalPreviewUrl,
  getLocalCaddyOptionMismatches,
  getLocalCaddyReuseDecision,
  normalizeLocalCaddyStartOptions,
  renderLocalPreviewCaddyfile,
  verifyLocalCaddyCompatibility,
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
      PREVIEW_RESOLVER_URL: 'http://127.0.0.1:3005/internal/preview/resolve',
      CADDY_PLUGINS_CADDY: '/tmp/plugins.caddy',
      CADDY_ACCESS_LOG: '/tmp/access.log',
    });
  });

  it('rewrites canonical localhost Preview URL parts to the local Caddy port', () => {
    expect(
      buildLocalPreviewUrl(
        {
          host: 'web-vibekanban-0123456789abcdef-preview.localhost',
        },
        55743,
      ),
    ).toBe(
      'http://web-vibekanban-0123456789abcdef-preview.localhost:55743/',
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
      readinessTimeoutMs: 5000,
      caddyBin: expect.stringMatching(/\.cache\/vibe-dashboard\/preview-caddy\/slot-repo-workspace-customer-v1\/caddy$/),
    });
  });

  it('rejects Caddy binaries that do not understand the current Preview URL grammar capability', () => {
    expect(() => verifyLocalCaddyCompatibility('/usr/bin/caddy', (_command, args) => {
      if (args[0] === 'list-modules') {
        return { status: 0, stdout: 'http.handlers.vibe_preview_resolver\n', stderr: '' };
      }
      return { status: 1, stdout: '', stderr: 'unrecognized vk_preview_resolver option "grammar"' };
    })).toThrow(/incompatible.*slot-repo-workspace-customer-v1.*bootstrap-custom-caddy/i);
  });

  it('accepts a Caddy binary only when module and grammar capability checks pass', () => {
    const calls: string[][] = [];
    expect(verifyLocalCaddyCompatibility('/repo/.tmp/custom-caddy/caddy', (_command, args) => {
      calls.push(args);
      return args[0] === 'list-modules'
        ? { status: 0, stdout: 'http.handlers.vibe_preview_resolver\n', stderr: '' }
        : { status: 0, stdout: '{}', stderr: '' };
    })).toBe('/repo/.tmp/custom-caddy/caddy');
    expect(calls).toEqual([
      ['list-modules'],
      ['adapt', '--adapter', 'caddyfile', '--config', '-'],
    ]);
  });

  it('documents the local Caddy VD marker in command URLs', () => {
    expect(buildLocalCaddyDashboardUrl(55743)).toBe(
      'http://localhost:55743/?previewLocalCaddy=1',
    );
  });

  it('renders a local-only Caddyfile bound to loopback', () => {
    const caddyfile = renderLocalPreviewCaddyfile();

    expect(caddyfile).toContain('http://:{$CADDY_PORT:3001}');
    expect(caddyfile).toContain('\tbind 127.0.0.1');
    expect(caddyfile).not.toContain('http://127.0.0.1:{$CADDY_PORT');
    expect(caddyfile).toContain('vk_preview_resolver');
    expect(caddyfile).toContain('resolver_url {$PREVIEW_RESOLVER_URL}');
    expect(caddyfile).not.toContain('base_domain');
    expect(caddyfile).toContain('routing domain-independent-v1');
    expect(caddyfile).toContain('grammar slot-repo-workspace-customer-v1');
    expect(caddyfile).toContain('@vibe_dashboard_assets');
    expect(caddyfile).toContain('@vk_workspace_assets');
    expect(caddyfile).toContain('handle_response @wrapper_asset_error');
    expect(caddyfile).toContain('handle /internal/preview/*');
  });

  it('detects option mismatches before reusing a running local Caddy process', () => {
    expect(
      getLocalCaddyOptionMismatches(
        {
          backendPort: 3007,
          caddyPort: 3001,
          dashboardPort: 3005,
          caddyBin: 'caddy',
        },
        {
          backendPort: 3007,
          caddyPort: 55743,
          dashboardPort: 3005,
          caddyBin: 'caddy',
        },
      ),
    ).toEqual(['caddyPort=3001 (requested 55743)']);
  });

  it('ignores a legacy baseDomain state field during migration', () => {
    const legacyState = { backendPort: 3007, caddyPort: 3001, dashboardPort: 3005, caddyBin: 'caddy', baseDomain: 'localhost' };
    expect(getLocalCaddyOptionMismatches(
      legacyState,
      { backendPort: 3007, caddyPort: 3001, dashboardPort: 3005, caddyBin: 'caddy' },
    )).toEqual([]);
  });

  it('reuses only an unchanged compatible executable identity', () => {
    const state = { executableIdentity: { sha256: 'same', grammar: 'slot-repo-workspace-customer-v1' as const, routing: 'domain-independent-v1' as const } };
    expect(getLocalCaddyReuseDecision(state, state.executableIdentity, true)).toEqual({ kind: 'reuse' });
    expect(getLocalCaddyReuseDecision(state, { ...state.executableIdentity, sha256: 'replacement' }, true)).toMatchObject({ kind: 'conflict' });
  });

  it('requires restart for legacy running state but permits stale-state migration', () => {
    const current = { sha256: 'current', grammar: 'slot-repo-workspace-customer-v1' as const, routing: 'domain-independent-v1' as const };
    expect(getLocalCaddyReuseDecision({}, current, true)).toMatchObject({ kind: 'conflict' });
    expect(getLocalCaddyReuseDecision({}, current, false)).toEqual({ kind: 'stale' });
    expect(getLocalCaddyReuseDecision({ executableIdentity: { sha256: 'current', grammar: 'slot-repo-workspace-customer-v1' } }, current, true)).toMatchObject({ kind: 'conflict' });
  });
});
