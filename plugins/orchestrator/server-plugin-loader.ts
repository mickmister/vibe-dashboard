import { join } from 'node:path';
import type { DiscoveredInstalledPlugin } from './installer';
import type { DenoComponent, EffectivePluginGrants } from './manifest';
import { buildDenoPermissionArgs, type DenoBridgeCommand } from './deno-bridge-runtime';

export interface ServerPluginStartupPlan {
  pluginId: string;
  pluginVersion: string;
  unitId: string;
  restartRequiredForCodeChanges: true;
  command: DenoBridgeCommand;
}

export interface CreateServerPluginStartupPlanInput {
  denoBinary: string;
  plugins: DiscoveredInstalledPlugin[];
  grantsByPluginVersion: Map<string, EffectivePluginGrants>;
}

export interface CreateServerPluginStartupPlanResult {
  plans: ServerPluginStartupPlan[];
  errors: string[];
}

export function createServerPluginStartupPlan(
  input: CreateServerPluginStartupPlanInput,
): CreateServerPluginStartupPlanResult {
  const plans: ServerPluginStartupPlan[] = [];
  const errors: string[] = [];

  for (const plugin of input.plugins) {
    if (plugin.disabled) continue;
    const grants = input.grantsByPluginVersion.get(`${plugin.id}@${plugin.version}`);
    for (const unit of plugin.manifest.components.denoBackends ?? []) {
      if (!grants) {
        errors.push(`${plugin.id}@${plugin.version} ${unit.id}: missing approved grants`);
        continue;
      }
      try {
        plans.push(createDenoBackendStartupPlan({
          denoBinary: input.denoBinary,
          plugin,
          unit,
          grants,
        }));
      } catch (error) {
        errors.push(`${plugin.id}@${plugin.version} ${unit.id}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  return { plans, errors };
}

function createDenoBackendStartupPlan(input: {
  denoBinary: string;
  plugin: DiscoveredInstalledPlugin;
  unit: DenoComponent;
  grants: EffectivePluginGrants;
}): ServerPluginStartupPlan {
  if (input.grants.pluginId !== input.plugin.id || input.grants.pluginVersion !== input.plugin.version) {
    throw new Error('Effective grants plugin identity does not match installed plugin');
  }
  if (input.grants.approval.state !== 'approved') {
    throw new Error('Server plugin has no approved grants');
  }

  const entry = join(input.plugin.extractedPath, input.unit.entry);
  return {
    pluginId: input.plugin.id,
    pluginVersion: input.plugin.version,
    unitId: input.unit.id,
    restartRequiredForCodeChanges: true,
    command: {
      command: input.denoBinary,
      args: ['run', '--no-prompt', ...buildDenoPermissionArgs(input.unit, input.grants), entry],
      env: {
        VD_PLUGIN_ID: input.plugin.id,
        VD_PLUGIN_VERSION: input.plugin.version,
        VD_BACKEND_ID: input.unit.id,
      },
    },
  };
}
