import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, normalize, relative, resolve } from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';
import {
  validatePluginManifest,
  type PluginManifest,
} from './manifest';

export interface PluginArtifactDescriptor {
  pluginId: string;
  version: string;
  sourceUrl: string;
  sha256: string;
  signature: string;
}

export interface PluginArtifactDownloader {
  (sourceUrl: string): Promise<Uint8Array>;
}

export interface PluginArtifactSignatureVerifier {
  (input: { descriptor: PluginArtifactDescriptor; sha256: string; signature: string }): boolean | Promise<boolean>;
}

export interface InstallVerifiedPluginArtifactInput {
  artifact: PluginArtifactDescriptor;
  installRoot: string;
  downloader: PluginArtifactDownloader;
  verifySignature: PluginArtifactSignatureVerifier;
}

export interface InstalledPluginArtifact {
  id: string;
  version: string;
  manifest: PluginManifest;
  installPath: string;
  extractedPath: string;
  verifiedPath: string;
  frontendAssetRoot?: string;
  frontendEntryAssetPath?: string;
}

export interface DiscoveredInstalledPlugin extends InstalledPluginArtifact {
  disabled: boolean;
}

export interface DiscoverInstalledPluginsInput {
  installRoot: string;
}

export interface DiscoverInstalledPluginsResult {
  plugins: DiscoveredInstalledPlugin[];
  disabled: DiscoveredInstalledPlugin[];
  errors: string[];
}

export interface TarFixtureEntry {
  path: string;
  data?: Uint8Array | string;
  type?: 'file' | 'symlink' | 'hardlink';
  linkName?: string;
}

interface VerifiedPluginArtifactMetadata {
  pluginId: string;
  version: string;
  sourceUrl: string;
  sha256: string;
  signature: string;
  verifiedAt: string;
  files: string[];
}

const MAX_PLUGIN_ARTIFACT_FILES = 1000;
const MAX_PLUGIN_ARTIFACT_BYTES = 50 * 1024 * 1024;
const MAX_COMPRESSED_PLUGIN_ARTIFACT_BYTES = 50 * 1024 * 1024;

export async function installVerifiedPluginArtifact(
  input: InstallVerifiedPluginArtifactInput,
): Promise<InstalledPluginArtifact> {
  assertSafeArtifactDescriptor(input.artifact);
  const installRoot = resolve(input.installRoot);
  const installPath = join(installRoot, input.artifact.pluginId, input.artifact.version);
  const extractedPath = join(installPath, 'extracted');
  const verifiedPath = join(installPath, 'verified.json');
  assertInsideRoot(installRoot, installPath);
  assertInsideRoot(installRoot, extractedPath);
  assertInsideRoot(installRoot, verifiedPath);

  const bytes = await input.downloader(input.artifact.sourceUrl);
  if (bytes.length > MAX_COMPRESSED_PLUGIN_ARTIFACT_BYTES) {
    throw new Error('Plugin artifact download is too large');
  }
  const actualSha = sha256Hex(bytes);
  if (actualSha !== input.artifact.sha256) {
    throw new Error(`Artifact sha256 mismatch: expected ${input.artifact.sha256}, got ${actualSha}`);
  }
  const signatureOk = await input.verifySignature({
    descriptor: input.artifact,
    sha256: actualSha,
    signature: input.artifact.signature,
  });
  if (!signatureOk) {
    throw new Error('Artifact signature verification failed');
  }

  const existingInstall = await getExistingVerifiedInstall({
    installRoot,
    installPath,
    extractedPath,
    verifiedPath,
    artifact: input.artifact,
  });
  if (existingInstall) return existingInstall;

  const temporaryExtractPath = join(installPath, `.extracting-${process.pid}-${Date.now()}`);
  await rm(temporaryExtractPath, { recursive: true, force: true });

  let files: string[] = [];
  let manifest: PluginManifest;
  try {
    files = await extractTarGzSafely(bytes, temporaryExtractPath);
    manifest = await readAndValidateManifest(join(temporaryExtractPath, 'plugin.json'));

    if (manifest.id !== input.artifact.pluginId || manifest.version !== input.artifact.version) {
      throw new Error(`Extracted plugin manifest mismatch for ${input.artifact.pluginId}@${input.artifact.version}`);
    }

    await rm(extractedPath, { recursive: true, force: true });
    await mkdir(installPath, { recursive: true });
    await rename(temporaryExtractPath, extractedPath);
  } catch (error) {
    await rm(temporaryExtractPath, { recursive: true, force: true });
    throw error;
  }

  const metadata: VerifiedPluginArtifactMetadata = {
    pluginId: manifest.id,
    version: manifest.version,
    sourceUrl: input.artifact.sourceUrl,
    sha256: input.artifact.sha256,
    signature: input.artifact.signature,
    verifiedAt: new Date(0).toISOString(),
    files,
  };
  await writeFile(verifiedPath, JSON.stringify(metadata, null, 2));

  return toInstalledArtifact({ installRoot, manifest, installPath, extractedPath, verifiedPath });
}

