import { createServer } from 'node:net';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';

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
  setupCommands: CommandSpec[];
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
const SANDBOX_CADDYFILE_NAME = 'Caddyfile';
const SANDBOX_CADDYFILE_ENV = 'VK_MOCKED_CADDYFILE';
const CHILD_SHUTDOWN_TIMEOUT_MS = 5_000;

function envInt(name: string, fallback: number, env = process.env): number {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > MAX_PORT) {
    throw new Error(`${name} must be a TCP port number, got ${raw}`);
  }
  return parsed;
}

function appendNodeOption(existingOptions: string | undefined, option: string): string {
  const trimmedOptions = existingOptions?.trim();
  if (!trimmedOptions) return option;
  if (trimmedOptions.includes(option)) return trimmedOptions;
  return `${trimmedOptions} ${option}`;
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

export function childProcessSignalTarget(pid: number): number {
  return process.platform === 'win32' ? pid : -pid;
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

export async function loadSandboxCaddyfile(vdRoot: string, env: NodeJS.ProcessEnv = process.env): Promise<string> {
  const configured = env[SANDBOX_CADDYFILE_ENV]?.trim() || SANDBOX_CADDYFILE_NAME;
  return await readFile(join(vdRoot, configured), 'utf8');
}

export function createSandboxPlan(input: {
  workspaceRoot?: string;
  env?: NodeJS.ProcessEnv;
  ports: SandboxPorts;
  runDir?: string;
  caddyfile: string;
}): SandboxPlan {
  const env = input.env ?? process.env;
  const workspaceRoot = resolve(input.workspaceRoot ?? process.cwd(), '..');
  const vdRoot = resolve(workspaceRoot, 'vibe-kanban-vscode-web');
  const configuredVkCheckout = env.VK_CHECKOUT?.trim();
  const vkRoot = resolve(workspaceRoot, configuredVkCheckout || 'Vktest');
  const runDir = resolve(
    input.runDir ?? join(vdRoot, '.vk-mocked-sandbox', 'current'),
  );
  const vdUrl = `http://localhost:${input.ports.vdCaddy}`;
  const vkFrontendUrl = vdUrl;

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
    CADDY_PLUGINS_CADDY: join(runDir, 'plugins.caddy'),
  };

  const vkAllowedOrigins = [
    vdUrl,
    `http://localhost:${input.ports.vdDashboard}`,
  ].join(',');

  const canUsePrebuiltLocalWeb =
    env.VK_MOCKED_SKIP_LOCAL_WEB_BUILD === '1' &&
    existsSync(join(vkRoot, 'packages/local-web/dist/index.html'));
  const setupCommands: CommandSpec[] = canUsePrebuiltLocalWeb
    ? []
    : [
        {
          name: 'vk-build-local-web',
          cwd: vkRoot,
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
            ...commonEnv,
            BACKEND_PORT: String(input.ports.vkBackend),
            FRONTEND_PORT: String(input.ports.vdCaddy),
            PREVIEW_PROXY_PORT: String(input.ports.vkPreviewProxy),
            NODE_OPTIONS: appendNodeOption(env.NODE_OPTIONS, '--max-old-space-size=8192'),
          },
        },
      ];

  const commands: CommandSpec[] = [
    {
      name: 'vk-backend-qa',
      cwd: vkRoot,
      command: 'cargo',
      args: ['run', '--quiet', '--features', 'qa-mode', '--bin', 'server'],
      env: {
        ...commonEnv,
        HOST: '127.0.0.1',
        BACKEND_PORT: String(input.ports.vkBackend),
        PORT: String(input.ports.vkBackend),
        FRONTEND_PORT: String(input.ports.vdCaddy),
        PREVIEW_PROXY_PORT: String(input.ports.vkPreviewProxy),
        VK_ALLOWED_ORIGINS: vkAllowedOrigins,
        DISABLE_WORKTREE_CLEANUP: '1',
        RUST_LOG: process.env.RUST_LOG ?? 'debug',
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
        VD_WORKFLOW_WEBHOOK_PORT: String(input.ports.vdCaddy),
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
        CADDY_ADMIN: 'off',
        CADDY_PORT: String(input.ports.vdCaddy),
        VD_SERVER_PORT: String(input.ports.vdServer),
        DASHBOARD_PORT: String(input.ports.vdDashboard),
        BACKEND_PORT: String(input.ports.vkBackend),
        CODE_PORT: String(input.ports.vkPreviewProxy),
        CADDY_ACCESS_LOG: join(runDir, 'access.log'),
        CADDY_PLUGINS_CADDY: commonEnv.CADDY_PLUGINS_CADDY,
      },
    },
  ];

  return {
    ports: input.ports,
    paths: { workspaceRoot, vdRoot, vkRoot, runDir },
    urls: { vd: vdUrl, vkFrontend: vkFrontendUrl },
    env: commonEnv,
    caddyfile: input.caddyfile,
    setupCommands,
    commands,
  };
}

