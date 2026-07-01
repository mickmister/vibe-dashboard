import type { RepoEnvKeyMetadata, RepoEnvSavedValueMetadata, VardashStore, VardashValueKind } from './store';

export type VardashEnvImportSource = 'pasted-env' | 'sample-template';

export interface ParsedDotenvEntry {
  key: string;
  value: string;
  line: number;
  hasAssignment: boolean;
}

export interface DotenvParseDiagnostic {
  line: number;
  message: string;
}

export interface ParsedDotenv {
  entries: ParsedDotenvEntry[];
  diagnostics: DotenvParseDiagnostic[];
}

export interface ImportVardashEnvInput {
  store: VardashStore;
  repoId: string;
  content: string;
  source: VardashEnvImportSource;
  plainKeys?: Iterable<string>;
  savedValueName?: string;
}

export interface ImportVardashEnvResult {
  keys: RepoEnvKeyMetadata[];
  savedValues: RepoEnvSavedValueMetadata[];
  diagnostics: DotenvParseDiagnostic[];
}

const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function parseDotenv(content: string): ParsedDotenv {
  const entries: ParsedDotenvEntry[] = [];
  const diagnostics: DotenvParseDiagnostic[] = [];
  const lines = content.replace(/^\uFEFF/, '').split(/\r?\n/);

  lines.forEach((rawLine, index) => {
    const line = index + 1;
    const trimmed = rawLine.trim();
    if (trimmed === '' || trimmed.startsWith('#')) return;

    const withoutExport = trimmed.startsWith('export ') ? trimmed.slice('export '.length).trimStart() : trimmed;
    const equalsIndex = withoutExport.indexOf('=');
    const rawKey = equalsIndex >= 0 ? withoutExport.slice(0, equalsIndex).trim() : withoutExport.trim();
    if (!ENV_KEY_PATTERN.test(rawKey)) {
      diagnostics.push({ line, message: 'Invalid environment variable key' });
      return;
    }

    if (equalsIndex < 0) {
      entries.push({ key: rawKey, value: '', line, hasAssignment: false });
      return;
    }

    const rawValue = withoutExport.slice(equalsIndex + 1).trimStart();
    entries.push({ key: rawKey, value: parseDotenvValue(rawValue), line, hasAssignment: true });
  });

  return { entries, diagnostics };
}

export async function importVardashEnv(input: ImportVardashEnvInput): Promise<ImportVardashEnvResult> {
  const parsed = parseDotenv(input.content);
  const plainKeys = new Set(input.plainKeys ?? []);
  const keys: RepoEnvKeyMetadata[] = [];
  const savedValues: RepoEnvSavedValueMetadata[] = [];
  const savedValueName = input.savedValueName ?? 'imported';

  for (const entry of parsed.entries) {
    const kind: VardashValueKind = plainKeys.has(entry.key) ? 'plain' : 'secret';
    const key = await input.store.upsertRepoEnvKey({
      repoId: input.repoId,
      key: entry.key,
      kind,
      required: true,
    });
    keys.push(key);

    if (input.source === 'pasted-env') {
      savedValues.push(
        await input.store.createSavedValue({
          repoId: input.repoId,
          envKeyId: key.id,
          name: savedValueName,
          value: entry.value,
        }),
      );
    }
  }

  return { keys, savedValues, diagnostics: parsed.diagnostics };
}

function parseDotenvValue(rawValue: string): string {
  if (rawValue.startsWith('"')) return parseDoubleQuotedValue(rawValue);
  if (rawValue.startsWith("'")) return parseSingleQuotedValue(rawValue);
  return stripInlineComment(rawValue).trimEnd();
}

function parseSingleQuotedValue(rawValue: string): string {
  const end = rawValue.indexOf("'", 1);
  if (end < 0) return rawValue.slice(1);
  return rawValue.slice(1, end);
}

function parseDoubleQuotedValue(rawValue: string): string {
  let result = '';
  for (let index = 1; index < rawValue.length; index += 1) {
    const char = rawValue[index];
    if (char === '"') return result;
    if (char === '\\' && index + 1 < rawValue.length) {
      index += 1;
      result += decodeEscape(rawValue[index] ?? '');
      continue;
    }
    result += char;
  }
  return result;
}

function decodeEscape(char: string): string {
  switch (char) {
    case 'n':
      return '\n';
    case 'r':
      return '\r';
    case 't':
      return '\t';
    case '"':
      return '"';
    case '\\':
      return '\\';
    default:
      return char;
  }
}

function stripInlineComment(value: string): string {
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === '#' && (index === 0 || /\s/.test(value[index - 1] ?? ''))) {
      return value.slice(0, index);
    }
  }
  return value;
}
