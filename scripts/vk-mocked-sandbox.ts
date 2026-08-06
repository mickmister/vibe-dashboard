import { createServer } from 'node:net';
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';

export interface SandboxPorts {
  vkBackend: number;
  vkFrontend: number;
  vkPreviewProxy: number;
  vdDashboard: number;
  vdServer: number;
  vdCaddy: number;
}

export interface SandboxPaths {
  workspaceRoot: string;
  vdRoot: string;
  vkRoot: string;
  runDir: string;
}

export interface SandboxPlan {
  ports: SandboxPorts;
  paths: SandboxPaths;
  urls: {
    vd: string;
    vkFrontend: string;
  };
  env: Record<string, string>;
  caddyfile: string;
  commands: CommandSpec[];
}

export interface CommandSpec {
  name: string;
  cwd: string;
  command: string;
  args: string[];
  env: Record<string, string>;
}

export interface PortAllocator {
  isAvailable(port: number): Promise<boolean>;
}

const DEFAULT_PORT_START = 50_000;
const MAX_PORT = 65_535;

function envInt(name: string, fallback: number, env = process.env): number {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > MAX_PORT) {
    throw new Error(`${name} must be a TCP port number, got ${raw}`);
  }
  return parsed;
}

export async function isTcpPortAvailable(port: number): Promise<boolean> {
  return await new Promise((resolveAvailability) => {
    const server = createServer();
    server.once('error', () => resolveAvailability(false));
    server.listen(port, '127.0.0.1', () => {
      server.close(() => resolveAvailability(true));
    });
  });
}

export async function findFreePort(
  start: number,
  allocator: PortAllocator = { isAvailable: isTcpPortAvailable },
  excludedPorts: ReadonlySet<number> = new Set(),
): Promise<number> {
  for (let port = start; port <= MAX_PORT; port += 1) {
    if (excludedPorts.has(port)) continue;
    if (await allocator.isAvailable(port)) return port;
  }
  throw new Error(`Could not find a free port at or above ${start}`);
}

export async function allocatePorts(
  env: NodeJS.ProcessEnv = process.env,
  allocator: PortAllocator = { isAvailable: isTcpPortAvailable },
): Promise<SandboxPorts> {
  const start = envInt('VK_MOCKED_SANDBOX_PORT_START', DEFAULT_PORT_START, env);
  const selectedPorts = new Map<number, string>();
  const nextPort = async (offset: number, envName: string): Promise<number> => {
    const configured = env[envName]?.trim();
    const port = configured
      ? envInt(envName, 0, env)
      : await findFreePort(start + offset, allocator, new Set(selectedPorts.keys()));
    const existingEnvName = selectedPorts.get(port);
    if (existingEnvName) {
      throw new Error(`${envName} must not duplicate ${existingEnvName} (${port})`);
    }
    selectedPorts.set(port, envName);
    return port;
  };

  const vkBackend = await nextPort(0, 'VK_MOCKED_BACKEND_PORT');
  const vkFrontend = await nextPort(1, 'VK_MOCKED_FRONTEND_PORT');
  const vkPreviewProxy = await nextPort(2, 'VK_MOCKED_PREVIEW_PROXY_PORT');
  const vdDashboard = await nextPort(3, 'VK_MOCKED_VD_DASHBOARD_PORT');
  const vdServer = await nextPort(4, 'VK_MOCKED_VD_SERVER_PORT');
  const vdCaddy = await nextPort(5, 'VK_MOCKED_CADDY_PORT');

  return {
    vkBackend,
    vkFrontend,
    vkPreviewProxy,
    vdDashboard,
    vdServer,
    vdCaddy,
  };
}

