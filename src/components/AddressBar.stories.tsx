import type { Meta, StoryObj } from '@storybook/react-vite';
import { AddressBar } from './AddressBar';
import { storybookTabGroups } from '../stories/fixtures';

const agentCraft = storybookTabGroups.agent;

const meta: Meta<typeof AddressBar> = {
  title: 'Components/AddressBar',
  component: AddressBar,
  decorators: [
    (Story) => (
      <div className="h-32 w-full bg-neutral-950 pt-6">
        <Story />
      </div>
    ),
  ],
  args: {
    tabGroup: agentCraft,
    activeItemId: 'tab_agent',
    onNavigate: (tabId, newUrl) => {
      console.info('navigate', { tabId, newUrl });
    },
  },
} satisfies Meta<typeof AddressBar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const SingleView: Story = {};

export const SplitPair: Story = {
  args: {
    activeItemId: 'pair_agent_code',
  },
};

export const NoActiveView: Story = {
  args: {
    activeItemId: 'missing-view',
  },
};
