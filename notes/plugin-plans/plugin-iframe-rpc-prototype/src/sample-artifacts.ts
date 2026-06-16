import { createHash, createHmac } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, normalize } from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';
import { createSampleCatalog, type ArtifactDownloader, type BackendPluginUnit, type PluginCatalog, type PluginCatalogVersion, type PluginReleaseAsset } from './sample-marketplace';

export const SAMPLE_ARTIFACT_SIGNATURE_KEY = 'vibe-kanban-plugin-fixture-signature-key';

export interface SampleTarEntry {
  path: string;
  data?: Uint8Array | string;
  type?: 'file' | 'symlink' | 'hardlink';
  linkName?: string;
}

export interface SamplePluginTarballFixture {
  bytes: Uint8Array;
  sha256: string;
  signature: string;
}

export interface StagedPluginArtifact {
  pluginId: string;
  version: string;
  frontendAssetRoute?: string;
  frontendAssetRoot?: string;
  artifactRoot: string;
  verifiedPath: string;
  backendUnits: BackendPluginUnit[];
}

export function createSamplePluginTarballFixture(input: {
  pluginId: string;
  version: string;
  frontendFiles: Array<{ path: string; data: Uint8Array | string }>;
  backendUnits?: BackendPluginUnit[];
}): SamplePluginTarballFixture {
  const manifest = {
    schemaVersion: 1,
    id: input.pluginId,
    version: input.version,
    frontend: { entry: 'frontend/index.html' },
    backend: input.backendUnits ? { units: input.backendUnits } : undefined,
  };

  const bytes = createTarGzFixture([
    { path: 'plugin.json', data: JSON.stringify(manifest, null, 2) },
    ...input.frontendFiles.map((file) => ({ path: `frontend/${file.path.replace(/^frontend\//, '')}`, data: file.data })),
  ]);
  const sha256 = sha256Hex(bytes);
  return {
    bytes,
    sha256,
    signature: signSampleArtifact(sha256),
  };
}

export function createTarGzFixture(entries: SampleTarEntry[]): Uint8Array {
  const chunks: Buffer[] = [];
  for (const entry of entries) {
    const data = toBuffer(entry.data ?? '');
    chunks.push(createTarHeader(entry, data.length));
    if ((entry.type ?? 'file') === 'file') {
      chunks.push(data);
      const padding = (512 - (data.length % 512)) % 512;
      if (padding > 0) chunks.push(Buffer.alloc(padding));
    }
  }
  chunks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(chunks));
}

