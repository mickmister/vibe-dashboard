import { access, cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { constants } from 'node:fs';
import { HttpReadinessProbe } from '../src/server/hotswap/readiness-probes.ts';
import { VdDistRuntimePromoter } from '../src/server/hotswap/runtime-promoters.node.ts';
import { SupervisorProgramRestarter } from '../src/server/hotswap/supervisor-runner.ts';

const runtimeDir = process.env.VIBE_DASHBOARD_RUNTIME_DIR ?? '/home/vkuser/.local/share/vibe-dashboard-runtime';
const stateDir = process.env.VIBE_DASHBOARD_HOTSWAP_STATE_DIR ?? join(runtimeDir, '.hotswap');
const programName = process.env.VIBE_DASHBOARD_SUPERVISOR_PROGRAM ?? 'vibe-dashboard';
const currentMarker = join(stateDir, 'current-kind');
const lastSourceMarker = join(stateDir, 'last-source');
const latestRollbackMarker = join(stateDir, 'latest-rollback-runtime');
const prodInitialRuntime = join(stateDir, 'prod-initial-runtime');
const managedRuntimePaths = ['dist', 'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', '.npmrc', 'packages', 'node_modules'];

async function deploy(worktree = process.cwd()): Promise<void> {
  const promoter = createPromoter();
  const supervisor = createSupervisor();
  const readiness = new HttpReadinessProbe();
  const distPath = join(worktree, 'dist');
  const inspection = await promoter.inspectDistPromotion(distPath);

  console.log(JSON.stringify({
    mode: 'apply',
    runtimeDir,
    distPath,
    dependencySyncRequired: inspection.dependencySyncRequired,
    dependencySyncReasons: inspection.reasons,
    managedPaths: inspection.managedPaths,
  }, null, 2));

  await captureRuntimeBundleOnce(prodInitialRuntime);
  const promotion = await promoter.promoteDist(distPath);
  try {
    await supervisor.restart(programName);
    await readiness.waitForVdReady();
    await mkdir(stateDir, { recursive: true });
    await writeFile(currentMarker, 'dev\n');
    await writeFile(lastSourceMarker, `${worktree}\n`);
    await writeFile(latestRollbackMarker, `${promotion.rollbackPath}\n`);
  } catch (error) {
    try {
      await promoter.rollback(promotion);
      await supervisor.restart(programName);
      await readiness.waitForVdReady();
    } catch (rollbackError) {
      throw new Error(
        `VD hotswap failed, then rollback recovery failed: original failure: ${formatError(error)}; recovery failure: ${formatError(rollbackError)}`,
      );
    }
    throw error;
  }
}

async function rollbackBundle(bundlePath: string, nextKind: 'dev' | 'prod', sourceLabel: string): Promise<void> {
  const promoter = createPromoter();
  const supervisor = createSupervisor();
  const readiness = new HttpReadinessProbe();
  await promoter.rollback({ promotedPath: runtimeDir, rollbackPath: bundlePath });
  await supervisor.restart(programName);
  await readiness.waitForVdReady();
  await mkdir(stateDir, { recursive: true });
  await writeFile(currentMarker, `${nextKind}\n`);
  await writeFile(lastSourceMarker, `${sourceLabel}\n`);
}

async function captureRuntimeBundleOnce(bundlePath: string): Promise<void> {
  if (await exists(join(bundlePath, 'dist', 'node', 'node-entry.mjs'))) return;
  await rm(bundlePath, { recursive: true, force: true });
  await mkdir(bundlePath, { recursive: true });
  for (const relativePath of managedRuntimePaths) {
    const source = join(runtimeDir, relativePath);
    if (await exists(source)) {
      await cp(source, join(bundlePath, relativePath), { recursive: true });
    }
  }
}

async function readText(path: string): Promise<string> {
  const { readFile } = await import('node:fs/promises');
  return (await readFile(path, 'utf8')).trim();
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function createPromoter(): VdDistRuntimePromoter {
  return new VdDistRuntimePromoter({ runtimeDir, stateDir });
}

function createSupervisor(): SupervisorProgramRestarter {
  return new SupervisorProgramRestarter({ supervisorConfigPath: process.env.SUPERVISOR_CONF });
}

async function main(argv: readonly string[]): Promise<void> {
  const command = argv[0];
  if (command === 'deploy') {
    await deploy(argv[1]);
    return;
  }
  if (command === 'rollback-dev') {
    const bundle = await readText(latestRollbackMarker);
    await rollbackBundle(bundle, 'dev', 'latest dependency-aware rollback bundle');
    return;
  }
  if (command === 'rollback-prod') {
    await rollbackBundle(prodInitialRuntime, 'prod', 'initial production runtime bundle');
    return;
  }
  throw new Error('Usage: hotswap-dashboard-dist.ts deploy [worktree] | rollback-dev | rollback-prod');
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

if (process.argv[1]?.endsWith('hotswap-dashboard-dist.ts')) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
