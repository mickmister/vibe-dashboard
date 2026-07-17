import { describe, expect, it } from 'vitest';
import {
  buildTmuxStartCommand,
  parseSharedPreviewArgs,
  plannedSharedPreviewCommands,
  resolveSharedPreviewConfig,
} from './shared-preview';

describe('shared BeadsForm preview server helper', () => {
  it('resolves a stable checkout config and useful URLs without using ephemeral worktrees', () => {
    const config = resolveSharedPreviewConfig({ printOnly: true }, {});

    expect(config.checkoutDir).toBe('/var/tmp/beadsform-preview-stable/vibe-kanban-vscode-web');
    expect(config.checkoutDir).not.toContain('/var/tmp/vibe-kanban/worktrees/beadsform-next');
    expect(config.branch).toBe('vk/8299-beads-web-show-m');
    expect(config.previewUrl).toBe('http://localhost:55123/dashboard/forms/preview?folder=%2Ftmp%2Fbeads-form-preview');
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
      port: '55123',
      serverPort: '55124',
    }, {});

    expect(buildTmuxStartCommand(config)).toBe(
      "cd '/stable/vd' && BEADS_FORM_DISABLE_HMR=1 npm run dev:beads-form-preview -- --folder '/tmp/forms with spaces' --port '55123' --server-port '55124' --host 'https://preview.example.test' > '/tmp/beadsform.log' 2>&1",
    );
  });

  it('plans stop, sync, install, and tmux start in the expected order', () => {
    const config = resolveSharedPreviewConfig({ checkoutDir: '/stable/vd', branch: 'feature/forms', session: 'preview' }, {});
    const commands = plannedSharedPreviewCommands(config);

    expect(commands[0]).toBe("tmux kill-session -t 'preview' || true");
    expect(commands).toContain("git clone --branch 'feature/forms' 'https://github.com/mickmister/vibe-dashboard.git' '/stable/vd'");
    expect(commands).toContain('pnpm install --frozen-lockfile');
    expect(commands.at(-1)).toContain("tmux new-session -d -s 'preview'");
    expect(commands.at(-1)).toContain('BEADS_FORM_DISABLE_HMR=1');
  });
});