export async function installVerifiedPluginArtifact(input: {
  catalog: PluginCatalog;
  pluginId: string;
  version?: string;
  artifactRoot: string;
  downloader: ArtifactDownloader;
}): Promise<StagedPluginArtifact> {
  const plugin = input.catalog.plugins.find((entry) => entry.id === input.pluginId);
  if (!plugin) throw new Error(`Unknown plugin: ${input.pluginId}`);
  const version = input.version ? plugin.versions.find((candidate) => candidate.version === input.version) : plugin.versions[0];
  if (!version) throw new Error(`Unknown version for ${input.pluginId}: ${input.version}`);

  const bytes = await input.downloader(version.asset.url);
  verifySampleReleaseAsset(version.asset, bytes);

  const versionRoot = join(input.artifactRoot, plugin.id, version.version);
  const extractedRoot = join(versionRoot, 'extracted');
  const extractedFiles = await extractTarGzSafely(bytes, extractedRoot);

  const manifestPath = join(extractedRoot, 'plugin.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as { id?: string; version?: string };
  if (manifest.id !== plugin.id || manifest.version !== version.version) {
    throw new Error(`Extracted plugin manifest mismatch for ${plugin.id}@${version.version}`);
  }

  const verifiedPath = join(versionRoot, 'verified.json');
  await writeFile(
    verifiedPath,
    JSON.stringify(
      {
        pluginId: plugin.id,
        version: version.version,
        assetUrl: version.asset.url,
        sha256: version.asset.sha256,
        signature: version.asset.signature,
        verifiedAt: 'fixture-deterministic-timestamp',
        files: extractedFiles,
      },
      null,
      2,
    ),
  );

  return {
    pluginId: plugin.id,
    version: version.version,
    artifactRoot: versionRoot,
    verifiedPath,
    frontendAssetRoute: version.frontend
      ? `/dashboard/plugins/${plugin.id}/${version.version}/frontend_assets/${version.frontend.entry.replace(/^frontend\//, '')}`
      : undefined,
    frontendAssetRoot: version.frontend ? join(extractedRoot, 'frontend') : undefined,
    backendUnits: version.backend?.units ?? [],
  };
}

export function createCatalogWithFixtureAsset(input: {
  pluginId: string;
  asset: PluginReleaseAsset;
  catalog?: PluginCatalog;
}): PluginCatalog {
  const catalog = structuredClone(input.catalog ?? createSampleCatalog()) as PluginCatalog;
  const plugin = catalog.plugins.find((entry) => entry.id === input.pluginId);
  const version = plugin?.versions[0];
  if (!version) throw new Error(`Unknown plugin in sample catalog: ${input.pluginId}`);
  version.asset = input.asset;
  return catalog;
}

export function verifySampleReleaseAsset(asset: PluginReleaseAsset, bytes: Uint8Array): void {
  const actualSha = sha256Hex(bytes);
  if (asset.sha256 !== actualSha) {
    throw new Error(`Artifact sha256 mismatch: expected ${asset.sha256}, got ${actualSha}`);
  }
  const expectedSignature = signSampleArtifact(actualSha);
  if (asset.signature !== expectedSignature) {
    throw new Error('Artifact signature verification failed');
  }
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function signSampleArtifact(sha256: string): string {
  return createHmac('sha256', SAMPLE_ARTIFACT_SIGNATURE_KEY).update(sha256).digest('hex');
}

async function extractTarGzSafely(bytes: Uint8Array, destinationRoot: string): Promise<string[]> {
  const tar = gunzipSync(bytes);
  const files: string[] = [];
  let offset = 0;
  let totalBytes = 0;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    offset += 512;
    if (header.every((byte) => byte === 0)) break;

    const name = readNullTerminated(header, 0, 100);
    const size = Number.parseInt(readNullTerminated(header, 124, 12).trim() || '0', 8);
    const typeFlag = readNullTerminated(header, 156, 1) || '0';
    assertSafeTarPath(name);
    if (typeFlag !== '0' && typeFlag !== '\0') {
      throw new Error(`Unsafe tar entry type for ${name}: ${JSON.stringify(typeFlag)}`);
    }
    if (files.length >= 200) throw new Error('Tarball contains too many files');
    totalBytes += size;
    if (totalBytes > 10 * 1024 * 1024) throw new Error('Tarball is too large for sample installer');

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

function assertSafeTarPath(path: string): void {
  const normalized = normalize(path);
  if (path.length === 0 || isAbsolute(path) || normalized.startsWith('..') || normalized.includes('/../')) {
    throw new Error(`Unsafe tar path: ${path}`);
  }
}

function createTarHeader(entry: SampleTarEntry, size: number): Buffer {
  const header = Buffer.alloc(512);
  const type = entry.type ?? 'file';
  writeString(header, entry.path, 0, 100);
  writeOctal(header, 0o644, 100, 8);
  writeOctal(header, 0, 108, 8);
  writeOctal(header, 0, 116, 8);
  writeOctal(header, type === 'file' ? size : 0, 124, 12);
  writeOctal(header, 0, 136, 12);
  header.fill(0x20, 148, 156);
  writeString(header, type === 'file' ? '0' : type === 'symlink' ? '2' : '1', 156, 1);
  if (entry.linkName) writeString(header, entry.linkName, 157, 100);
  writeString(header, 'ustar', 257, 6);
  writeString(header, '00', 263, 2);
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  writeOctal(header, checksum, 148, 8);
  return header;
}

function writeString(buffer: Buffer, value: string, offset: number, length: number): void {
  buffer.write(value.slice(0, length), offset, length, 'utf8');
}

function writeOctal(buffer: Buffer, value: number, offset: number, length: number): void {
  const text = value.toString(8).padStart(length - 1, '0').slice(0, length - 1);
  buffer.write(text, offset, length - 1, 'ascii');
  buffer[offset + length - 1] = 0;
}

function readNullTerminated(buffer: Buffer, offset: number, length: number): string {
  const slice = buffer.subarray(offset, offset + length);
  const nullIndex = slice.indexOf(0);
  return slice.subarray(0, nullIndex === -1 ? slice.length : nullIndex).toString('utf8');
}

function toBuffer(value: Uint8Array | string): Buffer {
  return typeof value === 'string' ? Buffer.from(value) : Buffer.from(value);
}
