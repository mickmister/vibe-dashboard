/// <reference types="node" />

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

import {
  compileBeadsForm,
  stripGeneratedBeadsFormFields,
  type StandardBeadsForm,
  type StoredBeadsForm,
} from '../../packages/beads-form/src/index.ts';
import { assertMetadataWithinIssueJsonGuard } from '../../src/lib/beadsFormCore.ts';
import { BeadsClient, type PendingBeadsFormQueueResult } from '../../src/lib/beadsClient.node.ts';

const execFileAsync = promisify(execFile);
const DEFAULT_CONFIG_DIR_NAME = 'vibe-dashboard';
const DEFAULT_CONFIG_FILE_NAME = 'beads-form.json';
const FORBIDDEN_APPEND_QUESTION_FIELDS = new Set([
  'html',
  'controls',
  'sourceMessages',
  'responses',
  'format',
  'goal',
  'content',
  'allowCodeFileChanges',
]);

export type JsonObject = Record<string, unknown>;

export type BeadsFormResponse = {
  submittedBy: string;
  submittedAt: string;
  values: JsonObject;
  prettySummary?: string;
};

export type BeadsFormDefinition = {
  id: string;
  goal: string;
  title: string;
  description?: string;
  version?: number;
  responses?: BeadsFormResponse[];
  format: 'standard';
  questions: StandardBeadsForm['questions'];
  content?: StandardBeadsForm['content'];
};

export type BeadsFormsSummary = {
  hasForms: boolean;
  hasPendingAnswer: boolean;
  pendingResponseCount: number;
  formIds: string[];
  pendingFormIds: string[];
};

type BeadFormResponsesMetadata = {
  responsesByFormId: Record<string, BeadsFormResponse[]>;
};

export type BeadLike = {
  id: string;
  title?: string;
  description?: string;
  metadata?: JsonObject | null;
};

export type ExecFileLike = (
  file: string,
  args: readonly string[],
  options: { cwd: string; timeout: number; maxBuffer?: number },
) => Promise<{ stdout: string | Buffer; stderr: string | Buffer }>;

type CliOptions = { _: string[] } & Record<string, string | boolean | string[] | undefined>;

export type BeadsFormCliCommand =
  | { command: 'attach'; options: AttachOptions }
  | { command: 'append-questions'; options: AppendQuestionsOptions }
  | { command: 'show'; options: ShowOptions }
  | { command: 'pending'; options: PendingOptions }
  | { command: 'help'; options: CliOptions };

export type AttachOptions = {
  dir: string;
  beadId: string;
  file?: string;
  json?: string;
  stdin?: boolean;
  origin?: string;
  workspaceId?: string;
  sessionId?: string;
};

export type AppendQuestionsOptions = {
  dir: string;
  beadId: string;
  formId: string;
  file?: string;
  json?: string;
  stdin?: boolean;
  origin?: string;
  workspaceId?: string;
  afterQuestionId?: string;
  baseHash?: string;
};

export type ShowOptions = {
  dir: string;
  beadId: string;
  formId?: string;
};

export type PendingOptions = {
  parentDir: string;
  limit: number;
  origin?: string;
};

export type AttachResult = {
  beadId: string;
  forms: Array<{
    id: string;
    title: string;
    /** Backward-compatible primary URL. Uses workspace URL when workspaceId is known, otherwise dir URL. */
    url: string;
    /** Explicit URL variants. Dir URL is always present as the locked fallback. */
    urls: {
      dir: string;
      workspace?: string;
    };
  }>;
  metadata: JsonObject;
};

export type AppendQuestionsPatch = {
  operation: 'append_questions';
  questions: StandardBeadsForm['questions'];
  afterQuestionId?: string;
};

export type AppendQuestionsResult = {
  beadId: string;
  formId: string;
  appendedQuestionIds: string[];
  formHashBefore: string;
  formHashAfter: string;
  url: string;
  urls: {
    dir: string;
    workspace?: string;
  };
  metadata: JsonObject;
};

export type ShowResult = {
  bead: Pick<BeadLike, 'id' | 'title' | 'description'>;
  form: ShowForm;
  responses: BeadsFormResponse[];
  responseCount: number;
  noResponses: boolean;
  mediaRefs: ShowMediaRef[];
};

export type ShowForm = {
  id: string;
  goal: string;
  title: string;
  description?: string;
  version?: number;
  format?: BeadsFormDefinition['format'];
  content?: BeadsFormDefinition['content'];
  questions?: BeadsFormDefinition['questions'];
};

export type ShowMediaRef = {
  galleryId?: string;
  blockId?: string;
  itemId?: string;
  type: 'image' | 'video' | 'markdown' | 'file' | 'code-snippet';
  src?: string;
  ref?: string;
  poster?: string;
  caption?: string;
  alt?: string;
  path?: string;
  commit?: string;
  startLine?: number;
  endLine?: number;
};

