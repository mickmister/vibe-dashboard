import type { ExpoConfig } from 'expo/config';

const config: ExpoConfig = {
  name: 'Vibe Kanban Mobile',
  slug: 'vibe-kanban-mobile',
  scheme: 'vibekanbanmobile',
  version: '1.0.0',
  orientation: 'portrait',
  userInterfaceStyle: 'automatic',
  assetBundlePatterns: ['**/*'],
  updates: {
    fallbackToCacheTimeout: 0,
  },
  android: {
    package: 'com.vibekanban.mobile',
  },
  ios: {
    bundleIdentifier: 'com.vibekanban.mobile',
    supportsTablet: true,
  },
  extra: {
    siteUrl: process.env.EXPO_PUBLIC_SITE_URL || 'http://127.0.0.1:1337',
  },
};

export default config;
