import { readFile, realpath, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import type { Hono } from 'hono';

const MEDIA_TYPES: Record<string, string> = {
  '.gif': 'image/gif',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
};

export function registerBeadsFormMediaRoutes(app: Hono): void {
  app.get('/dashboard/api/beads-form/preview-media', async (c) => {
    const folder = c.req.query('folder') ?? '';
    const file = c.req.query('file') ?? '';
    const resolved = await resolvePreviewMediaPath(folder, file);
    if (!resolved.ok) return c.text(resolved.error, resolved.status);

    const bytes = await readFile(resolved.path);
    return c.body(bytes, 200, {
      'Content-Type': resolved.contentType,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
  });
}

export type ResolvePreviewMediaPathResult =
  | { ok: true; path: string; contentType: string }
  | { ok: false; status: 400 | 403 | 404 | 415; error: string };

export async function resolvePreviewMediaPath(folder: string, file: string): Promise<ResolvePreviewMediaPathResult> {
  if (!folder.trim()) return { ok: false, status: 400, error: 'folder is required' };
  if (!file.trim()) return { ok: false, status: 400, error: 'file is required' };

  const folderPath = resolve(folder);
  let folderReal: string;
  try {
    folderReal = await realpath(folderPath);
  } catch {
    return { ok: false, status: 404, error: 'preview folder not found' };
  }

  const filePath = resolve(folderReal, file.replace(/^attachment:\/\//, ''));
  if (!isPathInside(folderReal, filePath)) {
    return { ok: false, status: 403, error: 'media file must be inside the preview folder' };
  }

  let fileReal: string;
  try {
    fileReal = await realpath(filePath);
  } catch {
    return { ok: false, status: 404, error: 'media file not found' };
  }

  if (!isPathInside(folderReal, fileReal)) {
    return { ok: false, status: 403, error: 'media file must be inside the preview folder' };
  }

  const contentType = MEDIA_TYPES[extname(fileReal).toLowerCase()];
  if (!contentType) return { ok: false, status: 415, error: 'unsupported media type' };

  try {
    const fileStat = await stat(fileReal);
    if (!fileStat.isFile()) return { ok: false, status: 404, error: 'media file not found' };
  } catch {
    return { ok: false, status: 404, error: 'media file not found' };
  }

  return { ok: true, path: fileReal, contentType };
}

function isPathInside(parent: string, child: string): boolean {
  return child === parent || child.startsWith(parent.endsWith(sep) ? parent : `${parent}${sep}`);
}