export type PendingFormsCliResult = {
  parentDir: string;
  repoLimit: number;
  reposScanned: number;
  pendingCount: number;
  entries: Array<{
    repo: {
      name: string;
      path: string;
    };
    bead: {
      id: string;
      title?: string;
      description?: string;
    };
    form: {
      id: string;
      title: string;
      description?: string;
      responseCount: number;
    };
    url: string;
  }>;
  skipped: Array<{ repoDir: string; reason: string }>;
  updateStrategy: PendingBeadsFormQueueResult['updateStrategy'];
};

export function parseBeadsFormCliArgs(argv: string[]): BeadsFormCliCommand {
  const [command = 'help', ...rest] = argv;
  const options = parseOptions(rest);
  if (command === 'attach') {
    return { command, options: normalizeAttachOptions(options) };
  }
  if (command === 'append-questions') {
    return { command, options: normalizeAppendQuestionsOptions(options) };
  }
  if (command === 'show') {
    return { command, options: normalizeShowOptions(options) };
  }
  if (command === 'pending') {
    return { command, options: normalizePendingOptions(options) };
  }
  return { command: 'help', options };
}

function parseOptions(argv: string[]): CliOptions {
  const options: CliOptions = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg) continue;
    if (arg === '--stdin') {
      options.stdin = true;
      continue;
    }
    if (arg.startsWith('--')) {
      const [rawKey, inlineValue] = arg.slice(2).split(/=(.*)/s, 2);
      if (!rawKey) continue;
      if (inlineValue !== undefined) {
        options[rawKey] = inlineValue;
        continue;
      }
      const next = argv[index + 1];
      if (next && !next.startsWith('--')) {
        options[rawKey] = next;
        index += 1;
      } else {
        options[rawKey] = true;
      }
      continue;
    }
    options._.push(arg);
  }
  return options;
}

function normalizeAttachOptions(options: CliOptions): AttachOptions {
  const beadId = stringOption(options, 'bead') ?? stringOption(options, 'bead-id') ?? options._[0];
  if (!beadId) throw new Error('Usage: npm run beads-form -- attach --bead <bead-id> (--file form.json | --json raw-json | --stdin)');
  const file = stringOption(options, 'file');
  const json = stringOption(options, 'json');
  const stdin = options.stdin === true;
  const inputCount = [file, json, stdin ? 'stdin' : undefined].filter(Boolean).length;
  if (inputCount !== 1) throw new Error('attach requires exactly one of --file, --json, or --stdin');
  const origin = resolveBeadsFormOrigin({ explicitOrigin: stringOption(options, 'origin') });
  const workspaceId = stringOption(options, 'workspace') ?? stringEnv(process.env, 'VK_WORKSPACE_ID');
  const sessionId = stringOption(options, 'session') ?? stringEnv(process.env, 'VK_SESSION_ID');
  return {
    dir: resolve(stringOption(options, 'dir') ?? process.cwd()),
    beadId,
    ...(file ? { file } : {}),
    ...(json ? { json } : {}),
    ...(stdin ? { stdin: true } : {}),
    ...(origin ? { origin } : {}),
    ...(workspaceId ? { workspaceId } : {}),
    ...(sessionId ? { sessionId } : {}),
  };
}

function normalizeAppendQuestionsOptions(options: CliOptions): AppendQuestionsOptions {
  const beadId = stringOption(options, 'bead') ?? stringOption(options, 'bead-id') ?? options._[0];
  const formId = stringOption(options, 'form') ?? stringOption(options, 'form-id') ?? options._[1];
  if (!beadId || !formId) {
    throw new Error('Usage: npm run beads-form -- append-questions --bead <bead-id> --form <form-id> (--file questions.json | --json raw-json | --stdin)');
  }
  const file = stringOption(options, 'file');
  const json = stringOption(options, 'json');
  const stdin = options.stdin === true;
  const inputCount = [file, json, stdin ? 'stdin' : undefined].filter(Boolean).length;
  if (inputCount !== 1) throw new Error('append-questions requires exactly one of --file, --json, or --stdin');
  const origin = resolveBeadsFormOrigin({ explicitOrigin: stringOption(options, 'origin') });
  const workspaceId = stringOption(options, 'workspace') ?? stringEnv(process.env, 'VK_WORKSPACE_ID');
  return {
    dir: resolve(stringOption(options, 'dir') ?? process.cwd()),
    beadId,
    formId,
    ...(file ? { file } : {}),
    ...(json ? { json } : {}),
    ...(stdin ? { stdin: true } : {}),
    ...(origin ? { origin } : {}),
    ...(workspaceId ? { workspaceId } : {}),
    ...(stringOption(options, 'after-question') ? { afterQuestionId: stringOption(options, 'after-question') } : {}),
    ...(stringOption(options, 'after-question-id') ? { afterQuestionId: stringOption(options, 'after-question-id') } : {}),
    ...(stringOption(options, 'base-hash') ? { baseHash: stringOption(options, 'base-hash') } : {}),
  };
}

