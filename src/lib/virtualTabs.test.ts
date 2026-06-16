import { describe, expect, it } from 'vitest';
import type { TabGroup } from '../types';
import { DIFF_TAB_ID, getTabsWithVirtualDiff } from './virtualTabs';

describe('getTabsWithVirtualDiff', () => {
  it('adds a virtual Diff tab when a craft has Agent and Code workspace metadata', () => {
    const tabGroup = {
      id: 'tg_1',
      label: 'Workspace',
      tabs: [
        { id: 'agent', title: 'Agent', url: '/workspaces/attempt-1' },
        { id: 'code', title: 'Code', url: '/?folder=/tmp/workspace' },
      ],
      pairs: [],
      order: 0,
    } satisfies TabGroup;

    expect(getTabsWithVirtualDiff(tabGroup).at(-1)).toEqual({
      id: DIFF_TAB_ID,
      title: 'Diff',
      url: 'internal://diff?workspaceId=attempt-1&workspaceDir=%2Ftmp%2Fworkspace',
    });
  });

  it('does not add Diff without enough workspace metadata', () => {
    const tabGroup = {
      id: 'tg_1',
      label: 'Custom',
      tabs: [{ id: 'tab_1', title: 'Custom', url: 'https://example.com' }],
      pairs: [],
      order: 0,
    } satisfies TabGroup;

    expect(getTabsWithVirtualDiff(tabGroup)).toHaveLength(1);
  });
});
