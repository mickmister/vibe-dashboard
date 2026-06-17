import { describe, expect, it } from 'vitest';
import type { PluginManifest } from './manifest';
import { buildApprovedMcpConfig } from './mcp-config';

const plugin: PluginManifest = {
  schemaVersion: 1,
  id: 'app.docs.search',
  version: '1.0.0',
  displayName: 'Docs Search',
  components: {
    mcp: [
      {
        id: 'docs',
        serverName: 'docs-search',
        transport: 'stdio',
        command: 'node dist/mcp.js',
        tools: ['docs.search'],
      },
    ],
  },
};

describe('admin-approved MCP config contributions', () => {
  it('ignores unapproved MCP contributions and materializes approved config deterministically', () => {
    expect(buildApprovedMcpConfig([{ manifest: plugin, approvedMcpIds: [] }])).toEqual({ mcpServers: {} });

    expect(buildApprovedMcpConfig([{ manifest: plugin, approvedMcpIds: ['docs'] }])).toEqual({
      mcpServers: {
        'app.docs.search/docs': {
          serverName: 'docs-search',
          transport: 'stdio',
          command: 'node dist/mcp.js',
          tools: ['docs.search'],
        },
      },
    });
  });

  it('rejects duplicate approved MCP server keys before writing global agent config', () => {
    expect(() =>
      buildApprovedMcpConfig([
        { manifest: plugin, approvedMcpIds: ['docs'] },
        { manifest: plugin, approvedMcpIds: ['docs'] },
      ]),
    ).toThrow('Duplicate MCP contribution key app.docs.search/docs');
  });
});
