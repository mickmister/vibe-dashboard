import { createHmac, createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, extname, join, normalize, relative } from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';
import { chromium } from 'playwright';

const root = new URL('..', import.meta.url).pathname;
const hostRoot = join(root, 'dist-fixture/host');
const pluginRoot = join(root, 'dist-fixture/plugin');
const signatureKey = 'vibe-kanban-plugin-fixture-signature-key';

const contentTypes = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
]);

const frontendAssetPrefix = '/dashboard/plugins/dev.vibe-kanban.fixture-plugin/1.0.0/frontend_assets';
const pluginTarballFiles = await readFrontendFiles(pluginRoot);
const fixtureTarball = createSamplePluginTarballFixture({
  pluginId: 'dev.vibe-kanban.fixture-plugin',
  version: '1.0.0',
  frontendFiles: pluginTarballFiles,
});
let stagedFrontendRoot;
const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  if (url.pathname.endsWith('/kv/get-all')) return json(res, {});
  if (url.pathname.endsWith('/kv/get')) return json(res, null);
  if (url.pathname.endsWith('/kv/set')) return json(res, { ok: true });
  if (url.pathname === '/mock-github/dev.vibe-kanban.fixture-plugin.tar.gz') {
    res.writeHead(200, { 'content-type': 'application/gzip' });
    res.end(Buffer.from(fixtureTarball.bytes));
    return;
  }

  const isPlugin = url.pathname === '/plugin' || url.pathname.startsWith('/plugin/') || url.pathname.startsWith(frontendAssetPrefix);
  const base = url.pathname.startsWith(frontendAssetPrefix) ? stagedFrontendRoot : isPlugin ? pluginRoot : hostRoot;
  if (!base) {
    res.writeHead(404).end('not installed');
    return;
  }
  const relativePath = url.pathname.startsWith(frontendAssetPrefix)
    ? url.pathname.replace(frontendAssetPrefix, '').replace(/^\//, '')
    : isPlugin
      ? url.pathname.replace(/^\/plugin\/?/, '').replace(/^\//, '')
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
const stagedArtifact = await installVerifiedPluginArtifact({
  pluginId: 'dev.vibe-kanban.fixture-plugin',
  version: '1.0.0',
  asset: {
    url: `http://127.0.0.1:${port}/mock-github/dev.vibe-kanban.fixture-plugin.tar.gz`,
    sha256: fixtureTarball.sha256,
    signature: fixtureTarball.signature,
  },
  artifactRoot: await mkdtemp(join(tmpdir(), 'vk-plugin-artifacts-e2e-')),
  downloader: async (url) => new Uint8Array(await (await fetch(url)).arrayBuffer()),
});
stagedFrontendRoot = stagedArtifact.frontendAssetRoot;
if (!stagedFrontendRoot) throw new Error('Sample plugin did not stage a frontend asset root');
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




function createSamplePluginTarballFixture({ pluginId, version, frontendFiles }) {
  const manifest = JSON.stringify({ schemaVersion: 1, id: pluginId, version, frontend: { entry: 'frontend/index.html' } }, null, 2);
  const bytes = createTarGzFixture([
    { path: 'plugin.json', data: manifest },
    ...frontendFiles.map((file) => ({ path: `frontend/${file.path.replace(/^frontend\//, '')}`, data: file.data })),
  ]);
  const sha256 = sha256Hex(bytes);
  return { bytes, sha256, signature: signSampleArtifact(sha256) };
}

async function installVerifiedPluginArtifact({ pluginId, version, asset, artifactRoot, downloader }) {
  const bytes = await downloader(asset.url);
  const actualSha = sha256Hex(bytes);
  if (actualSha !== asset.sha256) throw new Error(`Artifact sha256 mismatch: expected ${asset.sha256}, got ${actualSha}`);
  if (asset.signature !== signSampleArtifact(actualSha)) throw new Error('Artifact signature verification failed');

  const versionRoot = join(artifactRoot, pluginId, version);
  const extractedRoot = join(versionRoot, 'extracted');
  const files = await extractTarGzSafely(bytes, extractedRoot);
  const manifest = JSON.parse(await readFile(join(extractedRoot, 'plugin.json'), 'utf8'));
  if (manifest.id !== pluginId || manifest.version !== version) throw new Error(`Extracted plugin manifest mismatch for ${pluginId}@${version}`);
  await writeFile(join(versionRoot, 'verified.json'), JSON.stringify({ pluginId, version, assetUrl: asset.url, sha256: asset.sha256, signature: asset.signature, files }, null, 2));
  return { frontendAssetRoot: join(extractedRoot, 'frontend') };
}

function createTarGzFixture(entries) {
  const chunks = [];
  for (const entry of entries) {
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data ?? '');
    chunks.push(createTarHeader(entry.path, data.length));
    chunks.push(data);
    const padding = (512 - (data.length % 512)) % 512;
    if (padding > 0) chunks.push(Buffer.alloc(padding));
  }
  chunks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(chunks));
}

