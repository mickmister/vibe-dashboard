function isLocalHostname(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '0.0.0.0' ||
    hostname === '[::1]'
  );
}

function getBaseHostname(hostname: string): string {
  const lowerHostname = hostname.toLowerCase();
  const withoutPortPrefix = lowerHostname.replace(/^port-\d+\./, '');

  if (isLocalHostname(withoutPortPrefix)) {
    return withoutPortPrefix;
  }

  const parts = withoutPortPrefix.split('.').filter(Boolean);
  if (parts.length <= 2) {
    return withoutPortPrefix;
  }

  return parts.slice(-2).join('.');
}

function normalizeOrigin(input: string): URL | null {
  try {
    return new URL(input);
  } catch {
    return null;
  }
}

export function getOriginTrustKey(origin: string): string | null {
  const normalized = normalizeOrigin(origin);
  if (!normalized) return null;

  return `${normalized.protocol}//${getBaseHostname(normalized.hostname)}`;
}

export function hasSameBaseOrigin(leftOrigin: string, rightOrigin: string): boolean {
  const leftKey = getOriginTrustKey(leftOrigin);
  const rightKey = getOriginTrustKey(rightOrigin);
  return Boolean(leftKey && rightKey && leftKey === rightKey);
}
