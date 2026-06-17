import { join } from 'node:path';
import {
  DEFAULT_PLUGIN_CAPABILITY_REQUESTS,
  type CodeServerCapability,
  type PluginCapabilityRequests,
  type PluginManifest,
  type VkHttpApiCapability,
} from './manifest';

export type FirstPartyPrivilegeTier =
  | 'core-control-plane'
  | 'core-network'
  | 'trusted-workspace'
  | 'host-observability'
  | 'host-network'
  | 'scoped-app';

export interface FirstPartyServicePlugin {
  manifest: PluginManifest;
  privilegeTier: FirstPartyPrivilegeTier;
  bootCritical: boolean;
  supervisorPrograms: string[];
  supervisorConfig?: string;
  installStrategy: 'github-release-asset' | 'bundled-runtime-artifact' | 'apt-or-script' | 'generated-config' | 'scoped-bridge';
  desiredVersion: string;
  stagingRequired: boolean;
  rollbackable: boolean;
}

export interface FirstPartyAdminCapabilitySummary {
  id: string;
  displayName: string;
  privilegeTier: FirstPartyPrivilegeTier;
  bootCritical: boolean;
  requiresRoot: boolean;
  requiresHostShell: boolean;
  vkHttpApi: VkHttpApiCapability;
  codeServer: CodeServerCapability;
  repoAccess: 'none' | 'workspace' | 'repo';
  networkMode: string;
}

export interface FirstPartyDesiredState {
  goldenConfigs: { dockerfile: 'Dockerfile.vkvd'; supervisor: 'supervisord.vkvd.conf' };
  services: Record<string, {
    desiredVersion: string;
    installStrategy: FirstPartyServicePlugin['installStrategy'];
    stagingRequired: boolean;
    rollbackable: boolean;
    supervisorPrograms: string[];
  }>;
}

export interface FirstPartyAdminPolicyEntry {
  id: string;
  displayName: string;
  adminRemovable: boolean;
  removalBlockedReason?: string;
  versionSwapAllowed: boolean;
  requiresStagingBeforeProduction: boolean;
  rollbackable: boolean;
}

export interface FirstPartyMarketplacePrivilegeAudit {
  marketplaceDefaults: PluginCapabilityRequests;
  firstPartyBroadGrants: FirstPartyAdminCapabilitySummary[];
}

export interface RequestedFirstPartyReleaseAsset {
  serviceId: string;
  repository: string;
  releaseTag: string;
  commitSha: string;
  assetName: string;
  sha256: string;
  installRoot: string;
  compatibility: { vibeDashboard: string };
}

export interface InstalledFirstPartyVersion {
  serviceId: string;
  versionKey: string;
  installPath: string;
}

export type FirstPartyReleaseInstallPlan =
  | {
    action: 'install';
    serviceId: string;
    versionKey: string;
    artifactUrl: string;
    checksumUrl: string;
    installPath: string;
    rollbackPointer: InstalledFirstPartyVersion | null;
    verify: { sha256: string };
    compatibility: RequestedFirstPartyReleaseAsset['compatibility'];
  }
  | {
    action: 'noop';
    serviceId: string;
    versionKey: string;
    installPath: string;
    rollbackPointer: InstalledFirstPartyVersion | null;
  };

export interface BeadsWebRouteConfig {
  host: string;
  upstream: string;
  fallbackPath: '/beads';
  assetOwnership: string;
}

const SUPERVISOR_HEADER = `[unix_http_server]
file=/var/run/supervisor.sock
chmod=0770
chown=root:vkuser

[supervisorctl]
serverurl=unix:///var/run/supervisor.sock

[supervisord]
nodaemon=true
logfile=/var/log/supervisor/supervisord.log
logfile_maxbytes=50MB
loglevel=info
user=root

[rpcinterface:supervisor]
supervisor.rpcinterface_factory = supervisor.rpcinterface:make_main_rpcinterface

[include]
files = /etc/supervisor/conf.d/vd-generated/*.conf`;