function normalizeShowOptions(options: CliOptions): ShowOptions {
  const beadId = stringOption(options, 'bead') ?? stringOption(options, 'bead-id') ?? options._[0];
  if (options.includeHtml === true || options['include-html'] === true) {
    throw new Error('beads-form show no longer supports --include-html; BeadsForms are stored as standard DSL only.');
  }
  if (!beadId) throw new Error('Usage: npm run beads-form -- show --bead <bead-id> [--form <form-id>]');
  return {
    dir: resolve(stringOption(options, 'dir') ?? process.cwd()),
    beadId,
    ...(stringOption(options, 'form') ? { formId: stringOption(options, 'form') } : {}),
  };
}

function normalizePendingOptions(options: CliOptions): PendingOptions {
  const parentDir = stringOption(options, 'parent-dir') ?? stringOption(options, 'parentDir');
  if (!parentDir) throw new Error('Usage: npm run beads-form -- pending --parent-dir <all-repos-dir> [--limit 80] [--origin origin]');
  const limitText = stringOption(options, 'limit');
  const limit = limitText ? Number.parseInt(limitText, 10) : 80;
  if (!Number.isFinite(limit) || limit < 1) throw new Error(`Invalid pending --limit: ${limitText}`);
  const origin = resolveBeadsFormOrigin({ explicitOrigin: stringOption(options, 'origin') });
  return {
    parentDir: resolve(parentDir),
    limit,
    ...(origin ? { origin } : {}),
  };
}

function stringOption(options: CliOptions, key: string): string | undefined {
  const value = options[key];
  return typeof value === 'string' && value.trim() ? value : undefined;
}

export function resolveBeadsFormOrigin(input: {
  explicitOrigin?: string;
  env?: NodeJS.ProcessEnv;
  configPath?: string;
} = {}): string | undefined {
  const env = input.env ?? process.env;
  const candidate = input.explicitOrigin
    ?? stringEnv(env, 'BEADS_FORM_ORIGIN')
    ?? stringEnv(env, 'VD_BEADS_FORM_ORIGIN')
    ?? readOriginConfig(input.configPath ?? defaultOriginConfigPath(env));
  return candidate ? normalizeOrigin(candidate) : undefined;
}

function defaultOriginConfigPath(env: NodeJS.ProcessEnv): string {
  const configHome = stringEnv(env, 'XDG_CONFIG_HOME') ?? join(homedir(), '.config');
  return join(configHome, DEFAULT_CONFIG_DIR_NAME, DEFAULT_CONFIG_FILE_NAME);
}

