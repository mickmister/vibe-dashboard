import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('workflow-e2e-docker-playwright harness', () => {
  it('runs workflow Playwright E2E inside Docker with read-only source mounts', () => {
    const script = readFileSync(
      resolve('scripts/workflow-e2e-docker-playwright.sh'),
      'utf8',
    );

    expect(script).toContain('docker run');
    expect(script).toContain('docker exec');
    expect(script).toContain('--volume "${vd_repo_dir}:/mnt/source/vibe-kanban-vscode-web:ro"');
    expect(script).toContain('--volume "${vk_repo_dir}:/mnt/source/vibe-kanban:ro"');
    expect(script).toContain('tar -C /mnt/source/vibe-kanban-vscode-web');
    expect(script).toContain('tar -C /mnt/source/vibe-kanban');
    expect(script).toContain('npx playwright test --config playwright.vk-workflows-docker.config.ts');

    const dockerExecIndex = script.indexOf('docker exec');
    const playwrightIndex = script.indexOf('npx playwright test --config playwright.vk-workflows-docker.config.ts');
    expect(dockerExecIndex).toBeGreaterThanOrEqual(0);
    expect(playwrightIndex).toBeGreaterThan(dockerExecIndex);
  });

  it('excludes host build artifacts when copying mounted sources into the container', () => {
    const script = readFileSync(
      resolve('scripts/workflow-e2e-docker-playwright.sh'),
      'utf8',
    );

    for (const excluded of [
      '--exclude node_modules',
      '--exclude target',
      '--exclude dev_assets',
      '--exclude .vk-mocked-sandbox',
    ]) {
      expect(script).toContain(excluded);
    }
  });
});
