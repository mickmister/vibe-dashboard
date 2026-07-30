export const EXTERNAL_TRACKERS_FEATURE_ENV = 'VD_EXTERNAL_TRACKERS_ENABLED';

export function isExternalTrackersEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env[EXTERNAL_TRACKERS_FEATURE_ENV] === 'true';
}
