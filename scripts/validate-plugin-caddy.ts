import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import {
  renderCaddyPluginExposureConfig,
  type PluginServiceCatalog,
} from '../plugins/orchestrator/plugin-service-orchestrator.ts';

const execFileAsync = promisify(execFile);
const repoRoot = resolve(import.meta.dirname, '..');
const caddyBinary = process.env.CADDY_BIN ?? 'caddy';
const activePluginImportPath = '/etc/caddy/plugins.caddy';

async function main(): Promise<void> {
  const [baseCaddyfile, placeholderPluginCaddy, firstPartyCatalog] = await Promise.all([
    readFile(resolve(repoRoot, 'Caddyfile'), 'utf8'),
    readFile(resolve(repoRoot, 'Caddyfile.plugins'), 'utf8'),
    readPluginCatalog(resolve(repoRoot, 'plugins/builtin.plugins.json')),
  ]);

  if (!baseCaddyfile.includes(activePluginImportPath)) {
    throw new Error(`Caddyfile must import ${activePluginImportPath}`);
  }

  await validatePluginCaddyContent({
    label: 'placeholder Caddyfile.plugins',
    baseCaddyfile,
    pluginCaddyContent: placeholderPluginCaddy,
  });

  const generatedFirstPartyPluginCaddy = renderCaddyPluginExposureConfig({
    catalog: firstPartyCatalog,
  });
  await validatePluginCaddyContent({
    label: 'generated first-party plugin exposure',
    baseCaddyfile,
    pluginCaddyContent: generatedFirstPartyPluginCaddy,
  });

  if (!generatedFirstPartyPluginCaddy.includes('@vd_plugin_vd_beads_web_web header_regexp vd_plugin_vd_beads_web_web_host Host ^beads-web\\.')) {
    throw new Error('Generated first-party plugin Caddy config did not include beads-web host matcher');
  }
  if (!generatedFirstPartyPluginCaddy.includes('reverse_proxy 127.0.0.1:3109')) {
    throw new Error('Generated first-party plugin Caddy config did not proxy beads-web via loopback');
  }

  console.log('Validated placeholder and generated first-party plugin Caddy config.');
}

async function validatePluginCaddyContent(input: {
  label: string;
  baseCaddyfile: string;
  pluginCaddyContent: string;
}): Promise<void> {
  const tempRoot = await mkdtemp(join(tmpdir(), 'vd-plugin-caddy-'));
  const tempPluginCaddyPath = join(tempRoot, 'plugins.caddy');
  const tempCaddyfilePath = join(tempRoot, 'Caddyfile');
  try {
    await writeFile(tempPluginCaddyPath, input.pluginCaddyContent);
    await writeFile(
      tempCaddyfilePath,
      input.baseCaddyfile.split(activePluginImportPath).join(tempPluginCaddyPath),
    );
    await execFileAsync(caddyBinary, ['adapt', '--config', tempCaddyfilePath, '--adapter', 'caddyfile']);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to validate ${input.label}: ${detail}`);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

async function readPluginCatalog(path: string): Promise<PluginServiceCatalog> {
  return JSON.parse(await readFile(path, 'utf8')) as PluginServiceCatalog;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