export function renderCaddyfile(ports: SandboxPorts): string {
  return `{
\tadmin off
\tauto_https off
}

:${ports.vdCaddy} {
\t# VD browser code calls /vk-api/*; strip that prefix to reach VK /api/*.
\thandle_path /vk-api/* {
\t\trewrite * /api{uri}
\t\treverse_proxy 127.0.0.1:${ports.vkBackend}
\t}

\t# VD app and Springboard dev assets.
\t@vd {
\t\tpath /
\t\tpath /dashboard /dashboard/*
\t\tpath /.springboard/*
\t\tpath /node_modules/*
\t\tpath /packages/*
\t\tpath /src/*
\t\tpath /@vite/*
\t\tpath /@id/*
\t\tpath /@react-refresh
\t\tpath /@fs/*
\t\tpath /kv/*
\t\tpath /rpc/*
\t\tpath /assets/*
\t\tpath /ws
\t\tpath /manifest.json
\t}
\thandle @vd {
\t\treverse_proxy 127.0.0.1:${ports.vdDashboard}
\t}

\t# VK workspace-create and agent routes fall through to VK local-web dev.
\thandle {
\t\treverse_proxy 127.0.0.1:${ports.vkFrontend}
\t}
}
`;
}

export function createSandboxPlan(input: {
  workspaceRoot?: string;
  ports: SandboxPorts;
  runDir?: string;
}): SandboxPlan {
  const workspaceRoot = resolve(input.workspaceRoot ?? process.cwd(), '..');
  const vdRoot = resolve(workspaceRoot, 'vibe-kanban-vscode-web');
  const vkRoot = resolve(workspaceRoot, 'Vktest');
  const runDir = resolve(
    input.runDir ?? join(vdRoot, '.vk-mocked-sandbox', 'current'),
  );
  const vdUrl = `http://localhost:${input.ports.vdCaddy}`;
  const vkFrontendUrl = `http://localhost:${input.ports.vkFrontend}`;

  const commonEnv = {
    VK_MOCKED_SANDBOX: '1',
    VK_MOCKED_SANDBOX_RUN_DIR: runDir,
    VK_MOCKED_VD_URL: vdUrl,
    VK_MOCKED_VK_FRONTEND_URL: vkFrontendUrl,
    VK_MOCKED_BACKEND_PORT: String(input.ports.vkBackend),
    VK_MOCKED_FRONTEND_PORT: String(input.ports.vkFrontend),
    VK_MOCKED_PREVIEW_PROXY_PORT: String(input.ports.vkPreviewProxy),
    VK_MOCKED_VD_DASHBOARD_PORT: String(input.ports.vdDashboard),
    VK_MOCKED_VD_SERVER_PORT: String(input.ports.vdServer),
    VK_MOCKED_CADDY_PORT: String(input.ports.vdCaddy),
  };

  const vkAllowedOrigins = [
    vdUrl,
    `http://localhost:${input.ports.vdDashboard}`,
    vkFrontendUrl,
  ].join(',');

  const commands: CommandSpec[] = [
    {
      name: 'vk-backend-qa',
      cwd: vkRoot,
      command: 'cargo',
      args: ['run', '--features', 'qa-mode', '--bin', 'server'],
      env: {
        ...commonEnv,
        HOST: '127.0.0.1',
        BACKEND_PORT: String(input.ports.vkBackend),
        PORT: String(input.ports.vkBackend),
        FRONTEND_PORT: String(input.ports.vkFrontend),
        PREVIEW_PROXY_PORT: String(input.ports.vkPreviewProxy),
        VK_ALLOWED_ORIGINS: vkAllowedOrigins,
        DISABLE_WORKTREE_CLEANUP: '1',
        RUST_LOG: process.env.RUST_LOG ?? 'debug',
      },
    },
    {
      name: 'vk-local-web',
      cwd: vkRoot,
      command: 'pnpm',
      args: [
        '--filter',
        '@vibe/local-web',
        'exec',
        'vite',
        '--host',
        '127.0.0.1',
        '--port',
        String(input.ports.vkFrontend),
        '--strictPort',
      ],
      env: {
        ...commonEnv,
        BACKEND_PORT: String(input.ports.vkBackend),
        FRONTEND_PORT: String(input.ports.vkFrontend),
        PREVIEW_PROXY_PORT: String(input.ports.vkPreviewProxy),
        VITE_OPEN: 'false',
      },
    },
    {
      name: 'vd-dashboard',
      cwd: vdRoot,
      command: 'npm',
      args: ['run', 'dev'],
      env: {
        ...commonEnv,
        PORT: String(input.ports.vdDashboard),
        SERVER_PORT: String(input.ports.vdServer),
        VITE_VK_BASE_ORIGIN: vkFrontendUrl,
        CADDY_PORT: String(input.ports.vdCaddy),
      },
    },
    {
      name: 'caddy',
      cwd: vdRoot,
      command: 'caddy',
      args: ['run', '--config', join(runDir, 'Caddyfile'), '--adapter', 'caddyfile'],
      env: {
        ...commonEnv,
        XDG_CONFIG_HOME: join(runDir, 'xdg-config'),
        XDG_DATA_HOME: join(runDir, 'xdg-data'),
      },
    },
  ];

  return {
    ports: input.ports,
    paths: { workspaceRoot, vdRoot, vkRoot, runDir },
    urls: { vd: vdUrl, vkFrontend: vkFrontendUrl },
    env: commonEnv,
    caddyfile: renderCaddyfile(input.ports),
    commands,
  };
}

