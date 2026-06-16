import { denoPermissionFlags, type DenoBackendPluginUnit } from './sample-marketplace';

export interface BackendRunResult {
  code: number;
  stdout: string;
  stderr: string;
}

export type CommandExecutor = (command: string, args: string[]) => Promise<BackendRunResult>;

export class DenoBackendRunner {
  constructor(
    private readonly options: {
      denoBinary: string;
      exec: CommandExecutor;
    },
  ) {}

  run(input: { pluginId: string; unit: DenoBackendPluginUnit; args?: string[] }): Promise<BackendRunResult> {
    const args = ['run', ...denoPermissionFlags(input.unit.permissions), input.unit.entry, ...(input.args ?? [])];
    return this.options.exec(this.options.denoBinary, args);
  }
}
