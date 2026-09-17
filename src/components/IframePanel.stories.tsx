import type { Meta, StoryObj } from '@storybook/react-vite';
import { IframePanel, type IframeRenderMode } from './IframePanel';
import { storybookTabGroups } from '../stories/fixtures';
import type { TabGroup } from '../types';

const blockedSelfAppGroup: TabGroup = {
  id: 'tg_blocked_self_app',
  label: 'Blocked self app',
  tabs: [
    {
      id: 'tab_blocked_dashboard',
      title: 'Dashboard recursion',
      url: '/dashboard',
    },
  ],
  pairs: [],
  order: 99,
};

const externalPreviewGroup: TabGroup = {
  id: 'tg_external_preview',
  label: 'External preview',
  tabs: [
    {
      id: 'tab_preview',
      title: 'Preview app',
      url: 'https://preview.example.test/auth',
    },
  ],
  pairs: [],
  order: 10,
};

const meta: Meta<typeof IframePanel> = {
  title: 'Components/IframePanel',
  component: IframePanel,
  decorators: [
    (Story) => (
      <div className="h-[520px] w-full bg-neutral-950 p-4">
        <div className="h-full overflow-hidden rounded-xl border border-neutral-800">
          <Story />
        </div>
      </div>
    ),
  ],
  args: {
    tabGroup: externalPreviewGroup,
    activeItemId: 'tab_preview',
    iframePreviewStatus: 'ready',
    onUpdatePairRatios: (pairId, ratios) => {
      console.info('update pair ratios', { pairId, ratios });
    },
  },
  render: (args, context) => {
    const globalMode = context.globals.iframeRenderMode as IframeRenderMode | undefined;
    return (
      <IframePanel
        {...args}
        iframeRenderMode={args.iframeRenderMode ?? globalMode ?? 'placeholder'}
      />
    );
  },
  argTypes: {
    iframeRenderMode: {
      control: 'inline-radio',
      options: ['placeholder', 'disabled', 'real'],
    },
    iframePreviewStatus: {
      control: 'inline-radio',
      options: ['ready', 'loading', 'error'],
    },
  },
} satisfies Meta<typeof IframePanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Placeholder: Story = {};

export const Disabled: Story = {
  args: {
    iframeRenderMode: 'disabled',
  },
};

export const LoadingOverlay: Story = {
  args: {
    iframePreviewStatus: 'loading',
  },
};

export const ErrorOverlay: Story = {
  args: {
    iframePreviewStatus: 'error',
  },
};

export const SplitPairPlaceholder: Story = {
  args: {
    tabGroup: storybookTabGroups.agent,
    activeItemId: 'pair_agent_code',
  },
};

export const BlockedSelfApp: Story = {
  args: {
    tabGroup: blockedSelfAppGroup,
    activeItemId: 'tab_blocked_dashboard',
    iframePreviewStatus: 'ready',
  },
};
