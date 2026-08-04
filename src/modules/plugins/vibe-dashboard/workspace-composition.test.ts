import { describe, expect, it } from 'vitest';
import { resolveWorkspaceFactoryComposition } from './workspace-composition';
import type { TabGroupFactoryContribution } from './types';

const factory: TabGroupFactoryContribution = {
  key: 'open-existing-workspace',
  title: 'Open Existing Workspace',
  description: 'Add workspace with Agent + Code split view',
  launchMode: 'vk-workspace',
  workspaceComposition: {
    primaryTabKey: 'agent',
    defaultPairTabKeys: ['agent', 'code'],
    tabs: [
      { key: 'agent', title: 'Agent', urlTemplate: '{{origin}}/workspaces/{{workspaceId}}' },
      { key: 'code', title: 'Code', urlTemplate: '{{origin}}/?folder={{containerRef}}' },
    ],
  },
};

describe('plugin-owned workspace composition', () => {
  it('resolves a plugin factory composition into serializable host action data', () => {
    expect(
      resolveWorkspaceFactoryComposition({
        factory,
        context: {
          origin: 'https://vd.example.test',
          workspaceId: 'workspace-1',
          workspaceName: 'Plugin System',
          containerRef: '/home/vkuser/repos/plugin-system',
        },
      }),
    ).toEqual({
      primaryTabKey: 'agent',
      pairTabKeys: ['agent', 'code'],
      tabs: [
        { key: 'agent', title: 'Agent', url: 'https://vd.example.test/workspaces/workspace-1' },
        { key: 'code', title: 'Code', url: 'https://vd.example.test/?folder=/home/vkuser/repos/plugin-system' },
      ],
    });
  });

  it('rejects factories without serializable workspace composition', () => {
    expect(() =>
      resolveWorkspaceFactoryComposition({
        factory: { ...factory, workspaceComposition: undefined },
        context: {
          origin: 'https://vd.example.test',
          workspaceId: 'workspace-1',
          workspaceName: 'Plugin System',
          containerRef: '/home/vkuser/repos/plugin-system',
        },
      }),
    ).toThrow('does not declare a workspace composition');
  });
});
