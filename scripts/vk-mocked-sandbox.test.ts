import { describe, expect, it } from 'vitest';

import {
  allocatePorts,
  createSandboxPlan,
  findFreePort,
  loadSandboxCaddyfile,
  type PortAllocator,
} from './vk-mocked-sandbox';

describe('VK mocked sandbox helpers', () => {
  it('finds the first available port at or above the requested start', async () => {
    const checked: number[] = [];
    const allocator: PortAllocator = {
      async isAvailable(port) {
        checked.push(port);
        return port === 50_002;
      },
    };

    await expect(findFreePort(50_000, allocator)).resolves.toBe(50_002);
    expect(checked).toEqual([50_000, 50_001, 50_002]);
  });

  it('uses explicit env port overrides when present', async () => {
    const allocator: PortAllocator = {
      async isAvailable() {
        throw new Error('explicit ports should not probe availability');
      },
    };

    await expect(
      allocatePorts(
        {
          VK_MOCKED_BACKEND_PORT: '4107',
          VK_MOCKED_FRONTEND_PORT: '4100',
          VK_MOCKED_PREVIEW_PROXY_PORT: '4106',
          VK_MOCKED_VD_DASHBOARD_PORT: '4105',
          VK_MOCKED_VD_SERVER_PORT: '4104',
          VK_MOCKED_CADDY_PORT: '4101',
        } as NodeJS.ProcessEnv,
        allocator,
      ),
    ).resolves.toEqual({
      vkBackend: 4107,
      vkFrontend: 4100,
      vkPreviewProxy: 4106,
      vdDashboard: 4105,
      vdServer: 4104,
      vdCaddy: 4101,
    });
  });

  it('skips already selected dynamic ports', async () => {
    const checked: number[] = [];
    const allocator: PortAllocator = {
      async isAvailable(port) {
        checked.push(port);
        return port !== 50_000;
      },
    };

    await expect(
      allocatePorts(
        {
          VK_MOCKED_SANDBOX_PORT_START: '50000',
        } as NodeJS.ProcessEnv,
        allocator,
      ),
    ).resolves.toEqual({
      vkBackend: 50_001,
      vkFrontend: 50_002,
      vkPreviewProxy: 50_003,
      vdDashboard: 50_004,
      vdServer: 50_005,
      vdCaddy: 50_006,
    });
    expect(checked).toEqual([
      50_000,
      50_001,
      50_002,
      50_003,
      50_004,
      50_005,
      50_006,
    ]);
  });

  it('rejects duplicate explicit port overrides', async () => {
    const allocator: PortAllocator = {
      async isAvailable() {
        throw new Error('explicit duplicate ports should fail before probing');
      },
    };

    await expect(
      allocatePorts(
        {
          VK_MOCKED_BACKEND_PORT: '4107',
          VK_MOCKED_FRONTEND_PORT: '4107',
        } as NodeJS.ProcessEnv,
        allocator,
      ),
    ).rejects.toThrow(
      'VK_MOCKED_FRONTEND_PORT must not duplicate VK_MOCKED_BACKEND_PORT',
    );
  });

  it('loads the committed Caddy front door with /vk-api routed to VK backend', async () => {
    const caddyfile = await loadSandboxCaddyfile(process.cwd());

    expect(caddyfile).toContain('admin {$CADDY_ADMIN:localhost:2019}');
    expect(caddyfile).toContain(':{$CADDY_PORT:3001}');
    expect(caddyfile).toContain('handle_path /vk-api/*');
    expect(caddyfile).toContain('rewrite * /api{uri}');
    expect(caddyfile).toContain('reverse_proxy localhost:{$BACKEND_PORT:3007}');
    expect(caddyfile).toContain('reverse_proxy localhost:{$DASHBOARD_PORT:3005}');
    expect(caddyfile).toContain('reverse_proxy localhost:{$CODE_PORT:3008}');
    expect(caddyfile).toContain('import /etc/caddy/plugins.caddy');
    expect(caddyfile).toContain(
      'output file {$CADDY_ACCESS_LOG:/var/log/caddy/access.log}',
    );
  });

  it('plans qa-mode VK, VD dev, and Caddy commands with matching env', () => {
    const plan = createSandboxPlan({
      workspaceRoot: '/tmp/worktrees/example/vibe-kanban-vscode-web',
      ports: {
        vkBackend: 4107,
        vkFrontend: 4100,
        vkPreviewProxy: 4106,
        vdDashboard: 4105,
        vdServer: 4104,
        vdCaddy: 4101,
      },
      runDir: '/tmp/run',
      caddyfile: 'mocked sandbox caddyfile',
    });

    expect(plan.urls).toEqual({
      vd: 'http://localhost:4101',
      vkFrontend: 'http://localhost:4101',
    });
    expect(plan.paths).toMatchObject({
      workspaceRoot: '/tmp/worktrees/example',
      vdRoot: '/tmp/worktrees/example/vibe-kanban-vscode-web',
      vkRoot: '/tmp/worktrees/example/Vktest',
      runDir: '/tmp/run',
    });
    expect(plan.caddyfile).toBe('mocked sandbox caddyfile');
    expect(plan.setupCommands.map((command) => command.name)).toEqual([
      'vk-build-local-web',
    ]);
    expect(plan.commands.map((command) => command.name)).toEqual([
      'vk-backend-qa',
      'vd-dashboard',
      'caddy',
    ]);
    expect(plan.setupCommands[0]).toMatchObject({
      command: 'pnpm',
      args: ['--filter', '@vibe/local-web', 'run', 'build'],
      env: {
        BACKEND_PORT: '4107',
        FRONTEND_PORT: '4101',
        PREVIEW_PROXY_PORT: '4106',
      },
    });
    expect(plan.setupCommands[0]?.env.NODE_OPTIONS).toContain(
      '--max-old-space-size=8192',
    );
    expect(plan.commands[0]).toMatchObject({
      command: 'cargo',
      args: ['run', '--features', 'qa-mode', '--bin', 'server'],
      env: {
        BACKEND_PORT: '4107',
        FRONTEND_PORT: '4101',
        PREVIEW_PROXY_PORT: '4106',
      },
    });
    const vdCommand = plan.commands.find((command) => command.name === 'vd-dashboard');
    const caddyCommand = plan.commands.find((command) => command.name === 'caddy');

    expect(vdCommand?.env.VITE_VK_BASE_ORIGIN).toBe(
      'http://localhost:4101',
    );
    expect(caddyCommand?.env.XDG_CONFIG_HOME).toBe(
      '/tmp/run/xdg-config',
    );
    expect(caddyCommand?.env.XDG_DATA_HOME).toBe('/tmp/run/xdg-data');
    expect(caddyCommand?.env).toMatchObject({
      CADDY_ADMIN: 'off',
      CADDY_PORT: '4101',
      DASHBOARD_PORT: '4105',
      BACKEND_PORT: '4107',
      CODE_PORT: '4106',
      CADDY_ACCESS_LOG: '/tmp/run/access.log',
    });
  });
});
