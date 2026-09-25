import { spawnSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export type BootstrapArgs = {
  printOnly: boolean;
  command: string[];
};

export type BootstrapConfig = {
  cwd: string;
  printOnly: boolean;
  command: string;
  args: string[];
  localBinDir: string;
};

export type BootstrapPlan = {
  cwd: string;
  install?: {
    command: string;
    args: string[];
    reason: string;
  };
  run: {
    command: string;
    args: string[];
  };
  envPathPrefix: string;
};

export function parseBootstrapArgs(argv: string[]): BootstrapArgs {
  const separatorIndex = argv.indexOf('--');
  const controlArgs = separatorIndex >= 0 ? argv.slice(0, separatorIndex) : [];
  const command = separatorIndex >= 0 ? argv.slice(separatorIndex + 1) : argv.slice();
  return {
    printOnly: controlArgs.includes('--print-only'),
    command: command.length > 0 ? command : ['vite'],
  };
}

export function resolveBootstrapConfig(input: { cwd?: string; argv: BootstrapArgs }): BootstrapConfig {
  const cwd = resolve(input.cwd ?? process.cwd());
  const [command = 'vite', ...args] = input.argv.command;
  return {
    cwd,
    printOnly: input.argv.printOnly,
    command,
    args,
    localBinDir: join(cwd, 'node_modules', '.bin'),
  };
}

export function buildBootstrapPlan(config: BootstrapConfig): BootstrapPlan {
  return {
    cwd: config.cwd,
    install: requiredInstall(config.cwd),
    run: {
      command: config.command,
      args: config.args,
    },
    envPathPrefix: config.localBinDir,
  };
}

export function formatBootstrapPlan(plan: BootstrapPlan): string {
  const installLine = plan.install
    ? `install: ${[plan.install.command, ...plan.install.args].join(' ')} (${plan.install.reason})`
    : 'install: skipped';
  return [
    'VD preview dependency bootstrap',
    `cwd: ${plan.cwd}`,
    installLine,
    `run: ${[plan.run.command, ...plan.run.args].join(' ')}`,
  ].join('\n');
}

function requiredInstall(cwd: string): BootstrapPlan['install'] {
  const viteBin = join(cwd, 'node_modules', '.bin', process.platform === 'win32' ? 'vite.cmd' : 'vite');
  if (!existsSync(viteBin)) {
    return {
      command: 'pnpm',
      args: ['install', '--frozen-lockfile'],
      reason: 'missing node_modules/.bin/vite',
    };
  }

  const pnpmState = join(cwd, 'node_modules', '.modules.yaml');
  const lockfile = join(cwd, 'pnpm-lock.yaml');
  if (existsSync(lockfile) && existsSync(pnpmState) && statSync(lockfile).mtimeMs > statSync(pnpmState).mtimeMs) {
    return {
      command: 'pnpm',
      args: ['install', '--frozen-lockfile'],
      reason: 'pnpm lockfile is newer than node_modules/.modules.yaml',
    };
  }

  return undefined;
}

function runPlan(plan: BootstrapPlan): number | null {
  if (plan.install) {
    console.error(`[preview-bootstrap] ${plan.install.reason}; running ${plan.install.command} ${plan.install.args.join(' ')}`);
    const install = spawnSync(plan.install.command, plan.install.args, { cwd: plan.cwd, stdio: 'inherit' });
    if (install.error) {
      console.error(`[preview-bootstrap] dependency install failed to start: ${install.error.message}`);
      return 1;
    }
    if (install.status !== 0 || install.signal) {
      console.error(`[preview-bootstrap] dependency install failed${install.signal ? ` by signal ${install.signal}` : ` with exit ${install.status}`}`);
      return install.status ?? 1;
    }
  }

  const path = process.env.PATH ? `${plan.envPathPrefix}:${process.env.PATH}` : plan.envPathPrefix;
  const child = spawnSync(plan.run.command, plan.run.args, {
    cwd: plan.cwd,
    stdio: 'inherit',
    env: { ...process.env, PATH: path },
  });
  if (child.error) {
    console.error(`[preview-bootstrap] failed to start ${plan.run.command}: ${child.error.message}`);
    return 1;
  }
  if (child.signal) {
    process.kill(process.pid, child.signal);
    return null;
  }
  return child.status ?? 0;
}

function main(): void {
  const args = parseBootstrapArgs(process.argv.slice(2));
  const plan = buildBootstrapPlan(resolveBootstrapConfig({ argv: args }));
  if (args.printOnly) {
    console.log(formatBootstrapPlan(plan));
    return;
  }
  const exitCode = runPlan(plan);
  if (exitCode !== null) process.exit(exitCode);
}

const thisFile = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === thisFile) {
  main();
}
