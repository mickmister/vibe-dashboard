const IMAGE_EXTENSIONS = new Set(['.gif', '.jpg', '.jpeg', '.png', '.webp']);
const VIDEO_EXTENSIONS = new Set(['.mp4', '.webm']);
const MARKDOWN_EXTENSIONS = new Set(['.md', '.markdown']);
const TEXT_ATTACHMENT_EXTENSIONS = new Set(['.txt', '.log', '.json']);

export const BEADS_FORM_ATTACHMENT_EXTENSIONS = new Set([
  ...IMAGE_EXTENSIONS,
  ...VIDEO_EXTENSIONS,
  ...MARKDOWN_EXTENSIONS,
  ...TEXT_ATTACHMENT_EXTENSIONS,
]);

export type BeadsFormAttachmentRefUsage = 'image' | 'video' | 'markdown' | 'file';

export type NormalizedBeadsFormAttachmentRef = {
  kind: 'repo-relative' | 'legacy-attachment' | 'hosted';
  ref: string;
  path?: string;
};

export function normalizeBeadsFormAttachmentRef(
  value: string,
  usage: BeadsFormAttachmentRefUsage,
): NormalizedBeadsFormAttachmentRef {
  const trimmed = value.trim();
  if (!trimmed) throw new Error('attachment ref is required');
  if (isHostedHttpRef(trimmed)) return { kind: 'hosted', ref: trimmed };
  const legacyPrefix = /^attachment:\/\//i;
  const legacy = legacyPrefix.test(trimmed);
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed) && !legacy) {
    throw new Error(`unsupported attachment ref protocol: ${trimmed}`);
  }
  const path = normalizeRepoRelativeAttachmentPath(legacy ? trimmed.replace(legacyPrefix, '') : trimmed);
  assertAllowedAttachmentExtension(path, usage);
  return { kind: legacy ? 'legacy-attachment' : 'repo-relative', ref: trimmed, path };
}

export function normalizeRepoRelativeAttachmentPath(value: string): string {
  let normalized = value.trim().replace(/^\.\//, '');
  if (!normalized) throw new Error('attachment ref path is required');
  if (normalized.startsWith('/') || normalized.startsWith('\\') || normalized.startsWith('//')) {
    throw new Error(`attachment ref must be repo-relative: ${value}`);
  }
  if (normalized.includes('\\')) throw new Error(`attachment ref must use forward slashes: ${value}`);
  if (/^[a-z][a-z0-9+.-]*:/i.test(normalized)) {
    throw new Error(`attachment ref must not contain a nested scheme: ${value}`);
  }
  const segments = normalized.split('/');
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    throw new Error(`attachment ref must not traverse directories: ${value}`);
  }
  normalized = segments.join('/');
  return normalized;
}

export function attachmentExtensionForPath(path: string): string {
  const basename = path.split('/').at(-1) ?? path;
  const dot = basename.lastIndexOf('.');
  return dot >= 0 ? basename.slice(dot).toLowerCase() : '';
}

function isHostedHttpRef(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function assertAllowedAttachmentExtension(path: string, usage: BeadsFormAttachmentRefUsage): void {
  const ext = attachmentExtensionForPath(path);
  const allowed = usage === 'image'
    ? IMAGE_EXTENSIONS
    : usage === 'video'
      ? VIDEO_EXTENSIONS
      : usage === 'markdown'
        ? MARKDOWN_EXTENSIONS
        : BEADS_FORM_ATTACHMENT_EXTENSIONS;
  if (!allowed.has(ext)) {
    throw new Error(`unsupported ${usage} attachment type for ref "${path}"`);
  }
}
