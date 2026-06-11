import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { chromium } from 'playwright';

const root = new URL('..', import.meta.url).pathname;
const hostRoot = join(root, 'dist-fixture/host');
const pluginRoot = join(root, 'dist-fixture/plugin');
const contentTypes = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
]);

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  if (url.pathname.endsWith('/kv/get-all')) return json(res, {});
  if (url.pathname.endsWith('/kv/get')) return json(res, null);
  if (url.pathname.endsWith('/kv/set')) return json(res, { ok: true });

  const frontendAssetPrefix = '/dashboard/plugins/dev.vibe-kanban.fixture-plugin/1.0.0/frontend_assets';
  const isPlugin = url.pathname === '/plugin' || url.pathname.startsWith('/plugin/') || url.pathname.startsWith(frontendAssetPrefix);
  const base = isPlugin ? pluginRoot : hostRoot;
  const relativePath = isPlugin
    ? url.pathname.replace(/^\/plugin\/?/, '').replace(frontendAssetPrefix, '').replace(/^\//, '')
    : url.pathname.replace(/^\//, '');
  const safePath = normalize(relativePath || 'index.html');
  if (safePath.startsWith('..')) {
    res.writeHead(403).end('forbidden');
    return;
  }

  const filePath = join(base, safePath.endsWith('/') ? `${safePath}index.html` : safePath);
  try {
    const body = await readFile(filePath);
    res.writeHead(200, {
      'content-type': contentTypes.get(extname(filePath)) ?? 'application/octet-stream',
      'access-control-allow-origin': '*',
    });
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
const port = typeof address === 'object' && address ? address.port : 0;
const browser = await chromium.launch({
  headless: true,
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
    ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
    : {}),
});
try {
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'networkidle' });
  await page.getByText('Marketplace install').waitFor();
  await page.getByText('false - awaiting admin approval').waitFor();
  await page.getByText('/dashboard/plugins/dev.vibe-kanban.fixture-plugin/1.0.0/frontend_assets/index.html').waitFor();
  await page.getByText('Capability grants').waitFor();
  await page.getByText('Deno backend boundary ready with restricted permissions').waitFor();

  const pluginFrame = page.frameLocator('iframe[title="Plugin iframe RPC fixture plugin"]');
  await pluginFrame.getByText('host accepted contribution').waitFor();

  const iframe = page.locator('iframe[title="Plugin iframe RPC fixture plugin"]');
  await expectAttribute(iframe, 'sandbox', 'allow-scripts allow-same-origin');

  const contributions = page.locator('section[aria-label="Registered contributions"]');
  await contributions.getByText('marketplace-card').waitFor();
  await contributions.getByText('Arbitrary plugin data').waitFor();
  await contributions.getByText('<strong>This is data, not trusted HTML.</strong>').waitFor();
  await expectCount(contributions.locator('pre strong'), 0);

  await assertInvalidParentSourceIsIgnored(page);
  await assertWrongNonceIsIgnored(page);
  await assertUnsupportedIframeMethodReturnsError(page);

  console.log('sample marketplace frontend/backend e2e smoke passed');
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}


async function expectAttribute(locator, name, expected) {
  const actual = await locator.getAttribute(name);
  if (actual !== expected) {
    throw new Error(`Expected ${name}=${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

async function expectCount(locator, expected) {
  const actual = await locator.count();
  if (actual !== expected) {
    throw new Error(`Expected locator count ${expected}, got ${actual}`);
  }
}

async function expectHidden(locator, label) {
  const count = await locator.count();
  if (count !== 0) {
    throw new Error(`${label} unexpectedly appeared ${count} time(s)`);
  }
}

async function assertInvalidParentSourceIsIgnored(page) {
  await page.evaluate(() => {
    window.postMessage(
      {
        type: 'vd-plugin-rpc/message',
        protocolVersion: 1,
        pluginId: 'dev.vibe-kanban.fixture-plugin',
        frameId: 'fixture-frame',
        nonce: 'fixture-nonce-for-demo-only',
        data: {
          jsonrpc: '2.0',
          id: 'parent-source-attack',
          method: 'contribution.register',
          params: {
            slot: 'parent-source-attack-card',
            data: { title: 'Invalid parent-source contribution' },
          },
        },
      },
      '*',
    );
  });
  await page.waitForTimeout(100);
  await expectHidden(page.getByText('parent-source-attack-card'), 'parent-source attack contribution');
}

async function assertWrongNonceIsIgnored(page) {
  const frame = page.frames().find((candidate) => candidate.url().includes('/dashboard/plugins/dev.vibe-kanban.fixture-plugin/1.0.0/frontend_assets/'));
  if (!frame) throw new Error('Plugin iframe was not found for wrong nonce assertion');

  await frame.evaluate(() => {
    window.parent.postMessage(
      {
        type: 'vd-plugin-rpc/message',
        protocolVersion: 1,
        pluginId: 'dev.vibe-kanban.fixture-plugin',
        frameId: 'fixture-frame',
        nonce: 'wrong-nonce',
        data: {
          jsonrpc: '2.0',
          id: 'wrong-nonce-attack',
          method: 'contribution.register',
          params: {
            slot: 'wrong-nonce-card',
            data: { title: 'Wrong nonce contribution' },
          },
        },
      },
      '*',
    );
  });
  await page.waitForTimeout(100);
  await expectHidden(page.getByText('wrong-nonce-card'), 'wrong nonce contribution');
}

async function assertUnsupportedIframeMethodReturnsError(page) {
  const frame = page.frames().find((candidate) => candidate.url().includes('/dashboard/plugins/dev.vibe-kanban.fixture-plugin/1.0.0/frontend_assets/'));
  if (!frame) throw new Error('Plugin iframe was not found for unsupported method assertion');

  const response = await frame.evaluate(() => {
    return new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        window.removeEventListener('message', handleMessage);
        reject(new Error('Timed out waiting for unsupported-method response'));
      }, 2_000);

      function handleMessage(event) {
        if (event.data?.data?.id !== 'unsupported-method') return;
        window.clearTimeout(timeout);
        window.removeEventListener('message', handleMessage);
        resolve(event.data.data);
      }

      window.addEventListener('message', handleMessage);
      window.parent.postMessage(
        {
          type: 'vd-plugin-rpc/message',
          protocolVersion: 1,
          pluginId: 'dev.vibe-kanban.fixture-plugin',
          frameId: 'fixture-frame',
          nonce: 'fixture-nonce-for-demo-only',
          data: {
            jsonrpc: '2.0',
            id: 'unsupported-method',
            method: 'workspace.deleteEverything',
          },
        },
        '*',
      );
    });
  });

  if (response?.error?.code !== -32601 || !String(response.error.message).includes('workspace.deleteEverything')) {
    throw new Error(`Unexpected unsupported-method response: ${JSON.stringify(response)}`);
  }
}

function json(res, value) {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify(value));
}