export async function writeSandboxFiles(plan: SandboxPlan): Promise<void> {
  await mkdir(plan.paths.runDir, { recursive: true });
  await writeFile(join(plan.paths.runDir, 'Caddyfile'), plan.caddyfile);
  await writeFile(join(plan.paths.runDir, 'plugins.caddy'), '');
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
  console.log(`VK frontend URL: ${plan.urls.vkFrontend}`);
  console.log(`Run dir: ${plan.paths.runDir}`);
  console.log('\nSetup commands:');
  for (const spec of plan.setupCommands) {
    console.log(`- ${spec.name}: (cd ${spec.cwd} && ${spec.command} ${spec.args.join(' ')})`);
  }
  console.log('\nCommands:');
  for (const spec of plan.commands) {
    console.log(`- ${spec.name}: (cd ${spec.cwd} && ${spec.command} ${spec.args.join(' ')})`);
  }
}

function runCommandToCompletion(spec: CommandSpec): Promise<void> {
  return new Promise((resolveCommand, rejectCommand) => {
    const child = spawn(spec.command, spec.args, {
      cwd: spec.cwd,
      env: { ...process.env, ...spec.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const prefix = `[${spec.name}]`;
    child.stdout?.on('data', (chunk) => process.stdout.write(`${prefix} ${chunk}`));
    child.stderr?.on('data', (chunk) => process.stderr.write(`${prefix} ${chunk}`));
    child.on('error', (error) => {
      rejectCommand(new Error(`${spec.name} failed to start: ${error.message}`));
    });
    child.on('exit', (code, signal) => {
      console.log(`${prefix} exited code=${code ?? 'null'} signal=${signal ?? 'null'}`);
      if (code === 0) {
        resolveCommand();
        return;
      }
      rejectCommand(
        new Error(`${spec.name} failed with code=${code ?? 'null'} signal=${signal ?? 'null'}`),
      );
    });
  });
}

function spawnCommand(
  spec: CommandSpec,
  onUnexpectedExit: (spec: CommandSpec, reason: string) => void,
): ChildProcess {
  const child = spawn(spec.command, spec.args, {
    cwd: spec.cwd,
    env: { ...process.env, ...spec.env },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
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

function signalChild(child: ChildProcess, signal: NodeJS.Signals): void {
  if (!child.pid) return;
  try {
    process.kill(childProcessSignalTarget(child.pid), signal);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return;
    child.kill(signal);
  }
}

function isChildExited(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

async function waitForChildExit(
  child: ChildProcess,
  timeoutMs: number,
): Promise<'exited' | 'timeout'> {
  if (isChildExited(child)) return 'exited';
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      once(child, 'exit').then(() => 'exited' as const),
      new Promise<'timeout'>((resolveTimeout) => {
        timeout = setTimeout(() => resolveTimeout('timeout'), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function stopChild(
  child: ChildProcess,
  name: string,
  timeoutMs = CHILD_SHUTDOWN_TIMEOUT_MS,
): Promise<void> {
  const prefix = `[${name}]`;
  if (isChildExited(child)) return;

  signalChild(child, 'SIGTERM');
  if ((await waitForChildExit(child, timeoutMs)) === 'exited') return;

  console.error(`${prefix} did not exit after SIGTERM; sending SIGKILL.`);
  signalChild(child, 'SIGKILL');
  await waitForChildExit(child, timeoutMs);
}

async function main(): Promise<void> {
  const mode = process.argv[2] ?? 'prepare';
  const ports = await allocatePorts();
  const workspaceRoot = resolve(process.cwd(), '..');
  const vdRoot = resolve(workspaceRoot, 'vibe-kanban-vscode-web');
  const caddyfile = await loadSandboxCaddyfile(vdRoot);
  const plan = createSandboxPlan({
    workspaceRoot: process.cwd(),
    ports,
    caddyfile,
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
  for (const spec of plan.setupCommands) {
    await runCommandToCompletion(spec);
  }
  let stopping = false;
  let stopPromise: Promise<void> | undefined;
  const children: { spec: CommandSpec; child: ChildProcess }[] = [];
  const stop = (exitCode?: number): Promise<void> => {
    if (stopPromise) return stopPromise;
    stopping = true;
    if (exitCode !== undefined) process.exitCode = exitCode;
    stopPromise = Promise.all(
      children.map(({ spec, child }) => stopChild(child, spec.name)),
    ).then(() => undefined);
    return stopPromise;
  };
  for (const spec of plan.commands) {
    const child = spawnCommand(spec, (exitedSpec, reason) => {
      if (stopping) return;
      console.error(`${exitedSpec.name} exited unexpectedly (${reason}); stopping sandbox.`);
      void stop(1).then(() => process.exit(1));
    });
    children.push({ spec, child });
  }
  process.on('SIGINT', () => {
    void stop().then(() => process.exit(process.exitCode ?? 0));
  });
  process.on('SIGTERM', () => {
    void stop().then(() => process.exit(process.exitCode ?? 0));
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack : String(error));
    process.exitCode = 1;
  });
}
