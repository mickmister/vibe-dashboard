import type { ExternalIssueProvider } from './contracts';

export const externalIssueProviders = ['jira', 'github', 'linear'] as const satisfies readonly ExternalIssueProvider[];

export function isExternalIssueProvider(value: string): value is ExternalIssueProvider {
  return (externalIssueProviders as readonly string[]).includes(value);
}
