import { readFile, realpath, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import type { Hono } from 'hono';
import { normalizeBeadsFormAttachmentRef, normalizeRepoRelativeAttachmentPath } from '../lib/beadsFormAttachmentRefs';

const MEDIA_TYPES: Record<string, string> = {
  '.gif': 'image/gif',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
};

const ATTACHMENT_TYPES: Record<string, string> = {
  ...MEDIA_TYPES,
  '.md': 'text/markdown; charset=utf-8',
  '.markdown': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.log': 'text/plain; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
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

  app.get('/dashboard/api/beads-form/bead-attachment', async (c) => {
    const dir = c.req.query('dir') ?? '';
    const file = c.req.query('file') ?? '';
    const resolved = await resolveBeadAttachmentPath(dir, file);
    if (!resolved.ok) return c.text(resolved.error, resolved.status);

    const bytes = await readFile(resolved.path);
    return c.body(bytes, 200, {
      'Content-Type': resolved.contentType,
      'Cache-Control': 'no-store',
      'Content-Disposition': `inline; filename="${resolved.filename.replace(/["\\]/g, '_')}"`,
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

  let normalizedFile: string;
  try {
    normalizedFile = normalizeRepoRelativeAttachmentPath(file.replace(/^attachment:\/\//i, ''));
  } catch (error) {
    return { ok: false, status: 403, error: error instanceof Error ? error.message : String(error) };
  }
  const filePath = resolve(folderReal, normalizedFile);
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

  const contentType = ATTACHMENT_TYPES[extname(fileReal).toLowerCase()];
  if (!contentType) return { ok: false, status: 415, error: 'unsupported attachment type' };

  try {
    const fileStat = await stat(fileReal);
    if (!fileStat.isFile()) return { ok: false, status: 404, error: 'media file not found' };
  } catch {
    return { ok: false, status: 404, error: 'media file not found' };
  }

  return { ok: true, path: fileReal, contentType };
}

export type ResolveBeadAttachmentPathResult =
  | { ok: true; path: string; contentType: string; filename: string }
  | { ok: false; status: 400 | 403 | 404 | 415; error: string };

export async function resolveBeadAttachmentPath(
  dir: string,
  file: string,
  options: { stagingRoot?: string } = {},
): Promise<ResolveBeadAttachmentPathResult> {
  if (!dir.trim()) return { ok: false, status: 400, error: 'dir is required' };
  if (!file.trim()) return { ok: false, status: 400, error: 'file is required' };

  const repoPath = resolve(dir);
  let normalized;
  try {
    normalized = normalizeBeadsFormAttachmentRef(file, 'file');
  } catch (error) {
    return { ok: false, status: 403, error: error instanceof Error ? error.message : String(error) };
  }
  if (normalized.kind === 'hosted' || !normalized.path) {
    return { ok: false, status: 403, error: 'bead attachment must be a repo-relative ref' };
  }

  const rootCandidates = normalized.kind === 'legacy-attachment'
    ? [resolve(repoPath, '.beads', 'attachments')]
    : [repoPath, ...(options.stagingRoot ? [options.stagingRoot] : [])];

  for (const rootCandidate of rootCandidates) {
    const resolved = await resolveAttachmentUnderRoot(rootCandidate, normalized.path, normalized.kind === 'legacy-attachment' ? 'legacy bead attachments folder' : 'allowed attachment root');
    if (resolved.ok) {
      return {
        ...resolved,
        filename: normalized.path.split('/').filter(Boolean).at(-1) ?? 'attachment',
      };
    }
    if (resolved.status !== 404) return resolved;
  }

  return { ok: false, status: 404, error: 'bead attachment not found' };
}

async function resolveAttachmentUnderRoot(
  root: string,
  path: string,
  rootLabel: string,
): Promise<ResolveBeadAttachmentPathResult> {
  let rootReal: string;
  try {
    rootReal = await realpath(resolve(root));
  } catch {
    return { ok: false, status: 404, error: `${rootLabel} not found` };
  }
  const filePath = resolve(rootReal, path);
  if (!isPathInside(rootReal, filePath)) {
    return { ok: false, status: 403, error: `bead attachment must be inside ${rootLabel}` };
  }
  let fileReal: string;
  try {
    fileReal = await realpath(filePath);
  } catch {
    return { ok: false, status: 404, error: 'bead attachment not found' };
  }

  if (!isPathInside(rootReal, fileReal)) {
    return { ok: false, status: 403, error: `bead attachment must be inside ${rootLabel}` };
  }

  const contentType = ATTACHMENT_TYPES[extname(fileReal).toLowerCase()];
  if (!contentType) return { ok: false, status: 415, error: 'unsupported attachment type' };

  try {
    const fileStat = await stat(fileReal);
    if (!fileStat.isFile()) return { ok: false, status: 404, error: 'bead attachment not found' };
  } catch {
    return { ok: false, status: 404, error: 'bead attachment not found' };
  }

  return {
    ok: true,
    path: fileReal,
    contentType,
    filename: path.split('/').filter(Boolean).at(-1) ?? 'attachment',
  };
}

function isPathInside(parent: string, child: string): boolean {
  return child === parent || child.startsWith(parent.endsWith(sep) ? parent : `${parent}${sep}`);
}
