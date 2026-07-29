export const EXTERNAL_TRACKERS_FEATURE_ENV = 'VD_EXTERNAL_TRACKERS_ENABLED';

export type JiraExternalTrackerProvider = 'jira';

export const jiraReadScopes = [
  'read:jira-user',
  'read:jira-work',
  'read:board-scope:jira-software',
  'read:board-scope.admin:jira-software',
  'read:issue-details:jira',
  'read:project:jira',
  'write:jira-work',
] as const;

export function isExternalTrackersEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env[EXTERNAL_TRACKERS_FEATURE_ENV] === 'true';
}

export function isJiraExternalTrackerProvider(value: string): value is JiraExternalTrackerProvider {
  return value === 'jira';
}

export function getJiraProviderScopes(): string[] {
  return [...jiraReadScopes];
}
