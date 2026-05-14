import { mergeConfig } from 'vite';
import { withoutVitePlugins } from '@storybook/builder-vite';
import type { StorybookConfig } from '@storybook/react-vite';

const config: StorybookConfig = {
  async viteFinal(storybookConfig) {
    // Remove plugins by name to prevent them from running in Storybook
    storybookConfig.plugins = await withoutVitePlugins(
      storybookConfig.plugins,
      [
        'springboard',
      ]
    );

    // Optionally merge other overrides
    return mergeConfig(storybookConfig, {
      // other custom overrides for Storybook’s Vite config
    });
  },
  stories: [
    '../src/**/*.mdx',
    '../src/**/*.stories.@(js|jsx|mjs|ts|tsx)',
    '../react-chrome-tabs/**/*.stories.@(js|jsx|mjs|ts|tsx)',
  ],
  addons: [
    '@chromatic-com/storybook',
    '@storybook/addon-vitest',
    '@storybook/addon-a11y',
    '@storybook/addon-docs',
    '@storybook/addon-onboarding',
  ],
  framework: '@storybook/react-vite',
};
export default config;