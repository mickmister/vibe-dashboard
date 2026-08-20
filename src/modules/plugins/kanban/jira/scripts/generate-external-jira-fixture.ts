import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { parseExternalViewUrl } from '../externalViewUrl.ts';
import { fetchJiraBoardView } from '../server/jiraAdapter.ts';
import { createExternalJiraStorybookFixture } from '../storybook/externalJiraFixtureSanitizer.ts';

const DEFAULT_OUTPUT = 'src/storybook-fixtures/external-jira/local.generated.json';

interface CliOptions {
  url?: string;
  outputPath: string;
  pageSize?: number;
  preserveText: boolean;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!options.url) {
    printUsageAndExit('Missing required --url <jira-board-url>.');
  }

  const accessToken = process.env.ATLASSIAN_STORYBOOK_ACCESS_TOKEN ?? process.env.JIRA_STORYBOOK_ACCESS_TOKEN;
  if (!accessToken) {
    printUsageAndExit('Missing ATLASSIAN_STORYBOOK_ACCESS_TOKEN or JIRA_STORYBOOK_ACCESS_TOKEN.');
  }

  const parsed = parseExternalViewUrl(options.url);
  if (parsed.status !== 'ok' || parsed.locator.provider !== 'jira' || parsed.locator.viewKind !== 'board') {
    throw new Error('Expected --url to be a supported Jira Cloud board URL.');
  }

  const result = await fetchJiraBoardView({
    locator: parsed.locator,
    accessToken,
    pageSize: options.pageSize,
  });

  if (!result.ok) {
    throw new Error(`Could not fetch Jira board fixture: ${result.error.code}. ${result.error.userAction}`);
  }

  const fixture = createExternalJiraStorybookFixture(result.boardView, { preserveText: options.preserveText });
  const outputPath = path.resolve(projectRoot(), options.outputPath);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(fixture, null, 2)}\n`, { mode: 0o600 });

  console.log(`Wrote sanitized Jira Storybook fixture: ${path.relative(projectRoot(), outputPath)}`);
  console.log(`Issues: ${fixture.boardView.cards.length}; columns: ${fixture.boardView.columns.length}; swimlanes: ${fixture.boardView.swimlanes.fidelity}`);
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = { outputPath: DEFAULT_OUTPUT, preserveText: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--url') {
      options.url = readValue(args, index, arg);
      index += 1;
    } else if (arg === '--out') {
      options.outputPath = readValue(args, index, arg);
      index += 1;
    } else if (arg === '--page-size') {
      const value = Number(readValue(args, index, arg));
      if (!Number.isInteger(value) || value <= 0) throw new Error('--page-size must be a positive integer.');
      options.pageSize = value;
      index += 1;
    } else if (arg === '--preserve-text') {
      options.preserveText = true;
    } else if (arg === '--help' || arg === '-h') {
      printUsageAndExit();
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function readValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value.`);
  return value;
}

function projectRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
}

function printUsageAndExit(message?: string): never {
  if (message) console.error(message);
  console.error(`\nUsage:\n  ATLASSIAN_STORYBOOK_ACCESS_TOKEN=<oauth-access-token> npm run storybook:jira-fixture -- --url <jira-board-url> [--out ${DEFAULT_OUTPUT}] [--preserve-text]\n`);
  process.exit(message ? 1 : 0);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
