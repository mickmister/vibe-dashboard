import {
  getExternalIntegrationsDb,
  type ExternalIntegrationsDbHandle,
} from '../modules/plugins/kanban/server/database';
import type { DataMigrationDependencies } from '../store/db/data_migrations/runner';
import { getPluginRegistrySnapshot } from '../modules/plugins/vibe-dashboard/registry';
import type { Craft } from '../types';
import type { LegacyTargetContextForCraft } from '../store/db/data_migrations/20260917100000_migrate_legacy_voyages';
import type { PanelTargetResolutionContext } from '../store/panelTargetRegistry';
import type { VoyagePersistenceAuthorityHandle } from '../store/voyagePersistenceAuthority';
import {
  dockviewM32HarnessWorkspaceId,
} from './DockviewM32HarnessFixture';
import { dockviewM32HarnessCraftId } from './DockviewM32HarnessWorkspace';

export const dockviewM32HarnessStartupFlag = 'VD_DOCKVIEW_M3_2_HARNESS';

export function isDockviewM32HarnessStartupEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env[dockviewM32HarnessStartupFlag] === '1';
}

export function createDockviewM32HarnessTargetContextForCraft(
  env: Record<string, string | undefined> = process.env,
): LegacyTargetContextForCraft {
  const hostOrigin = env.VITE_VK_BASE_ORIGIN || env.VK_MOCKED_VD_URL || 'http://127.0.0.1:3005';
  return (craft: Craft, workspaceId: string): PanelTargetResolutionContext | null => {
    if (workspaceId !== dockviewM32HarnessWorkspaceId || craft.id !== dockviewM32HarnessCraftId || craft.workspace?.workspaceId !== workspaceId) return null;
    const plugins = getPluginRegistrySnapshot();
    return {
      craftId: dockviewM32HarnessCraftId,
      hostOrigin,
      crafts: { [dockviewM32HarnessCraftId]: { workspaceId, allowedPluginTargets: [] } },
      workspaces: {
        [workspaceId]: {
          id: workspaceId,
          available: true,
          directory: craft.workspace.workspaceDir || '/tmp/dockview-m3-2-harness',
          origin: hostOrigin,
          repositoryIds: [],
          locations: {
            overview: `/workspaces/${workspaceId}`,
            code: `/workspaces/${workspaceId}/vscode`,
            changes: `/workspaces/${workspaceId}/changes`,
            beads: `/workspaces/${workspaceId}/beads`,
            forms: `/workspaces/${workspaceId}/forms`,
          },
        },
      },
      agentSessions: {},
      terminals: {},
      previews: {},
      builtInRoutes: {},
      redirectGuards: Object.fromEntries(['craft-overview', 'code', 'changes', 'beads', 'forms']
        .map((kind) => [`${kind}:${workspaceId}`, { deliveryUrl: `${hostOrigin}/internal/panel-target/workspaces/${workspaceId}/${kind}`, upstreamOrigin: hostOrigin }])),
      getPluginRegistry: () => plugins,
    };
  };
}

export function dockviewM32HarnessDataMigrationDependencies(
  env: Record<string, string | undefined> = process.env,
): DataMigrationDependencies | undefined {
  return isDockviewM32HarnessStartupEnabled(env)
    ? { services: { legacyTargetContextForCraft: createDockviewM32HarnessTargetContextForCraft(env) } }
    : undefined;
}

export async function initializeDockviewM32HarnessVoyageAuthority(
  openDatabase: (legacyTargetContextForCraft: LegacyTargetContextForCraft) => Promise<ExternalIntegrationsDbHandle> = (legacyTargetContextForCraft) =>
    getExternalIntegrationsDb({ services: { legacyTargetContextForCraft } }),
  env: Record<string, string | undefined> = process.env,
): Promise<VoyagePersistenceAuthorityHandle> {
  const legacyTargetContextForCraft = createDockviewM32HarnessTargetContextForCraft(env);
  const handle = await openDatabase(legacyTargetContextForCraft);
  return Object.assign(handle, { legacyTargetContextForCraft });
}