function stringEnv(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const value = env[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function readOriginConfig(configPath: string): string | undefined {
  if (!existsSync(configPath)) return undefined;
  const parsed = JSON.parse(readFileSync(configPath, 'utf8')) as unknown;
  if (!isObject(parsed) || typeof parsed.origin !== 'string' || !parsed.origin.trim()) return undefined;
  return parsed.origin;
}

function normalizeOrigin(origin: string): string {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    throw new Error(`Invalid BeadsForm origin: ${origin}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`Invalid BeadsForm origin protocol: ${url.protocol}`);
  }
  return url.origin;
}

export async function readAttachInput(options: AttachOptions, stdin = process.stdin): Promise<string> {
  return readJsonInput(options, stdin);
}

export async function readAppendQuestionsInput(options: AppendQuestionsOptions, stdin = process.stdin): Promise<string> {
  return readJsonInput(options, stdin);
}

async function readJsonInput(options: Pick<AttachOptions, 'file' | 'json' | 'stdin'>, stdin = process.stdin): Promise<string> {
  if (options.file) return readFile(resolve(options.file), 'utf8');
  if (options.json) return options.json;
  if (options.stdin) return readStream(stdin);
  throw new Error('requires --file, --json, or --stdin');
}

function readStream(stream: NodeJS.ReadableStream): Promise<string> {
  return new Promise((resolveRead, reject) => {
    let text = '';
    stream.setEncoding('utf8');
    stream.on('data', (chunk) => {
      text += chunk;
    });
    stream.on('error', reject);
    stream.on('end', () => resolveRead(text));
  });
}

export function formsFromJsonForAttach(parsed: unknown): BeadsFormDefinition[] {
  if (isObject(parsed) && isObject(parsed.beadForms) && Array.isArray(parsed.beadForms.forms)) {
    return parsed.beadForms.forms.map(normalizeSingleFormForAttach);
  }

  if (Array.isArray(parsed)) {
    return parsed.map(normalizeSingleFormForAttach);
  }

  if (isObject(parsed) && Array.isArray(parsed.forms)) {
    return parsed.forms.map(normalizeSingleFormForAttach);
  }

  return [normalizeSingleFormForAttach(parsed)];
}

function normalizeSingleFormForAttach(value: unknown): BeadsFormDefinition {
  const form = normalizeForm(value);
  if (!form) throw new Error('No BeadsForm definitions found in JSON input');
  return form;
}

function normalizeForm(value: unknown): BeadsFormDefinition | undefined {
  if (isHtmlForm(value) && !isStandardForm(value)) {
    throw new Error('Raw HTML BeadsForms are no longer supported; express the form with the standard BeadsForm DSL.');
  }
  if (!isStandardForm(value)) return undefined;
  compileBeadsForm(value);
  return stripGeneratedBeadsFormFields(value);
}

function isHtmlForm(value: unknown): value is JsonObject & { id: string; title: string; html: string } {
  return isObject(value)
    && typeof value.id === 'string'
    && value.id.trim().length > 0
    && typeof value.title === 'string'
    && value.title.trim().length > 0
    && typeof value.html === 'string'
    && value.html.trim().length > 0;
}

function isStandardForm(value: unknown): value is StandardBeadsForm {
  return isObject(value)
    && value.format === 'standard'
    && typeof value.id === 'string'
    && value.id.trim().length > 0
    && typeof value.goal === 'string'
    && value.goal.trim().length > 0
    && typeof value.title === 'string'
    && value.title.trim().length > 0
    && Array.isArray(value.questions);
}

function isStoredStandardFormLike(value: unknown): value is StoredBeadsForm {
  return isObject(value)
    && value.format === 'standard'
    && typeof value.id === 'string'
    && value.id.trim().length > 0
    && typeof value.title === 'string'
    && value.title.trim().length > 0
    && Array.isArray(value.questions);
}

function withLegacyFallbackGoal(form: StoredBeadsForm): StoredBeadsForm {
  if (typeof form.goal === 'string' && form.goal.trim().length > 0) return form;
  return {
    ...form,
    goal: `Answer ${form.title}.`,
  };
}

export function parseFormsJsonForAttach(text: string): BeadsFormDefinition[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`Invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  const forms = formsFromJsonForAttach(parsed);
  assertUniqueFormIds(forms);
  for (const form of forms) assertNoLocalBeadBackedMediaRefs(form);
  return forms;
}

export function parseQuestionsJsonForAppend(text: string): AppendQuestionsPatch {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`Invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  const patch = questionsPatchFromJson(parsed);
  assertUniqueQuestionIds(patch.questions);
  assertNoGeneratedFormFields(parsed);
  assertNoForbiddenAppendQuestionFields(patch.questions);
  return patch;
}

function questionsPatchFromJson(parsed: unknown): AppendQuestionsPatch {
  if (Array.isArray(parsed)) {
    return normalizeAppendQuestionsPatch({ operation: 'append_questions', questions: parsed });
  }
  if (!isObject(parsed)) throw new Error('append-questions input must be a question array or an object with questions[]');
  if (parsed.operation !== undefined && parsed.operation !== 'append_questions') {
    throw new Error(`Unsupported append-questions operation: ${String(parsed.operation)}`);
  }
  if ('format' in parsed || ('id' in parsed && 'title' in parsed)) {
    throw new Error('append-questions accepts questions only, not full BeadsForm definitions');
  }
  return normalizeAppendQuestionsPatch(parsed);
}

function normalizeAppendQuestionsPatch(value: JsonObject): AppendQuestionsPatch {
  if (!Array.isArray(value.questions)) throw new Error('append-questions input must include a non-empty questions[] array');
  if (value.questions.length === 0) throw new Error('append-questions requires at least one question');
  const questions = value.questions as StandardBeadsForm['questions'];
  const patch: AppendQuestionsPatch = {
    operation: 'append_questions',
    questions,
  };
  if (typeof value.afterQuestionId === 'string' && value.afterQuestionId.trim()) {
    patch.afterQuestionId = value.afterQuestionId.trim();
  }
  return patch;
}

function assertUniqueQuestionIds(questions: StandardBeadsForm['questions']): void {
  const seen = new Set<string>();
  for (const question of questions) {
    if (!isObject(question) || typeof question.id !== 'string' || !question.id.trim()) {
      throw new Error('append-questions input contains a question without an id');
    }
    if (seen.has(question.id)) throw new Error(`Duplicate question id in append input: ${question.id}`);
    seen.add(question.id);
  }
}

function assertNoGeneratedFormFields(parsed: unknown): void {
  if (isObject(parsed) && ('html' in parsed || 'controls' in parsed)) {
    throw new Error('append-questions accepts standard DSL questions only, not generated html/controls');
  }
}

function assertNoForbiddenAppendQuestionFields(value: unknown, path = 'questions'): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoForbiddenAppendQuestionFields(item, `${path}[${index}]`));
    return;
  }
  if (!isObject(value)) return;
  for (const key of Object.keys(value)) {
    if (FORBIDDEN_APPEND_QUESTION_FIELDS.has(key)) {
      throw new Error(`append-questions input contains forbidden form/generated field "${key}" at ${path}`);
    }
    assertNoForbiddenAppendQuestionFields(value[key], `${path}.${key}`);
  }
}

function assertUniqueFormIds(forms: BeadsFormDefinition[]): void {
  const seen = new Set<string>();
  for (const form of forms) {
    if (seen.has(form.id)) throw new Error(`Duplicate form id in input: ${form.id}`);
    seen.add(form.id);
  }
}

function assertNoLocalBeadBackedMediaRefs(form: BeadsFormDefinition): void {
  for (const ref of collectMediaRefs(form)) {
    for (const [field, value] of Object.entries({ src: ref.src, ref: ref.ref, poster: ref.poster })) {
      if (typeof value !== 'string' || !value) continue;
      if (isLocalMediaRef(value)) {
        throw new Error(`Form ${form.id} uses local attachment ${field} "${value}"; bead-backed attachments support http(s) or attachment:// refs only`);
      }
    }
  }
}

