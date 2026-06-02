import type { Craft, SavedWorkspaceSession, VoyageEntry } from '../types';

function slugifyPart(value: string): string {
  const normalized = value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || 'item';
}

function getIdSuffix(id: string): string {
  const parts = id.split(/[_-]/).filter(Boolean);
  return parts[parts.length - 1] || id;
}

export function buildVoyageSlug(label: string | undefined, id: string): string {
  return `${slugifyPart(label || 'voyage')}-${id}`;
}

export function getVoyageSlug(session: SavedWorkspaceSession): string {
  return session.slug || buildVoyageSlug(session.name, session.id);
}

export function buildCraftParam(
  tabGroup: Craft | undefined,
  entry: VoyageEntry | undefined,
): string | null {
  if (!(tabGroup && entry)) return null;
  return `${slugifyPart(tabGroup.label)}-${getIdSuffix(tabGroup.id)}-${getIdSuffix(entry.id)}`;
}

export function parseCraftParam(value: string | null | undefined): {
  tabGroupSuffix: string;
  entrySuffix: string;
} | null {
  if (!value) return null;
  const parts = value.split('-').filter(Boolean);
  if (parts.length < 3) return null;
  const entrySuffix = parts[parts.length - 1];
  const tabGroupSuffix = parts[parts.length - 2];
  if (!(tabGroupSuffix && entrySuffix)) return null;
  return { tabGroupSuffix, entrySuffix };
}

export function buildViewParam(label: string, id: string): string {
  return `${slugifyPart(label)}-${getIdSuffix(id)}`;
}

export function parseViewParam(value: string | null | undefined): string | null {
  if (!value) return null;
  const parts = value.split('-').filter(Boolean);
  return parts[parts.length - 1] || null;
}

export function parseViewsParam(value: string | null | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((entry) => parseViewParam(entry.trim()))
    .filter((entry): entry is string => Boolean(entry));
}
