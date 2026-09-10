import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import type { ExternalProvider } from '../../../../store/kysely_types';
import type { ExternalKanbanBoardViewDto, ExternalKanbanCardDto } from '../boardTypes';
import { isExternalIssueProvider } from '../providerIds';

const execFile = promisify(execFileCallback);
const EXTERNAL_ISSUES_METADATA_KEY = 'external_issues';
const DEFAULT_BD_COMMAND_TIMEOUT_MS = 15_000;
const BEAD_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export interface BeadExternalIssueRef {
  provider: ExternalProvider;
  key: string;
  url: string;
  id?: string;
  site?: string;
  metadata?: Record<string, unknown>;
}

export interface RelatedBead {
  id: string;
  title: string;
  status?: string;
  priority?: number | string;
  externalIssue: BeadExternalIssueRef;
}

export type ExternalKanbanCardWithBeads = ExternalKanbanCardDto & {
  relatedBeads: RelatedBead[];
};

export type ExternalKanbanBoardViewWithBeads<BoardView extends ExternalKanbanBoardViewDto = ExternalKanbanBoardViewDto> = Omit<BoardView, 'cards'> & {
  cards: ExternalKanbanCardWithBeads[];
};

export interface BdCommandRunner {
  (args: string[]): Promise<{ stdout: string }>;
}

export interface BeadsExternalIssueServiceOptions {
  cwd?: string;
  runBd?: BdCommandRunner;
  commandTimeoutMs?: number;
}

export class BeadsExternalIssueError extends Error {
  constructor(
    public readonly code: 'invalid_bead_id' | 'bd_command_failed',
    message: string,
  ) {
    super(message);
    this.name = 'BeadsExternalIssueError';
  }
}

interface BdIssueJson {
  id: string;
  title?: string;
  status?: string;
  priority?: number | string;
  metadata?: unknown;
  [key: string]: unknown;
}

export async function decorateExternalKanbanBoardWithBeadLinks<BoardView extends ExternalKanbanBoardViewDto>(
  boardView: BoardView,
  options: BeadsExternalIssueServiceOptions = {},
): Promise<ExternalKanbanBoardViewWithBeads<BoardView>> {
  const links = await listBeadExternalIssueLinks(options);
  const cards = boardView.cards.map((card) => ({
    ...card,
    relatedBeads: links.filter((link) => externalIssueMatchesKanbanCard(boardView, card, link.externalIssue)),
  }));

  return { ...boardView, cards };
}

export async function listBeadExternalIssueLinks(options: BeadsExternalIssueServiceOptions = {}): Promise<RelatedBead[]> {
  const { stdout } = await runBd(options, ['export']);
  return parseBdExport(stdout).flatMap((issue) => {
    const metadata = readMetadataObject(issue.metadata);
    const externalIssues = parseExternalIssuesMetadata(metadata[EXTERNAL_ISSUES_METADATA_KEY]);
    return externalIssues.map((externalIssue) => ({
      id: issue.id,
      title: issue.title ?? issue.id,
      ...(issue.status ? { status: issue.status } : {}),
      ...(issue.priority !== undefined ? { priority: issue.priority } : {}),
      externalIssue,
    }));
  });
}

export async function addBeadExternalIssueLink(
  beadId: string,
  externalIssue: BeadExternalIssueRef,
  options: BeadsExternalIssueServiceOptions = {},
): Promise<BeadExternalIssueRef[]> {
  const normalizedIssue = normalizeExternalIssueRef(externalIssue);
  if (!normalizedIssue) throw new Error('invalid_external_issue');
  const issue = await getBeadIssue(beadId, options);
  const metadata = readMetadataObject(issue.metadata);
  const currentExternalIssues = parseExternalIssuesMetadata(metadata[EXTERNAL_ISSUES_METADATA_KEY]);
  const nextExternalIssues = upsertExternalIssue(currentExternalIssues, normalizedIssue);

  await writeBeadMetadata(beadId, { ...metadata, [EXTERNAL_ISSUES_METADATA_KEY]: nextExternalIssues }, options);
  return nextExternalIssues;
}

export async function removeBeadExternalIssueLink(
  beadId: string,
  externalIssue: BeadExternalIssueRef,
  options: BeadsExternalIssueServiceOptions = {},
): Promise<BeadExternalIssueRef[]> {
  const normalizedIssue = normalizeExternalIssueRef(externalIssue);
  if (!normalizedIssue) throw new Error('invalid_external_issue');
  const issue = await getBeadIssue(beadId, options);
  const metadata = readMetadataObject(issue.metadata);
  const currentExternalIssues = parseExternalIssuesMetadata(metadata[EXTERNAL_ISSUES_METADATA_KEY]);
  const nextExternalIssues = currentExternalIssues.filter((candidate) => !externalIssueIdentityMatches(candidate, normalizedIssue));

  if (nextExternalIssues.length > 0) {
    await writeBeadMetadata(beadId, { ...metadata, [EXTERNAL_ISSUES_METADATA_KEY]: nextExternalIssues }, options);
  } else {
    const { [EXTERNAL_ISSUES_METADATA_KEY]: _removed, ...remainingMetadata } = metadata;
    await writeBeadMetadata(beadId, remainingMetadata, options);
  }

  return nextExternalIssues;
}

