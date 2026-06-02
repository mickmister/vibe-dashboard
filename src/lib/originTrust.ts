function isLocalHostname(hostname: string): boolean {
  const normalizedHostname = normalizeHostname(hostname);
  return (
    normalizedHostname === 'localhost' ||
    normalizedHostname === '127.0.0.1' ||
    normalizedHostname === '0.0.0.0' ||
    normalizedHostname === '::1'
  );
}

function normalizeHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/^\[(.*)]$/, '$1');
}

function isIpHostname(hostname: string): boolean {
  const normalizedHostname = normalizeHostname(hostname);

  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(normalizedHostname)) {
    return normalizedHostname.split('.').every((segment) => {
      const value = Number(segment);
      return Number.isInteger(value) && value >= 0 && value <= 255;
    });
  }

  return normalizedHostname.includes(':');
}

function getBaseHostname(hostname: string): string {
  const lowerHostname = normalizeHostname(hostname);
  const withoutPortPrefix = lowerHostname.replace(/^port-\d+\./, '');

  if (isLocalHostname(withoutPortPrefix) || isIpHostname(withoutPortPrefix)) {
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
