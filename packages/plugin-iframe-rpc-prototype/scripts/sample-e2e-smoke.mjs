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
const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ?? '/usr/bin/google-chrome' });
try {
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'networkidle' });
  await page.getByText('Marketplace install').waitFor();
  await page.getByText('false - awaiting admin approval').waitFor();
  await page.getByText('/dashboard/plugins/dev.vibe-kanban.fixture-plugin/1.0.0/frontend_assets/index.html').waitFor();
  await page.getByText('Capability grants').waitFor();
  await page.getByText('Deno backend boundary ready with restricted permissions').waitFor();
  await page.getByText('marketplace-card').waitFor();
  await page.getByText('Arbitrary plugin data').waitFor();
  console.log('sample marketplace frontend/backend e2e smoke passed');
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}

function json(res, value) {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify(value));
}
