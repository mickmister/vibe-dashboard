export interface VdWorkspaceOpenOptionDto {
  workspaceId: string;
  displayName: string;
  branch: string;
  workspaceDir?: string;
}

export type VdWorkspaceOpenOptionsResponse =
  | { ok: true; workspaces: VdWorkspaceOpenOptionDto[] }
  | {
      ok: false;
      error: { code: string; message: string; userAction: string };
    };

export async function fetchVdWorkspaceOpenOptions(
  fetchImpl: typeof fetch = fetch,
): Promise<VdWorkspaceOpenOptionsResponse> {
  const response = await fetchImpl('/dashboard/api/vk/workspace-open-options', {
    headers: { accept: 'application/json' },
  });
  return response.json() as Promise<VdWorkspaceOpenOptionsResponse>;
}
