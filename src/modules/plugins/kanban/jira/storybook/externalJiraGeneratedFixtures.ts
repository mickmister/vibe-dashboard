import type { ExternalJiraStorybookFixture } from './externalJiraFixtureSanitizer';

declare global {
  interface ImportMeta {
    glob<T = unknown>(pattern: string, options: { eager: true; import: 'default' }): Record<string, T>;
  }
}

const generatedFixtureModules = import.meta.glob<ExternalJiraStorybookFixture>('../../../../../storybook-fixtures/external-jira/*.generated.json', {
  eager: true,
  import: 'default',
});

export function getGeneratedExternalJiraStorybookFixture(): ExternalJiraStorybookFixture | undefined {
  const fixtures = Object.entries(generatedFixtureModules)
    .map(([path, fixture]) => ({ path, fixture }))
    .filter(({ fixture }) => isExternalJiraStorybookFixture(fixture))
    .sort((left, right) => left.path.localeCompare(right.path));
  return fixtures[0]?.fixture;
}

function isExternalJiraStorybookFixture(value: ExternalJiraStorybookFixture): value is ExternalJiraStorybookFixture {
  return value?.version === 1 && value.source?.sanitized === true && value.boardView?.provider === 'jira';
}
