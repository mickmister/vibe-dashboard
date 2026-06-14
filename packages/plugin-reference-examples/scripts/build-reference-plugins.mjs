import { cp, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const sourceRoot = join(root, 'reference-plugins');
const distRoot = join(root, 'dist');
await rm(distRoot, { recursive: true, force: true });
await mkdir(distRoot, { recursive: true });

const pluginIds = (await readdir(sourceRoot, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

for (const pluginId of pluginIds) {
  await cp(join(sourceRoot, pluginId), join(distRoot, pluginId), { recursive: true });
}

await writeFile(join(distRoot, 'build-manifest.json'), `${JSON.stringify({ builtAt: '1970-01-01T00:00:00.000Z', pluginIds }, null, 2)}\n`);
