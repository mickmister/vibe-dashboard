import type { Meta, StoryObj } from '@storybook/react-vite';
import { AppLoadingScreen } from './AppLoadingScreen';

const meta: Meta<typeof AppLoadingScreen> = {
  title: 'Components/AppLoadingScreen',
  component: AppLoadingScreen,
  args: {
    className: 'h-64 w-full rounded-xl border border-neutral-800',
  },
} satisfies Meta<typeof AppLoadingScreen>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Inline: Story = {};

export const FullViewport: Story = {
  args: {
    className: 'min-h-screen w-full',
  },
};
