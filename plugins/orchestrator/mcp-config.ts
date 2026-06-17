import type { McpContribution, PluginManifest } from './manifest';

export interface ApprovedMcpPluginInput {
  manifest: PluginManifest;
  approvedMcpIds: string[];
}

export interface GeneratedMcpServerConfig {
  serverName: string;
  transport: 'stdio' | 'http';
  command?: string;
  url?: string;
  tools?: string[];
}

export interface GeneratedMcpConfig {
  mcpServers: Record<string, GeneratedMcpServerConfig>;
}

export function buildApprovedMcpConfig(inputs: ApprovedMcpPluginInput[]): GeneratedMcpConfig {
  const mcpServers: Record<string, GeneratedMcpServerConfig> = {};

  for (const input of inputs) {
    const approved = new Set(input.approvedMcpIds);
    for (const contribution of input.manifest.components.mcp ?? []) {
      if (!approved.has(contribution.id)) continue;
      const key = `${input.manifest.id}/${contribution.id}`;
      if (mcpServers[key]) throw new Error(`Duplicate MCP contribution key ${key}`);
      mcpServers[key] = toGeneratedMcpServerConfig(contribution);
    }
  }

  return { mcpServers };
}

function toGeneratedMcpServerConfig(contribution: McpContribution): GeneratedMcpServerConfig {
  const config: GeneratedMcpServerConfig = {
    serverName: contribution.serverName,
    transport: contribution.transport,
  };
  if (contribution.command) config.command = contribution.command;
  if (contribution.url) config.url = contribution.url;
  if (contribution.tools) config.tools = [...contribution.tools];
  return config;
}
