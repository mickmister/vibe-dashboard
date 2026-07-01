import { execFile } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const wrapper = resolve(process.cwd(), 'scripts/bd-wrapper/bin/bd');

async function fakeBd(tempRoot: string): Promise<{ bin: string; argsFile: string }> {
  const argsFile = join(tempRoot, 'args.json');
  const bin = join(tempRoot, 'real-bd');
  await writeFile(bin, `#!/usr/bin/env node\nconst { writeFileSync } = require('node:fs');\nwriteFileSync(${JSON.stringify(argsFile)}, JSON.stringify(process.argv.slice(2)));\n`, { mode: 0o755 });
  return { bin, argsFile };
}

describe('bd metadata wrapper', () => {
  it('stamps bd create metadata and preserves user metadata', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'bd-wrapper-'));
    const { bin, argsFile } = await fakeBd(tempRoot);

    await execFileAsync(wrapper, ['create', 'Task title', '--metadata', '{"priority":"high","branch":"old"}'], {
      env: {
        ...process.env,
        REAL_BD: bin,
        VK_BD_WRAPPER_BRANCH: 'feature/test',
        VK_WORKSPACE_ID: 'workspace-1',
        VK_SESSION_ID: 'session-1',
      },
    });

    const args = JSON.parse(await readFile(argsFile, 'utf8')) as string[];
    expect(args.slice(0, 2)).toEqual(['create', 'Task title']);
    const metadataFlagIndex = args.indexOf('--metadata');
    expect(metadataFlagIndex).toBeGreaterThan(0);
    expect(JSON.parse(args[metadataFlagIndex + 1]!)).toEqual({
      priority: 'high',
      branch: 'feature/test',
      VK_WORKSPACE_ID: 'workspace-1',
      VK_SESSION_ID: 'session-1',
    });
  });

  it('passes through non-create commands unchanged', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'bd-wrapper-pass-'));
    const { bin, argsFile } = await fakeBd(tempRoot);

    await execFileAsync(wrapper, ['show', 'vkvw-123', '--json'], {
      env: { ...process.env, REAL_BD: bin },
    });

    await expect(readFile(argsFile, 'utf8').then(JSON.parse)).resolves.toEqual([
      'show',
      'vkvw-123',
      '--json',
    ]);
  });
});