function isLocalMediaRef(value: string): boolean {
  const lower = value.trim().toLowerCase();
  if (!lower) return false;
  return !(lower.startsWith('https://') || lower.startsWith('http://') || lower.startsWith('attachment://'));
}

export async function attachBeadsForms(input: {
  options: AttachOptions;
  forms: BeadsFormDefinition[];
  execFile?: ExecFileLike;
}): Promise<AttachResult> {
  const exec = input.execFile ?? defaultExecFile;
  const bead = await readBead({ execFile: exec, dir: input.options.dir, beadId: input.options.beadId });
  const metadata = attachFormsToMetadata(bead.metadata, input.forms, {
    workspaceId: input.options.workspaceId,
    sessionId: input.options.sessionId,
  });
  await updateMetadata({ execFile: exec, dir: input.options.dir, beadId: input.options.beadId, metadata });
  return {
    beadId: input.options.beadId,
    forms: input.forms.map((form) => {
      const urls = buildFillOutUrls({
        dir: input.options.dir,
        beadId: input.options.beadId,
        formId: form.id,
        origin: input.options.origin,
        workspaceId: input.options.workspaceId,
      });
      return {
        id: form.id,
        title: form.title,
        url: urls.workspace ?? urls.dir,
        urls,
      };
    }),
    metadata,
  };
}

export function attachFormsToMetadata(
  metadata: unknown,
  forms: BeadsFormDefinition[],
  options: { workspaceId?: string; sessionId?: string } = {},
): JsonObject {
  const next: JsonObject = isObject(metadata) ? structuredClone(metadata) as JsonObject : {};
  const beadForms = isObject(next.beadForms) ? next.beadForms : { forms: [] };
  const existingForms = getFormsFromMetadata(next);
  const existingIds = new Set(existingForms
    .map((form) => form.id));
  for (const form of forms) {
    if (existingIds.has(form.id)) throw new Error(`Form id already exists on bead: ${form.id}`);
  }
  const allForms = [...existingForms, ...forms];
  const storedForms = allForms.map(stripResponsesFromForm);
  next.beadForms = { ...beadForms, forms: storedForms };
  writeSplitResponses(next, allForms);
  next.beadFormsSummary = buildBeadsFormsSummary(getFormsFromMetadata(next));
  stampStringMetadata(next, 'VK_WORKSPACE_ID', options.workspaceId);
  stampStringMetadata(next, 'VK_SESSION_ID', options.sessionId);
  return next;
}

export async function appendQuestionsToBeadsForm(input: {
  options: AppendQuestionsOptions;
  patch: AppendQuestionsPatch;
  execFile?: ExecFileLike;
}): Promise<AppendQuestionsResult> {
  const exec = input.execFile ?? defaultExecFile;
  const bead = await readBead({ execFile: exec, dir: input.options.dir, beadId: input.options.beadId });
  const mutation = appendQuestionsToMetadata(bead.metadata, input.options.formId, {
    ...input.patch,
    afterQuestionId: input.options.afterQuestionId ?? input.patch.afterQuestionId,
  }, {
    baseHash: input.options.baseHash,
  });
  await updateMetadata({ execFile: exec, dir: input.options.dir, beadId: input.options.beadId, metadata: mutation.metadata });
  const urls = buildFillOutUrls({
    dir: input.options.dir,
    beadId: input.options.beadId,
    formId: input.options.formId,
    origin: input.options.origin,
    workspaceId: input.options.workspaceId,
  });
  return {
    beadId: input.options.beadId,
    formId: input.options.formId,
    appendedQuestionIds: input.patch.questions.map((question) => question.id),
    formHashBefore: mutation.formHashBefore,
    formHashAfter: mutation.formHashAfter,
    url: urls.workspace ?? urls.dir,
    urls,
    metadata: mutation.metadata,
  };
}

