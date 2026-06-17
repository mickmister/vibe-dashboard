import { execFile } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);

describe('plugin runtime apply script', () => {
  it('retries Caddy reload until the admin endpoint is ready', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'vd-plugin-runtime-apply-'));
    const binDir = join(tempRoot, 'bin');
    const caddyCountPath = join(tempRoot, 'caddy-count');
    await mkdir(binDir);
    await writeExecutable(join(binDir, 'node'), '#!/bin/sh\nexit 0\n');
    await writeExecutable(join(binDir, 'supervisorctl'), '#!/bin/sh\nexit 0\n');
    await writeExecutable(join(binDir, 'caddy'), `#!/bin/sh
count="$(cat "$CADDY_COUNT_PATH" 2>/dev/null || echo 0)"
count=$((count + 1))
echo "$count" > "$CADDY_COUNT_PATH"
if [ "$count" -lt 3 ]; then
  exit 1
fi
exit 0
`);

    const result = await execFileAsync('sh', [resolve(process.cwd(), 'plugins/scripts/vd-plugin-runtime-apply.sh')], {
      env: {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH ?? ''}`,
        CADDY_COUNT_PATH: caddyCountPath,
        VD_PLUGIN_CADDY_RELOAD_ATTEMPTS: '3',
        VD_PLUGIN_CADDY_RELOAD_DELAY_SECONDS: '0',
      },
    });

    await expect(readFile(caddyCountPath, 'utf8')).resolves.toBe('3\n');
    expect(result.stderr).toContain('Caddy reload failed on attempt 1/3');
    expect(result.stderr).toContain('Caddy reload failed on attempt 2/3');
  });

  it('fails after bounded Caddy reload attempts when the admin endpoint never becomes ready', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'vd-plugin-runtime-apply-fails-'));
    const binDir = join(tempRoot, 'bin');
    const caddyCountPath = join(tempRoot, 'caddy-count');
    await mkdir(binDir);
    await writeExecutable(join(binDir, 'node'), '#!/bin/sh\nexit 0\n');
    await writeExecutable(join(binDir, 'supervisorctl'), '#!/bin/sh\nexit 0\n');
    await writeExecutable(join(binDir, 'caddy'), `#!/bin/sh
count="$(cat "$CADDY_COUNT_PATH" 2>/dev/null || echo 0)"
count=$((count + 1))
echo "$count" > "$CADDY_COUNT_PATH"
exit 1
`);

    await expect(execFileAsync('sh', [resolve(process.cwd(), 'plugins/scripts/vd-plugin-runtime-apply.sh')], {
      env: {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH ?? ''}`,
        CADDY_COUNT_PATH: caddyCountPath,
        VD_PLUGIN_CADDY_RELOAD_ATTEMPTS: '3',
        VD_PLUGIN_CADDY_RELOAD_DELAY_SECONDS: '0',
      },
    })).rejects.toMatchObject({
      stderr: expect.stringContaining('Caddy reload failed after 3 attempts; generated plugin config remains on disk'),
    });

    await expect(readFile(caddyCountPath, 'utf8')).resolves.toBe('3\n');
  });
});

async function writeExecutable(path: string, content: string): Promise<void> {
  await writeFile(path, content, { mode: 0o755 });
  await chmod(path, 0o755);
}
