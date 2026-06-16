import { describe, expect, it } from 'vitest';
import type { TabGroup, WorkspaceState } from '../types';
import {
  BUILT_IN_AGENT_CODE_PAIR_ID,
  BUILT_IN_AGENT_DIFF_PAIR_ID,
  BUILT_IN_AGENT_TAB_ID,
  BUILT_IN_CODE_TAB_ID,
  BUILT_IN_DIFF_TAB_ID,
  getEffectivePairs,
  getEffectiveTabs,
  migrateWorkspaceBuiltInTabs,
} from './builtInWorkspaceTabs';

describe('built-in workspace tabs', () => {
  it('adds built-in Agent, Code, and Diff tabs from workspace metadata', () => {
    const tabGroup = {
      id: 'tg_1',
      label: 'Workspace',
      workspace: {
        workspaceId: 'attempt-1',
        workspaceDir: '/tmp/workspace',
        baseOrigin: 'https://workspace.example',
      },
      tabs: [{ id: 'tab_custom', title: 'Docs', url: 'https://example.com' }],
      pairs: [],
      order: 0,
    } satisfies TabGroup;

    expect(getEffectiveTabs(tabGroup)).toEqual([
      {
        id: BUILT_IN_AGENT_TAB_ID,
        title: 'Agent',
        url: 'https://workspace.example/workspaces/attempt-1',
        pinned: true,
      },
      {
        id: BUILT_IN_CODE_TAB_ID,
        title: 'Code',
        url: 'https://workspace.example/?folder=%2Ftmp%2Fworkspace',
        pinned: true,
      },
      {
        id: BUILT_IN_DIFF_TAB_ID,
        title: 'Diff',
        url: 'internal://diff?workspaceId=attempt-1&workspaceDir=%2Ftmp%2Fworkspace',
        pinned: true,
      },
      { id: 'tab_custom', title: 'Docs', url: 'https://example.com' },
    ]);
  });

  it('derives built-ins from old persisted Agent and Code tabs', () => {
    const tabGroup = {
      id: 'tg_1',
      label: 'Workspace',
      tabs: [
        { id: 'old_agent', title: 'Agent', url: '/workspaces/attempt-1' },
        { id: 'old_code', title: 'Code', url: '/?folder=/tmp/workspace' },
      ],
      pairs: [],
      order: 0,
    } satisfies TabGroup;

    expect(getEffectiveTabs(tabGroup).map((tab) => tab.id)).toEqual([
      BUILT_IN_AGENT_TAB_ID,
      BUILT_IN_CODE_TAB_ID,
      BUILT_IN_DIFF_TAB_ID,
    ]);
    expect(getEffectivePairs(tabGroup).map((pair) => pair.id)).toEqual([
      BUILT_IN_AGENT_CODE_PAIR_ID,
      BUILT_IN_AGENT_DIFF_PAIR_ID,
    ]);
  });

  it('hides stale persisted pairs that reference migrated built-in tab ids', () => {
    const tabGroup = {
      id: 'tg_1',
      label: 'Workspace',
      workspace: {
        workspaceId: 'attempt-1',
        workspaceDir: '/tmp/workspace',
      },
      tabs: [
        { id: 'old_agent', title: 'Agent', url: '/workspaces/attempt-1' },
        { id: 'old_code', title: 'Code', url: '/?folder=/tmp/workspace' },
        { id: 'tab_custom', title: 'Docs', url: 'https://example.com' },
      ],
      pairs: [
        {
          id: 'old_pair',
          tabIds: ['old_agent', 'old_code'],
          ratios: [50, 50],
        },
        {
          id: 'custom_pair',
          tabIds: ['tab_custom'],
          ratios: [100],
        },
      ],
      order: 0,
    } satisfies TabGroup;

    expect(getEffectivePairs(tabGroup).map((pair) => pair.id)).toEqual([
      BUILT_IN_AGENT_CODE_PAIR_ID,
      BUILT_IN_AGENT_DIFF_PAIR_ID,
      'custom_pair',
    ]);
  });

  it('migrates old persisted workspace tabs and pairs into metadata', () => {
    const workspace = {
      spaces: [
        {
          id: 'space_home',
          name: 'Home',
          icon: 'home',
          tabGroupIds: ['tg_1'],
        },
      ],
      tabGroups: [
        {
          id: 'tg_1',
          label: 'Workspace',
          tabs: [
            { id: 'old_agent', title: 'Agent', url: '/workspaces/attempt-1' },
            { id: 'old_code', title: 'Code', url: '/?folder=/tmp/workspace' },
            { id: 'diff', title: 'Diff', url: 'internal://diff' },
            { id: 'tab_custom', title: 'Docs', url: 'https://example.com' },
          ],
          pairs: [
            {
              id: 'old_pair',
              tabIds: ['old_agent', 'old_code'],
              ratios: [50, 50],
            },
            {
              id: 'custom_pair',
              tabIds: ['tab_custom'],
              ratios: [100],
            },
          ],
          order: 0,
        },
      ],
      nextId: 10,
    } satisfies WorkspaceState;

    const migrated = migrateWorkspaceBuiltInTabs(workspace);
    expect(migrated).not.toBe(workspace);
    expect(migrated.tabGroups[0]).toMatchObject({
      workspace: {
        workspaceId: 'attempt-1',
        workspaceDir: '/tmp/workspace',
        baseOrigin: '',
      },
      tabs: [{ id: 'tab_custom', title: 'Docs', url: 'https://example.com' }],
      pairs: [{ id: 'custom_pair', tabIds: ['tab_custom'], ratios: [100] }],
    });
  });
});
