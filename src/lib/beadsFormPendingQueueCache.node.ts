/// <reference types="node" />

import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import type { PendingBeadsFormQueueResult } from './beadsClient.node.ts';

export const BEADS_FORM_PENDING_PARENT_DIR_ENV = 'BEADS_FORM_PENDING_PARENT_DIR';
export const BEADS_FORM_PENDING_CACHE_DIR_ENV = 'BEADS_FORM_PENDING_CACHE_DIR';
export const BEADS_FORM_PENDING_WARM_ON_STARTUP_ENV = 'BEADS_FORM_PENDING_WARM_ON_STARTUP';

const CACHE_VERSION = 1;

export type PendingQueueCacheInput = {
  reposRoot?: string;
  repoLimit?: number;
};

export type NormalizedPendingQueueCacheInput = {
  reposRoot: string;
  repoLimit: number;
};

export type PendingQueueDiskCacheEntry = {
  result: PendingBeadsFormQueueResult;
  loadedAtMs: number;
};

type PendingQueueDiskCacheFile = {
  version: number;
  writtenAt: string;
  result: PendingBeadsFormQueueResult;
};

export function normalizePendingQueueInput(
  input: PendingQueueCacheInput = {},
  env: NodeJS.ProcessEnv = process.env,
): NormalizedPendingQueueCacheInput {
  return {
    reposRoot: normalizeDir(input.reposRoot ?? env[BEADS_FORM_PENDING_PARENT_DIR_ENV] ?? join(homedir(), 'repos')),
    repoLimit: input.repoLimit ?? 80,
  };
}

export function pendingQueueCacheDir(env: NodeJS.ProcessEnv = process.env): string {
  const xdgCacheHome = env.XDG_CACHE_HOME ? normalizeDir(env.XDG_CACHE_HOME) : join(homedir(), '.cache');
  return normalizeDir(env[BEADS_FORM_PENDING_CACHE_DIR_ENV] ?? join(xdgCacheHome, 'vibe-dashboard', 'beads-form-pending'));
}

export function pendingQueueCachePath(
  input: NormalizedPendingQueueCacheInput,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const digest = createHash('sha256')
    .update(JSON.stringify(input))
    .digest('hex')
    .slice(0, 24);
  return join(pendingQueueCacheDir(env), `${digest}.json`);
}

export async function readPendingQueueDiskCache(
  input: NormalizedPendingQueueCacheInput,
  env: NodeJS.ProcessEnv = process.env,
): Promise<PendingQueueDiskCacheEntry | undefined> {
  try {
    const text = await readFile(pendingQueueCachePath(input, env), 'utf8');
    const parsed = JSON.parse(text) as Partial<PendingQueueDiskCacheFile>;
    if (parsed.version !== CACHE_VERSION || !parsed.result || typeof parsed.writtenAt !== 'string') return undefined;
    const loadedAtMs = Date.parse(parsed.writtenAt);
    if (!Number.isFinite(loadedAtMs)) return undefined;
    return { result: parsed.result, loadedAtMs };
  } catch (error) {
    if (isMissingFileError(error)) return undefined;
    return undefined;
  }
}

export async function writePendingQueueDiskCache(
  input: NormalizedPendingQueueCacheInput,
  result: PendingBeadsFormQueueResult,
  now = new Date(),
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const cachePath = pendingQueueCachePath(input, env);
  await mkdir(dirname(cachePath), { recursive: true });
  const tempPath = `${cachePath}.${process.pid}.${Date.now()}.tmp`;
  const payload: PendingQueueDiskCacheFile = {
    version: CACHE_VERSION,
    writtenAt: now.toISOString(),
    result,
  };
  await writeFile(tempPath, JSON.stringify(payload, null, 2), 'utf8');
  await rename(tempPath, cachePath);
}

export function shouldWarmPendingQueueOnStartup(env: NodeJS.ProcessEnv = process.env): boolean {
  const explicit = env[BEADS_FORM_PENDING_WARM_ON_STARTUP_ENV];
  if (explicit === '1' || explicit?.toLowerCase() === 'true') return true;
  if (explicit === '0' || explicit?.toLowerCase() === 'false') return false;
  return env.NODE_ENV === 'production';
}

function normalizeDir(value: string): string {
  const expanded = value === '~' ? homedir() : value.startsWith('~/') ? join(homedir(), value.slice(2)) : value;
  return resolve(expanded);
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}
