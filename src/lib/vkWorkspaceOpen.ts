import { vkClient } from './vk-client';

export async function resolveWorkspaceContainerRef(
  workspaceId: string,
  fallbackContainerRef: string | null | undefined,
): Promise<string> {
  if (!workspaceId) {
    return fallbackContainerRef || '';
  }

  try {
    await vkClient.getWorkspaceBranchStatus(workspaceId);
    const workspace = await vkClient.getWorkspace(workspaceId);
    return workspace.container_ref || fallbackContainerRef || '';
  } catch {
    return fallbackContainerRef || '';
  }
}

export function buildWorkspaceFolderUrl(
  baseOrigin: string,
  containerRef: string,
): string {
  const search = new URLSearchParams({ folder: containerRef }).toString();
  return `${baseOrigin}/?${search}`;
}
