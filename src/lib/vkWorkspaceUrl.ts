export function buildWorkspaceFolderUrl(
  baseOrigin: string,
  containerRef: string,
): string {
  const search = new URLSearchParams({ folder: containerRef }).toString();
  return `${baseOrigin}/?${search}`;
}

export function buildWorkspaceDiffUrl(
  workspaceId: string,
  containerRef: string,
): string {
  const search = new URLSearchParams({
    workspaceId,
    workspaceDir: containerRef,
  }).toString();
  return `internal://diff?${search}`;
}
