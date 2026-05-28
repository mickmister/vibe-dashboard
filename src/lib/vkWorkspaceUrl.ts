export function buildWorkspaceFolderUrl(
  baseOrigin: string,
  containerRef: string,
): string {
  const search = new URLSearchParams({ folder: containerRef }).toString();
  return `${baseOrigin}/?${search}`;
}