const CODE_SERVER_SUPERVISOR = `; code-server
[program:code-server]
command=sh -c 'if [ -n "\${CODE_PASSWORD}" ] && [ "\${CODE_PASSWORD}" != "__unset__" ]; then export PASSWORD="\${CODE_PASSWORD}"; unset HASHED_PASSWORD; exec code-server --auth password --bind-addr 0.0.0.0:%(ENV_CODE_PORT)s --idle-timeout-seconds=3600; else unset PASSWORD HASHED_PASSWORD; exec code-server --auth none --bind-addr 0.0.0.0:%(ENV_CODE_PORT)s --idle-timeout-seconds=3600; fi'
autostart=true
autorestart=true
stopasgroup=true
killasgroup=true
startsecs=5
startretries=3
stdout_logfile=/dev/fd/1
stdout_logfile_maxbytes=0
stderr_logfile=/dev/fd/2
stderr_logfile_maxbytes=0
environment=PORT="%(ENV_CODE_PORT)s",CODE_PASSWORD="%(ENV_CODE_PASSWORD)s",HOME="/home/vkuser",XDG_CONFIG_HOME="/home/vkuser/.config",PATH="/usr/local/lib/vk-bd-wrapper/bin:/home/vkuser/.npm-global/bin:/usr/local/cargo/bin:/usr/local/go/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
user=vkuser`;

const VIBE_KANBAN_SUPERVISOR = `; vibe-kanban (source-built binary with database backup before starting)
[program:vibe-kanban]
command=sh -c 'if [ "%(ENV_ENABLE_VIBE_KANBAN)s" != "true" ]; then echo "vibe-kanban disabled (ENABLE_VIBE_KANBAN != true)"; exit 0; fi; /usr/local/bin/backup-vibe-kanban-db.sh && exec /usr/local/bin/vibe-kanban'
autostart=true
autorestart=true
stdout_logfile=/dev/fd/1
stdout_logfile_maxbytes=0
stderr_logfile=/dev/fd/2
stderr_logfile_maxbytes=0
environment=HOST="0.0.0.0",PORT="%(ENV_BACKEND_PORT)s",ENABLE_VIBE_KANBAN="%(ENV_ENABLE_VIBE_KANBAN)s",VK_BUILD_VERSION_FILE="/usr/local/share/vibe-kanban-build-version",VK_SHARED_API_BASE="%(ENV_VK_SHARED_API_BASE)s",VK_ALLOWED_ORIGINS="%(ENV_VK_ALLOWED_ORIGINS)s",HOME="/home/vkuser",XDG_CONFIG_HOME="/home/vkuser/.config",PATH="/usr/local/lib/vk-bd-wrapper/bin:/home/vkuser/.npm-global/bin:/usr/local/cargo/bin:/usr/local/go/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
user=vkuser
directory=/home/vkuser/repos`;

const VIBE_DASHBOARD_SUPERVISOR = `; vibe-dashboard
[program:vibe-dashboard]
command=node dist/node/node-entry.mjs
autostart=true
autorestart=true
stdout_logfile=/dev/fd/1
stdout_logfile_maxbytes=0
stderr_logfile=/dev/fd/2
stderr_logfile_maxbytes=0
environment=HOST="0.0.0.0",PORT="%(ENV_DASHBOARD_PORT)s",VD_PLUGIN_INSTALL_ROOT="/var/lib/vd/plugins",HOME="/home/vkuser",XDG_CONFIG_HOME="/home/vkuser/.config",PATH="/usr/local/lib/vk-bd-wrapper/bin:/home/vkuser/.npm-global/bin:/usr/local/cargo/bin:/usr/local/go/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
user=vkuser
directory=/home/vkuser/.local/share/vibe-dashboard-runtime`;

const PLUGIN_SERVICE_ORCHESTRATOR_SUPERVISOR = `; plugin service orchestrator (reconciles persisted per-instance plugin config into generated supervisor programs)
[program:vd-plugin-service-orchestrator-startup]
command=/usr/local/bin/vd-plugin-runtime-apply.sh
autostart=true
autorestart=false
startsecs=0
priority=1000
stdout_logfile=/dev/fd/1
stdout_logfile_maxbytes=0
stderr_logfile=/dev/fd/2
stderr_logfile_maxbytes=0
environment=HOME="/root",PATH="/usr/local/lib/vk-bd-wrapper/bin:/home/vkuser/.npm-global/bin:/usr/local/cargo/bin:/usr/local/go/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
user=root`;

const CADDY_SUPERVISOR = `; caddy
[program:caddy]
command=caddy run --config /etc/caddy/Caddyfile --adapter caddyfile
autostart=true
autorestart=true
priority=10
stdout_logfile=/dev/fd/1
stdout_logfile_maxbytes=0
stderr_logfile=/dev/fd/2
stderr_logfile_maxbytes=0`;

