import type { ExpoConfig } from 'expo/config';

const appProfile = process.env.EXPO_APP_PROFILE || 'preview';
const appQualifier = appProfile === 'production' ? '' : appProfile;
const appQualifierWithDash = appQualifier ? `${appQualifier}-` : '';
const appQualifierWithDot = appQualifier ? `.${appQualifier}` : '';
const projectId = process.env.EXPO_PROJECT_ID;
const owner = process.env.EXPO_OWNER;

const config: ExpoConfig = {
  name: `${appQualifierWithDash}Vibe Kanban`,
  slug: 'vibe-kanban-mobile',
  scheme: `vibekanbanmobile${appQualifier}`,
  version: '1.0.0',
  orientation: 'portrait',
  userInterfaceStyle: 'automatic',
  assetBundlePatterns: ['**/*'],
  updates: {
    fallbackToCacheTimeout: 0,
    ...(projectId ? {
      url: `https://u.expo.dev/${projectId}`,
    } : {}),
  },
  android: {
    package: `com.vibekanban.mobile${appQualifierWithDot}`,
  },
  ios: {
    bundleIdentifier: `com.vibekanban.mobile${appQualifierWithDot}`,
    supportsTablet: true,
  },
  extra: {
    ...(projectId ? {
      eas: {
        projectId,
      },
    } : {}),
    siteUrl: process.env.EXPO_PUBLIC_SITE_URL || 'http://127.0.0.1:1337',
  },
  ...(owner ? { owner } : {}),
  runtimeVersion: {
    policy: 'appVersion',
  },
};

export default config;
