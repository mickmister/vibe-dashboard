/// <reference types="node" />

import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { getBeadsForms, type BeadsFormDefinition } from './beadsFormCore';

export type FolderBeadsForm = BeadsFormDefinition & {
  sourceFile: string;
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

function formsFromJson(parsed: unknown): BeadsFormDefinition[] {
  const directForms = getBeadsForms(parsed);
  if (directForms.length > 0) return directForms;

  if (Array.isArray(parsed)) {
    return getBeadsForms({ beadForms: { forms: parsed } });
  }

  return getBeadsForms({ beadForms: { forms: [parsed] } });
}