const MEMORY_WATCHDOG_SUPERVISOR = `; memory watchdog (Mattermost alerts for per-process and total RAM thresholds)
[program:memory-watchdog]
command=sh -c 'if [ "%(ENV_MEMORY_WATCHDOG_ENABLED)s" != "true" ]; then echo "memory-watchdog disabled (MEMORY_WATCHDOG_ENABLED != true)"; exec tail -f /dev/null; fi; if [ -z "%(ENV_MEMORY_WATCHDOG_MATTERMOST_WEBHOOK_URL)s" ]; then echo "memory-watchdog disabled (MEMORY_WATCHDOG_MATTERMOST_WEBHOOK_URL is empty)"; exec tail -f /dev/null; fi; exec node /opt/vibe-kanban-vscode-web-seed/scripts/memory-watchdog.mjs'
autostart=true
autorestart=true
startsecs=0
stdout_logfile=/dev/fd/1
stdout_logfile_maxbytes=0
stderr_logfile=/dev/fd/2
stderr_logfile_maxbytes=0
environment=HOME="/root",PATH="/usr/local/lib/vk-bd-wrapper/bin:/home/vkuser/.npm-global/bin:/usr/local/cargo/bin:/usr/local/go/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
user=root
directory=/home/vkuser/repos/vibe-kanban-vscode-web`;

const PROCESS_EXPORTER_SUPERVISOR = `; process-exporter (grouped process metrics for Prometheus)
[program:process-exporter]
command=/usr/local/bin/process-exporter -config.path /etc/process-exporter/process-exporter.yml -web.listen-address=127.0.0.1:9256 -children=true -threads=false -remove-empty-groups
autostart=true
autorestart=true
startsecs=0
stdout_logfile=/dev/fd/1
stdout_logfile_maxbytes=0
stderr_logfile=/dev/fd/2
stderr_logfile_maxbytes=0
environment=HOME="/root",PATH="/usr/local/lib/vk-bd-wrapper/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
user=root`;

const TAILSCALE_SUPERVISOR = `; tailscaled (daemon must run as root, requires ENABLE_TAILSCALE=true)
[program:tailscaled]
command=sh -c 'if [ "%(ENV_ENABLE_TAILSCALE)s" != "true" ]; then echo "Tailscale disabled (ENABLE_TAILSCALE != true)"; exit 0; fi; exec /usr/sbin/tailscaled --state=/var/lib/tailscale/tailscaled.state --socket=/var/run/tailscale/tailscaled.sock'
autostart=true
autorestart=unexpected
startsecs=0
stdout_logfile=/dev/fd/1
stdout_logfile_maxbytes=0
stderr_logfile=/dev/fd/2
stderr_logfile_maxbytes=0
user=root

; tailscale up (requires ENABLE_TAILSCALE=true)
[program:tailscale-up]
command=sh -c 'if [ "%(ENV_ENABLE_TAILSCALE)s" != "true" ]; then echo "Tailscale disabled (ENABLE_TAILSCALE != true)"; exit 0; fi; sleep 2 && if [ -n "\${TAILSCALE_AUTHKEY}" ]; then tailscale up --authkey="\${TAILSCALE_AUTHKEY}" --hostname="\${TAILSCALE_HOSTNAME:-vkdev}"; else tailscale up --hostname="\${TAILSCALE_HOSTNAME:-vkdev}"; fi'
autostart=true
autorestart=false
startsecs=0
stdout_logfile=/dev/fd/1
stdout_logfile_maxbytes=0
stderr_logfile=/dev/fd/2
stderr_logfile_maxbytes=0
user=root`;

function manifest(input: {
  id: string;
  displayName: string;
  version: string;
  requestedCapabilities?: PluginManifest['requestedCapabilities'];
  components?: Partial<PluginManifest['components']>;
}): PluginManifest {
  return {
    schemaVersion: 1,
    id: input.id,
    version: input.version,
    displayName: input.displayName,
    kind: 'first-party-service',
    components: input.components ?? { services: [{ id: input.id.split('.').pop()!, runtime: 'supervisor', command: input.id }] },
    requestedCapabilities: input.requestedCapabilities,
  };
}