export function appendQuestionsToMetadata(
  metadata: unknown,
  formId: string,
  patch: AppendQuestionsPatch,
  options: { baseHash?: string } = {},
): { metadata: JsonObject; formHashBefore: string; formHashAfter: string } {
  const next: JsonObject = isObject(metadata) ? structuredClone(metadata) as JsonObject : {};
  const beadForms = isObject(next.beadForms) ? next.beadForms : undefined;
  if (!beadForms || !Array.isArray(beadForms.forms)) throw new Error('No canonical beadForms.forms[] metadata found on bead');

  const forms = getFormsFromMetadata(next);
  const formIndex = forms.findIndex((candidate) => candidate.id === formId);
  if (formIndex < 0) throw new Error(`Form not found: ${formId}`);
  const form = forms[formIndex]!;
  const formHashBefore = buildFormDefinitionHash(form);
  if (options.baseHash && options.baseHash !== formHashBefore) {
    throw new Error(`Form ${formId} changed since base hash ${options.baseHash}; current hash is ${formHashBefore}`);
  }

  assertUniqueQuestionIds(patch.questions);
  assertNoForbiddenAppendQuestionFields(patch.questions);
  const existingQuestionIds = new Set(form.questions.map((question) => question.id));
  for (const question of patch.questions) {
    if (existingQuestionIds.has(question.id)) throw new Error(`Question id already exists on form ${formId}: ${question.id}`);
  }

  const insertionIndex = patch.afterQuestionId
    ? form.questions.findIndex((question) => question.id === patch.afterQuestionId)
    : form.questions.length - 1;
  if (patch.afterQuestionId && insertionIndex < 0) {
    throw new Error(`afterQuestionId not found on form ${formId}: ${patch.afterQuestionId}`);
  }
  const insertAt = patch.afterQuestionId ? insertionIndex + 1 : form.questions.length;
  const questions = [
    ...form.questions.slice(0, insertAt),
    ...patch.questions,
    ...form.questions.slice(insertAt),
  ] as StandardBeadsForm['questions'];
  const updatedForm = stripGeneratedBeadsFormFields({
    ...form,
    questions,
  } as StoredBeadsForm);
  compileBeadsForm(updatedForm);

  forms[formIndex] = updatedForm;
  const storedForms = forms.map(stripResponsesFromForm);
  next.beadForms = { ...beadForms, forms: storedForms };
  writeSplitResponses(next, forms);
  next.beadFormsSummary = buildBeadsFormsSummary(getFormsFromMetadata(next));
  return {
    metadata: next,
    formHashBefore,
    formHashAfter: buildFormDefinitionHash(updatedForm),
  };
}

export function buildFormDefinitionHash(form: BeadsFormDefinition): string {
  const { responses: _responses, ...definition } = stripGeneratedBeadsFormFields(form as StoredBeadsForm) as BeadsFormDefinition;
  return createHash('sha256').update(stableStringify(definition)).digest('hex');
}

function normalizeStoredForm(value: unknown): BeadsFormDefinition {
  if (isHtmlForm(value) && !isStoredStandardFormLike(value)) {
    throw new Error('Raw HTML BeadsForms are no longer supported; express the form with the standard BeadsForm DSL.');
  }
  if (!isStoredStandardFormLike(value)) {
    throw new Error('Cannot update bead metadata because beadForms.forms[] contains a non-standard BeadsForm');
  }
  const stored = stripGeneratedBeadsFormFields(withLegacyFallbackGoal(value));
  compileBeadsForm(stored);
  return stored;
}

function isBeadsFormResponse(value: unknown): value is BeadsFormResponse {
  return isObject(value)
    && typeof value.submittedBy === 'string'
    && typeof value.submittedAt === 'string'
    && isObject(value.values);
}

function getSplitResponsesByFormId(metadata: JsonObject): Map<string, BeadsFormResponse[]> {
  const responsesByFormId = new Map<string, BeadsFormResponse[]>();
  const namespace = metadata.beadFormResponses;
  if (!isObject(namespace) || !isObject(namespace.responsesByFormId)) return responsesByFormId;
  for (const [formId, responses] of Object.entries(namespace.responsesByFormId)) {
    if (Array.isArray(responses) && responses.every(isBeadsFormResponse)) {
      responsesByFormId.set(formId, responses);
    }
  }
  return responsesByFormId;
}

function applySplitResponses(metadata: JsonObject, forms: BeadsFormDefinition[]): BeadsFormDefinition[] {
  const splitResponses = getSplitResponsesByFormId(metadata);
  return forms.map((form) => {
    const responses = splitResponses.get(form.id) ?? form.responses;
    if (!responses) return form;
    return { ...form, responses };
  });
}

function stripResponsesFromForm(form: BeadsFormDefinition): StoredBeadsForm {
  const { responses: _responses, ...stored } = stripGeneratedBeadsFormFields(form as StoredBeadsForm) as BeadsFormDefinition;
  return stored as StoredBeadsForm;
}

function writeSplitResponses(next: JsonObject, forms: BeadsFormDefinition[]): void {
  const responsesByFormId: BeadFormResponsesMetadata['responsesByFormId'] = {};
  for (const form of forms) {
    if ((form.responses?.length ?? 0) > 0) responsesByFormId[form.id] = form.responses!;
  }
  if (Object.keys(responsesByFormId).length > 0) {
    next.beadFormResponses = { responsesByFormId };
  } else {
    delete next.beadFormResponses;
  }
}

export function buildBeadsFormsSummary(forms: readonly BeadsFormDefinition[]): BeadsFormsSummary {
  const formIds = forms.map((form) => form.id);
  const pendingFormIds = forms
    .filter((form) => (form.responses?.length ?? 0) === 0)
    .map((form) => form.id);
  return {
    hasForms: formIds.length > 0,
    hasPendingAnswer: pendingFormIds.length > 0,
    pendingResponseCount: pendingFormIds.length,
    formIds,
    pendingFormIds,
  };
}

function stampStringMetadata(metadata: JsonObject, key: string, value: string | undefined): void {
  const trimmed = value?.trim();
  if (trimmed) metadata[key] = trimmed;
}

