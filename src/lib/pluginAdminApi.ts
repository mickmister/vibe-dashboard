export type ObservedPluginRuntimeState = 'not_running' | 'running' | 'failed_to_start' | 'failed' | 'disabled';

export interface PluginAdminStatus {
  pluginId: string;
  name: string;
  version: string;
  pluginPath?: string;
  installPath?: string;
  desiredEnabled: boolean;
  observedState: ObservedPluginRuntimeState;
  error?: string;
}

export async function fetchPluginAdminStatuses(): Promise<PluginAdminStatus[]> {
  const response = await fetch('/dashboard/api/admin/plugins/status', { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`Failed to load plugin statuses: ${response.status}`);
  const payload = await response.json() as { plugins?: PluginAdminStatus[] };
  return payload.plugins ?? [];
}

export async function setPluginAdminDesiredEnabled(pluginId: string, enable: boolean): Promise<PluginAdminStatus> {
  const response = await fetch(`/dashboard/api/admin/plugins/${encodeURIComponent(pluginId)}/enable`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ enable }),
  });
  if (!response.ok) throw new Error(`Failed to ${enable ? 'enable' : 'disable'} plugin ${pluginId}: ${response.status}`);
  const payload = await response.json() as { plugin?: PluginAdminStatus };
  if (!payload.plugin) throw new Error('Plugin admin API response did not include plugin status');
  return payload.plugin;
}