export const BEADS_WEB_FIRST_PARTY_PLUGIN: FirstPartyServicePlugin = {
  manifest: manifest({
    id: 'first-party.beads-web',
    displayName: 'Beads Web',
    version: 'planned',
    components: {
      services: [{ id: 'beads-web', runtime: 'deno', command: 'beads-web --host 127.0.0.1 --port ${BEADS_WEB_PORT}' }],
      denoBridges: [{
        id: 'beads-data-bridge',
        entry: 'bridges/beads-data.ts',
        methods: ['beads.list', 'beads.get', 'beads.updateStatus'],
        permissions: { read: ['.beads'], write: ['.beads'], run: [] },
      }],
    },
    requestedCapabilities: {
      hostShell: 'none',
      codeServer: 'none',
      hostDocker: 'none',
      filesystem: [{ scope: 'workspace', path: '.beads', access: 'readWrite' }],
      network: { mode: 'ingress', ports: ['${BEADS_WEB_PORT}'] },
    },
  }),
  privilegeTier: 'scoped-app',
  bootCritical: false,
  supervisorPrograms: [],
  installStrategy: 'scoped-bridge',
  desiredVersion: 'planned',
  stagingRequired: true,
  rollbackable: true,
};

export const BUILTIN_FIRST_PARTY_SERVICE_PLUGINS: FirstPartyServicePlugin[] = [
  {
    manifest: manifest({
      id: 'first-party.code-server',
      displayName: 'code-server',
      version: '4.123.0',
      requestedCapabilities: { hostShell: { commands: ['code-server'] }, codeServer: 'admin', filesystem: [{ scope: 'workspace', path: '.', access: 'readWrite' }], network: { mode: 'ingress', ports: ['${CODE_PORT}'] } },
    }),
    privilegeTier: 'trusted-workspace', bootCritical: false, supervisorPrograms: ['code-server'], supervisorConfig: CODE_SERVER_SUPERVISOR, installStrategy: 'apt-or-script', desiredVersion: 'code-server@4.123.0', stagingRequired: true, rollbackable: true,
  },
  {
    manifest: manifest({
      id: 'first-party.vibe-kanban', displayName: 'Vibe Kanban', version: 'github-release:vk-assets-${VK_COMMIT}',
      requestedCapabilities: { vkHttpApi: 'agentPrompt', hostShell: { commands: ['/usr/local/bin/vibe-kanban'] }, codeServer: 'workspace', filesystem: [{ scope: 'repo', path: '/home/vkuser/repos', access: 'readWrite' }], network: { mode: 'ingress-and-egress', ports: ['${BACKEND_PORT}'] }, env: ['VK_SHARED_API_BASE', 'VK_ALLOWED_ORIGINS'] },
      components: { services: [{ id: 'vibe-kanban', runtime: 'supervisor', command: '/usr/local/bin/vibe-kanban', versionSource: { kind: 'github-release-asset', repository: 'mickmister/vibe-kanban', tag: 'vk-assets-${VK_COMMIT}', asset: 'vibe-kanban-${TARGETARCH}.tar.gz' } }] },
    }),
    privilegeTier: 'core-control-plane', bootCritical: false, supervisorPrograms: ['vibe-kanban'], supervisorConfig: VIBE_KANBAN_SUPERVISOR, installStrategy: 'github-release-asset', desiredVersion: 'github-release:vk-assets-${VK_COMMIT}', stagingRequired: true, rollbackable: true,
  },
  {
    manifest: manifest({ id: 'first-party.vibe-dashboard', displayName: 'Vibe Dashboard', version: 'bundled', requestedCapabilities: { hostShell: { commands: ['node dist/node/node-entry.mjs'] }, network: { mode: 'ingress', ports: ['${DASHBOARD_PORT}'] } } }),
    privilegeTier: 'core-control-plane', bootCritical: true, supervisorPrograms: ['vibe-dashboard'], supervisorConfig: VIBE_DASHBOARD_SUPERVISOR, installStrategy: 'bundled-runtime-artifact', desiredVersion: 'bundled', stagingRequired: true, rollbackable: true,
  },
  {
    manifest: manifest({ id: 'first-party.plugin-service-orchestrator', displayName: 'Plugin Service Orchestrator', version: 'bundled', requestedCapabilities: { hostShell: { commands: ['vd-plugin-runtime-apply.sh', 'supervisorctl reread', 'supervisorctl update', 'caddy reload'] }, filesystem: [{ scope: 'absolute', path: '/var/lib/vd', access: 'readWrite' }], network: { mode: 'egress' } } }),
    privilegeTier: 'core-control-plane', bootCritical: false, supervisorPrograms: ['vd-plugin-service-orchestrator-startup'], supervisorConfig: PLUGIN_SERVICE_ORCHESTRATOR_SUPERVISOR, installStrategy: 'bundled-runtime-artifact', desiredVersion: 'bundled', stagingRequired: true, rollbackable: true,
  },
  {
    manifest: manifest({ id: 'first-party.caddy', displayName: 'Caddy', version: '2.10.2', requestedCapabilities: { hostShell: { commands: ['caddy run'] }, network: { mode: 'ingress-and-egress', ports: ['80', '443'] } } }),
    privilegeTier: 'core-network', bootCritical: true, supervisorPrograms: ['caddy'], supervisorConfig: CADDY_SUPERVISOR, installStrategy: 'generated-config', desiredVersion: 'caddy@2.10.2+vibe-rewriter', stagingRequired: true, rollbackable: true,
  },
  {
    manifest: manifest({ id: 'first-party.memory-watchdog', displayName: 'Memory Watchdog', version: 'bundled', requestedCapabilities: { hostShell: { commands: ['node scripts/memory-watchdog.mjs'] }, env: ['MEMORY_WATCHDOG_MATTERMOST_WEBHOOK_URL'] } }),
    privilegeTier: 'host-observability', bootCritical: false, supervisorPrograms: ['memory-watchdog'], supervisorConfig: MEMORY_WATCHDOG_SUPERVISOR, installStrategy: 'bundled-runtime-artifact', desiredVersion: 'bundled', stagingRequired: true, rollbackable: true,
  },
  {
    manifest: manifest({ id: 'first-party.process-exporter', displayName: 'process-exporter', version: '0.8.7', requestedCapabilities: { hostShell: { commands: ['process-exporter'] }, network: { mode: 'ingress', ports: ['9256'] } } }),
    privilegeTier: 'host-observability', bootCritical: false, supervisorPrograms: ['process-exporter'], supervisorConfig: PROCESS_EXPORTER_SUPERVISOR, installStrategy: 'github-release-asset', desiredVersion: 'process-exporter@0.8.7', stagingRequired: true, rollbackable: true,
  },
  {
    manifest: manifest({
      id: 'first-party.tailscale',
      displayName: 'Tailscale',
      version: '1.98.4',
      components: {
        services: [
          { id: 'tailscaled', runtime: 'supervisor', command: 'tailscaled' },
          { id: 'tailscale-up', runtime: 'supervisor', command: 'tailscale up' },
        ],
        secrets: [{ id: 'tailscale-authkey', provider: 'varlock', ref: 'first-party/tailscale/authkey' }],
      },
      requestedCapabilities: { hostShell: { commands: ['tailscaled', 'tailscale up'] }, network: { mode: 'ingress-and-egress' }, secrets: ['tailscale-authkey'] },
    }),
    privilegeTier: 'host-network', bootCritical: false, supervisorPrograms: ['tailscaled', 'tailscale-up'], supervisorConfig: TAILSCALE_SUPERVISOR, installStrategy: 'apt-or-script', desiredVersion: 'tailscale@1.98.4', stagingRequired: true, rollbackable: true,
  },
];

