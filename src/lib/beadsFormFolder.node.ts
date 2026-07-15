/// <reference types="node" />

import { mkdir, readdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getBeadsForms, type BeadsFormDefinition, type JsonObject } from './beadsFormCore';

export type FolderBeadsForm = BeadsFormDefinition & {
  sourceFile: string;
};

export type PreviewResponseRecord = {
  formId: string;
  submittedAt: string;
  values: JsonObject;
};

export async function loadBeadsFormsFromFolder(folder: string): Promise<FolderBeadsForm[]> {
  const trimmed = folder.trim();
  if (!trimmed) throw new Error('folder is required');
  const folderStat = await stat(trimmed);
  if (!folderStat.isDirectory()) throw new Error(`BeadsForm preview path is not a directory: ${trimmed}`);

  const entries = await readdir(trimmed, { withFileTypes: true });
  const forms: FolderBeadsForm[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    const sourceFile = join(trimmed, entry.name);
    const parsed = JSON.parse(await readFile(sourceFile, 'utf8')) as unknown;
    forms.push(...formsFromJson(parsed).map((form) => ({ ...form, sourceFile })));
  }

  forms.sort((a, b) => a.id.localeCompare(b.id));
  return forms;
}

export async function appendBeadsFormPreviewResponse(
  folder: string,
  formId: string,
  values: JsonObject,
  submittedAt = new Date().toISOString(),
): Promise<{ submittedAt: string; sidecarPath: string; responses: PreviewResponseRecord[] }> {
  const folderPath = folder.trim();
  if (!folderPath) throw new Error('folder is required');
  const folderStat = await stat(folderPath);
  if (!folderStat.isDirectory()) throw new Error(`BeadsForm preview path is not a directory: ${folderPath}`);

  const realFolder = await realpath(folderPath);
  const sidecarDir = join(realFolder, '.beads-form-responses');
  await mkdir(sidecarDir, { recursive: true });

  const sidecarPath = join(sidecarDir, `${safeSidecarName(formId)}.responses.json`);
  const existing = await readPreviewResponses(sidecarPath);
  const responses = [...existing, { formId, submittedAt, values }];
  await writeFile(sidecarPath, `${JSON.stringify({ responses }, null, 2)}\n`, 'utf8');
  return { submittedAt, sidecarPath, responses };
}

function formsFromJson(parsed: unknown): BeadsFormDefinition[] {
  const directForms = getBeadsForms(parsed);
  if (directForms.length > 0) return directForms;

  if (Array.isArray(parsed)) {
    return getBeadsForms({ beadForms: { forms: parsed } });
  }

  return getBeadsForms({ beadForms: { forms: [parsed] } });
}

async function readPreviewResponses(sidecarPath: string): Promise<PreviewResponseRecord[]> {
  try {
    const parsed = JSON.parse(await readFile(sidecarPath, 'utf8')) as { responses?: unknown };
    if (!Array.isArray(parsed.responses)) return [];
    return parsed.responses.filter(isPreviewResponseRecord);
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return [];
    throw error;
  }
}

function safeSidecarName(formId: string): string {
  const safe = formId.replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
  return safe || 'form';
}

function isPreviewResponseRecord(value: unknown): value is PreviewResponseRecord {
  return !!value
    && typeof value === 'object'
    && !Array.isArray(value)
    && 'formId' in value
    && typeof value.formId === 'string'
    && 'submittedAt' in value
    && typeof value.submittedAt === 'string'
    && 'values' in value
    && !!value.values
    && typeof value.values === 'object'
    && !Array.isArray(value.values);
}
