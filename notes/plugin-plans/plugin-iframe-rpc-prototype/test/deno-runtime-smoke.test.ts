import { execFile } from 'node:child_process';
import { access, mkdtemp, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { DenoBackendRunner, type BackendRunResult } from '../src/sample-runtime';
import type { DenoBackendPluginUnit } from '../src/sample-marketplace';

const execFileAsync = promisify(execFile);

describe('real Deno backend runtime smoke', () => {
  it('runs a plugin script with explicit least-permission flags and denies ungranted access', async () => {
    const denoBinary = await findDenoBinary();
    const workspace = await mkdtemp(join(tmpdir(), 'vk-deno-plugin-'));
    const dataDir = join(workspace, 'data');
    const scriptPath = join(workspace, 'backend-plugin.ts');
    await writeFile(scriptPath, denoPluginSource());

    const exec = async (command: string, args: string[]): Promise<BackendRunResult> => {
      try {
        const { stdout, stderr } = await execFileAsync(command, args, {
          env: { ...process.env, PLUGIN_DATA_DIR: dataDir },
        });
        return { code: 0, stdout, stderr };
      } catch (error) {
        const failed = error as { code?: number; stdout?: string; stderr?: string };
        return {
          code: typeof failed.code === 'number' ? failed.code : 1,
          stdout: failed.stdout ?? '',
          stderr: failed.stderr ?? '',
        };
      }
    };

    const runner = new DenoBackendRunner({ denoBinary, exec });
    const allowedUnit: DenoBackendPluginUnit = {
      id: 'real-deno-smoke',
      kind: 'deno',
      entry: scriptPath,
      permissions: {
        allowRead: [dataDir],
        allowWrite: [dataDir],
        allowEnv: ['PLUGIN_DATA_DIR'],
      },
    };

    const allowed = await runner.run({ pluginId: 'dev.vibe-kanban.fixture-plugin', unit: allowedUnit, args: ['allowed'] });
    expect(allowed).toMatchObject({ code: 0, stderr: '' });
    expect(JSON.parse(allowed.stdout)).toEqual({ mode: 'allowed', value: 'plugin-data-ok' });

    const deniedRead = await runner.run({ pluginId: 'dev.vibe-kanban.fixture-plugin', unit: allowedUnit, args: ['deny-read'] });
    expect(deniedRead.code).not.toBe(0);
    expect(`${deniedRead.stdout}\n${deniedRead.stderr}`).toContain('NotCapable');

    const deniedEnv = await runner.run({ pluginId: 'dev.vibe-kanban.fixture-plugin', unit: allowedUnit, args: ['deny-env'] });
    expect(deniedEnv.code).not.toBe(0);
    expect(`${deniedEnv.stdout}\n${deniedEnv.stderr}`).toContain('NotCapable');

    const deniedNet = await runner.run({ pluginId: 'dev.vibe-kanban.fixture-plugin', unit: allowedUnit, args: ['deny-net'] });
    expect(deniedNet.code).not.toBe(0);
    expect(`${deniedNet.stdout}\n${deniedNet.stderr}`).toContain('NotCapable');
  }, 20_000);
});

async function findDenoBinary(): Promise<string> {
  const candidates = [
    process.env.DENO_BINARY,
    'deno',
    join(homedir(), '.deno/bin/deno'),
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidates) {
    try {
      await execFileAsync(candidate, ['--version']);
      return candidate;
    } catch {
      try {
        await access(candidate);
        return candidate;
      } catch {
        // try next candidate
      }
    }
  }

  throw new Error('Deno binary not found. Install Deno or set DENO_BINARY to run this smoke test.');
}

function denoPluginSource(): string {
  return `
const mode = Deno.args[0];
const dataDir = Deno.env.get('PLUGIN_DATA_DIR');
if (!dataDir) throw new Error('PLUGIN_DATA_DIR is required');

if (mode === 'allowed') {
  await Deno.mkdir(dataDir, { recursive: true });
  const path = dataDir + '/value.txt';
  await Deno.writeTextFile(path, 'plugin-data-ok');
  const value = await Deno.readTextFile(path);
  console.log(JSON.stringify({ mode, value }));
} else if (mode === 'deny-read') {
  await Deno.readTextFile('/etc/passwd');
} else if (mode === 'deny-env') {
  Deno.env.get('HOME');
} else if (mode === 'deny-net') {
  await fetch('https://example.com');
} else {
  throw new Error('Unknown mode: ' + mode);
}
`;
}
