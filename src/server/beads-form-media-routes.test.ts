import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { registerBeadsFormMediaRoutes, resolveBeadAttachmentPath, resolvePreviewMediaPath } from './beads-form-media-routes';

describe('BeadsForm preview media routes', () => {
  it('resolves media files under the preview folder only', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'beads-form-media-'));
    await mkdir(join(folder, 'shots'));
    await writeFile(join(folder, 'shots', 'candidate.png'), 'png', 'utf8');
    await writeFile(join(folder, 'notes.exe'), 'not-supported', 'utf8');

    await expect(resolvePreviewMediaPath(folder, 'shots/candidate.png')).resolves.toMatchObject({
      ok: true,
      contentType: 'image/png',
    });
    await expect(resolvePreviewMediaPath(folder, '../secret.png')).resolves.toMatchObject({
      ok: false,
      status: 403,
    });
    await expect(resolvePreviewMediaPath(folder, 'notes.exe')).resolves.toMatchObject({
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

  it('serves bead-backed repo-relative attachment refs from the repo cwd', async () => {
    const repo = await mkdtemp(join(tmpdir(), 'beads-form-repo-'));
    await mkdir(join(repo, 'docs'), { recursive: true });
    await writeFile(join(repo, 'docs', 'decision.md'), '# Decision', 'utf8');
    await writeFile(join(repo, 'outside.md'), '# Outside', 'utf8');

    await expect(resolveBeadAttachmentPath(repo, 'docs/decision.md')).resolves.toMatchObject({
      ok: true,
      contentType: 'text/markdown; charset=utf-8',
      filename: 'decision.md',
    });
    await expect(resolveBeadAttachmentPath(repo, '../outside.md')).resolves.toMatchObject({
      ok: false,
      status: 403,
    });

    const app = new Hono();
    registerBeadsFormMediaRoutes(app);
    const response = await app.request(`/dashboard/api/beads-form/bead-attachment?dir=${encodeURIComponent(repo)}&file=${encodeURIComponent('docs/decision.md')}`);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/markdown; charset=utf-8');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    await expect(response.text()).resolves.toBe('# Decision');
  });

  it('serves explicit staging-root refs when the route declares the staging root', async () => {
    const repo = await mkdtemp(join(tmpdir(), 'beads-form-repo-'));
    const stagingRoot = await mkdtemp(join(tmpdir(), 'beads-form-staging-'));
    await mkdir(join(stagingRoot, 'exports'), { recursive: true });
    await writeFile(join(stagingRoot, 'exports', 'summary.md'), '# Staged', 'utf8');

    await expect(resolveBeadAttachmentPath(repo, 'exports/summary.md', { stagingRoot })).resolves.toMatchObject({
      ok: true,
      contentType: 'text/markdown; charset=utf-8',
      filename: 'summary.md',
    });
  });

  it('serves legacy attachment refs from .beads/attachments for compatibility', async () => {
    const repo = await mkdtemp(join(tmpdir(), 'beads-form-repo-'));
    await mkdir(join(repo, '.beads', 'attachments', 'docs'), { recursive: true });
    await writeFile(join(repo, '.beads', 'attachments', 'docs', 'decision.md'), '# Legacy', 'utf8');

    await expect(resolveBeadAttachmentPath(repo, 'attachment://docs/decision.md')).resolves.toMatchObject({
      ok: true,
      contentType: 'text/markdown; charset=utf-8',
      filename: 'decision.md',
    });
  });

  it('rejects bead-backed attachment symlinks that resolve outside allowed roots', async () => {
    const repo = await mkdtemp(join(tmpdir(), 'beads-form-repo-'));
    const outside = await mkdtemp(join(tmpdir(), 'beads-form-repo-outside-'));
    await mkdir(join(repo, 'docs'), { recursive: true });
    await writeFile(join(outside, 'outside.md'), '# Outside', 'utf8');
    await symlink(join(outside, 'outside.md'), join(repo, 'docs', 'linked.md'));

    await expect(resolveBeadAttachmentPath(repo, 'docs/linked.md')).resolves.toMatchObject({
      ok: false,
      status: 403,
    });
  });

  it('rejects unsafe bead-backed refs before filesystem access', async () => {
    const repo = await mkdtemp(join(tmpdir(), 'beads-form-repo-'));

    for (const ref of [
      '/abs/secret.md',
      '../secret.md',
      'docs/../../secret.md',
      'docs\\secret.md',
      'attachment://https://example.test/secret.md',
      'javascript:alert(1)',
      'docs/tool.exe',
    ]) {
      await expect(resolveBeadAttachmentPath(repo, ref)).resolves.toMatchObject({
        ok: false,
      });
    }
  });
});
