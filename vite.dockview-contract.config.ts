import { defineConfig } from 'vite';

function redirectGuardContract() {
  return {
    name: 'redirect-guard-contract',
    configureServer(server: { middlewares: { use(handler: (request: { url?: string }, response: { statusCode: number; setHeader(name: string, value: string): void; end(body?: string): void }, next: () => void) => void): void } }) {
      server.middlewares.use(async (request, response, next) => {
        const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1');
        if (/^\/voyages\/[^/]+\/split\/[^/]+$/.test(requestUrl.pathname)) {
          request.url = `/spikes/dockview-contract/split-view.html${requestUrl.search}`;
          next(); return;
        }
        if (requestUrl.pathname === '/contract/redirect/same') {
          response.statusCode = 302; response.setHeader('Location', '/contract/redirect/final'); response.end(); return;
        }
        if (requestUrl.pathname === '/contract/redirect/cross') {
          const destinationHost = requestUrl.searchParams.get('to') === 'trusted' ? '127.0.0.1' : 'localhost';
          response.statusCode = 302; response.setHeader('Location', `http://${destinationHost}:${requestUrl.searchParams.get('port')}/contract/redirect/final`); response.end(); return;
        }
        if (requestUrl.pathname === '/contract/redirect/final') { response.statusCode = 200; response.end('guarded-final'); return; }
        if (requestUrl.pathname === '/contract/plugin-navigation') {
          const mode = requestUrl.searchParams.get('mode'); const destination = `/contract/plugin-navigation-final?mode=${mode}`;
          if (mode === 'redirect') { response.statusCode = 302; response.setHeader('Location', destination); response.end(); return; }
          response.setHeader('Content-Type', 'text/html');
          if (mode === 'meta') response.end(`<meta http-equiv="refresh" content="0;url=${destination}">`);
          else if (mode === 'script') response.end(`<script>location.href=${JSON.stringify(destination)}</script>`);
          else if (mode === 'link') response.end(`<a id="go" href="${destination}">go</a><script>go.click()</script>`);
          else if (mode === 'form') response.end(`<form id="go" action="${destination}" method="get"></form><script>go.submit()</script>`);
          else { response.statusCode = 400; response.end('unknown-mode'); }
          return;
        }
        if (requestUrl.pathname === '/contract/plugin-navigation-final') { response.statusCode = 200; response.end('navigation-final'); return; }
        if (requestUrl.pathname !== '/contract/guard') { next(); return; }
        const target = requestUrl.searchParams.get('target');
        try {
          let current = new URL(target ?? '');
          if (current.hostname !== '127.0.0.1' && current.hostname !== 'localhost') throw new Error('contract-host-denied');
          if (requestUrl.searchParams.get('fixture') === 'message') {
            response.setHeader('Content-Type', 'text/html');
            response.end(`<!doctype html><script>addEventListener('message',event=>{if(event.data?.command==='emit'){const mode=event.data.mode;parent.postMessage({schemaVersion:1,type:mode==='unknown-type'?'runtime-admin':'runtime-ready',panelId:'panel-1',runtimeId:'runtime-1',generation:mode==='stale'?8:9,payload:mode==='malformed-payload'?{protocolVersion:1,privilege:'admin'}:{protocolVersion:1}},'*')}});parent.postMessage({fixtureReady:${JSON.stringify(requestUrl.searchParams.get('name'))}},'*')</script>`);
            return;
          }
          const trustedOrigin = current.origin;
          for (let hops = 0; hops < 6; hops += 1) {
            const upstream = await fetch(current, { redirect: 'manual' });
            if (upstream.status < 300 || upstream.status >= 400) {
              response.statusCode = upstream.status;
              const contentType = upstream.headers.get('content-type'); if (contentType) response.setHeader('Content-Type', contentType);
              response.end(await upstream.text()); return;
            }
            const location = upstream.headers.get('location'); if (!location) throw new Error('redirect-without-location');
            const nextUrl = new URL(location, current);
            if (nextUrl.origin !== trustedOrigin) { response.statusCode = 409; response.end('cross-origin-redirect-rejected'); return; }
            current = nextUrl;
          }
          response.statusCode = 508; response.end('redirect-limit');
        } catch { response.statusCode = 400; response.end('invalid-target'); }
      });
    },
  };
}

// Keep the Phase 0 browser spike independent from Springboard production setup.
export default defineConfig({
  plugins: [redirectGuardContract()],
  optimizeDeps: {
    entries: ['spikes/dockview-contract/index.html'],
  },
});
