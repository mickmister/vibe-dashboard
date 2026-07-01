import { mkdtemp, readFile, stat, chmod, writeFile, symlink, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  VardashKeyError,
  assertVardashKeyIsNotInRepoOrWorktree,
  loadOrCreateVardashSqlcipherKey,
  validateVardashSqlcipherKey,
} from './key-manager';

describe('vardash SQLCipher key manager', () => {
  it('generates a high-entropy key in private data with tight permissions', async () => {
    const privateDir = await mkdtemp(join(tmpdir(), 'vardash-key-'));

    const material = await loadOrCreateVardashSqlcipherKey({ privateDir });

    expect(material.created).toBe(true);
    expect(material.key).toMatch(/^vd-sqlcipher-key-v1:[A-Za-z0-9_-]{43}$/);
    expect((await stat(privateDir)).mode & 0o777).toBe(0o700);
    expect((await stat(material.keyPath)).mode & 0o777).toBe(0o600);
    expect(await readFile(material.keyPath, 'utf8')).toBe(`${material.key}\n`);

    const second = await loadOrCreateVardashSqlcipherKey({ privateDir });
    expect(second.created).toBe(false);
    expect(second.key).toBe(material.key);
  });

  it('repairs loose permissions and rejects corrupt key files without exposing key material', async () => {
    const privateDir = await mkdtemp(join(tmpdir(), 'vardash-key-'));
    const material = await loadOrCreateVardashSqlcipherKey({ privateDir });
    await chmod(privateDir, 0o755);
    await chmod(material.keyPath, 0o644);

    const repaired = await loadOrCreateVardashSqlcipherKey({ privateDir });
    expect(repaired.key).toBe(material.key);
    expect((await stat(privateDir)).mode & 0o777).toBe(0o700);
    expect((await stat(material.keyPath)).mode & 0o777).toBe(0o600);

    await writeFile(material.keyPath, 'not-a-valid-key\n', { mode: 0o600 });
    await expect(loadOrCreateVardashSqlcipherKey({ privateDir })).rejects.toThrow(VardashKeyError);
    await expect(loadOrCreateVardashSqlcipherKey({ privateDir })).rejects.not.toThrow(material.key);
  });

  it('detects keys stored inside repo or worktree roots', async () => {
    const privateDir = await mkdtemp(join(tmpdir(), 'vardash-key-'));
    const material = await loadOrCreateVardashSqlcipherKey({ privateDir });

    await expect(
      assertVardashKeyIsNotInRepoOrWorktree({ keyPath: material.keyPath, forbiddenRoots: [tmpdir()] }),
    ).rejects.toThrow('must not be inside a repo/worktree');

    await expect(
      loadOrCreateVardashSqlcipherKey({ privateDir, forbiddenRoots: [tmpdir()] }),
    ).rejects.toThrow('must not be inside a repo/worktree');

    await expect(
      assertVardashKeyIsNotInRepoOrWorktree({ keyPath: material.keyPath, forbiddenRoots: ['/definitely-not-parent'] }),
    ).resolves.toBeUndefined();
  });

  it('rejects symlinked key paths instead of following them', async () => {
    const privateDir = await mkdtemp(join(tmpdir(), 'vardash-key-'));
    const targetDir = await mkdtemp(join(tmpdir(), 'vardash-key-target-'));
    await mkdir(privateDir, { recursive: true });
    await writeFile(join(targetDir, 'actual.key'), 'vd-sqlcipher-key-v1:abcdefghijklmnopqrstuvwxyzABCDEFG1234567\n');
    await symlink(join(targetDir, 'actual.key'), join(privateDir, 'sqlcipher.key'));

    await expect(loadOrCreateVardashSqlcipherKey({ privateDir })).rejects.toThrow('must be a real file');
  });

  it('validates supported key format', () => {
    expect(() => validateVardashSqlcipherKey('vd-sqlcipher-key-v1:short')).toThrow(VardashKeyError);
  });
});