export function parseExternalIssuesMetadata(value: unknown): BeadExternalIssueRef[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => normalizeExternalIssueRef(entry)).filter((entry): entry is BeadExternalIssueRef => Boolean(entry));
}

export function normalizeExternalIssueRef(value: unknown): BeadExternalIssueRef | undefined {
  if (!isPlainObject(value)) return undefined;
  const provider = value.provider;
  const key = value.key;
  const url = value.url;
  if (!(typeof provider === 'string' && isExternalIssueProvider(provider))) return undefined;
  if (!isNonEmptyString(key)) return undefined;
  if (!isNonEmptyString(url)) return undefined;
  if (!isOptionalString(value.id)) return undefined;
  if (!isOptionalString(value.site)) return undefined;
  if (!isOptionalPlainObject(value.metadata)) return undefined;

  return {
    provider,
    key: key.trim(),
    url: url.trim(),
    ...(value.id?.trim() ? { id: value.id.trim() } : {}),
    ...(value.site?.trim() ? { site: value.site.trim().toLowerCase() } : {}),
    ...(value.metadata ? { metadata: value.metadata } : {}),
  };
}

export function isValidBeadId(beadId: unknown): beadId is string {
  if (typeof beadId !== 'string') return false;
  const trimmed = beadId.trim();
  return beadId === trimmed && BEAD_ID_PATTERN.test(trimmed);
}

export function externalIssueMatchesKanbanCard(boardView: ExternalKanbanBoardViewDto, card: ExternalKanbanCardDto, externalIssue: BeadExternalIssueRef): boolean {
  if (externalIssue.provider !== boardView.provider) return false;
  if (externalIssue.key !== card.key) return false;
  if (externalIssue.site) return externalIssue.site === boardView.siteHostname;
  return externalIssue.url === card.url;
}

function upsertExternalIssue(currentExternalIssues: BeadExternalIssueRef[], externalIssue: BeadExternalIssueRef): BeadExternalIssueRef[] {
  const withoutExisting = currentExternalIssues.filter((candidate) => !externalIssueIdentityMatches(candidate, externalIssue));
  return [...withoutExisting, externalIssue];
}

function externalIssueIdentityMatches(left: BeadExternalIssueRef, right: BeadExternalIssueRef): boolean {
  if (left.provider !== right.provider || left.key !== right.key) return false;
  if (left.site || right.site) return left.site === right.site;
  return left.url === right.url;
}

async function getBeadIssue(beadId: string, options: BeadsExternalIssueServiceOptions): Promise<BdIssueJson> {
  assertValidBeadId(beadId);
  const { stdout } = await runBd(options, ['show', beadId, '--json']);
  const parsed = JSON.parse(stdout) as unknown;
  const issue = Array.isArray(parsed) ? parsed[0] : parsed;
  if (!isPlainObject(issue) || typeof issue.id !== 'string') throw new Error('invalid_bd_show_response');
  return issue as BdIssueJson;
}

async function writeBeadMetadata(beadId: string, metadata: Record<string, unknown>, options: BeadsExternalIssueServiceOptions): Promise<void> {
  assertValidBeadId(beadId);
  await runBd(options, ['update', beadId, '--metadata', JSON.stringify(metadata)]);
}

function parseBdExport(stdout: string): BdIssueJson[] {
  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as unknown)
    .filter((entry): entry is BdIssueJson => isPlainObject(entry) && typeof entry.id === 'string');
}

function readMetadataObject(value: unknown): Record<string, unknown> {
  return isPlainObject(value) ? { ...value } : {};
}

async function runBd(options: BeadsExternalIssueServiceOptions, args: string[]): Promise<{ stdout: string }> {
  try {
    if (options.runBd) return await options.runBd(args);
    const { stdout } = await execFile('bd', args, {
      cwd: options.cwd ?? process.cwd(),
      maxBuffer: 10 * 1024 * 1024,
      timeout: options.commandTimeoutMs ?? DEFAULT_BD_COMMAND_TIMEOUT_MS,
    });
    return { stdout };
  } catch (error) {
    if (error instanceof BeadsExternalIssueError) throw error;
    throw new BeadsExternalIssueError('bd_command_failed', 'Beads command failed.');
  }
}

function assertValidBeadId(beadId: string): void {
  if (!isValidBeadId(beadId)) {
    throw new BeadsExternalIssueError('invalid_bead_id', 'Invalid bead id.');
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === 'string';
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isOptionalPlainObject(value: unknown): value is Record<string, unknown> | undefined {
  return value === undefined || isPlainObject(value);
}
