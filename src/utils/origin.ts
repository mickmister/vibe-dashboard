/**
 * Returns the configured app base origin when provided.
 * Falls back to a relative origin so generated URLs stay deployment-agnostic.
 */
export function getBaseOrigin(): string {
  const env = (import.meta as ImportMeta & {
    env?: Record<string, string | undefined>;
  }).env;

  return env?.VITE_VK_BASE_ORIGIN || '';
}

export function applyUrlTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => values[key] ?? '');
}
