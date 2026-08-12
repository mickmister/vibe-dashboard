import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('workflow-e2e-docker-playwright harness', () => {
  it('runs workflow Playwright E2E inside Docker with read-only source mounts', () => {
    const script = readFileSync(
      resolve('scripts/workflow-e2e-docker-playwright.sh'),
      'utf8',
    );
    const dockerfile = readFileSync(
      resolve('scripts/Dockerfile.workflow-e2e'),
      'utf8',
    );

    expect(script).toContain('docker build');
    expect(script).toContain('scripts/Dockerfile.workflow-e2e');
    expect(script).toContain('docker run');
    expect(script).toContain('docker exec');
    expect(script).toContain('--volume "${vd_repo_dir}:/mnt/source/vibe-kanban-vscode-web:ro"');
    expect(script).toContain('--volume "${vk_repo_dir}:/mnt/source/vibe-kanban:ro"');
    expect(script).toContain('--volume "${log_dir}:/tmp/workflow-e2e-logs"');
    expect(script).toContain('--volume "${cargo_target_volume}:/tmp/vk-target"');
    expect(script).toContain('--volume "${cargo_registry_volume}:/root/.cargo/registry"');
    expect(script).toContain('--volume "${cargo_git_volume}:/root/.cargo/git"');
    expect(script).toContain('tar -C /mnt/source/vibe-kanban-vscode-web');
    expect(script).toContain('tar -C /mnt/source/vibe-kanban');
    expect(script).toContain('npx playwright test --config playwright.vk-workflows-docker.config.ts --output=/tmp/workflow-e2e-logs/playwright-test-results');
    expect(dockerfile).toContain('libclang-dev');
    expect(dockerfile).toContain('lld');
    expect(dockerfile).toContain('clang');
    expect(dockerfile).toContain('--profile minimal --default-toolchain stable');
    expect(script).toContain('--env VK_MOCKED_SKIP_LOCAL_WEB_BUILD=1');
    expect(script).toContain('--env VK_QA_SCRIPTED_OUTCOME_FILE="${VK_QA_SCRIPTED_OUTCOME_FILE:-}"');
    expect(script).toContain('--env WORKFLOW_E2E_PLAYWRIGHT_ARGS="${WORKFLOW_E2E_PLAYWRIGHT_ARGS:-}"');
    expect(script).toContain('VK mocked local web stub');
    expect(script).toContain('find /root/.cargo/git /tmp/vk-target -name "*.lock" -delete');
    expect(script).toContain('run_with_log vk-cargo-build cargo build --features qa-mode --bin server');
    expect(script).toContain('run_with_log');
    expect(script).toContain('still running');
    expect(script).toContain('run_with_log playwright npx playwright test --config playwright.vk-workflows-docker.config.ts --output=/tmp/workflow-e2e-logs/playwright-test-results');
    expect(script).toContain('${WORKFLOW_E2E_PLAYWRIGHT_ARGS}');
    const playwrightConfig = readFileSync(resolve('playwright.vk-workflows-docker.config.ts'), 'utf8');
    expect(playwrightConfig).toContain("trace: 'on'");
    expect(playwrightConfig).toContain("video: 'on'");
    expect(script).toContain('--env CARGO_BUILD_JOBS="${CARGO_BUILD_JOBS:-1}"');
    expect(script).toContain('--env CARGO_TARGET_DIR=/tmp/vk-target');
    expect(script).toContain('WORKFLOW_E2E_CARGO_TARGET_VOLUME');
    expect(script).toContain('--env CARGO_PROFILE_DEV_DEBUG=0');
    expect(script).toContain('PNPM_CONFIG_CHILD_CONCURRENCY');
    expect(script).toContain('--env OPENSSL_NO_VENDOR=1');
    expect(script).toContain('--child-concurrency=1');
    expect(script).toContain('--env RUSTFLAGS="${RUSTFLAGS:--C debuginfo=0 -C linker=clang -C link-arg=-fuse-ld=lld}"');
    expect(script).toContain('--env RUSTUP_TOOLCHAIN=stable');

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
