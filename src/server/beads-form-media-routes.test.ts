import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { registerBeadsFormMediaRoutes, resolvePreviewMediaPath } from './beads-form-media-routes';

describe('BeadsForm preview media routes', () => {
  it('resolves media files under the preview folder only', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'beads-form-media-'));
    await mkdir(join(folder, 'shots'));
    await writeFile(join(folder, 'shots', 'candidate.png'), 'png', 'utf8');
    await writeFile(join(folder, 'notes.txt'), 'not-media', 'utf8');

    await expect(resolvePreviewMediaPath(folder, 'shots/candidate.png')).resolves.toMatchObject({
      ok: true,
      contentType: 'image/png',
    });
    await expect(resolvePreviewMediaPath(folder, '../secret.png')).resolves.toMatchObject({
      ok: false,
      status: 403,
    });
    await expect(resolvePreviewMediaPath(folder, 'notes.txt')).resolves.toMatchObject({
      ok: false,
      status: 415,
    });
  });

  it('serves allowlisted preview media with nosniff headers', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'beads-form-media-'));
    await writeFile(join(folder, 'candidate.webp'), 'webp-bytes', 'utf8');
    const app = new Hono();
    registerBeadsFormMediaRoutes(app);

    const response = await app.request(`/dashboard/api/beads-form/preview-media?folder=${encodeURIComponent(folder)}&file=candidate.webp`);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/webp');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    await expect(response.text()).resolves.toBe('webp-bytes');
  });

  it('rejects symlinks that resolve outside the preview folder', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'beads-form-media-'));
    const outside = await mkdtemp(join(tmpdir(), 'beads-form-media-outside-'));
    await mkdir(join(folder, 'shots'));
    await writeFile(join(outside, 'outside.png'), 'outside', 'utf8');
    await symlink(join(outside, 'outside.png'), join(folder, 'shots', 'linked.png'));

    await expect(resolvePreviewMediaPath(folder, 'shots/linked.png')).resolves.toMatchObject({
      ok: false,
      status: 403,
    });
  });
});