export async function writeSandboxFiles(plan: SandboxPlan): Promise<void> {
  await mkdir(plan.paths.runDir, { recursive: true });
  await writeFile(join(plan.paths.runDir, 'Caddyfile'), plan.caddyfile);
  await writeFile(
    join(plan.paths.runDir, 'env.sh'),
    Object.entries(plan.env)
      .map(([key, value]) => `export ${key}=${JSON.stringify(value)}\n`)
      .join(''),
  );
  await writeFile(join(plan.paths.runDir, 'plan.json'), JSON.stringify(plan, null, 2));
}

function printPlan(plan: SandboxPlan): void {
  console.log(`VD URL: ${plan.urls.vd}`);
  console.log(`VK local-web URL: ${plan.urls.vkFrontend}`);
  console.log(`Run dir: ${plan.paths.runDir}`);
  console.log('\nCommands:');
  for (const spec of plan.commands) {
    console.log(`- ${spec.name}: (cd ${spec.cwd} && ${spec.command} ${spec.args.join(' ')})`);
  }
}

function spawnCommand(
  spec: CommandSpec,
  onUnexpectedExit: (spec: CommandSpec, reason: string) => void,
): ChildProcess {
  const child = spawn(spec.command, spec.args, {
    cwd: spec.cwd,
    env: { ...process.env, ...spec.env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const prefix = `[${spec.name}]`;
  let reportedUnexpectedExit = false;
  child.stdout?.on('data', (chunk) => process.stdout.write(`${prefix} ${chunk}`));
  child.stderr?.on('data', (chunk) => process.stderr.write(`${prefix} ${chunk}`));
  child.on('error', (error) => {
    if (reportedUnexpectedExit) return;
    reportedUnexpectedExit = true;
    console.error(`${prefix} failed to start: ${error.message}`);
    onUnexpectedExit(spec, `spawn error: ${error.message}`);
  });
  child.on('exit', (code, signal) => {
    console.log(`${prefix} exited code=${code ?? 'null'} signal=${signal ?? 'null'}`);
    if (reportedUnexpectedExit) return;
    reportedUnexpectedExit = true;
    onUnexpectedExit(spec, `exit code=${code ?? 'null'} signal=${signal ?? 'null'}`);
  });
  return child;
}

async function main(): Promise<void> {
  const mode = process.argv[2] ?? 'prepare';
  const ports = await allocatePorts();
  const plan = createSandboxPlan({
    workspaceRoot: process.cwd(),
    ports,
  });
  await writeSandboxFiles(plan);

  if (mode === 'prepare') {
    printPlan(plan);
    return;
  }

  if (mode !== 'start') {
    throw new Error(`Unknown mode ${mode}. Usage: vk-mocked-sandbox.ts [prepare|start]`);
  }

  if (!existsSync(plan.paths.vkRoot)) {
    throw new Error(`VK repo not found at ${plan.paths.vkRoot}`);
  }

  printPlan(plan);
  let stopping = false;
  const children: ChildProcess[] = [];
  const stop = (): void => {
    if (stopping) return;
    stopping = true;
    for (const child of children) child.kill('SIGTERM');
  };
  for (const spec of plan.commands) {
    children.push(spawnCommand(spec, (exitedSpec, reason) => {
      if (stopping) return;
      console.error(`${exitedSpec.name} exited unexpectedly (${reason}); stopping sandbox.`);
      process.exitCode = 1;
      stop();
    }));
  }
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack : String(error));
    process.exitCode = 1;
  });
}
