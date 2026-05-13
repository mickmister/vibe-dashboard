import type { ExpoConfig } from 'expo/config';

const appProfile = process.env.EXPO_APP_PROFILE || 'preview';
const appQualifier = appProfile === 'production' ? '' : appProfile;
const appQualifierWithDash = appQualifier ? `${appQualifier}-` : '';
const appQualifierWithDot = appQualifier ? `.${appQualifier}` : '';
const projectId = process.env.EXPO_PROJECT_ID || 'a0f24779-6c4b-41f6-831f-535f62a25b0a';
const owner = process.env.EXPO_OWNER;

const config: ExpoConfig = {
  name: `${appQualifierWithDash}Vibe Dashboard`,
  slug: 'vibe-dashboard',
  scheme: `vibedashboard${appQualifier}`,
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
    package: `com.jamtools.vibedashboard${appQualifierWithDot}`,
  },
  ios: {
    bundleIdentifier: `com.jamtools.vibedashboard${appQualifierWithDot}`,
    supportsTablet: true,
    infoPlist: {
      ITSAppUsesNonExemptEncryption: false,
    },
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
