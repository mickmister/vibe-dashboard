import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Gas City runtime packaging GCW-9', () => {
  const dockerfile = readFileSync(resolve('Dockerfile.vkvd'), 'utf8');
  const workflowDockerfile = readFileSync(resolve('scripts/Dockerfile.workflow-e2e'), 'utf8');
  const workflowHarness = readFileSync(resolve('scripts/workflow-e2e-docker-playwright.sh'), 'utf8');
  const runtimeSmoke = readFileSync(resolve('scripts/smoke-gas-city-runtime.sh'), 'utf8');
  const provider = readFileSync(resolve('src/modules/plugins/workflows/server/gasCityCliWorkflowProvider.ts'), 'utf8');
  const adr = readFileSync(resolve('docs/adr/0002-gas-city-backed-vd-workflows.md'), 'utf8');

  it('pins compatible released Gas City and Beads versions in runtime images', () => {
    for (const contents of [dockerfile, workflowDockerfile]) {
      expect(contents).toContain('ARG GASCITY_VERSION=v1.4.1');
      expect(contents).toContain('ARG BEADS_VERSION=v1.2.2');
      expect(contents).toContain('github.com/gastownhall/gascity/releases/download/${GASCITY_VERSION}');
      expect(contents).toContain('gascity_${GASCITY_VERSION#v}_checksums.txt');
      expect(contents).toContain('github.com/gastownhall/beads/releases/download/${BEADS_VERSION}');
      expect(contents).toContain('checksums.txt');
      expect(contents).toContain('gc version --json | grep -F "${GASCITY_VERSION#v}"');
      expect(contents).toContain('bd version | grep -F "${BEADS_VERSION#v}"');
    }
    expect(provider).toContain('DEFAULT_PINNED_GAS_CITY_VERSION = "1.4.1"');
    expect(adr).toContain('GASCITY_VERSION=v1.4.1');
    expect(adr).toContain('BEADS_VERSION=v1.2.2');
  });

  it('installs and smokes the VD-owned gc-session-vibe bridge without requiring a Gas City checkout', () => {
    expect(dockerfile).toContain('go install ./cmd/gc-session-vibe');
    expect(dockerfile).toContain('GC_EXEC_STATE_DIR=/tmp/gc-session-vibe-smoke gc-session-vibe list-running');
    expect(workflowHarness).toContain('run_with_log gc-session-vibe-build');
    expect(workflowHarness).toContain('GC_EXEC_STATE_DIR=/tmp/gc-session-vibe-smoke gc-session-vibe list-running');
    expect(runtimeSmoke).toContain('gc-session-vibe list-running');
    expect(runtimeSmoke).toContain('--skip-bridge');
  });

  it('keeps Docker workflow E2E on the same pinned runtime tools', () => {
    expect(workflowHarness).toContain('run_with_log gas-city-runtime-smoke bash scripts/smoke-gas-city-runtime.sh --skip-bridge');
    expect(workflowDockerfile).toContain('ENV VD_GAS_CITY_VERSION=${GASCITY_VERSION}');
    expect(workflowDockerfile).toContain('ENV VD_BEADS_VERSION=${BEADS_VERSION}');
    expect(workflowDockerfile).toContain('ENV GC_HOME=/root/.gc');
    expect(workflowDockerfile).toContain('ENV XDG_RUNTIME_DIR=/tmp/vibe-kanban/gc-runtime');
  });
});
