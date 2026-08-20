export const DEFAULT_VD_SITE_ORIGIN = 'https://jamtools.dev';

export function normalizeVdSiteOrigin(value: string | undefined | null): string {
  const trimmed = value?.trim().replace(/\/+$/, '') ?? '';
  if (!trimmed) return DEFAULT_VD_SITE_ORIGIN;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return DEFAULT_VD_SITE_ORIGIN;
    return url.origin;
  } catch {
    return DEFAULT_VD_SITE_ORIGIN;
  }
}

export function buildVdWorkspacePath(workspaceId: string): string {
  return `/dashboard/workspaces/${encodeURIComponent(workspaceId)}`;
}

export function buildVdWorkspaceUrl(workspaceId: string, siteOrigin?: string | null): string {
  return `${normalizeVdSiteOrigin(siteOrigin)}${buildVdWorkspacePath(workspaceId)}`;
}

export function isValidVdWorkspaceId(value: string | undefined | null): value is string {
  return Boolean(value && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value));
}
