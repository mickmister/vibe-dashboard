/* eslint-disable formatjs/no-literal-string-in-object -- QA harness fixtures use exact product labels. */
import type { WorkspaceState } from '../types';
import { dockviewM32HarnessWorkspaceId } from './DockviewM32HarnessFixture';

export const dockviewM32HarnessCraftId = 'craft-a';

export function createDockviewM32HarnessWorkspace(): WorkspaceState {
  return {
    spaces: [{
      id: 'space_home',
      name: 'Home',
      icon: 'home',
      tabGroupIds: [dockviewM32HarnessCraftId],
      isSystem: true,
    }],
    tabGroups: [{
      id: dockviewM32HarnessCraftId,
      label: 'DockView QA Craft',
      workspace: {
        workspaceId: dockviewM32HarnessWorkspaceId,
        workspaceDir: '/tmp/dockview-m3-2-harness',
      },
      tabs: [{
        id: 'craft-overview',
        title: 'Panel',
        url: `/workspaces/${dockviewM32HarnessWorkspaceId}`,
        pinned: true,
      }],
      pairs: [],
      order: 0,
      createdAt: '2026-01-01T00:00:00.000Z',
      lastVisitedAt: '2026-01-01T00:00:00.000Z',
    }],
    nextId: 10,
  };
}
