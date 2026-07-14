/// <reference types="node" />

import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

import {
  compileBeadsForm,
  type BeadsFormControl,
  type StandardBeadsForm,
} from '../../packages/beads-form/src/index.ts';

const execFileAsync = promisify(execFile);

export type JsonObject = Record<string, unknown>;

export type BeadsFormResponse = {
  submittedBy: string;
  submittedAt: string;
  values: JsonObject;
  prettySummary?: string;
};

export type BeadsFormDefinition = {
  id: string;
  title: string;
  description?: string;
  version?: number;
  html: string;
  controls?: BeadsFormControl[];
  responses?: BeadsFormResponse[];
  sourceMessages?: Array<{ source?: string; submittedAt?: string; text: string }>;
  format?: 'standard';
  questions?: StandardBeadsForm['questions'];
  content?: StandardBeadsForm['content'];
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
  | { command: 'show'; options: ShowOptions }
  | { command: 'help'; options: CliOptions };

export type AttachOptions = {
  dir: string;
  beadId: string;
  file?: string;
  json?: string;
  stdin?: boolean;
  origin?: string;
  workspaceId?: string;
};

export type ShowOptions = {
  dir: string;
  beadId: string;
  formId?: string;
  includeHtml?: boolean;
};

export type AttachResult = {
  beadId: string;
  forms: Array<{ id: string; title: string; url: string }>;
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
  title: string;
  description?: string;
  version?: number;
  format?: BeadsFormDefinition['format'];
  content?: BeadsFormDefinition['content'];
  questions?: BeadsFormDefinition['questions'];
  html?: string;
  controls?: BeadsFormControl[];
};

export type ShowMediaRef = {
  galleryId: string;
  itemId: string;
  type: 'image' | 'video';
  src: string;
  poster?: string;
  caption?: string;
  alt?: string;
};

export function parseBeadsFormCliArgs(argv: string[]): BeadsFormCliCommand {
  const [command = 'help', ...rest] = argv;
  const options = parseOptions(rest);
  if (command === 'attach') {
    return { command, options: normalizeAttachOptions(options) };
  }
  if (command === 'show') {
    return { command, options: normalizeShowOptions(options) };
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
    if (arg === '--include-html') {
      options.includeHtml = true;
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
  return {
    dir: resolve(stringOption(options, 'dir') ?? process.cwd()),
    beadId,
    ...(file ? { file } : {}),
    ...(json ? { json } : {}),
    ...(stdin ? { stdin: true } : {}),
    ...(stringOption(options, 'origin') ? { origin: stringOption(options, 'origin') } : {}),
    ...(stringOption(options, 'workspace') ?? process.env.VK_WORKSPACE_ID
      ? { workspaceId: stringOption(options, 'workspace') ?? process.env.VK_WORKSPACE_ID }
      : {}),
  };
}

function normalizeShowOptions(options: CliOptions): ShowOptions {
  const beadId = stringOption(options, 'bead') ?? stringOption(options, 'bead-id') ?? options._[0];
  if (!beadId) throw new Error('Usage: npm run beads-form -- show --bead <bead-id> [--form <form-id>] [--include-html]');
  return {
    dir: resolve(stringOption(options, 'dir') ?? process.cwd()),
    beadId,
    ...(stringOption(options, 'form') ? { formId: stringOption(options, 'form') } : {}),
    includeHtml: options.includeHtml === true,
  };
}

function stringOption(options: CliOptions, key: string): string | undefined {
  const value = options[key];
  return typeof value === 'string' && value.trim() ? value : undefined;
}

export async function readAttachInput(options: AttachOptions, stdin = process.stdin): Promise<string> {
  if (options.file) return readFile(resolve(options.file), 'utf8');
  if (options.json) return options.json;
  if (options.stdin) return readStream(stdin);
  throw new Error('attach requires --file, --json, or --stdin');
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
  if (isHtmlForm(value)) return value;
  if (!isStandardForm(value)) return undefined;
  return compileBeadsForm(value);
}

function isHtmlForm(value: unknown): value is BeadsFormDefinition {
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
    && typeof value.title === 'string'
    && value.title.trim().length > 0
    && Array.isArray(value.questions);
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

function assertUniqueFormIds(forms: BeadsFormDefinition[]): void {
  const seen = new Set<string>();
  for (const form of forms) {
    if (seen.has(form.id)) throw new Error(`Duplicate form id in input: ${form.id}`);
    seen.add(form.id);
  }
}

function assertNoLocalBeadBackedMediaRefs(form: BeadsFormDefinition): void {
  for (const ref of collectMediaRefs(form)) {
    for (const [field, value] of Object.entries({ src: ref.src, poster: ref.poster })) {
      if (typeof value !== 'string' || !value) continue;
      if (isLocalMediaRef(value)) {
        throw new Error(`Form ${form.id} uses local media ${field} "${value}"; bead-backed media only supports non-local refs for now`);
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
  const metadata = attachFormsToMetadata(bead.metadata, input.forms);
  await updateMetadata({ execFile: exec, dir: input.options.dir, beadId: input.options.beadId, metadata });
  return {
    beadId: input.options.beadId,
    forms: input.forms.map((form) => ({
      id: form.id,
      title: form.title,
      url: buildFillOutUrl({
        dir: input.options.dir,
        beadId: input.options.beadId,
        formId: form.id,
        origin: input.options.origin,
        workspaceId: input.options.workspaceId,
      }),
    })),
    metadata,
  };
}

export function attachFormsToMetadata(metadata: unknown, forms: BeadsFormDefinition[]): JsonObject {
  const next: JsonObject = isObject(metadata) ? structuredClone(metadata) as JsonObject : {};
  const beadForms = isObject(next.beadForms) ? next.beadForms : { forms: [] };
  const existingForms = Array.isArray(beadForms.forms) ? [...beadForms.forms] : [];
  const existingIds = new Set(existingForms
    .filter((form): form is JsonObject => isObject(form) && typeof form.id === 'string')
    .map((form) => form.id as string));
  for (const form of forms) {
    if (existingIds.has(form.id)) throw new Error(`Form id already exists on bead: ${form.id}`);
  }
  next.beadForms = { ...beadForms, forms: [...existingForms, ...forms] };
  return next;
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
  } else {
    params.set('dir', resolve(args.dir));
  }
  params.set('bead', args.beadId);
  params.set('form', args.formId);
  const path = `/dashboard/forms?${params.toString()}`;
  return args.origin ? `${args.origin.replace(/\/$/, '')}${path}` : path;
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
  return [...current, ...legacy].filter((form) => {
    if (seen.has(form.id)) return false;
    seen.add(form.id);
    return true;
  });
}

function formsAt(metadata: JsonObject, key: string): BeadsFormDefinition[] {
  const namespace = metadata[key];
  if (!isObject(namespace) || !Array.isArray(namespace.forms)) return [];
  return namespace.forms.map(normalizeForm).filter((form): form is BeadsFormDefinition => !!form);
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
  return buildShowResult({ bead, form, includeHtml: input.options.includeHtml ?? false });
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
  includeHtml?: boolean;
}): ShowResult {
  const form = input.form;
  const showForm: ShowForm = {
    id: form.id,
    title: form.title,
    ...(form.description ? { description: form.description } : {}),
    ...(form.version !== undefined ? { version: form.version } : {}),
    ...(form.format ? { format: form.format } : {}),
    ...(form.content ? { content: form.content } : {}),
    ...(form.questions ? { questions: form.questions } : {}),
  };
  if (input.includeHtml) {
    showForm.html = form.html;
    showForm.controls = form.controls ?? [];
  }
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

export function collectMediaRefs(form: Pick<BeadsFormDefinition, 'content'>): ShowMediaRef[] {
  const refs: ShowMediaRef[] = [];
  for (const block of form.content ?? []) {
    if (block.type !== 'media-gallery') continue;
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
  return refs;
}

function isObject(value: unknown): value is JsonObject {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function printHelp(): void {
  console.log(`Usage:
  npm run beads-form -- attach --bead <id> (--file form.json | --json raw-json | --stdin) [--dir repo] [--origin origin]
  npm run beads-form -- show --bead <id> [--form form-id] [--dir repo] [--include-html]

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

  const result = await showBeadsForm({ options: command.options });
  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], 'file:').href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