export function buildFillOutUrl(args: {
  dir: string;
  beadId: string;
  formId: string;
  origin?: string;
  workspaceId?: string;
}): string {
  const params = new URLSearchParams();
  if (args.workspaceId) {
    params.set('workspace', args.workspaceId);
  }
  params.set('dir', resolve(args.dir));
  params.set('bead', args.beadId);
  params.set('form', args.formId);
  const path = `/dashboard/forms?${params.toString()}`;
  return args.origin ? `${args.origin.replace(/\/$/, '')}${path}` : path;
}

export function buildFillOutUrls(args: {
  dir: string;
  beadId: string;
  formId: string;
  origin?: string;
  workspaceId?: string;
}): { dir: string; workspace?: string } {
  const dir = buildFillOutUrl({
    dir: args.dir,
    beadId: args.beadId,
    formId: args.formId,
    origin: args.origin,
  });
  if (!args.workspaceId) return { dir };
  return {
    workspace: buildFillOutUrl(args),
    dir,
  };
}

async function defaultExecFile(
  file: string,
  args: readonly string[],
  options: { cwd: string; timeout: number; maxBuffer?: number },
): Promise<{ stdout: string | Buffer; stderr: string | Buffer }> {
  return execFileAsync(file, [...args], options);
}

async function readBead(input: {
  execFile: ExecFileLike;
  dir: string;
  beadId: string;
}): Promise<BeadLike> {
  const { stdout } = await input.execFile('bd', ['show', input.beadId, '--json', '--long'], {
    cwd: input.dir,
    timeout: 30_000,
    maxBuffer: 1024 * 1024 * 5,
  });
  const text = String(stdout);
  const jsonStart = text.indexOf('[');
  const jsonText = jsonStart >= 0 ? text.slice(jsonStart) : text;
  const beads = JSON.parse(jsonText) as BeadLike[];
  const bead = beads.find((candidate) => candidate.id === input.beadId);
  if (!bead) throw new Error(`Bead not found: ${input.beadId}`);
  return bead;
}

