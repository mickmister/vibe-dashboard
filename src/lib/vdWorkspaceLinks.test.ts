import { describe, expect, it } from 'vitest';
import { buildVdWorkspacePath, buildVdWorkspaceUrl, normalizeVdSiteOrigin, isValidVdWorkspaceId } from './vdWorkspaceLinks';

describe('VD workspace links', () => {
  it('defaults workspace links to jamtools.dev', () => {
    expect(normalizeVdSiteOrigin(undefined)).toBe('https://jamtools.dev');
    expect(buildVdWorkspaceUrl('370dc1c5-4d81-4c80-93a9-145763090324')).toBe('https://jamtools.dev/dashboard/workspaces/370dc1c5-4d81-4c80-93a9-145763090324');
  });

  it('normalizes custom site origins and encodes workspace ids', () => {
    expect(normalizeVdSiteOrigin('https://vd.example.com/')).toBe('https://vd.example.com');
    expect(buildVdWorkspaceUrl('ws:1', 'https://vd.example.com/')).toBe('https://vd.example.com/dashboard/workspaces/ws%3A1');
    expect(buildVdWorkspacePath('ws:1')).toBe('/dashboard/workspaces/ws%3A1');
  });

  it('validates route workspace ids without allowing path traversal', () => {
    expect(isValidVdWorkspaceId('ws-1')).toBe(true);
    expect(isValidVdWorkspaceId('370dc1c5-4d81-4c80-93a9-145763090324')).toBe(true);
    expect(isValidVdWorkspaceId('../secret')).toBe(false);
    expect(isValidVdWorkspaceId('')).toBe(false);
  });
});
