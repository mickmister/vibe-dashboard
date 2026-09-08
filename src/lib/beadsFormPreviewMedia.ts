const MEDIA_ROUTE = '/dashboard/api/beads-form/preview-media';

export function buildPreviewMediaUrl(folder: string, ref: string): string {
  const params = new URLSearchParams();
  params.set('folder', folder);
  params.set('file', ref.startsWith('attachment://') ? ref.slice('attachment://'.length) : ref);
  return `${MEDIA_ROUTE}?${params.toString()}`;
}

export function isFolderPreviewMediaRef(ref: string): boolean {
  const trimmed = ref.trim();
  if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('/') || trimmed.startsWith('//')) return false;
  if (trimmed.startsWith('attachment://')) return true;
  return !/^[a-z][a-z0-9+.-]*:/i.test(trimmed);
}

export function rewriteFolderPreviewMediaRefs(html: string, folder: string): string {
  if (typeof DOMParser === 'undefined') return html;
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  const rewriteAttribute = (element: Element, attrName: string) => {
    const value = element.getAttribute(attrName);
    if (!value || !isFolderPreviewMediaRef(value)) return;
    element.setAttribute(attrName, buildPreviewMediaUrl(folder, value));
  };

  for (const element of Array.from(parsed.body.querySelectorAll('img[src], video[src]'))) {
    rewriteAttribute(element, 'src');
  }
  for (const element of Array.from(parsed.body.querySelectorAll('video[poster]'))) {
    rewriteAttribute(element, 'poster');
  }

  return parsed.body.innerHTML;
}
