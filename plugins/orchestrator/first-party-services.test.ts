import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BEADS_WEB_FIRST_PARTY_PLUGIN,
  BUILTIN_FIRST_PARTY_SERVICE_PLUGINS,
  createBeadsWebRouteConfig,
  createFirstPartyAdminPolicy,
  createFirstPartyDesiredState,
  createFirstPartyReleaseInstallPlan,
  getFirstPartyAdminCapabilitySummaries,
  getFirstPartyMarketplacePrivilegeAudit,
  getSupervisorManagedProgramNames,
  normalizeSupervisorConfig,
  renderBundledSupervisorConfig,
} from './first-party-services';
import { validatePluginManifest } from './manifest';

const goldenSupervisor = readFileSync(resolve(process.cwd(), 'supervisord.vkvd.conf'), 'utf8');
const goldenDockerfile = readFileSync(resolve(process.cwd(), 'Dockerfile.vkvd'), 'utf8');
const goldenCaddyfile = readFileSync(resolve(process.cwd(), 'Caddyfile'), 'utf8');
const pluginCaddyfile = readFileSync(resolve(process.cwd(), 'Caddyfile.plugins'), 'utf8');
const dockerEntrypoint = readFileSync(resolve(process.cwd(), 'docker-entrypoint.sh'), 'utf8');
const pluginRuntimeApply = readFileSync(resolve(process.cwd(), 'plugins/scripts/vd-plugin-runtime-apply.sh'), 'utf8');
const pluginReload = readFileSync(resolve(process.cwd(), 'plugins/scripts/vd-plugin-reload.sh'), 'utf8');

