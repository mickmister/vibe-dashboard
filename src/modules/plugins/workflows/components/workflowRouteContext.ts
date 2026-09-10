export function workflowRouteHref(
  path: string,
  source?: URLSearchParams | Record<string, string | null | undefined>,
  extra?: Record<string, string | null | undefined>,
): string {
  const [maybeBase, existingQuery = ''] = path.split('?');
  const base = maybeBase ?? path;
  const params = new URLSearchParams(existingQuery);
  if (source instanceof URLSearchParams) {
    source.forEach((value, key) => {
      if (value) params.set(key, value);
    });
  } else if (source) {
    for (const [key, value] of Object.entries(source)) {
      if (value) params.set(key, value);
    }
  }
  for (const [key, value] of Object.entries(extra ?? {})) {
    if (value == null || value === '') params.delete(key);
    else params.set(key, value);
  }
  const query = params.toString();
  return query ? `${base}?${query}` : base;
}