export async function discoverInstalledPlugins(
  input: DiscoverInstalledPluginsInput,
): Promise<DiscoverInstalledPluginsResult> {
  const candidates: DiscoveredInstalledPlugin[] = [];
  const errors: string[] = [];

  for (const pluginId of await readDirectoryNames(input.installRoot)) {
    const pluginRoot = join(input.installRoot, pluginId);
    for (const version of await readDirectoryNames(pluginRoot)) {
      const installPath = join(pluginRoot, version);
      const extractedPath = join(installPath, 'extracted');
      const verifiedPath = join(installPath, 'verified.json');
      try {
        const metadata = JSON.parse(await readFile(verifiedPath, 'utf8')) as Partial<VerifiedPluginArtifactMetadata>;
        const manifest = await readAndValidateManifest(join(extractedPath, 'plugin.json'));
        if (metadata.pluginId !== manifest.id || metadata.version !== manifest.version) {
          throw new Error('verified metadata does not match plugin manifest');
        }
        candidates.push({
          ...toInstalledArtifact({ installRoot: input.installRoot, manifest, installPath, extractedPath, verifiedPath }),
          disabled: existsSync(join(installPath, 'disabled.json')),
        });
      } catch (error) {
        errors.push(`${pluginId}@${version}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  candidates.sort(compareDiscoveredPlugins);
  const selected = new Map<string, DiscoveredInstalledPlugin>();
  for (const candidate of candidates) {
    const existing = selected.get(candidate.id);
    if (!existing) {
      selected.set(candidate.id, candidate);
      continue;
    }
    errors.push(`Duplicate plugin ${candidate.id}: selected ${existing.version} and ignored ${candidate.version}`);
  }

  const plugins: DiscoveredInstalledPlugin[] = [];
  const disabled: DiscoveredInstalledPlugin[] = [];
  for (const plugin of selected.values()) {
    if (plugin.disabled) disabled.push(plugin);
    else plugins.push(plugin);
  }

  return {
    plugins,
    disabled,
    errors,
  };
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function createPluginArtifactTarGz(entries: TarFixtureEntry[]): Uint8Array {
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

async function getExistingVerifiedInstall(input: {
  installRoot: string;
  installPath: string;
  extractedPath: string;
  verifiedPath: string;
  artifact: PluginArtifactDescriptor;
}): Promise<InstalledPluginArtifact | null> {
  if (!existsSync(input.verifiedPath)) return null;
  const existing = JSON.parse(await readFile(input.verifiedPath, 'utf8')) as Partial<VerifiedPluginArtifactMetadata>;
  if (existing.sha256 !== input.artifact.sha256 || existing.signature !== input.artifact.signature) {
    throw new Error(
      `Refusing to overwrite existing verified plugin artifact ${input.artifact.pluginId}@${input.artifact.version}`,
    );
  }

  const manifest = await readAndValidateManifest(join(input.extractedPath, 'plugin.json'));
  if (manifest.id !== input.artifact.pluginId || manifest.version !== input.artifact.version) {
    throw new Error(`Existing plugin manifest mismatch for ${input.artifact.pluginId}@${input.artifact.version}`);
  }
  return toInstalledArtifact({
    installRoot: input.installRoot,
    manifest,
    installPath: input.installPath,
    extractedPath: input.extractedPath,
    verifiedPath: input.verifiedPath,
  });
}

async function readAndValidateManifest(manifestPath: string): Promise<PluginManifest> {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as unknown;
  const result = validatePluginManifest(manifest);
  if (!result.success || !result.manifest) {
    throw new Error(`Plugin manifest validation failed: ${result.errors.join('; ')}`);
  }
  return result.manifest;
}

function toInstalledArtifact(input: {
  installRoot: string;
  manifest: PluginManifest;
  installPath: string;
  extractedPath: string;
  verifiedPath: string;
}): InstalledPluginArtifact {
  const frontendEntry = input.manifest.components.frontend?.entry;
  const frontendAssetRoot = frontendEntry ? join(input.extractedPath, dirname(frontendEntry)) : undefined;
  const frontendEntryAssetPath = frontendEntry ? relative(dirname(frontendEntry), frontendEntry) : undefined;
  return {
    id: input.manifest.id,
    version: input.manifest.version,
    manifest: input.manifest,
    installPath: input.installPath,
    extractedPath: input.extractedPath,
    verifiedPath: input.verifiedPath,
    frontendAssetRoot,
    frontendEntryAssetPath,
  };
}

async function extractTarGzSafely(bytes: Uint8Array, destinationRoot: string): Promise<string[]> {
  const tar = gunzipPluginArtifact(bytes);
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
    if (files.length >= MAX_PLUGIN_ARTIFACT_FILES) {
      throw new Error('Plugin artifact contains too many files');
    }
    totalBytes += size;
    if (totalBytes > MAX_PLUGIN_ARTIFACT_BYTES) {
      throw new Error('Plugin artifact is too large');
    }

    const data = tar.subarray(offset, offset + size);
    offset += size + ((512 - (size % 512)) % 512);
    const targetPath = join(destinationRoot, name);
    assertInsideRoot(destinationRoot, targetPath);
    await mkdir(dirname(targetPath), { recursive: true });
    await writeFile(targetPath, data);
    files.push(name);
  }

  if (!files.includes('plugin.json')) {
    throw new Error('Plugin artifact must contain plugin.json at root');
  }
  return files;
}

function gunzipPluginArtifact(bytes: Uint8Array): Buffer {
  try {
    return gunzipSync(bytes, { maxOutputLength: MAX_PLUGIN_ARTIFACT_BYTES });
  } catch (error) {
    if (isNodeError(error) && (error.code === 'ERR_BUFFER_TOO_LARGE' || error.code === 'ERR_OUT_OF_RANGE')) {
      throw new Error('Plugin artifact is too large');
    }
    throw error;
  }
}

function assertSafeTarPath(path: string): void {
  const normalized = normalize(path);
  if (
    path.length === 0 ||
    path.includes('\\') ||
    isAbsolute(path) ||
    normalized === '..' ||
    normalized.startsWith('../') ||
    normalized.includes('/../')
  ) {
    throw new Error(`Unsafe tar path: ${path}`);
  }
}

function assertInsideRoot(root: string, target: string): void {
  const relativeTarget = relative(root, target);
  if (relativeTarget.startsWith('..') || isAbsolute(relativeTarget)) {
    throw new Error(`Unsafe extraction target: ${target}`);
  }
}

function assertSafeArtifactDescriptor(artifact: PluginArtifactDescriptor): void {
  if (!isSafePluginIdentifier(artifact.pluginId)) {
    throw new Error('Artifact pluginId must be a safe plugin identifier');
  }
  if (!isSafePathSegment(artifact.version)) {
    throw new Error('Artifact version must be a safe path segment');
  }
  if (!isNonEmptyString(artifact.sourceUrl)) {
    throw new Error('Artifact sourceUrl is required');
  }
  if (!/^[a-f0-9]{64}$/i.test(artifact.sha256)) {
    throw new Error('Artifact sha256 must be a hex SHA-256 digest');
  }
  if (!isNonEmptyString(artifact.signature)) {
    throw new Error('Artifact signature is required');
  }
}

function isSafePluginIdentifier(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z0-9][a-z0-9._-]*[a-z0-9]$/i.test(value);
}

function isSafePathSegment(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value !== '.' &&
    value !== '..' &&
    !value.includes('/') &&
    !value.includes('\\') &&
    !value.includes('\0')
  );
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}


async function readDirectoryNames(path: string): Promise<string[]> {
  try {
    const entries = await readdir(path, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return [];
    throw error;
  }
}

function compareDiscoveredPlugins(a: DiscoveredInstalledPlugin, b: DiscoveredInstalledPlugin): number {
  const idCompare = a.id.localeCompare(b.id);
  if (idCompare !== 0) return idCompare;
  return compareVersionsDescending(a.version, b.version);
}

function compareVersionsDescending(a: string, b: string): number {
  const aParts = a.split('.').map((part) => Number.parseInt(part, 10));
  const bParts = b.split('.').map((part) => Number.parseInt(part, 10));
  for (let index = 0; index < Math.max(aParts.length, bParts.length); index += 1) {
    const aPart = Number.isFinite(aParts[index]) ? aParts[index]! : 0;
    const bPart = Number.isFinite(bParts[index]) ? bParts[index]! : 0;
    if (aPart !== bPart) return bPart - aPart;
  }
  return b.localeCompare(a);
}

function createTarHeader(entry: TarFixtureEntry, size: number): Buffer {
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

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
