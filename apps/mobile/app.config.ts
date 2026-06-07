import type { ExpoConfig } from 'expo/config';

const parseBooleanEnv = (value: string | undefined, fallback: boolean) => {
  if (value === undefined) {
    return fallback;
  }

  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
};

const appProfile = process.env.EXPO_APP_PROFILE || 'preview';
const appQualifier = appProfile === 'production' ? '' : appProfile;
const appQualifierWithDash = appQualifier ? `${appQualifier}-` : '';
const nativeIdentifierQualifier = appQualifier.replace(/[^A-Za-z0-9_]/g, '');
const nativeIdentifierQualifierWithDot = nativeIdentifierQualifier
  ? `.${nativeIdentifierQualifier}`
  : '';
const projectId = process.env.EXPO_PROJECT_ID || 'a0f24779-6c4b-41f6-831f-535f62a25b0a';
const owner = process.env.EXPO_OWNER;
const version = '1.0.0';
const siteUrl = process.env.EXPO_PUBLIC_SITE_URL || 'http://127.0.0.1:1337';
const loadWebViewFromSiteUrl = parseBooleanEnv(
  process.env.EXPO_LOAD_WEBVIEW_FROM_SITE_URL,
  appProfile !== 'local',
);

const config: ExpoConfig = {
  name: `${appQualifierWithDash}Vibe Dashboard`,
  slug: 'vibe-dashboard',
  scheme: `vibedashboard${nativeIdentifierQualifier}`,
  version,
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
    package: `com.jamtools.vibedashboard${nativeIdentifierQualifierWithDot}`,
  },
  ios: {
    bundleIdentifier: `com.jamtools.vibedashboard${nativeIdentifierQualifierWithDot}`,
    supportsTablet: true,
    infoPlist: {
      ITSAppUsesNonExemptEncryption: false,
    },
  },
  plugins: siteUrl.startsWith('http://')
    ? ['./plugins/with-cleartext-traffic.cjs']
    : [],
  extra: {
    ...(projectId ? {
      eas: {
        projectId,
      },
    } : {}),
    siteUrl,
    loadWebViewFromSiteUrl,
  },
  ...(owner ? { owner } : {}),
  runtimeVersion: {
    policy: 'appVersion',
  },
};

if (process.env.EXPO_GITHUB_ACTIONS_RUN) {
  config.runtimeVersion = version;
}

export default config;
