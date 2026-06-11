import React, { useEffect, useMemo, useRef, useState } from 'react';
import springboard from 'springboard';
import { PluginIframeHostBridge, type PluginContribution } from '../../host-bridge';
import {
  PluginMarketplaceInstaller,
  createSampleCatalog,
  type InstalledPluginArtifact,
  type PluginCatalogVersion,
} from '../../sample-marketplace';
import { FIXTURE_FRAME_ID, FIXTURE_NONCE, FIXTURE_PLUGIN_ID } from '../constants';

springboard.registerModule('PluginIframeRpcHostFixture', {}, async (moduleAPI) => {
  moduleAPI.registerRoute('/', {}, () => <HostFixture />);
  return {};
});

function HostFixture() {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [contributions, setContributions] = useState<PluginContribution[]>([]);
  const [installedPlugin, setInstalledPlugin] = useState<InstalledPluginArtifact | null>(null);
  const [selectedVersion, setSelectedVersion] = useState<PluginCatalogVersion | null>(null);
  const [backendStatus, setBackendStatus] = useState('backend not run yet');
  const bridge = useMemo(() => new PluginIframeHostBridge(), []);

  useEffect(() => {
    let cancelled = false;
    const catalog = createSampleCatalog();
    const mixedPlugin = catalog.plugins.find((plugin) => plugin.id === FIXTURE_PLUGIN_ID);
    const version = mixedPlugin?.versions[0];
    if (!version) return;

    const installer = new PluginMarketplaceInstaller({
      catalog,
      downloader: async () => new TextEncoder().encode('fixture plugin bundle bytes'),
      verifier: async () => true,
    });

    installer.install({ pluginId: FIXTURE_PLUGIN_ID }).then((installed) => {
      if (cancelled) return;
      setInstalledPlugin(installed);
      setSelectedVersion(version);
      setBackendStatus(
        installed.backendUnits.some((unit) => unit.kind === 'deno')
          ? 'Deno backend boundary ready with restricted permissions'
          : 'no backend units declared',
      );
    });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const iframe = iframeRef.current;
    const targetWindow = iframe?.contentWindow;
    if (!targetWindow || !installedPlugin?.frontendAssetRoute) return;

    bridge.registerFrame({
      pluginId: FIXTURE_PLUGIN_ID,
      frameId: FIXTURE_FRAME_ID,
      nonce: FIXTURE_NONCE,
      targetWindow,
    });

    const handleMessage = (event: MessageEvent) => {
      if (event.source !== targetWindow) return;
      const response = bridge.receive({
        data: event.data,
        source: targetWindow,
      });
      if (!response) return;

      bridge.send(FIXTURE_FRAME_ID, response);
      setContributions(bridge.getContributions());
    };

    window.addEventListener('message', handleMessage);
    return () => {
      window.removeEventListener('message', handleMessage);
      bridge.unregisterFrame(FIXTURE_FRAME_ID);
    };
  }, [bridge, installedPlugin?.frontendAssetRoute]);

  return (
    <main style={{ fontFamily: 'system-ui', padding: 24 }}>
      <h1>Plugin iframe RPC host fixture</h1>
      <p>
        This host page stages a marketplace plugin, displays requested capabilities, loads its verified frontend asset route in a sandboxed
        plugin iframe (with allow-same-origin for the current Springboard browser runtime), and accepts JSON-only data-driven contributions
        over postMessage RPC.
      </p>

      <section aria-label="Marketplace install">
        <h2>Marketplace install</h2>
        <p>Plugin: {installedPlugin?.pluginId ?? 'installing plugin'}</p>
        <p>Enabled: {installedPlugin?.enabled === false ? 'false - awaiting admin approval' : 'not installed'}</p>
        <p>Frontend route: {installedPlugin?.frontendAssetRoute ?? 'pending'}</p>
      </section>

      <section aria-label="Capability grants">
        <h2>Capability grants</h2>
        <pre>{JSON.stringify(selectedVersion?.capabilities ?? {}, null, 2)}</pre>
        <p>{backendStatus}</p>
      </section>

      {installedPlugin?.frontendAssetRoute ? (
        <iframe
          ref={iframeRef}
          title="Plugin iframe RPC fixture plugin"
          src={installedPlugin.frontendAssetRoute}
          sandbox="allow-scripts allow-same-origin"
          style={{ width: '100%', height: 160, border: '1px solid #555' }}
        />
      ) : null}

      <section aria-label="Registered contributions">
        <h2>Registered contributions</h2>
        {contributions.length === 0 ? (
          <p>No contributions registered yet.</p>
        ) : (
          <ul>
            {contributions.map((contribution, index) => (
              <li key={`${contribution.pluginId}-${contribution.slot}-${index}`}>
                <strong>{contribution.slot}</strong>
                <pre>{JSON.stringify(contribution.data, null, 2)}</pre>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
