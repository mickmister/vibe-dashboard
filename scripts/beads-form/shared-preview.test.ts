import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  buildTmuxStartCommand,
  parseSharedPreviewArgs,
  plannedSharedPreviewCommands,
  resolveSharedPreviewConfig,
} from './shared-preview';

describe('shared BeadsForm preview server helper', () => {
  it('keeps user-facing BeadsForm preview guidance off ephemeral /tmp paths', () => {
    const repoRoot = new URL('../../', import.meta.url);
    const docs = [
      'packages/beads-form/SKILL.md',
      'packages/beads-form/PENDING_QUEUE.md',
      'test-plans/branches/8299-beads-web-show-m/beadsform-upcoming-milestones-detailed.md',
    ].map((path) => readFileSync(new URL(path, repoRoot), 'utf8')).join('\n');

    expect(docs).not.toMatch(/(^|[\s`"'])\/tmp\//m);
    expect(docs).toContain('.vk-mocked-sandbox/beads-form-pending-cache');
    expect(docs).toContain(
      'BEADS_FORM_PENDING_CACHE_DIR="/var/tmp/vibe-kanban/worktrees/8299-beads-web-show-m/vibe-kanban-vscode-web/.vk-mocked-sandbox/beads-form-pending-cache"',
    );
    expect(docs).not.toContain('/beads-web/.vk-mocked-sandbox/beads-form-pending-cache');
    expect(docs).toContain('Automated tests may continue to use operating-system temporary');
  });

  it('resolves a stable checkout config and useful URLs without using ephemeral worktrees', () => {
    const config = resolveSharedPreviewConfig({ printOnly: true }, {});

    expect(config.checkoutDir).toBe('/var/tmp/beadsform-preview-stable/vibe-kanban-vscode-web');
    expect(config.checkoutDir).not.toContain('/var/tmp/vibe-kanban/worktrees/beadsform-next');
    expect(config.branch).toBe('vk/8299-beads-web-show-m');
    expect(config.formsDir).toBe('/var/tmp/beadsform-preview-stable/vibe-kanban-vscode-web/.vk-mocked-sandbox/beads-form-preview');
    expect(config.logPath).toBe('/var/tmp/beadsform-preview-stable/vibe-kanban-vscode-web/.vk-mocked-sandbox/logs/beadsform-shared-preview-55123.log');
    expect(config.cacheDir).toBe('/var/tmp/beadsform-preview-stable/vibe-kanban-vscode-web/.vk-mocked-sandbox/beads-form-pending-cache');
    expect(config.previewUrl).toContain('folder=%2Fvar%2Ftmp%2Fbeadsform-preview-stable');
    expect(config.parentDirUrl).toBe('http://localhost:55123/dashboard/forms?parentDir=%2Fvar%2Ftmp%2Fvibe-kanban%2Fworktrees');
  });

  it('accepts branch, stable checkout, host, folder, parent dir, and port overrides', () => {
    const options = parseSharedPreviewArgs([
      '--checkout-dir', '/stable/vd',
      '--branch=feature/forms',
      '--folder', '/forms',
      '--parent-dir=/repos',
      '--host', 'https://port-55123.example.test/',
      '--port', '55123',
      '--server-port=55124',
      '--print-only',
    ]);
    const config = resolveSharedPreviewConfig(options, {});

    expect(config).toMatchObject({
      checkoutDir: '/stable/vd',
      branch: 'feature/forms',
      formsDir: '/forms',
      parentDir: '/repos',
      host: 'https://port-55123.example.test',
      port: '55123',
      serverPort: '55124',
      printOnly: true,
    });
    expect(config.previewUrl).toContain('folder=%2Fforms');
    expect(config.parentDirUrl).toContain('parentDir=%2Frepos');
  });

  it('builds the tmux command with HMR disabled and folder preview arguments', () => {
    const config = resolveSharedPreviewConfig({
      checkoutDir: '/stable/vd',
      formsDir: '/tmp/forms with spaces',
      host: 'https://preview.example.test',
      logPath: '/tmp/beadsform.log',
      cacheDir: '/stable/vd/.vk-mocked-sandbox/beads-form-pending-cache',
      port: '55123',
      serverPort: '55124',
    }, {});

    expect(buildTmuxStartCommand(config)).toBe(
      "cd '/stable/vd' && BEADS_FORM_DISABLE_HMR=1 BEADS_FORM_PENDING_CACHE_DIR='/stable/vd/.vk-mocked-sandbox/beads-form-pending-cache' BEADS_FORM_PENDING_WARM_ON_STARTUP=0 npm run dev:beads-form-preview -- --folder '/tmp/forms with spaces' --port '55123' --server-port '55124' --host 'https://preview.example.test' > '/tmp/beadsform.log' 2>&1",
    );
  });

  it('plans stop, sync, install, and tmux start in the expected order', () => {
    const config = resolveSharedPreviewConfig({ checkoutDir: '/stable/vd', branch: 'feature/forms', session: 'preview' }, {});
    const commands = plannedSharedPreviewCommands(config);

    expect(commands[0]).toBe("tmux kill-session -t 'preview' || true");
    expect(commands).toContain("mkdir -p '/stable'");
    expect(commands).toContain("git clone --branch 'feature/forms' 'https://github.com/mickmister/vibe-dashboard.git' '/stable/vd'");
    expect(commands).toContain("pnpm --dir '/stable/vd' install --frozen-lockfile");
    expect(commands).toContain("mkdir -p '/stable/vd/.vk-mocked-sandbox/beads-form-preview' '/stable/vd/.vk-mocked-sandbox/beads-form-pending-cache' '/stable/vd/.vk-mocked-sandbox/logs'");
    expect(commands).not.toContain('pnpm install --frozen-lockfile');
    expect(commands.at(-1)).toContain("tmux new-session -d -s 'preview'");
    expect(commands.at(-1)).toContain('BEADS_FORM_DISABLE_HMR=1');
    expect(commands.at(-1)).toContain('BEADS_FORM_PENDING_WARM_ON_STARTUP=0');
  });

  it('plans checkout-scoped install for existing stable checkout sync mode', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'beadsform-shared-preview-'));
    const checkoutDir = join(tempDir, 'vibe-kanban-vscode-web');
    mkdirSync(join(checkoutDir, '.git'), { recursive: true });
    try {
      const config = resolveSharedPreviewConfig({ checkoutDir, branch: 'feature/forms', session: 'preview' }, {});
      const commands = plannedSharedPreviewCommands(config);

      expect(commands).toContain(`git -C '${checkoutDir}' fetch origin 'feature/forms'`);
      expect(commands).not.toContain(`mkdir -p '${tempDir}'`);
      expect(commands.some((command) => command.includes('git clone'))).toBe(false);
      expect(commands).toContain(`pnpm --dir '${checkoutDir}' install --frozen-lockfile`);
      expect(commands).not.toContain('pnpm install --frozen-lockfile');
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
