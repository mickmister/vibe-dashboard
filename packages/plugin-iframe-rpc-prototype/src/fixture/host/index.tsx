import React, { useEffect, useMemo, useRef, useState } from 'react';
import springboard from 'springboard';
import { PluginIframeHostBridge, type PluginContribution } from '../../host-bridge';
import { FIXTURE_FRAME_ID, FIXTURE_NONCE, FIXTURE_PLUGIN_ID } from '../constants';

const pluginIframeSrc = '/plugin/';

springboard.registerModule('PluginIframeRpcHostFixture', {}, async (moduleAPI) => {
  moduleAPI.registerRoute('/', {}, () => <HostFixture />);
  return {};
});

function HostFixture() {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [contributions, setContributions] = useState<PluginContribution[]>([]);
  const bridge = useMemo(() => new PluginIframeHostBridge(), []);

  useEffect(() => {
    const iframe = iframeRef.current;
    const targetWindow = iframe?.contentWindow;
    if (!targetWindow) return;

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
  }, [bridge]);

  return (
    <main style={{ fontFamily: 'system-ui', padding: 24 }}>
      <h1>Plugin iframe RPC host fixture</h1>
      <p>
        This host page loads a sandboxed plugin iframe (with allow-same-origin for the current Springboard browser runtime) and accepts JSON-only
        data-driven contributions over postMessage RPC.
      </p>
      <iframe
        ref={iframeRef}
        title="Plugin iframe RPC fixture plugin"
        src={pluginIframeSrc}
        sandbox="allow-scripts allow-same-origin"
        style={{ width: '100%', height: 160, border: '1px solid #555' }}
      />
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
