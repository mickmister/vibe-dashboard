import { createServer } from 'node:net';
import { access, chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { promisify } from 'node:util';

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

export interface CiReleaseArtifact {
  targetSha: string;
  releaseRunId: string;
  artifactRoot: string;
  binaryPath: string;
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
const CHILD_SHUTDOWN_TIMEOUT_MS = 5_000;
const CI_RELEASE_BACKEND_MODE = 'ci-release';
const FULL_SHA_PATTERN = /^[0-9a-f]{40}$/i;
const DEFAULT_VK_GH_REPO = 'mickmister/vibe-kanban';
const DEFAULT_VK_GH_WORKFLOW = 'Release Binaries';
const DEFAULT_VK_GH_ARTIFACT_NAME = 'release-assets-linux-x64';
const DEFAULT_VK_GH_ARCHIVE_NAME = 'vibe-kanban-linux-x64.tar.gz';
const VIBE_DASHBOARD_CADDY_MARKER = '# Vibe Dashboard app';

const execFileAsync = promisify(execFile);

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

function requireFullCommitSha(value: string, envName = 'VK_MOCKED_RELEASE_SHA'): string {
  const sha = value.trim();
  if (!FULL_SHA_PATTERN.test(sha)) {
    throw new Error(`${envName} must be a full 40-character commit SHA, got ${value}`);
  }
  return sha.toLowerCase();
}

function isCiReleaseBackend(env: NodeJS.ProcessEnv): boolean {
  return env.VK_MOCKED_VK_BACKEND === CI_RELEASE_BACKEND_MODE;
}

function ciReleaseArtifactRoot(
  vdRoot: string,
  targetSha: string,
  releaseRunId: string,
): string {
  return join(vdRoot, '.vk-mocked-sandbox', 'vk-release-assets', targetSha, releaseRunId);
}

function caddyfileWithCiReleaseAssetRouting(caddyfile: string): string {
  const markerMatch = caddyfile.match(
    new RegExp(`^([ \\t]*)${VIBE_DASHBOARD_CADDY_MARKER}$`, 'm'),
  );
  if (!markerMatch) {
    throw new Error(
      `Cannot add CI-release VK asset routing: Caddyfile is missing marker "${VIBE_DASHBOARD_CADDY_MARKER}".`,
    );
  }

  const indent = markerMatch[1] ?? '';
  const indented = (line: string) => (line ? `${indent}${line}` : '');
  const releaseAssetRouting = [
    '# VK release binary frontend assets. Release builds embed VK local-web',
    '# with normal /assets/... URLs, so CI-release sandbox mode must send',
    '# these module/static asset requests to VK before VD/Vite can serve',
    '# its HTML fallback with text/html.',
    '@vk_release_assets {',
    '\tpath_regexp vk_release_assets ^/assets/.+\\.(js|css|wasm|mjs|map|json|png|jpe?g|svg|webp|ico|woff2?)$',
    '}',
    '',
    'handle @vk_release_assets {',
    '\tvk_rewrite',
    '\treverse_proxy localhost:{$BACKEND_PORT:3007} {',
    '\t\theader_up Host {upstream_hostport}',
    '\t\theader_up Upgrade {http.request.header.Upgrade}',
    '\t\theader_up Connection {http.request.header.Connection}',
    '\t\theader_up Accept-Encoding identity',
    '\t}',
    '}',
    '',
  ]
    .map(indented)
    .join('\n');

  return caddyfile.replace(markerMatch[0], `${releaseAssetRouting}${markerMatch[0]}`);
}

function ciReleaseArtifactFromEnv(
  vdRoot: string,
  env: NodeJS.ProcessEnv,
): CiReleaseArtifact | undefined {
  if (!isCiReleaseBackend(env)) return undefined;

  const targetSha = requireFullCommitSha(env.VK_MOCKED_RELEASE_SHA ?? '');
  const releaseRunId = env.VK_MOCKED_RELEASE_RUN_ID?.trim();
  if (!releaseRunId) {
    throw new Error(
      [
        'VK_MOCKED_RELEASE_RUN_ID is required after resolving the CI release run.',
        `Run prepare/start with VK_MOCKED_VK_BACKEND=${CI_RELEASE_BACKEND_MODE} so the sandbox can discover it,`,
        'or provide VK_MOCKED_RELEASE_RUN_ID explicitly.',
      ].join(' '),
    );
  }

  const artifactRoot = ciReleaseArtifactRoot(vdRoot, targetSha, releaseRunId);
  return {
    targetSha,
    releaseRunId,
    artifactRoot,
    binaryPath: join(artifactRoot, 'extracted', 'vibe-kanban'),
  };
}

async function fileExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function execText(
  command: string,
  args: string[],
  options: { cwd?: string } = {},
): Promise<string> {
  try {
    const { stdout } = await execFileAsync(command, args, {
      cwd: options.cwd,
      maxBuffer: 10 * 1024 * 1024,
    });
    return stdout;
  } catch (error) {
    const err = error as NodeJS.ErrnoException & {
      stderr?: string;
      stdout?: string;
    };
    const stderr = err.stderr?.trim();
    const stdout = err.stdout?.trim();
    throw new Error(
      [
        `${command} ${args.join(' ')} failed: ${err.message}`,
        stderr ? `stderr:\n${stderr}` : '',
        stdout ? `stdout:\n${stdout}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
    );
  }
}

async function execJson<T>(
  command: string,
  args: string[],
  options: { cwd?: string } = {},
): Promise<T> {
  return JSON.parse(await execText(command, args, options)) as T;
}

async function resolveTargetSha(
  vkRoot: string,
  env: NodeJS.ProcessEnv,
): Promise<string> {
  const configuredSha = env.VK_MOCKED_RELEASE_SHA?.trim();
  if (configuredSha) return requireFullCommitSha(configuredSha);

  const ref = env.VK_REF?.trim();
  if (!ref) {
    throw new Error(
      [
        'CI-release VK mocked sandbox requires an exact VK commit.',
        'Set VK_MOCKED_RELEASE_SHA=<40-character-sha>.',
        'For source mode instead, use npm run dev:vk-mocked-sandbox.',
      ].join(' '),
    );
  }

  const resolved = (await execText('git', ['-C', vkRoot, 'rev-parse', ref])).trim();
  return requireFullCommitSha(resolved, 'VK_REF');
}

async function resolveReleaseRunId(
  targetSha: string,
  env: NodeJS.ProcessEnv,
): Promise<string> {
  const configuredRunId = env.VK_MOCKED_RELEASE_RUN_ID?.trim();
  if (configuredRunId) return configuredRunId;

  const repo = env.VK_MOCKED_GH_REPO ?? DEFAULT_VK_GH_REPO;
  const workflow = env.VK_MOCKED_GH_WORKFLOW ?? DEFAULT_VK_GH_WORKFLOW;
  const runs = await execJson<
    Array<{
      databaseId: number;
      headSha: string;
      status: string;
      conclusion: string | null;
    }>
  >('gh', [
    'run',
    'list',
    '--repo',
    repo,
    '--workflow',
    workflow,
    '--limit',
    '50',
    '--json',
    'databaseId,headSha,status,conclusion',
  ]);

  const matchingRun = runs.find((run) => run.headSha === targetSha);
  if (!matchingRun) {
    throw new Error(
      [
        `No ${workflow} GitHub Actions run was found for VK commit ${targetSha}.`,
        `Checked repo ${repo}.`,
        'Wait for CI to publish release assets, provide VK_MOCKED_RELEASE_RUN_ID,',
        'or use source mode with npm run dev:vk-mocked-sandbox when iterating VK locally.',
      ].join(' '),
    );
  }

  return String(matchingRun.databaseId);
}

async function requireSuccessfulReleaseRun(
  targetSha: string,
  releaseRunId: string,
  env: NodeJS.ProcessEnv,
): Promise<void> {
  const repo = env.VK_MOCKED_GH_REPO ?? DEFAULT_VK_GH_REPO;
  const workflow = env.VK_MOCKED_GH_WORKFLOW ?? DEFAULT_VK_GH_WORKFLOW;
  const run = await execJson<{
    headSha: string;
    status: string;
    conclusion: string | null;
    workflowName: string;
    url?: string;
  }>('gh', [
    'run',
    'view',
    releaseRunId,
    '--repo',
    repo,
    '--json',
    'headSha,status,conclusion,workflowName,url',
  ]);

  if (run.headSha !== targetSha) {
    throw new Error(
      `Release run ${releaseRunId} targets ${run.headSha}, expected ${targetSha}.`,
    );
  }
  if (run.workflowName !== workflow) {
    throw new Error(
      `Release run ${releaseRunId} is workflow ${run.workflowName}, expected ${workflow}.`,
    );
  }
  if (run.status !== 'completed' || run.conclusion !== 'success') {
    throw new Error(
      [
        `Release run ${releaseRunId} is ${run.status} / ${run.conclusion ?? 'none'}; expected completed / success.`,
        run.url ? `Run: ${run.url}` : '',
        'Wait for Release Binaries to succeed or use source mode with npm run dev:vk-mocked-sandbox.',
      ]
        .filter(Boolean)
        .join(' '),
    );
  }
}

async function verifyManifestIfAvailable(
  manifestPath: string,
  targetSha: string,
): Promise<void> {
  if (!(await fileExists(manifestPath))) return;
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
    vk_sha?: string;
    commit?: string;
    platforms?: Record<
      string,
      {
        assets?: Record<string, { file?: string; sha256?: string }>;
      }
    >;
  };
  const manifestSha = manifest.vk_sha ?? manifest.commit;
  if (manifestSha && manifestSha !== targetSha) {
    throw new Error(
      `Release manifest commit mismatch: expected ${targetSha}, got ${manifestSha}.`,
    );
  }
}

async function verifyCiReleaseArtifactFiles(input: {
  artifactDir: string;
  archiveName: string;
  targetSha: string;
}): Promise<void> {
  const archivePath = join(input.artifactDir, input.archiveName);
  const checksumPath = `${archivePath}.sha256`;
  const manifestPath = join(input.artifactDir, 'manifest.json');

  if (!(await fileExists(archivePath))) {
    throw new Error(`Release artifact is missing expected archive ${archivePath}.`);
  }
  if (!(await fileExists(checksumPath))) {
    throw new Error(`Release artifact is missing checksum file ${checksumPath}.`);
  }
  await verifyManifestIfAvailable(manifestPath, input.targetSha);
  await execText('sha256sum', ['-c', `${input.archiveName}.sha256`], {
    cwd: input.artifactDir,
  });
}

export async function downloadCiReleaseArtifactFromEnv(
  vdRoot: string,
  env: NodeJS.ProcessEnv,
): Promise<CiReleaseArtifact> {
  const targetSha = requireFullCommitSha(env.VK_MOCKED_RELEASE_SHA ?? '');
  const releaseRunId = env.VK_MOCKED_RELEASE_RUN_ID?.trim();
  if (!releaseRunId) {
    throw new Error('VK_MOCKED_RELEASE_RUN_ID is required for download-ci-release.');
  }
  await requireSuccessfulReleaseRun(targetSha, releaseRunId, env);

  const repo = env.VK_MOCKED_GH_REPO ?? DEFAULT_VK_GH_REPO;
  const artifactName = env.VK_MOCKED_GH_ARTIFACT_NAME ?? DEFAULT_VK_GH_ARTIFACT_NAME;
  const archiveName = env.VK_MOCKED_GH_ARCHIVE_NAME ?? DEFAULT_VK_GH_ARCHIVE_NAME;
  const artifactRoot =
    env.VK_MOCKED_RELEASE_CACHE_DIR?.trim() ||
    ciReleaseArtifactRoot(vdRoot, targetSha, releaseRunId);
  const artifactDir = join(artifactRoot, artifactName);
  const extractDir = join(artifactRoot, 'extracted');
  const archivePath = join(artifactDir, archiveName);
  const binaryPath = join(extractDir, 'vibe-kanban');

  if (await fileExists(binaryPath)) {
    await verifyCiReleaseArtifactFiles({ artifactDir, archiveName, targetSha });
    await chmod(binaryPath, 0o755);
    return { targetSha, releaseRunId, artifactRoot, binaryPath };
  }

  await rm(artifactDir, { recursive: true, force: true });
  await rm(extractDir, { recursive: true, force: true });
  await mkdir(artifactDir, { recursive: true });
  await mkdir(extractDir, { recursive: true });

  console.log(
    `[vk-mocked-sandbox] downloading ${artifactName} from Release Binaries run ${releaseRunId}`,
  );
  await execText('gh', [
    'run',
    'download',
    releaseRunId,
    '--repo',
    repo,
    '--name',
    artifactName,
    '--dir',
    artifactDir,
  ]);

  if (!(await fileExists(archivePath))) {
    throw new Error(`Downloaded artifact is missing expected archive ${archivePath}.`);
  }
  await verifyCiReleaseArtifactFiles({ artifactDir, archiveName, targetSha });
  await execText('tar', ['-xzf', archivePath, '-C', extractDir]);

  if (!(await fileExists(binaryPath))) {
    throw new Error(`Extracted archive did not contain executable ${binaryPath}.`);
  }
  await chmod(binaryPath, 0o755);

  return { targetSha, releaseRunId, artifactRoot, binaryPath };
}

async function resolveCiReleaseArtifact(
  vdRoot: string,
  vkRoot: string,
  env: NodeJS.ProcessEnv,
): Promise<CiReleaseArtifact> {
  const targetSha = await resolveTargetSha(vkRoot, env);
  const releaseRunId = await resolveReleaseRunId(targetSha, env);
  await requireSuccessfulReleaseRun(targetSha, releaseRunId, env);
  const artifactRoot = ciReleaseArtifactRoot(vdRoot, targetSha, releaseRunId);
  return {
    targetSha,
    releaseRunId,
    artifactRoot,
    binaryPath: join(artifactRoot, 'extracted', 'vibe-kanban'),
  };
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

export async function loadSandboxCaddyfile(vdRoot: string): Promise<string> {
  return await readFile(join(vdRoot, SANDBOX_CADDYFILE_NAME), 'utf8');
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
  const ciReleaseArtifact = ciReleaseArtifactFromEnv(vdRoot, env);
  if (ciReleaseArtifact && env.VK_MOCKED_PREBUILD_BACKEND === '1') {
    throw new Error(
      [
        'VK_MOCKED_PREBUILD_BACKEND is not supported in ci-release mode because it would locally build VK.',
        'Unset VK_MOCKED_PREBUILD_BACKEND or use npm run dev:vk-mocked-sandbox for source mode.',
      ].join(' '),
    );
  }
  const runDir = resolve(
    input.runDir ?? join(vdRoot, '.vk-mocked-sandbox', 'current'),
  );
  const caddyfile = ciReleaseArtifact
    ? caddyfileWithCiReleaseAssetRouting(input.caddyfile)
    : input.caddyfile;
  const vdUrl = `http://localhost:${input.ports.vdCaddy}`;
  const publicOrigin = getConfiguredPublicOrigin(env);
  const browserOrigin = publicOrigin ?? vdUrl;
  const vkFrontendUrl = browserOrigin;

  const commonEnv = {
    VK_MOCKED_SANDBOX: '1',
    VK_MOCKED_SANDBOX_RUN_DIR: runDir,
    VK_MOCKED_VD_URL: browserOrigin,
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
    ...(publicOrigin ? [publicOrigin] : []),
    `http://localhost:${input.ports.vdDashboard}`,
  ].join(',');

  const canUsePrebuiltLocalWeb =
    Boolean(ciReleaseArtifact) ||
    (env.VK_MOCKED_SKIP_LOCAL_WEB_BUILD === '1' &&
      existsSync(join(vkRoot, 'packages/local-web/dist/index.html')));
  const setupCommands: CommandSpec[] = [];
  if (ciReleaseArtifact) {
    setupCommands.push({
      name: 'vk-download-release-artifact',
      cwd: vdRoot,
      command: 'node',
      args: [
        '--experimental-strip-types',
        'scripts/vk-mocked-sandbox.ts',
        'download-ci-release',
      ],
      env: {
        ...commonEnv,
        VK_MOCKED_VK_BACKEND: CI_RELEASE_BACKEND_MODE,
        VK_MOCKED_RELEASE_SHA: ciReleaseArtifact.targetSha,
        VK_MOCKED_RELEASE_RUN_ID: ciReleaseArtifact.releaseRunId,
        VK_MOCKED_RELEASE_CACHE_DIR: ciReleaseArtifact.artifactRoot,
        VK_MOCKED_GH_REPO: env.VK_MOCKED_GH_REPO ?? DEFAULT_VK_GH_REPO,
        VK_MOCKED_GH_WORKFLOW: env.VK_MOCKED_GH_WORKFLOW ?? DEFAULT_VK_GH_WORKFLOW,
        VK_MOCKED_GH_ARTIFACT_NAME:
          env.VK_MOCKED_GH_ARTIFACT_NAME ?? DEFAULT_VK_GH_ARTIFACT_NAME,
        VK_MOCKED_GH_ARCHIVE_NAME:
          env.VK_MOCKED_GH_ARCHIVE_NAME ?? DEFAULT_VK_GH_ARCHIVE_NAME,
      },
    });
  } else if (!canUsePrebuiltLocalWeb) {
    setupCommands.push({
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
    });
  }
  if (env.VK_MOCKED_PREBUILD_BACKEND === '1') {
    setupCommands.push({
      name: 'vk-build-backend-qa',
      cwd: vkRoot,
      command: 'cargo',
      args: ['build', '--features', 'qa-mode', '--bin', 'server'],
      env: commonEnv,
    });
  }

  const vkBackendCommand: CommandSpec = ciReleaseArtifact
    ? {
        name: 'vk-backend-ci-release',
        cwd: vkRoot,
        command: ciReleaseArtifact.binaryPath,
        args: [],
        env: {
          ...commonEnv,
          HOST: '127.0.0.1',
          BACKEND_PORT: String(input.ports.vkBackend),
          PORT: String(input.ports.vkBackend),
          FRONTEND_PORT: String(input.ports.vdCaddy),
          PREVIEW_PROXY_PORT: String(input.ports.vkPreviewProxy),
          VK_ALLOWED_ORIGINS: vkAllowedOrigins,
          DISABLE_WORKTREE_CLEANUP: '1',
          XDG_CONFIG_HOME: join(runDir, 'xdg-config'),
          XDG_DATA_HOME: join(runDir, 'xdg-data'),
          VK_QA_MODE: '1',
          QA_MODE: '1',
          RUST_LOG: process.env.RUST_LOG ?? 'debug',
        },
      }
    : {
      name: 'vk-backend-qa',
      cwd: vkRoot,
      command: 'cargo',
      args: ['run', '--features', 'qa-mode', '--bin', 'server'],
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
    };

  const commands: CommandSpec[] = [
    vkBackendCommand,
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
        CADDY_ADMIN: 'off',
        CADDY_PORT: String(input.ports.vdCaddy),
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
    urls: { vd: browserOrigin, vkFrontend: vkFrontendUrl },
    env: commonEnv,
    caddyfile,
    setupCommands,
    commands,
  };
}

function getConfiguredPublicOrigin(env: NodeJS.ProcessEnv): string | null {
  const raw = env.VK_MOCKED_PUBLIC_ORIGIN?.trim();
  if (!raw) return null;

  try {
    return new URL(raw).origin;
  } catch {
    throw new Error(`VK_MOCKED_PUBLIC_ORIGIN must be a valid absolute URL origin, got ${raw}`);
  }
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
  if (mode === 'download-ci-release') {
    const workspaceRoot = resolve(process.cwd(), '..');
    const vdRoot = resolve(workspaceRoot, 'vibe-kanban-vscode-web');
    const artifact = await downloadCiReleaseArtifactFromEnv(vdRoot, process.env);
    console.log(`[vk-mocked-sandbox] VK release binary ready: ${artifact.binaryPath}`);
    return;
  }

  const ports = await allocatePorts();
  const workspaceRoot = resolve(process.cwd(), '..');
  const vdRoot = resolve(workspaceRoot, 'vibe-kanban-vscode-web');
  const caddyfile = await loadSandboxCaddyfile(vdRoot);
  const configuredVkCheckout = process.env.VK_CHECKOUT?.trim();
  const vkRoot = resolve(workspaceRoot, configuredVkCheckout || 'Vktest');
  let env = process.env;
  if (isCiReleaseBackend(process.env)) {
    const artifact = await resolveCiReleaseArtifact(vdRoot, vkRoot, process.env);
    env = {
      ...process.env,
      VK_MOCKED_RELEASE_SHA: artifact.targetSha,
      VK_MOCKED_RELEASE_RUN_ID: artifact.releaseRunId,
      VK_MOCKED_RELEASE_CACHE_DIR: artifact.artifactRoot,
    };
  }
  const plan = createSandboxPlan({
    workspaceRoot: process.cwd(),
    env,
    ports,
    caddyfile,
  });
  await writeSandboxFiles(plan);

  if (mode === 'prepare') {
    printPlan(plan);
    return;
  }

  if (!existsSync(plan.paths.vkRoot)) {
    throw new Error(`VK repo not found at ${plan.paths.vkRoot}`);
  }

  printPlan(plan);
  if (mode === 'setup') {
    for (const spec of plan.setupCommands) {
      await runCommandToCompletion(spec);
    }
    return;
  }

  if (mode !== 'start') {
    throw new Error(`Unknown mode ${mode}. Usage: vk-mocked-sandbox.ts [prepare|setup|start]`);
  }

  if (process.env.VK_MOCKED_SKIP_SETUP_COMMANDS !== '1') {
    for (const spec of plan.setupCommands) {
      await runCommandToCompletion(spec);
    }
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
