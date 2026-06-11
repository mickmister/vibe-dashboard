import React, { useEffect, useState } from 'react';
import springboard from 'springboard';
import { createPluginIframeRpcEnvelope } from '../../protocol';
import { FIXTURE_FRAME_ID, FIXTURE_NONCE, FIXTURE_PLUGIN_ID, FIXTURE_SLOT } from '../constants';

springboard.registerModule('PluginIframeRpcPluginFixture', {}, async (moduleAPI) => {
  moduleAPI.registerRoute('/', {}, () => <PluginFixture />);
  moduleAPI.registerRoute('/plugin/', {}, () => <PluginFixture />);
  return {};
});

function PluginFixture() {
  const [status, setStatus] = useState('waiting to register contribution');

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const data = event.data as { data?: { id?: string | number; result?: unknown; error?: unknown } };
      if (data?.data?.id !== 'fixture-contribution') return;
      setStatus(data.data.error ? 'host rejected contribution' : 'host accepted contribution');
    };

    window.addEventListener('message', handleMessage);
    window.parent.postMessage(
      createPluginIframeRpcEnvelope({
        pluginId: FIXTURE_PLUGIN_ID,
        frameId: FIXTURE_FRAME_ID,
        nonce: FIXTURE_NONCE,
        data: {
          jsonrpc: '2.0',
          id: 'fixture-contribution',
          method: 'contribution.register',
          params: {
            slot: FIXTURE_SLOT,
            data: {
              title: 'Arbitrary plugin data',
              body: '<strong>This is data, not trusted HTML.</strong>',
              action: {
                label: 'Open fixture',
                command: 'fixture.open',
              },
            },
          },
        },
      }),
      '*',
    );

    return () => window.removeEventListener('message', handleMessage);
  }, []);

  return (
    <main style={{ fontFamily: 'system-ui', padding: 16 }}>
      <h1>Plugin iframe</h1>
      <p>{status}</p>
    </main>
  );
}
