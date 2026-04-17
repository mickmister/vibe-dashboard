/**
 * Returns origin without a `port-<n>.` host prefix when present.
 */
export function getBaseOrigin(): string {
  const { protocol, host } = window.location;
  const portPrefixMatch = host.match(/^port-\d+\.(.+)$/);

  if (portPrefixMatch) {
    return `${protocol}//${portPrefixMatch[1]}`;
  }

  return '';
}

export function applyUrlTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => values[key] ?? '');
}
