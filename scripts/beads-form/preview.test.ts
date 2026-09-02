import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildBeadsFormPreviewUrl, parsePreviewArgs, resolvePreviewConfig } from './preview';

describe('beads-form preview script helpers', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('parses --folder style arguments and legacy positional folders', () => {
    expect(parsePreviewArgs(['--folder', '/tmp/forms', '--port', '55743', '--server-port=55744', '--print-only'])).toEqual({
      formsDir: '/tmp/forms',
      port: '55743',
      serverPort: '55744',
      printOnly: true,
    });
    expect(parsePreviewArgs(['/tmp/forms'])).toEqual({ formsDir: '/tmp/forms' });
  });

  it('builds a folder-preview URL with an encoded absolute folder', () => {
    expect(buildBeadsFormPreviewUrl({
      origin: 'http://localhost:5173/',
      formsDir: '/tmp/forms with spaces',
    })).toBe('http://localhost:5173/dashboard/forms/preview?folder=%2Ftmp%2Fforms+with+spaces');
  });

  it('validates the forms folder and returns the preview config', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'beads-form-preview-'));
    const config = await resolvePreviewConfig({
      formsDir: folder,
      port: '55123',
      serverPort: '55124',
      host: 'https://port-55123.jamtools.dev',
    });

    expect(config).toEqual({
      formsDir: folder,
      port: '55123',
      serverPort: '55124',
      url: `https://port-55123.jamtools.dev/dashboard/forms/preview?folder=${encodeURIComponent(folder)}`,
    });
  });

  it('does not reuse an ambient PORT unless the BeadsForm preview port is explicit', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'beads-form-preview-'));
    vi.stubEnv('PORT', '12345');
    vi.stubEnv('BEADS_FORM_PREVIEW_PORT', '55125');

    const config = await resolvePreviewConfig({
      formsDir: folder,
      serverPort: '55126',
      host: 'http://localhost:55125',
    });

    expect(config.port).toBe('55125');
    expect(config.url).toContain('http://localhost:55125/dashboard/forms/preview');
  });

  it('rejects missing or non-directory folders', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'beads-form-preview-'));
    const file = join(folder, 'form.json');
    await writeFile(file, '{}', 'utf8');

    await expect(resolvePreviewConfig({ formsDir: file, port: '1', serverPort: '2' })).rejects.toThrow('not a directory');
  });
});
