import { describe, expect, it } from 'vitest';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';

import {
  allocatePorts,
  childProcessSignalTarget,
  createSandboxPlan,
  downloadCiReleaseArtifactFromEnv,
  findFreePort,
  loadSandboxCaddyfile,
  writeSandboxFiles,
  type PortAllocator,
} from './vk-mocked-sandbox';
import { isSandboxRuntimeProcessLine } from './e2e-vk-mocked-sandbox-fixtures';

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

  it('targets long-running child process groups on POSIX for shutdown cleanup', () => {
    const pid = 12_345;
    expect(childProcessSignalTarget(pid)).toBe(
      process.platform === 'win32' ? pid : -pid,
    );
  });

  it('does not treat CI orchestration commands as live sandbox runtime processes', () => {
    expect(isSandboxRuntimeProcessLine(
      '9416 bash scripts/ci-run-vk-mocked-sandbox-e2e.sh',
    )).toBe(false);
    expect(isSandboxRuntimeProcessLine(
      '1234 node --experimental-strip-types scripts/vk-mocked-sandbox.ts start',
    )).toBe(true);
    expect(isSandboxRuntimeProcessLine('5678 cargo run --features qa-mode --bin server vk-backend-qa')).toBe(true);
    expect(isSandboxRuntimeProcessLine(
      '6789 /tmp/workspace/vibe-kanban-vscode-web/.vk-mocked-sandbox/vk-release-assets/ff79144e3842e5454ffc36b5546a1336ab4da993/31655931916/extracted/vibe-kanban',
    )).toBe(true);
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
    expect(caddyfile).toContain('handle_path /vk-static/*');
    expect(caddyfile).toContain('rewrite * /api{uri}');
    expect(caddyfile).toContain('reverse_proxy localhost:{$BACKEND_PORT:3007}');
    expect(caddyfile).toContain('reverse_proxy localhost:{$DASHBOARD_PORT:3005}');
    expect(caddyfile).toContain('reverse_proxy localhost:{$CODE_PORT:3008}');
    expect(caddyfile).toContain(
      'import {$CADDY_PLUGINS_CADDY:/etc/caddy/plugins.caddy}',
    );
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
      args: [
        '--filter',
        '@vibe/local-web',
        'run',
        'build',
        '--base',
        '/vk-static/',
      ],
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
      CADDY_PLUGINS_CADDY: '/tmp/run/plugins.caddy',
    });
    expect(plan.env.CADDY_PLUGINS_CADDY).toBe('/tmp/run/plugins.caddy');
  });

  it('uses a configured public origin for browser-facing same-origin URLs', () => {
    const plan = createSandboxPlan({
      workspaceRoot: '/tmp/worktrees/example/vibe-kanban-vscode-web',
      env: {
        VK_MOCKED_PUBLIC_ORIGIN: 'https://port-4101.jamtools.dev/some/path',
      } as NodeJS.ProcessEnv,
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
      vd: 'https://port-4101.jamtools.dev',
      vkFrontend: 'https://port-4101.jamtools.dev',
    });
    expect(plan.env.VK_MOCKED_VD_URL).toBe('https://port-4101.jamtools.dev');
    expect(plan.env.VK_MOCKED_VK_FRONTEND_URL).toBe('https://port-4101.jamtools.dev');
    const vdCommand = plan.commands.find((command) => command.name === 'vd-dashboard');
    const vkCommand = plan.commands.find((command) => command.name === 'vk-backend-qa');

    expect(vdCommand?.env.VITE_VK_BASE_ORIGIN).toBe('https://port-4101.jamtools.dev');
    expect(vkCommand?.env.VK_ALLOWED_ORIGINS).toBe(
      'http://localhost:4101,https://port-4101.jamtools.dev,http://localhost:4105',
    );
  });

  it('can plan CI backend prebuild separately from Playwright readiness waiting', () => {
    const plan = createSandboxPlan({
      workspaceRoot: '/tmp/worktrees/example/vibe-kanban-vscode-web',
      env: {
        VK_MOCKED_PREBUILD_BACKEND: '1',
      } as NodeJS.ProcessEnv,
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

    expect(plan.setupCommands.map((command) => command.name)).toEqual([
      'vk-build-local-web',
      'vk-build-backend-qa',
    ]);
    expect(plan.setupCommands[1]).toMatchObject({
      cwd: '/tmp/worktrees/example/Vktest',
      command: 'cargo',
      args: ['build', '--features', 'qa-mode', '--bin', 'server'],
    });
    expect(plan.commands[0]).toMatchObject({
      command: 'cargo',
      args: ['run', '--features', 'qa-mode', '--bin', 'server'],
    });
  });

  it('plans release-asset VK without local VK builds and enables runtime QA mode', () => {
    const caddyfile = [
      '# VK built frontend assets for the same-origin mocked sandbox.',
      'handle_path /vk-static/* {',
      '  reverse_proxy localhost:{$BACKEND_PORT:3007}',
      '}',
      '# Vibe Dashboard app',
      '@vibe_dashboard_assets {',
      '  path /assets/*',
      '}',
    ].join('\n');
    const plan = createSandboxPlan({
      workspaceRoot: '/tmp/worktrees/example/vibe-kanban-vscode-web',
      env: {
        VK_MOCKED_VK_BACKEND: 'ci-release',
        VK_MOCKED_RELEASE_SHA:
          'ff79144e3842e5454ffc36b5546a1336ab4da993',
        VK_MOCKED_RELEASE_RUN_ID: '31655931916',
      } as NodeJS.ProcessEnv,
      ports: {
        vkBackend: 4107,
        vkFrontend: 4100,
        vkPreviewProxy: 4106,
        vdDashboard: 4105,
        vdServer: 4104,
        vdCaddy: 4101,
      },
      runDir: '/tmp/run',
      caddyfile,
    });

    const artifactRoot =
      '/tmp/worktrees/example/vibe-kanban-vscode-web/.vk-mocked-sandbox/vk-release-assets/ff79144e3842e5454ffc36b5546a1336ab4da993/31655931916';

    expect(plan.setupCommands.map((command) => command.name)).toEqual([
      'vk-download-release-artifact',
    ]);
    expect(plan.setupCommands[0]).toMatchObject({
      cwd: '/tmp/worktrees/example/vibe-kanban-vscode-web',
      command: 'node',
      args: [
        '--experimental-strip-types',
        'scripts/vk-mocked-sandbox.ts',
        'download-ci-release',
      ],
      env: {
        VK_MOCKED_RELEASE_SHA:
          'ff79144e3842e5454ffc36b5546a1336ab4da993',
        VK_MOCKED_RELEASE_RUN_ID: '31655931916',
        VK_MOCKED_RELEASE_CACHE_DIR: artifactRoot,
      },
    });
    expect(plan.commands[0]).toMatchObject({
      name: 'vk-backend-ci-release',
      cwd: '/tmp/worktrees/example/Vktest',
      command: `${artifactRoot}/extracted/vibe-kanban`,
      args: [],
      env: {
        BACKEND_PORT: '4107',
        FRONTEND_PORT: '4101',
        PREVIEW_PROXY_PORT: '4106',
        VK_ALLOWED_ORIGINS: 'http://localhost:4101,http://localhost:4105',
        VK_QA_MODE: '1',
        QA_MODE: '1',
      },
    });
    expect(plan.commands[0]?.env.XDG_CONFIG_HOME).toBe('/tmp/run/xdg-config');
    expect(plan.commands[0]?.env.XDG_DATA_HOME).toBe('/tmp/run/xdg-data');
    expect(plan.caddyfile).toContain('@vk_release_assets');
    expect(plan.caddyfile).toContain(
      'path_regexp vk_release_assets ^/assets/.+\\.(js|css|wasm|mjs|map|json|png|jpe?g|svg|webp|ico|woff2?)$',
    );
    expect(plan.caddyfile).toContain('handle @vk_release_assets');
    expect(plan.caddyfile.indexOf('handle @vk_release_assets')).toBeLessThan(
      plan.caddyfile.indexOf('@vibe_dashboard_assets'),
    );
  });

  it('does not add release /assets routing to source-mode sandbox plans', () => {
    const caddyfile = [
      '# VK built frontend assets for the same-origin mocked sandbox.',
      'handle_path /vk-static/* {',
      '  reverse_proxy localhost:{$BACKEND_PORT:3007}',
      '}',
      '# Vibe Dashboard app',
      '@vibe_dashboard_assets {',
      '  path /assets/*',
      '}',
    ].join('\n');
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
      caddyfile,
    });

    expect(plan.caddyfile).toBe(caddyfile);
    expect(plan.caddyfile).not.toContain('@vk_release_assets');
  });

  it('requires an exact SHA for release-asset VK planning', () => {
    expect(() =>
      createSandboxPlan({
        workspaceRoot: '/tmp/worktrees/example/vibe-kanban-vscode-web',
        env: {
          VK_MOCKED_VK_BACKEND: 'ci-release',
          VK_MOCKED_RELEASE_SHA: 'HEAD',
          VK_MOCKED_RELEASE_RUN_ID: '31655931916',
        } as NodeJS.ProcessEnv,
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
      }),
    ).toThrow('VK_MOCKED_RELEASE_SHA must be a full 40-character commit SHA');
  });

  it('rejects stale source prebuild env in release-asset VK planning', () => {
    expect(() =>
      createSandboxPlan({
        workspaceRoot: '/tmp/worktrees/example/vibe-kanban-vscode-web',
        env: {
          VK_MOCKED_VK_BACKEND: 'ci-release',
          VK_MOCKED_RELEASE_SHA:
            'ff79144e3842e5454ffc36b5546a1336ab4da993',
          VK_MOCKED_RELEASE_RUN_ID: '31655931916',
          VK_MOCKED_PREBUILD_BACKEND: '1',
        } as NodeJS.ProcessEnv,
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
      }),
    ).toThrow('VK_MOCKED_PREBUILD_BACKEND is not supported in ci-release mode');
  });

  it('verifies cached release artifact manifest and checksum before using binary', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vk-mocked-sandbox-cache-'));
    const binDir = join(root, 'bin');
    const artifactRoot = join(
      root,
      '.vk-mocked-sandbox/vk-release-assets/ff79144e3842e5454ffc36b5546a1336ab4da993/31655931916',
    );
    const artifactDir = join(artifactRoot, 'release-assets-linux-x64');
    const extractDir = join(artifactRoot, 'extracted');
    const archiveName = 'vibe-kanban-linux-x64.tar.gz';
    const archiveContents = 'cached archive';
    const archiveSha = createHash('sha256').update(archiveContents).digest('hex');
    const originalPath = process.env.PATH;

    try {
      await mkdir(binDir, { recursive: true });
      await mkdir(artifactDir, { recursive: true });
      await mkdir(extractDir, { recursive: true });
      await writeFile(
        join(binDir, 'gh'),
        [
          '#!/usr/bin/env bash',
          'if [ "$1 $2" = "run view" ]; then',
          '  printf \'{"headSha":"ff79144e3842e5454ffc36b5546a1336ab4da993","status":"completed","conclusion":"success","workflowName":"Release Binaries"}\\n\'',
          '  exit 0',
          'fi',
          'echo "unexpected gh call: $*" >&2',
          'exit 2',
          '',
        ].join('\n'),
      );
      await chmod(join(binDir, 'gh'), 0o755);
      await writeFile(join(artifactDir, archiveName), archiveContents);
      await writeFile(
        join(artifactDir, `${archiveName}.sha256`),
        `${archiveSha}  ${archiveName}\n`,
      );
      await writeFile(
        join(artifactDir, 'manifest.json'),
        JSON.stringify({
          schema_version: 1,
          vk_sha: 'not-the-requested-commit',
        }),
      );
      await writeFile(join(extractDir, 'vibe-kanban'), '#!/usr/bin/env bash\n');
      await chmod(join(extractDir, 'vibe-kanban'), 0o755);

      process.env.PATH = `${binDir}:${originalPath ?? ''}`;
      await expect(
        downloadCiReleaseArtifactFromEnv(root, {
          VK_MOCKED_RELEASE_SHA:
            'ff79144e3842e5454ffc36b5546a1336ab4da993',
          VK_MOCKED_RELEASE_RUN_ID: '31655931916',
          VK_MOCKED_RELEASE_CACHE_DIR: artifactRoot,
        } as NodeJS.ProcessEnv),
      ).rejects.toThrow('Release manifest commit mismatch');
    } finally {
      process.env.PATH = originalPath;
      await rm(root, { recursive: true, force: true });
    }
  });

  it('uses an explicit VK checkout path when provided', () => {
    const plan = createSandboxPlan({
      workspaceRoot: '/tmp/worktrees/example/vibe-kanban-vscode-web',
      env: {
        VK_CHECKOUT: '/tmp/custom-vk-checkout',
      } as NodeJS.ProcessEnv,
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

    expect(plan.paths.vkRoot).toBe('/tmp/custom-vk-checkout');
    expect(plan.setupCommands[0]?.cwd).toBe('/tmp/custom-vk-checkout');
    expect(plan.commands[0]?.cwd).toBe('/tmp/custom-vk-checkout');
  });

  it('falls back to the sibling VK checkout when VK_CHECKOUT is blank', () => {
    const plan = createSandboxPlan({
      workspaceRoot: '/tmp/worktrees/example/vibe-kanban-vscode-web',
      env: {
        VK_CHECKOUT: '  ',
      } as NodeJS.ProcessEnv,
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

    expect(plan.paths.vkRoot).toBe('/tmp/worktrees/example/Vktest');
  });

  it('skips the VK local-web build when prebuilt assets are available', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'vk-mocked-sandbox-workspace-'));
    const vkRoot = join(workspaceRoot, 'Vktest');
    const localWebDist = join(vkRoot, 'packages/local-web/dist');
    try {
      const planWithoutDist = createSandboxPlan({
        workspaceRoot: join(workspaceRoot, 'vibe-kanban-vscode-web'),
        env: {
          VK_MOCKED_SKIP_LOCAL_WEB_BUILD: '1',
        } as NodeJS.ProcessEnv,
        ports: {
          vkBackend: 4107,
          vkFrontend: 4100,
          vkPreviewProxy: 4106,
          vdDashboard: 4105,
          vdServer: 4104,
          vdCaddy: 4101,
        },
        runDir: join(workspaceRoot, 'run'),
        caddyfile: 'mocked sandbox caddyfile',
      });

      expect(planWithoutDist.setupCommands.map((command) => command.name)).toEqual([
        'vk-build-local-web',
      ]);

      await mkdir(localWebDist, { recursive: true });
      await writeFile(join(localWebDist, 'index.html'), '<!doctype html>');

      const planWithDist = createSandboxPlan({
        workspaceRoot: join(workspaceRoot, 'vibe-kanban-vscode-web'),
        env: {
          VK_MOCKED_SKIP_LOCAL_WEB_BUILD: '1',
        } as NodeJS.ProcessEnv,
        ports: {
          vkBackend: 4107,
          vkFrontend: 4100,
          vkPreviewProxy: 4106,
          vdDashboard: 4105,
          vdServer: 4104,
          vdCaddy: 4101,
        },
        runDir: join(workspaceRoot, 'run'),
        caddyfile: 'mocked sandbox caddyfile',
      });

      expect(planWithDist.setupCommands).toEqual([]);
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it('writes a sandbox-local plugins.caddy stub for Caddy imports', async () => {
    const runDir = await mkdtemp(join(tmpdir(), 'vk-mocked-sandbox-test-'));
    try {
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
        runDir,
        caddyfile: 'mocked sandbox caddyfile',
      });

      await writeSandboxFiles(plan);

      await expect(readFile(join(runDir, 'plugins.caddy'), 'utf8')).resolves.toBe(
        '',
      );
      await expect(readFile(join(runDir, 'env.sh'), 'utf8')).resolves.toContain(
        `export CADDY_PLUGINS_CADDY="${join(runDir, 'plugins.caddy')}"`,
      );
    } finally {
      await rm(runDir, { recursive: true, force: true });
    }
  });
});