export function renderBundledSupervisorConfig(plugins: FirstPartyServicePlugin[]): string {
  return [SUPERVISOR_HEADER, ...plugins.flatMap((plugin) => plugin.supervisorConfig ? [plugin.supervisorConfig] : [])].join('\n\n') + '\n';
}

export function normalizeSupervisorConfig(config: string): string {
  return config.replace(/\r\n/g, '\n').trim() + '\n';
}

export function getSupervisorManagedProgramNames(plugins: FirstPartyServicePlugin[]): string[] {
  return plugins.flatMap((plugin) => plugin.supervisorPrograms);
}

export function getFirstPartyAdminCapabilitySummaries(plugins: FirstPartyServicePlugin[]): FirstPartyAdminCapabilitySummary[] {
  return plugins.map((plugin) => {
    const capabilities = plugin.manifest.requestedCapabilities ?? {};
    const fs = capabilities.filesystem ?? [];
    return {
      id: plugin.manifest.id,
      displayName: plugin.manifest.displayName,
      privilegeTier: plugin.privilegeTier,
      bootCritical: plugin.bootCritical,
      requiresRoot: plugin.supervisorConfig?.includes('user=root') ?? false,
      requiresHostShell: capabilities.hostShell !== undefined && capabilities.hostShell !== 'none',
      vkHttpApi: capabilities.vkHttpApi ?? 'none',
      codeServer: capabilities.codeServer ?? 'none',
      repoAccess: fs.some((entry) => entry.scope === 'repo') ? 'repo' : fs.some((entry) => entry.scope === 'workspace') ? 'workspace' : 'none',
      networkMode: capabilities.network?.mode ?? 'none',
    };
  });
}

