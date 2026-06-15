import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import beadsWebPlugin from './fixtures/beads-web.plugin.json';
import { runPluginInstanceConfigCli } from './plugin-instance-config-cli';
import {
  applyAddInstancePlugin,
  createAddInstancePluginDryRunPlan,
  type CommandRunner,
} from './plugin-instance-config';
import type { PluginServiceDefinition } from './plugin-service-orchestrator';

const execFile = promisify(execFileCallback);

describe('per-instance plugin config CLI', () => {
  it('dry-runs adding a plugin into a new persisted config repo without writing files', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'vd-instance-config-dry-run-'));
    const configRepoDir = join(tempRoot, 'instance-config');

    await expect(createAddInstancePluginDryRunPlan({
      configRepoDir,
      plugin: beadsWebPlugin as PluginServiceDefinition,
    })).resolves.toMatchObject({
      action: 'create-config',
      configPath: join(configRepoDir, 'plugins.json'),
      pluginId: 'vd.beads-web',
      beforePluginCount: 0,
      afterPluginCount: 1,
      gitActions: ['git init', 'git config local author defaults', 'git add plugins.json', 'git commit', 'git push when requested'],
    });
  });

  it('requires explicit approval for non-interactive apply mode', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'vd-instance-config-approval-'));
    const pluginPath = join(tempRoot, 'plugin.json');
    await writeFile(pluginPath, JSON.stringify(beadsWebPlugin));

    await expect(runPluginInstanceConfigCli([
      'apply-add',
      '--config-repo-dir', join(tempRoot, 'instance-config'),
      '--plugin', pluginPath,
    ])).rejects.toThrow('apply-add requires --approved true');
  });

  it('applies plugin config, initializes git, commits, and leaves push opt-in', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'vd-instance-config-apply-'));
    const configRepoDir = join(tempRoot, 'instance-config');
    const commands: string[] = [];
    const runCommand: CommandRunner = async (command, args) => {
      commands.push([command, ...args].join(' '));
    };

    const result = await applyAddInstancePlugin({
      configRepoDir,
      plugin: beadsWebPlugin as PluginServiceDefinition,
      commitMessage: 'Install beads-web plugin',
      push: false,
      runCommand,
    });

    expect(result).toMatchObject({ action: 'create-config', committed: true, pushed: false });
    await expect(readFile(join(configRepoDir, 'plugins.json'), 'utf8')).resolves.toContain('vd.beads-web');
    expect(commands).toEqual([
      'git init',
      'git config user.email vd-instance@localhost',
      'git config user.name Vibe Dashboard',
      'git add plugins.json',
      'git commit -m Install beads-web plugin',
    ]);
  });

  it('can use real git locally so per-instance config has an auditable commit', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'vd-instance-config-real-git-'));
    const configRepoDir = join(tempRoot, 'instance-config');
    await execFile('git', ['init', configRepoDir]);
    await execFile('git', ['config', 'user.email', 'vd-tests@example.invalid'], { cwd: configRepoDir });
    await execFile('git', ['config', 'user.name', 'VD Tests'], { cwd: configRepoDir });

    await applyAddInstancePlugin({
      configRepoDir,
      plugin: beadsWebPlugin as PluginServiceDefinition,
      commitMessage: 'Install beads-web plugin',
      push: false,
    });

    const { stdout } = await execFile('git', ['log', '--oneline', '--', 'plugins.json'], { cwd: configRepoDir });
    expect(stdout).toContain('Install beads-web plugin');
  });
});
