import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { SupervisorRestarter } from './vk-agent-hotswap';

const execFileAsync = promisify(execFile);

export interface CommandResult {
  stdout: string;
  stderr: string;
}

export interface CommandRunner {
  execFile(file: string, args: string[]): Promise<CommandResult>;
}

export class ExecFileCommandRunner implements CommandRunner {
  async execFile(file: string, args: string[]): Promise<CommandResult> {
    return execFileAsync(file, args);
  }
}

export interface SupervisorProgramRestarterOptions {
  runner?: CommandRunner;
  supervisorctlPath?: string;
  supervisorConfigPath?: string;
}

export class SupervisorProgramRestarter implements SupervisorRestarter {
  private readonly runner: CommandRunner;
  private readonly supervisorctlPath: string;
  private readonly supervisorConfigPath?: string;

  constructor(options: SupervisorProgramRestarterOptions = {}) {
    this.runner = options.runner ?? new ExecFileCommandRunner();
    this.supervisorctlPath = options.supervisorctlPath ?? 'supervisorctl';
    this.supervisorConfigPath = options.supervisorConfigPath;
  }

  async restart(programName: string): Promise<void> {
    assertSafeSupervisorToken(programName, 'programName');
    const args = this.supervisorConfigPath
      ? ['-c', this.supervisorConfigPath, 'restart', programName]
      : ['restart', programName];
    await this.runner.execFile(this.supervisorctlPath, args);
  }
}

function assertSafeSupervisorToken(value: string, label: string): void {
  if (!/^[a-zA-Z0-9_.:-]+$/.test(value)) {
    throw new Error(`Invalid supervisor ${label}: ${value}`);
  }
}
