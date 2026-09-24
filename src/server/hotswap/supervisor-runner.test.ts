import { describe, expect, it, vi } from 'vitest';
import { SupervisorProgramRestarter, type CommandRunner } from './supervisor-runner';

describe('SupervisorProgramRestarter', () => {
  it('restarts a supervisor program through execFile argv without shell interpolation', async () => {
    const runner: CommandRunner = { execFile: vi.fn(async () => ({ stdout: '', stderr: '' })) };
    const restarter = new SupervisorProgramRestarter({
      runner,
      supervisorConfigPath: '/etc/supervisor/conf.d/supervisord.conf',
    });

    await restarter.restart('vibe-kanban');

    expect(runner.execFile).toHaveBeenCalledWith('supervisorctl', [
      '-c',
      '/etc/supervisor/conf.d/supervisord.conf',
      'restart',
      'vibe-kanban',
    ]);
  });

  it('rejects unsafe supervisor program names before invoking the command runner', async () => {
    const runner: CommandRunner = { execFile: vi.fn(async () => ({ stdout: '', stderr: '' })) };
    const restarter = new SupervisorProgramRestarter({ runner });

    await expect(restarter.restart('vibe-kanban; rm -rf /')).rejects.toThrow('Invalid supervisor programName');
    expect(runner.execFile).not.toHaveBeenCalled();
  });
});
