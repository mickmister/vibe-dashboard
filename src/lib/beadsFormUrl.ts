export function normalizeBeadsFormQueryId(value: string | null | undefined): string | undefined {
  if (value === null || value === undefined) return undefined;
  const normalized = value.replace(/\\_/g, '_');
  return normalized || undefined;
}
