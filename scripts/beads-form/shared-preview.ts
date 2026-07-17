import { execFileSync } from 'node:child_process';
import { mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export type SharedPreviewOptions = {
  checkoutDir?: string;
  branch?: string;
  repoUrl?: string;
  session?: string;
  formsDir?: string;
  parentDir?: string;
  port?: string;
  serverPort?: string;
  host?: string;
  logPath?: string;
  printOnly?: boolean;
};

export type SharedPreviewConfig = Required<Omit<SharedPreviewOptions, 'printOnly'>> & {
  printOnly: boolean;
  previewUrl: string;
  parentDirUrl: string;
};

const DEFAULT_CHECKOUT_DIR = '/var/tmp/beadsform-preview-stable/vibe-kanban-vscode-web';
const DEFAULT_BRANCH = 'vk/8299-beads-web-show-m';
const DEFAULT_REPO_URL = 'https://github.com/mickmister/vibe-dashboard.git';
const DEFAULT_SESSION = 'beadsform-shared-preview-55123';
const DEFAULT_FORMS_DIR = '/tmp/beads-form-preview';
const DEFAULT_PARENT_DIR = '/var/tmp/vibe-kanban/worktrees';
const DEFAULT_PORT = '55123';
const DEFAULT_SERVER_PORT = '55124';
const DEFAULT_LOG_PATH = '/tmp/beadsform-shared-preview-55123.log';

export function parseSharedPreviewArgs(argv: string[]): SharedPreviewOptions {
  const options: SharedPreviewOptions = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      index += 1;
      return argv[index];
    };
    if (arg === '--checkout-dir') options.checkoutDir = next();
    else if (arg?.startsWith('--checkout-dir=')) options.checkoutDir = arg.slice('--checkout-dir='.length);
    else if (arg === '--branch') options.branch = next();
    else if (arg?.startsWith('--branch=')) options.branch = arg.slice('--branch='.length);
    else if (arg === '--repo-url') options.repoUrl = next();
    else if (arg?.startsWith('--repo-url=')) options.repoUrl = arg.slice('--repo-url='.length);
    else if (arg === '--session') options.session = next();
    else if (arg?.startsWith('--session=')) options.session = arg.slice('--session='.length);
    else if (arg === '--folder' || arg === '-f') options.formsDir = next();
    else if (arg?.startsWith('--folder=')) options.formsDir = arg.slice('--folder='.length);
    else if (arg === '--parent-dir') options.parentDir = next();
    else if (arg?.startsWith('--parent-dir=')) options.parentDir = arg.slice('--parent-dir='.length);
    else if (arg === '--port' || arg === '-p') options.port = next();
    else if (arg?.startsWith('--port=')) options.port = arg.slice('--port='.length);
    else if (arg === '--server-port') options.serverPort = next();
    else if (arg?.startsWith('--server-port=')) options.serverPort = arg.slice('--server-port='.length);
    else if (arg === '--host') options.host = next();
    else if (arg?.startsWith('--host=')) options.host = arg.slice('--host='.length);
    else if (arg === '--log') options.logPath = next();
    else if (arg?.startsWith('--log=')) options.logPath = arg.slice('--log='.length);
    else if (arg === '--print-only') options.printOnly = true;
    else if (arg && !arg.startsWith('-') && !options.formsDir) options.formsDir = arg;
  }
  return options;
}

export function resolveSharedPreviewConfig(options: SharedPreviewOptions, env: NodeJS.ProcessEnv = process.env): SharedPreviewConfig {
  const port = options.port ?? env.BEADS_FORM_PREVIEW_PORT ?? DEFAULT_PORT;
  const host = stripTrailingSlash(options.host ?? env.BEADS_FORM_PREVIEW_HOST ?? `http://localhost:${port}`);
  const checkoutDir = resolve(options.checkoutDir ?? env.BEADS_FORM_PREVIEW_CHECKOUT ?? DEFAULT_CHECKOUT_DIR);
  const formsDir = resolve(options.formsDir ?? env.FORMS_DIR ?? DEFAULT_FORMS_DIR);
  const parentDir = resolve(options.parentDir ?? env.BEADS_FORM_PREVIEW_PARENT_DIR ?? DEFAULT_PARENT_DIR);
  const logPath = resolve(options.logPath ?? env.BEADS_FORM_PREVIEW_LOG ?? DEFAULT_LOG_PATH);
  return {
    checkoutDir,
    branch: options.branch ?? env.BEADS_FORM_PREVIEW_BRANCH ?? DEFAULT_BRANCH,
    repoUrl: options.repoUrl ?? env.BEADS_FORM_PREVIEW_REPO_URL ?? DEFAULT_REPO_URL,
    session: options.session ?? env.BEADS_FORM_PREVIEW_SESSION ?? DEFAULT_SESSION,
    formsDir,
    parentDir,
    port,
    serverPort: options.serverPort ?? env.BEADS_FORM_PREVIEW_SERVER_PORT ?? DEFAULT_SERVER_PORT,
    host,
    logPath,
    printOnly: options.printOnly ?? false,
    previewUrl: `${host}/dashboard/forms/preview?${new URLSearchParams({ folder: formsDir }).toString()}`,
    parentDirUrl: `${host}/dashboard/forms?${new URLSearchParams({ parentDir }).toString()}`,
  };
}

