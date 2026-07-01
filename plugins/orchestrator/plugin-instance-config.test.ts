import { execFile as execFileCallback } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import beadsWebPlugin from '../fixtures/beads-web.plugin.json';
import { runPluginInstanceConfigCli } from './plugin-instance-config-cli';
import {
  applyAddInstancePlugin,
  applySetInstancePluginEnabled,
  createAddInstancePluginDryRunPlan,
  createSetInstancePluginEnabledDryRunPlan,
  type CommandRunner,
} from './plugin-instance-config';
import type { PluginServiceCatalog, PluginServiceDefinition } from './plugin-service-orchestrator';

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

  it('preserves existing plugin enable state when upserting a per-instance plugin', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'vd-instance-config-plugin-states-'));
    const configRepoDir = join(tempRoot, 'instance-config');
    const existingCatalog: PluginServiceCatalog = {
      plugins: [],
      pluginStates: { 'vd.beads-web': { enable: false } },
    };
    const runCommand: CommandRunner = async () => {};

    await mkdir(configRepoDir, { recursive: true });
    await writeFile(join(configRepoDir, 'plugins.json'), JSON.stringify(existingCatalog));

    await applyAddInstancePlugin({
      configRepoDir,
      plugin: beadsWebPlugin as PluginServiceDefinition,
      push: false,
      runCommand,
    });

    await expect(readFile(join(configRepoDir, 'plugins.json'), 'utf8').then((raw) => JSON.parse(raw)))
      .resolves.toMatchObject({
        plugins: [expect.objectContaining({ id: 'vd.beads-web' })],
        pluginStates: { 'vd.beads-web': { enable: false } },
      });
  });

  it('dry-runs disabling a plugin in persisted instance state without writing files', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'vd-instance-config-disable-dry-run-'));
    const configRepoDir = join(tempRoot, 'instance-config');

    await expect(createSetInstancePluginEnabledDryRunPlan({
      configRepoDir,
      pluginId: 'vd.beads-web',
      enable: false,
    })).resolves.toMatchObject({
      action: 'create-config',
      configPath: join(configRepoDir, 'plugins.json'),
      pluginId: 'vd.beads-web',
      beforeEnable: true,
      afterEnable: false,
      gitActions: ['git init', 'git config local author defaults', 'git add plugins.json', 'git commit', 'git push when requested'],
    });

    await expect(readFile(join(configRepoDir, 'plugins.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('applies plugin enable state changes while preserving configured plugins', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'vd-instance-config-disable-apply-'));
    const configRepoDir = join(tempRoot, 'instance-config');
    const commands: string[] = [];
    const runCommand: CommandRunner = async (command, args) => {
      commands.push([command, ...args].join(' '));
    };

    await mkdir(configRepoDir, { recursive: true });
    await writeFile(join(configRepoDir, 'plugins.json'), JSON.stringify({ plugins: [beadsWebPlugin] }));

    const result = await applySetInstancePluginEnabled({
      configRepoDir,
      pluginId: 'vd.beads-web',
      enable: false,
      push: false,
      runCommand,
    });

    expect(result).toMatchObject({
      action: 'set-plugin-state',
      beforeEnable: true,
      afterEnable: false,
      committed: true,
      pushed: false,
    });
    await expect(readFile(join(configRepoDir, 'plugins.json'), 'utf8').then((raw) => JSON.parse(raw)))
      .resolves.toMatchObject({
        plugins: [expect.objectContaining({ id: 'vd.beads-web' })],
        pluginStates: { 'vd.beads-web': { enable: false } },
      });
    expect(commands).toEqual([
      'git init',
      'git config user.email vd-instance@localhost',
      'git config user.name Vibe Dashboard',
      'git add plugins.json',
      'git commit -m Set VD plugin vd.beads-web disabled',
    ]);
  });

  it('does not commit when applying an unchanged plugin enable state', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'vd-instance-config-disable-unchanged-'));
    const configRepoDir = join(tempRoot, 'instance-config');
    const commands: string[] = [];
    const runCommand: CommandRunner = async (command, args) => {
      commands.push([command, ...args].join(' '));
    };

    await mkdir(configRepoDir, { recursive: true });
    await writeFile(join(configRepoDir, 'plugins.json'), JSON.stringify({
      plugins: [],
      pluginStates: { 'vd.beads-web': { enable: false } },
    }));

    await expect(applySetInstancePluginEnabled({
      configRepoDir,
      pluginId: 'vd.beads-web',
      enable: false,
      push: false,
      runCommand,
    })).resolves.toMatchObject({
      action: 'unchanged',
      committed: false,
      pushed: false,
    });
    expect(commands).toEqual([]);
  });

  it('treats enabling a plugin with no persisted state as unchanged because enabled is the default', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'vd-instance-config-enable-default-'));
    const configRepoDir = join(tempRoot, 'instance-config');
    const commands: string[] = [];
    const runCommand: CommandRunner = async (command, args) => {
      commands.push([command, ...args].join(' '));
    };

    await expect(applySetInstancePluginEnabled({
      configRepoDir,
      pluginId: 'vd.beads-web',
      enable: true,
      push: false,
      runCommand,
    })).resolves.toMatchObject({
      action: 'unchanged',
      beforeEnable: true,
      afterEnable: true,
      committed: false,
      pushed: false,
    });
    await expect(readFile(join(configRepoDir, 'plugins.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    expect(commands).toEqual([]);
  });

  it('rejects malformed plugin ids before writing plugin enable state', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'vd-instance-config-invalid-plugin-state-'));
    const configRepoDir = join(tempRoot, 'instance-config');

    await expect(applySetInstancePluginEnabled({
      configRepoDir,
      pluginId: '../evil',
      enable: false,
      runCommand: async () => {
        throw new Error('git should not run for invalid plugin state');
      },
    })).rejects.toThrow('Invalid plugin state id');
    await expect(readFile(join(configRepoDir, 'plugins.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('exposes explicit dry-run-disable and approved apply-enable CLI commands', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'vd-instance-config-state-cli-'));
    const configRepoDir = join(tempRoot, 'instance-config');

    await expect(runPluginInstanceConfigCli([
      'dry-run-disable',
      '--config-repo-dir', configRepoDir,
      '--plugin-id', 'vd.beads-web',
    ])).resolves.toMatchObject({
      action: 'create-config',
      beforeEnable: true,
      afterEnable: false,
    });

    await expect(runPluginInstanceConfigCli([
      'apply-enable',
      '--config-repo-dir', configRepoDir,
      '--plugin-id', 'vd.beads-web',
    ])).rejects.toThrow('apply-enable requires --approved true');
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
