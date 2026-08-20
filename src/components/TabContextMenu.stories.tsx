import type { Meta, StoryObj } from '@storybook/react-vite';
import { TabContextMenu } from './TabContextMenu';
import { storybookSpaces, storybookTabGroups } from '../stories/fixtures';

const baseArgs = {
  position: { x: 24, y: 24 },
  tabGroup: storybookTabGroups.agent,
  activeItemId: 'tab_agent',
  activeSpaceId: storybookSpaces.product.id,
  onClose: () => console.info('close menu'),
  onCreatePair: (tabIds: string[]) => console.info('create pair', tabIds),
  onCloseTab: (tabId: string) => console.info('close tab', tabId),
  onSplitPair: (pairId: string) => console.info('split pair', pairId),
  onDeleteTabGroup: (spaceId: string, tabGroupId: string) =>
    console.info('delete craft', { spaceId, tabGroupId }),
  onRenameTabGroup: (tabGroupId: string, newLabel: string) =>
    console.info('rename craft', { tabGroupId, newLabel }),
  onRenameTab: (tabId: string, newTitle: string) =>
    console.info('rename view', { tabId, newTitle }),
};

const meta: Meta<typeof TabContextMenu> = {
  title: 'Components/TabContextMenu',
  component: TabContextMenu,
  decorators: [
    (Story) => (
      <div className="relative min-h-80 w-full bg-neutral-950 p-4 text-neutral-100">
        <div className="rounded-lg border border-dashed border-neutral-800 p-4 text-sm text-neutral-500">
          Context menu preview canvas
        </div>
        <Story />
      </div>
    ),
  ],
  args: {
    ...baseArgs,
    tabId: 'tab_code',
  },
} satisfies Meta<typeof TabContextMenu>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ViewMenu: Story = {};

export const PinnedViewMenu: Story = {
  args: {
    tabId: 'tab_agent',
  },
};

export const PairMenu: Story = {
  args: {
    tabId: 'pair_agent_code',
  },
};

export const CraftMenu: Story = {
  args: {
    tabId: `group-label-${storybookTabGroups.agent.id}`,
  },
};

export const NoActionsAvailable: Story = {
  args: {
    tabId: 'tab_overview',
    tabGroup: storybookTabGroups.home,
    activeItemId: 'tab_overview',
    activeSpaceId: storybookSpaces.home.id,
  },
};
