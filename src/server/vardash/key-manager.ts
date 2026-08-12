import { randomBytes } from 'node:crypto';
import { mkdir, readFile, stat, chmod, writeFile, lstat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const KEY_PREFIX = 'vd-sqlcipher-key-v1:';
const KEY_PATTERN = /^vd-sqlcipher-key-v1:[A-Za-z0-9_-]{43}$/;

export class VardashKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VardashKeyError';
  }
}

export interface VardashKeyOptions {
  privateDir?: string;
  keyFileName?: string;
  forbiddenRoots?: string[];
  allowCreate?: boolean;
}

export interface VardashKeyMaterial {
  key: string;
  privateDir: string;
  keyPath: string;
  created: boolean;
}

export function defaultVardashPrivateDir(): string {
  return (
    process.env.VARDASH_PRIVATE_DATA_DIR ??
    join(homedir(), '.local/share/vibe-dashboard-runtime/data/vardash')
  );
}

export async function loadOrCreateVardashSqlcipherKey(
  options: VardashKeyOptions = {},
): Promise<VardashKeyMaterial> {
  const privateDir = options.privateDir ?? defaultVardashPrivateDir();
  const keyPath = join(privateDir, options.keyFileName ?? 'sqlcipher.key');
  await assertVardashKeyIsNotInRepoOrWorktree({
    keyPath,
    forbiddenRoots: options.forbiddenRoots ?? [],
  });

  await ensurePrivateDirectory(privateDir);

  const existing = await readExistingKey(keyPath);
  if (existing != null) {
    await ensurePrivateFileMode(keyPath);
    return { key: existing, privateDir, keyPath, created: false };
  }

  if (options.allowCreate === false) {
    throw new VardashKeyError('Vardash SQLCipher key file is missing');
  }

  const key = generateVardashSqlcipherKey();
  try {
    await writeFile(keyPath, `${key}\n`, {
      flag: 'wx',
      mode: 0o600,
    });
  } catch (error) {
    if (isAlreadyExistsError(error)) {
      const raced = await readExistingKey(keyPath);
      if (raced == null) {
        throw new VardashKeyError('Vardash key file appeared but could not be read');
      }
      await ensurePrivateFileMode(keyPath);
      return { key: raced, privateDir, keyPath, created: false };
    }
    throw error;
  }
  await ensurePrivateFileMode(keyPath);
  return { key, privateDir, keyPath, created: true };
}

export function generateVardashSqlcipherKey(): string {
  return `${KEY_PREFIX}${randomBytes(32).toString('base64url')}`;
}

export function validateVardashSqlcipherKey(value: string): string {
  const trimmed = value.trim();
  if (!KEY_PATTERN.test(trimmed)) {
    throw new VardashKeyError('Vardash SQLCipher key file is corrupt or unsupported');
  }
  return trimmed;
}

async function ensurePrivateDirectory(privateDir: string): Promise<void> {
  await mkdir(privateDir, { recursive: true, mode: 0o700 });
  const info = await lstat(privateDir);
  if (info.isSymbolicLink() || !info.isDirectory()) {
    throw new VardashKeyError('Vardash private data directory must be a real directory');
  }
  await chmod(privateDir, 0o700);
  const mode = (await stat(privateDir)).mode & 0o777;
  if (mode !== 0o700) {
    throw new VardashKeyError('Vardash private data directory permissions are not 0700');
  }
}

async function ensurePrivateFileMode(keyPath: string): Promise<void> {
  await assertRegularKeyFile(keyPath);
  await chmod(keyPath, 0o600);
  const mode = (await stat(keyPath)).mode & 0o777;
  if (mode !== 0o600) {
    throw new VardashKeyError('Vardash SQLCipher key file permissions are not 0600');
  }
}

async function readExistingKey(keyPath: string): Promise<string | null> {
  try {
    await assertRegularKeyFile(keyPath);
    return validateVardashSqlcipherKey(await readFile(keyPath, 'utf8'));
  } catch (error) {
    if (isNotFoundError(error)) return null;
    throw error;
  }
}

async function assertRegularKeyFile(keyPath: string): Promise<void> {
  const info = await lstat(keyPath);
  if (info.isSymbolicLink() || !info.isFile()) {
    throw new VardashKeyError('Vardash SQLCipher key path must be a real file');
  }
}

function isNotFoundError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

function isAlreadyExistsError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'EEXIST';
}

export async function assertVardashKeyIsNotInRepoOrWorktree(input: {
  keyPath: string;
  forbiddenRoots: string[];
}): Promise<void> {
  const { resolve, relative } = await import('node:path');
  const keyPath = resolve(input.keyPath);
  for (const root of input.forbiddenRoots) {
    const resolvedRoot = resolve(root);
    const rel = relative(resolvedRoot, keyPath);
    if (rel === '' || (!rel.startsWith('..') && !rel.startsWith('/'))) {
      throw new VardashKeyError('Vardash SQLCipher key path must not be inside a repo/worktree');
    }
  }
}

export const VARDASH_KEY_FILE_ACCESS = constants.R_OK | constants.W_OK;