export function createFirstPartyAdminPolicy(plugins: FirstPartyServicePlugin[]): Record<string, FirstPartyAdminPolicyEntry> {
  return Object.fromEntries(plugins.map((plugin) => {
    const adminRemovable = !plugin.bootCritical;
    return [plugin.manifest.id, {
      id: plugin.manifest.id,
      displayName: plugin.manifest.displayName,
      adminRemovable,
      removalBlockedReason: adminRemovable ? undefined : 'boot-critical service required for the control plane to start',
      versionSwapAllowed: plugin.rollbackable,
      requiresStagingBeforeProduction: plugin.stagingRequired,
      rollbackable: plugin.rollbackable,
    }];
  }));
}

export function getFirstPartyMarketplacePrivilegeAudit(plugins: FirstPartyServicePlugin[]): FirstPartyMarketplacePrivilegeAudit {
  const broadPrivilegeSummaries = getFirstPartyAdminCapabilitySummaries(plugins).filter((summary) => {
    return summary.requiresRoot
      || summary.requiresHostShell
      || summary.vkHttpApi !== 'none'
      || summary.codeServer !== 'none'
      || summary.repoAccess === 'repo'
      || summary.networkMode === 'ingress-and-egress';
  });

  return {
    marketplaceDefaults: {
      ...DEFAULT_PLUGIN_CAPABILITY_REQUESTS,
      filesystem: [...DEFAULT_PLUGIN_CAPABILITY_REQUESTS.filesystem],
      env: [...DEFAULT_PLUGIN_CAPABILITY_REQUESTS.env],
      secrets: [...DEFAULT_PLUGIN_CAPABILITY_REQUESTS.secrets],
      plugins: [...DEFAULT_PLUGIN_CAPABILITY_REQUESTS.plugins],
      network: { ...DEFAULT_PLUGIN_CAPABILITY_REQUESTS.network },
    },
    firstPartyBroadGrants: broadPrivilegeSummaries,
  };
}

export function createFirstPartyDesiredState(plugins: FirstPartyServicePlugin[]): FirstPartyDesiredState {
  return {
    goldenConfigs: { dockerfile: 'Dockerfile.vkvd', supervisor: 'supervisord.vkvd.conf' },
    services: Object.fromEntries(plugins.map((plugin) => [plugin.manifest.id, {
      desiredVersion: plugin.desiredVersion,
      installStrategy: plugin.installStrategy,
      stagingRequired: plugin.stagingRequired,
      rollbackable: plugin.rollbackable,
      supervisorPrograms: plugin.supervisorPrograms,
    }])),
  };
}

export function createFirstPartyReleaseInstallPlan(input: {
  requested: RequestedFirstPartyReleaseAsset;
  installed: InstalledFirstPartyVersion[];
}): FirstPartyReleaseInstallPlan {
  const versionKey = `github-release:${input.requested.releaseTag}@${input.requested.commitSha}`;
  const existing = input.installed.find((candidate) => candidate.serviceId === input.requested.serviceId && candidate.versionKey === versionKey);
  const rollbackPointer = input.installed.find((candidate) => candidate.serviceId === input.requested.serviceId) ?? null;
  if (existing) return { action: 'noop', serviceId: input.requested.serviceId, versionKey, installPath: existing.installPath, rollbackPointer: null };

  const baseUrl = `https://github.com/${input.requested.repository}/releases/download/${input.requested.releaseTag}`;
  return {
    action: 'install',
    serviceId: input.requested.serviceId,
    versionKey,
    artifactUrl: `${baseUrl}/${input.requested.assetName}`,
    checksumUrl: `${baseUrl}/${input.requested.assetName}.sha256`,
    installPath: join(input.requested.installRoot, input.requested.serviceId, sanitizeVersionKey(versionKey)),
    rollbackPointer,
    verify: { sha256: input.requested.sha256 },
    compatibility: input.requested.compatibility,
  };
}

export function createBeadsWebRouteConfig(input: { proxyDomain?: string; port: number }): BeadsWebRouteConfig {
  return {
    host: input.proxyDomain ? `beads-web.${input.proxyDomain}` : 'localhost',
    upstream: `127.0.0.1:${input.port}`,
    fallbackPath: '/beads',
    assetOwnership: 'beads-web host owns / and /_next only on named host',
  };
}

function sanitizeVersionKey(versionKey: string): string {
  return versionKey.replace(/[^a-zA-Z0-9._-]/g, '_');
}