export function buildTmuxStartCommand(config: SharedPreviewConfig): string {
  return [
    `cd ${shQuote(config.checkoutDir)}`,
    `BEADS_FORM_DISABLE_HMR=1 npm run dev:beads-form-preview -- --folder ${shQuote(config.formsDir)} --port ${shQuote(config.port)} --server-port ${shQuote(config.serverPort)} --host ${shQuote(config.host)} > ${shQuote(config.logPath)} 2>&1`,
  ].join(' && ');
}

export function plannedSharedPreviewCommands(config: SharedPreviewConfig): string[] {
  const sync = existsSync(`${config.checkoutDir}/.git`)
    ? [
      `git -C ${shQuote(config.checkoutDir)} fetch origin ${shQuote(config.branch)}`,
      `git -C ${shQuote(config.checkoutDir)} checkout ${shQuote(config.branch)}`,
      `git -C ${shQuote(config.checkoutDir)} reset --hard ${shQuote(`origin/${config.branch}`)}`,
    ]
    : [`git clone --branch ${shQuote(config.branch)} ${shQuote(config.repoUrl)} ${shQuote(config.checkoutDir)}`];
  return [
    `tmux kill-session -t ${shQuote(config.session)} || true`,
    ...sync,
    `pnpm install --frozen-lockfile`,
    `tmux new-session -d -s ${shQuote(config.session)} -- sh -lc ${shQuote(buildTmuxStartCommand(config))}`,
  ];
}

export function shQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/$/, '');
}

function run(command: string, args: string[], options: { cwd?: string; ignoreFailure?: boolean } = {}): void {
  try {
    execFileSync(command, args, { cwd: options.cwd, stdio: 'inherit' });
  } catch (error) {
    if (!options.ignoreFailure) throw error;
  }
}

function syncCheckout(config: SharedPreviewConfig): void {
  if (existsSync(`${config.checkoutDir}/.git`)) {
    run('git', ['fetch', 'origin', config.branch], { cwd: config.checkoutDir });
    run('git', ['checkout', config.branch], { cwd: config.checkoutDir });
    run('git', ['reset', '--hard', `origin/${config.branch}`], { cwd: config.checkoutDir });
    return;
  }
  mkdirSync(dirname(config.checkoutDir), { recursive: true });
  run('git', ['clone', '--branch', config.branch, config.repoUrl, config.checkoutDir]);
}

function restartSharedPreview(config: SharedPreviewConfig): void {
  run('tmux', ['kill-session', '-t', config.session], { ignoreFailure: true });
  syncCheckout(config);
  run('pnpm', ['install', '--frozen-lockfile'], { cwd: config.checkoutDir });
  const command = buildTmuxStartCommand(config);
  run('tmux', ['new-session', '-d', '-s', config.session, '--', 'sh', '-lc', command]);
}

function printConfig(config: SharedPreviewConfig): void {
  console.log('Shared BeadsForm preview server');
  console.log(`Stable checkout: ${config.checkoutDir}`);
  console.log(`Branch:          ${config.branch}`);
  console.log(`tmux session:    ${config.session}`);
  console.log(`Log:             ${config.logPath}`);
  console.log(`Preview URL:     ${config.previewUrl}`);
  console.log(`Parent-dir URL:  ${config.parentDirUrl}`);
  console.log('Browser auto-reload: disabled (BEADS_FORM_DISABLE_HMR=1)');
}

function main(): void {
  const config = resolveSharedPreviewConfig(parseSharedPreviewArgs(process.argv.slice(2)));
  printConfig(config);
  if (config.printOnly) {
    console.log('\nPlanned commands:');
    for (const command of plannedSharedPreviewCommands(config)) console.log(`- ${command}`);
    return;
  }
  restartSharedPreview(config);
  console.log('\nRestarted shared BeadsForm preview server.');
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], 'file:').href) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
