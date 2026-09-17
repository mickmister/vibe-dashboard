import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { buildDeclarativeWorkflowRunRequestBody } from './vk.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('vk workflow CLI helpers', () => {
  it('includes inline declarative definition JSON in workflow run request bodies', () => {
    const body = buildDeclarativeWorkflowRunRequestBody({
      'definition-json': JSON.stringify({ id: 'custom-workflow', version: 1 }),
      'instance-id': 'instance-1',
    }, { task: 'Do it' }, { id: 'team-1' });

    expect(body).toMatchObject({
      input: { task: 'Do it' },
      team: { id: 'team-1' },
      definition: { id: 'custom-workflow', version: 1 },
      instanceId: 'instance-1',
    });
  });

  it('includes declarative definition JSON read from --definition-file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vd-workflow-cli-'));
    tempDirs.push(dir);
    const file = join(dir, 'definition.json');
    writeFileSync(file, JSON.stringify({ id: 'file-workflow', version: 1 }));

    const body = buildDeclarativeWorkflowRunRequestBody({ 'definition-file': file }, { task: 'Do it' }, { id: 'team-1' });

    expect(body).toMatchObject({ definition: { id: 'file-workflow', version: 1 } });
  });
});
