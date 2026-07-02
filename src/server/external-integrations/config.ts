export const EXTERNAL_TRACKERS_FEATURE_ENV = 'VD_EXTERNAL_TRACKERS_ENABLED';

export type ExternalTrackerProvider = 'jira' | 'github' | 'linear';

export const externalTrackerProviders = ['jira', 'github', 'linear'] as const satisfies readonly ExternalTrackerProvider[];

export const jiraReadScopes = [
  'read:jira-user',
  'read:jira-work',
  'read:board-scope:jira-software',
  'read:issue-details:jira',
  'read:project:jira',
] as const;

export function isExternalTrackersEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env[EXTERNAL_TRACKERS_FEATURE_ENV] === 'true';
}

export function isExternalTrackerProvider(value: string): value is ExternalTrackerProvider {
  return (externalTrackerProviders as readonly string[]).includes(value);
}

export function getProviderScopes(provider: ExternalTrackerProvider): string[] {
  switch (provider) {
    case 'jira':
      return [...jiraReadScopes];
    case 'github':
      return ['read:user', 'user:email'];
    case 'linear':
      return ['read'];
  }
}
