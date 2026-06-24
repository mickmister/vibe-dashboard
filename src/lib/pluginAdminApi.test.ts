import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchPluginAdminStatuses, setPluginAdminDesiredEnabled } from './pluginAdminApi';

describe('plugin admin UI API client', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('loads plugin statuses from the admin API', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ plugins: [] })));

    await expect(fetchPluginAdminStatuses()).resolves.toEqual([]);
    expect(fetchMock).toHaveBeenCalledWith('/dashboard/api/admin/plugins/status', { headers: { Accept: 'application/json' } });
  });

  it('posts persistent desired enable state for the UI disable/enable action path', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      plugin: {
        pluginId: 'vd.beads-web',
        name: 'Beads Web',
        version: 'v0.11.4',
        desiredEnabled: false,
        observedState: 'disabled',
      },
    })));

    await expect(setPluginAdminDesiredEnabled('vd.beads-web', false)).resolves.toMatchObject({
      pluginId: 'vd.beads-web',
      desiredEnabled: false,
      observedState: 'disabled',
    });
    expect(fetchMock).toHaveBeenCalledWith('/dashboard/api/admin/plugins/vd.beads-web/enable', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ enable: false }),
    });
  });
});