describe('first-party service plugin inventory and golden supervisor config', () => {
  it('inventories current supervisor-managed programs as first-party plugin manifests with privilege tiers', () => {
    for (const plugin of BUILTIN_FIRST_PARTY_SERVICE_PLUGINS) {
      expect(validatePluginManifest(plugin.manifest), plugin.manifest.id).toMatchObject({ success: true, errors: [] });
    }

    expect(getSupervisorManagedProgramNames(BUILTIN_FIRST_PARTY_SERVICE_PLUGINS)).toEqual([
      'code-server',
      'vibe-kanban',
      'vibe-dashboard',
      'vibe-agent-nudge-daemon',
      'vd-plugin-service-orchestrator-startup',
      'caddy',
      'memory-watchdog',
      'process-exporter',
      'tailscaled',
      'tailscale-up',
    ]);

    expect(getFirstPartyAdminCapabilitySummaries(BUILTIN_FIRST_PARTY_SERVICE_PLUGINS)).toMatchObject([
      { id: 'first-party.code-server', privilegeTier: 'trusted-workspace', requiresHostShell: true, repoAccess: 'workspace' },
      { id: 'first-party.vibe-kanban', privilegeTier: 'core-control-plane', vkHttpApi: 'agentPrompt', repoAccess: 'repo' },
      { id: 'first-party.vibe-dashboard', privilegeTier: 'core-control-plane', bootCritical: true },
      { id: 'first-party.vibe-agent-nudge-daemon', privilegeTier: 'core-control-plane', vkHttpApi: 'agentPrompt' },
      { id: 'first-party.plugin-service-orchestrator', privilegeTier: 'core-control-plane', requiresRoot: true },
      { id: 'first-party.caddy', privilegeTier: 'core-network', bootCritical: true },
      { id: 'first-party.memory-watchdog', privilegeTier: 'host-observability', requiresHostShell: true },
      { id: 'first-party.process-exporter', privilegeTier: 'host-observability', requiresRoot: true },
      { id: 'first-party.tailscale', privilegeTier: 'host-network', requiresRoot: true },
    ]);
  });

  it('renders the bundled supervisor config equivalent to supervisord.vkvd.conf', () => {
    expect(normalizeSupervisorConfig(renderBundledSupervisorConfig(BUILTIN_FIRST_PARTY_SERVICE_PLUGINS))).toBe(
      normalizeSupervisorConfig(goldenSupervisor),
    );
  });

  it('keeps Caddy startup non-blocking while plugin runtime apply runs after supervisor starts', () => {
    expect(goldenCaddyfile).toContain('admin localhost:2019');
    expect(goldenCaddyfile).toContain('import /etc/caddy/plugins.caddy');
    expect(goldenCaddyfile).not.toContain('@beads_web_host');
    expect(pluginCaddyfile).toContain('VD plugin-owned Caddy routes');
    expect(goldenDockerfile).toContain('COPY Caddyfile.plugins /etc/caddy/plugins.caddy');
    expect(goldenDockerfile).toContain('COPY plugins/scripts/vd-plugin-runtime-apply.sh /usr/local/bin/vd-plugin-runtime-apply.sh');
    expect(goldenDockerfile).toContain('COPY plugins/scripts/vd-plugin-reload.sh /usr/local/bin/vd-plugin-reload.sh');
    expect(goldenDockerfile).toContain('COPY plugins/scripts/vd-plugin-service-runner.mjs /usr/local/bin/vd-plugin-service-runner.mjs');
    expect(goldenDockerfile).toContain('COPY --from=dashboard-builder /app/dist/vibe-agent /opt/vibe-kanban-vscode-web-seed/dist/vibe-agent');
    expect(goldenDockerfile).toContain('exec node /opt/vibe-kanban-vscode-web-seed/dist/vibe-agent/legacy-cli/vibe-agent.js "$@"');
    expect(goldenDockerfile).toContain('command -v vibe-agent');
    expect(goldenDockerfile).toContain('vibe-agent --help >/dev/null');
    expect(dockerEntrypoint).toContain('Runtime plugin apply writes generated routes here after Caddy starts, then reloads Caddy.');
    expect(goldenCaddyfile).toContain('Caddy starts with this import present; runtime');
    expect(dockerEntrypoint).not.toContain('plugin-service-orchestrator-cli.ts apply');
    expect(pluginRuntimeApply).toContain('dist/plugins-orchestrator/plugin-service-orchestrator-cli.js apply');
    expect(pluginRuntimeApply).toContain('--caddy-config-path /etc/caddy/Caddyfile');
    expect(pluginRuntimeApply).toContain('supervisorctl reread');
    expect(pluginRuntimeApply).toContain('supervisorctl update');
    expect(pluginRuntimeApply).toContain('reload_caddy_with_retry()');
    expect(pluginRuntimeApply).toContain('VD_PLUGIN_CADDY_RELOAD_ATTEMPTS');
    expect(pluginRuntimeApply).toContain('caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile');
    expect(pluginRuntimeApply).not.toContain('VD_PLUGIN_ORCHESTRATOR_ALLOW_HASH_MISMATCH');
    expect(pluginReload).toContain('exec /usr/local/bin/vd-plugin-runtime-apply.sh "$@"');
    expect(goldenSupervisor).toContain('command=/usr/local/bin/vd-plugin-runtime-apply.sh');
    expect(goldenSupervisor).toContain('[program:caddy]\ncommand=caddy run --config /etc/caddy/Caddyfile --adapter caddyfile\nautostart=true\nautorestart=true\npriority=10');
    expect(goldenSupervisor).toContain('[program:vibe-agent-nudge-daemon]\ncommand=sh -c');
    expect(goldenSupervisor).toContain('VD_NUDGE_DAEMON_ENABLED');
    expect(goldenSupervisor).toContain('dist/vibe-agent/nudge/daemon.js');
    expect(goldenSupervisor).toContain('[program:vd-plugin-service-orchestrator-startup]\ncommand=/usr/local/bin/vd-plugin-runtime-apply.sh\nautostart=true\nautorestart=false\nstartsecs=0\npriority=1000');
  });

  it('treats Dockerfile.vkvd and supervisord.vkvd.conf as golden runtime config names', () => {
    const desired = createFirstPartyDesiredState(BUILTIN_FIRST_PARTY_SERVICE_PLUGINS);

    expect(desired.goldenConfigs).toEqual({ dockerfile: 'Dockerfile.vkvd', supervisor: 'supervisord.vkvd.conf' });
    expect(desired.services['first-party.vibe-kanban']).toMatchObject({
      desiredVersion: 'github-release:vk-assets-${VK_COMMIT}',
      installStrategy: 'github-release-asset',
      stagingRequired: true,
      rollbackable: true,
    });
    expect(desired.services['first-party.vibe-dashboard']).toMatchObject({
      installStrategy: 'bundled-runtime-artifact',
      stagingRequired: true,
    });
  });

  it('makes boot-critical first-party services non-removable while keeping restart-only services swappable', () => {
    const policy = createFirstPartyAdminPolicy(BUILTIN_FIRST_PARTY_SERVICE_PLUGINS);

    expect(policy['first-party.vibe-dashboard']).toMatchObject({
      adminRemovable: false,
      removalBlockedReason: 'boot-critical service required for the control plane to start',
      versionSwapAllowed: true,
      requiresStagingBeforeProduction: true,
    });
    expect(policy['first-party.caddy']).toMatchObject({
      adminRemovable: false,
      removalBlockedReason: 'boot-critical service required for the control plane to start',
    });
    expect(policy['first-party.vibe-kanban']).toMatchObject({
      adminRemovable: true,
      versionSwapAllowed: true,
      requiresStagingBeforeProduction: true,
    });
    expect(policy['first-party.code-server']).toMatchObject({
      adminRemovable: true,
      versionSwapAllowed: true,
    });
  });

  it('audits broad first-party privileges separately from sandbox-first marketplace defaults', () => {
    const audit = getFirstPartyMarketplacePrivilegeAudit(BUILTIN_FIRST_PARTY_SERVICE_PLUGINS);

    expect(audit.marketplaceDefaults).toMatchObject({
      vkHttpApi: 'none',
      hostShell: 'none',
      codeServer: 'none',
      hostDocker: 'none',
      filesystem: [],
      network: { mode: 'none' },
    });
    expect(audit.firstPartyBroadGrants).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'first-party.vibe-kanban', vkHttpApi: 'agentPrompt', repoAccess: 'repo' }),
        expect.objectContaining({ id: 'first-party.code-server', codeServer: 'admin', requiresHostShell: true }),
        expect.objectContaining({ id: 'first-party.tailscale', networkMode: 'ingress-and-egress', requiresRoot: true }),
      ]),
    );
  });

  it('plans idempotent first-party release asset installs and no-ops matching installed versions', () => {
    const requested = {
      serviceId: 'first-party.vibe-kanban',
      repository: 'mickmister/vibe-kanban',
      releaseTag: 'vk-assets-abc123',
      commitSha: 'abc123',
      assetName: 'vibe-kanban-linux-x64.tar.gz',
      sha256: 'a'.repeat(64),
      installRoot: '/var/lib/vd/first-party',
      compatibility: { vibeDashboard: '^1.0.0' },
    } as const;

    expect(createFirstPartyReleaseInstallPlan({ requested, installed: [] })).toMatchObject({
      action: 'install',
      serviceId: 'first-party.vibe-kanban',
      versionKey: 'github-release:vk-assets-abc123@abc123',
      artifactUrl: 'https://github.com/mickmister/vibe-kanban/releases/download/vk-assets-abc123/vibe-kanban-linux-x64.tar.gz',
      checksumUrl: 'https://github.com/mickmister/vibe-kanban/releases/download/vk-assets-abc123/vibe-kanban-linux-x64.tar.gz.sha256',
      installPath: '/var/lib/vd/first-party/first-party.vibe-kanban/github-release_vk-assets-abc123_abc123',
      rollbackPointer: null,
      verify: { sha256: 'a'.repeat(64) },
    });

    expect(createFirstPartyReleaseInstallPlan({
      requested,
      installed: [{ serviceId: 'first-party.vibe-kanban', versionKey: 'github-release:vk-assets-abc123@abc123', installPath: '/existing' }],
    })).toEqual({
      action: 'noop',
      serviceId: 'first-party.vibe-kanban',
      versionKey: 'github-release:vk-assets-abc123@abc123',
      installPath: '/existing',
      rollbackPointer: null,
    });
  });

  it('models beads-web as a least-privilege first-party plugin with scoped bridge and named-host routing', () => {
    expect(BEADS_WEB_FIRST_PARTY_PLUGIN.manifest).toMatchObject({
      id: 'first-party.beads-web',
      kind: 'first-party-service',
      components: {
        denoBridges: [
          {
            id: 'beads-data-bridge',
            methods: ['beads.list', 'beads.get', 'beads.updateStatus'],
            permissions: { read: ['.beads'], write: ['.beads'], run: [] },
          },
        ],
      },
      requestedCapabilities: {
        hostShell: 'none',
        codeServer: 'none',
        hostDocker: 'none',
        filesystem: [{ scope: 'workspace', path: '.beads', access: 'readWrite' }],
      },
    });

    expect(createBeadsWebRouteConfig({ proxyDomain: 'example.test', port: 3109 })).toEqual({
      host: 'beads-web.example.test',
      upstream: '127.0.0.1:3109',
      fallbackPath: '/beads',
      assetOwnership: 'beads-web host owns / and /_next only on named host',
    });
  });
});