async function extractTarGzSafely(bytes, destinationRoot) {
  const tar = gunzipSync(bytes);
  const files = [];
  let offset = 0;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    offset += 512;
    if (header.every((byte) => byte === 0)) break;
    const name = readNullTerminated(header, 0, 100);
    const size = Number.parseInt(readNullTerminated(header, 124, 12).trim() || '0', 8);
    const typeFlag = readNullTerminated(header, 156, 1) || '0';
    assertSafeTarPath(name);
    if (typeFlag !== '0' && typeFlag !== '\0') throw new Error(`Unsafe tar entry type for ${name}: ${JSON.stringify(typeFlag)}`);
    const data = tar.subarray(offset, offset + size);
    offset += size + ((512 - (size % 512)) % 512);
    const targetPath = join(destinationRoot, name);
    await mkdir(dirname(targetPath), { recursive: true });
    await writeFile(targetPath, data);
    files.push(name);
  }
  if (!files.includes('plugin.json')) throw new Error('Plugin tarball must contain plugin.json at root');
  return files;
}

function createTarHeader(name, size) {
  const header = Buffer.alloc(512);
  writeString(header, name, 0, 100);
  writeOctal(header, 0o644, 100, 8);
  writeOctal(header, 0, 108, 8);
  writeOctal(header, 0, 116, 8);
  writeOctal(header, size, 124, 12);
  writeOctal(header, 0, 136, 12);
  header.fill(0x20, 148, 156);
  writeString(header, '0', 156, 1);
  writeString(header, 'ustar', 257, 6);
  writeString(header, '00', 263, 2);
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  writeOctal(header, checksum, 148, 8);
  return header;
}

function assertSafeTarPath(path) {
  const normalized = normalize(path);
  if (path.length === 0 || normalized.startsWith('..') || normalized.includes('/../')) throw new Error(`Unsafe tar path: ${path}`);
}

function writeString(buffer, value, offset, length) {
  buffer.write(value.slice(0, length), offset, length, 'utf8');
}

function writeOctal(buffer, value, offset, length) {
  const text = value.toString(8).padStart(length - 1, '0').slice(0, length - 1);
  buffer.write(text, offset, length - 1, 'ascii');
  buffer[offset + length - 1] = 0;
}

function readNullTerminated(buffer, offset, length) {
  const slice = buffer.subarray(offset, offset + length);
  const nullIndex = slice.indexOf(0);
  return slice.subarray(0, nullIndex === -1 ? slice.length : nullIndex).toString('utf8');
}

function sha256Hex(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function signSampleArtifact(sha256) {
  return createHmac('sha256', signatureKey).update(sha256).digest('hex');
}

async function readFrontendFiles(rootDir) {
  const files = [];
  async function visit(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const absolutePath = join(dir, entry.name);
      if (entry.isDirectory()) {
        await visit(absolutePath);
      } else if (entry.isFile()) {
        const path = relative(rootDir, absolutePath);
        const data = await readFile(absolutePath);
        files.push({
          path,
          data: path === 'index.html' ? Buffer.from(data.toString('utf8').replaceAll('/plugin/assets/', `${frontendAssetPrefix}/assets/`)) : data,
        });
      }
    }
  }
  await visit(rootDir);
  return files;
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
