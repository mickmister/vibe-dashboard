import type { Hono } from 'hono';
import { VibeKanbanServerClient, type Workspace } from './vk-client';

export function registerVkWorkspaceRoutes(
  hono: Hono,
  options: {
    vkClient?: Pick<VibeKanbanServerClient, 'getWorkspaces'>;
  } = {},
): void {
  const vkClient = options.vkClient ?? new VibeKanbanServerClient();

  hono.get('/dashboard/api/vk/workspace-open-options', async (c) => {
    try {
      const workspaces = (await vkClient.getWorkspaces())
        .filter((workspace) => !workspace.archived)
        .map(workspaceToOpenOption)
        .sort((left, right) => left.displayName.localeCompare(right.displayName));
      return c.json({ ok: true, workspaces });
    } catch {
      return c.json({
        ok: false,
        error: {
          code: 'vk_workspace_open_options_failed',
          message: 'Could not load VK workspaces.',
          userAction: 'Verify the VK server is running and try again.',
        },
      }, 502);
    }
  });
}

function workspaceToOpenOption(workspace: Workspace): {
  workspaceId: string;
  displayName: string;
  branch: string;
  workspaceDir?: string;
} {
  return {
    workspaceId: workspace.id,
    displayName: workspace.name || workspace.branch || workspace.id,
    branch: workspace.branch,
    workspaceDir: workspace.agent_working_dir || undefined,
  };
}