async function updateMetadata(input: {
  execFile: ExecFileLike;
  dir: string;
  beadId: string;
  metadata: JsonObject;
}): Promise<void> {
  assertMetadataWithinIssueJsonGuard(input.metadata);
  const tempDir = await mkdtemp(join(tmpdir(), 'beadsform-cli-'));
  const metadataPath = join(tempDir, 'metadata.json');
  try {
    await writeFile(metadataPath, JSON.stringify(input.metadata, null, 2), 'utf8');
    await input.execFile('bd', ['update', input.beadId, '--metadata', `@${metadataPath}`], {
      cwd: input.dir,
      timeout: 30_000,
      maxBuffer: 1024 * 1024 * 5,
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

function getFormsFromMetadata(metadata: unknown): BeadsFormDefinition[] {
  if (!isObject(metadata)) return [];
  const current = formsAt(metadata, 'beadForms');
  const legacy = formsAt(metadata, 'beadsWeb');
  const seen = new Set<string>();
  const forms = [...current, ...legacy].filter((form) => {
    if (seen.has(form.id)) return false;
    seen.add(form.id);
    return true;
  });
  return applySplitResponses(metadata, forms);
}

function formsAt(metadata: JsonObject, key: string): BeadsFormDefinition[] {
  const namespace = metadata[key];
  if (!isObject(namespace) || !Array.isArray(namespace.forms)) return [];
  return namespace.forms.map(normalizeStoredForm);
}

export async function showBeadsForm(input: {
  options: ShowOptions;
  execFile?: ExecFileLike;
}): Promise<ShowResult> {
  const bead = await readBead({
    execFile: input.execFile ?? defaultExecFile,
    dir: input.options.dir,
    beadId: input.options.beadId,
  });
  const forms = getFormsFromMetadata(bead.metadata);
  const form = selectFormForShow(forms, input.options.formId);
  return buildShowResult({ bead, form });
}

export function selectFormForShow(forms: BeadsFormDefinition[], formId?: string): BeadsFormDefinition {
  if (formId) {
    const form = forms.find((candidate) => candidate.id === formId);
    if (!form) throw new Error(`Form not found: ${formId}`);
    return form;
  }
  if (forms.length === 1) return forms[0]!;
  if (forms.length === 0) throw new Error('No forms attached to this bead');
  throw new Error(`Multiple forms attached; pass --form. Available forms: ${forms.map((form) => form.id).join(', ')}`);
}

export function buildShowResult(input: {
  bead: BeadLike;
  form: BeadsFormDefinition;
}): ShowResult {
  const form = input.form;
  const showForm: ShowForm = {
    id: form.id,
    goal: form.goal,
    title: form.title,
    ...(form.description ? { description: form.description } : {}),
    ...(form.version !== undefined ? { version: form.version } : {}),
    ...(form.format ? { format: form.format } : {}),
    ...(form.content ? { content: form.content } : {}),
    ...(form.questions ? { questions: form.questions } : {}),
  };
  const responses = form.responses ?? [];
  return {
    bead: {
      id: input.bead.id,
      ...(input.bead.title ? { title: input.bead.title } : {}),
      ...(input.bead.description ? { description: input.bead.description } : {}),
    },
    form: showForm,
    responses,
    responseCount: responses.length,
    noResponses: responses.length === 0,
    mediaRefs: collectMediaRefs(form),
  };
}

export async function scanPendingBeadsForms(input: {
  options: PendingOptions;
  execFile?: ExecFileLike;
}): Promise<PendingFormsCliResult> {
  const client = new BeadsClient(input.execFile ? { execFile: input.execFile } : {});
  const queue = await client.listPendingBeadsFormQueue({
    reposRoot: input.options.parentDir,
    repoLimit: input.options.limit,
  });
  const entries = queue.entries.map((entry) => ({
    repo: {
      name: entry.repoName,
      path: entry.repoDir,
    },
    bead: entry.bead,
    form: entry.form,
    url: buildFillOutUrl({
      dir: entry.repoDir,
      beadId: entry.bead.id,
      formId: entry.form.id,
      origin: input.options.origin,
    }),
  }));
  return {
    parentDir: queue.reposRoot,
    repoLimit: queue.repoLimit,
    reposScanned: queue.reposScanned,
    pendingCount: entries.length,
    entries,
    skipped: queue.skipped,
    updateStrategy: queue.updateStrategy,
  };
}

export function collectMediaRefs(form: Pick<BeadsFormDefinition, 'content'>): ShowMediaRef[] {
  const refs: ShowMediaRef[] = [];
  for (const block of form.content ?? []) {
    if (block.type === 'media-gallery') {
      for (const item of block.items) {
        refs.push({
          galleryId: block.id,
          itemId: item.id,
          type: item.type,
          src: item.src,
          ...(item.poster ? { poster: item.poster } : {}),
          ...(item.caption ? { caption: item.caption } : {}),
          ...(item.alt ? { alt: item.alt } : {}),
        });
      }
    }
    if (block.type === 'markdown-attachment') {
      refs.push({
        blockId: block.id,
        type: 'markdown',
        ref: block.ref,
      });
    }
    if (block.type === 'attachments') {
      for (const item of block.items) {
        refs.push({
          blockId: block.id,
          itemId: item.id,
          type: item.mediaType ?? 'file',
          ref: item.ref,
        });
      }
    }
    if (block.type === 'code-snippet') {
      refs.push({
        blockId: block.id,
        type: 'code-snippet',
        path: block.path,
        commit: block.commit,
        startLine: block.startLine,
        ...(block.endLine ? { endLine: block.endLine } : {}),
      });
    }
  }
  return refs;
}

function isObject(value: unknown): value is JsonObject {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (isObject(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function printHelp(): void {
  console.log(`Usage:
  beads-form attach --bead <id> (--file form.json | --json raw-json | --stdin) [--dir repo] [--origin origin] [--workspace id] [--session id]
  beads-form append-questions --bead <id> --form <form-id> (--file questions.json | --json raw-json | --stdin) [--dir repo] [--after-question id] [--base-hash sha256] [--origin origin] [--workspace id]
  beads-form show --bead <id> [--form form-id] [--dir repo]
  beads-form pending --parent-dir <all-repos-dir> [--limit 80] [--origin origin]

Also supported:
  npm run beads-form -- attach --bead <id> (--file form.json | --json raw-json | --stdin) [--dir repo] [--origin origin] [--workspace id] [--session id]
  npm run beads-form -- append-questions --bead <id> --form <form-id> (--file questions.json | --json raw-json | --stdin) [--dir repo] [--after-question id] [--base-hash sha256] [--origin origin] [--workspace id]
  npm run beads-form -- show --bead <id> [--form form-id] [--dir repo]
  npm run beads-form -- pending --parent-dir <all-repos-dir> [--limit 80] [--origin origin]

Attach origin precedence:
  1. explicit --origin
  2. BEADS_FORM_ORIGIN or VD_BEADS_FORM_ORIGIN
  3. ${DEFAULT_CONFIG_FILE_NAME} with {"origin":"https://example.test"} under XDG_CONFIG_HOME/${DEFAULT_CONFIG_DIR_NAME}/

Attach metadata stamps:
  VK_WORKSPACE_ID from --workspace or env, and VK_SESSION_ID from --session or env, when non-empty.

Default show output is JSON and includes all responses.`);
}

async function main(): Promise<void> {
  const command = parseBeadsFormCliArgs(process.argv.slice(2));
  if (command.command === 'help') {
    printHelp();
    return;
  }

  if (command.command === 'attach') {
    const text = await readAttachInput(command.options);
    const forms = parseFormsJsonForAttach(text);
    const result = await attachBeadsForms({ options: command.options, forms });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command.command === 'append-questions') {
    const text = await readAppendQuestionsInput(command.options);
    const patch = parseQuestionsJsonForAppend(text);
    const result = await appendQuestionsToBeadsForm({ options: command.options, patch });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command.command === 'pending') {
    const result = await scanPendingBeadsForms({ options: command.options });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  const result = await showBeadsForm({ options: command.options });
  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], 'file:').href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
