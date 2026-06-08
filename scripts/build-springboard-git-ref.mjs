import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(import.meta.dirname, '..');
const rootPackageJsonPath = path.join(repoRoot, 'package.json');
const rootPackageJson = JSON.parse(fs.readFileSync(rootPackageJsonPath, 'utf8'));
const springboardSpec = rootPackageJson.dependencies?.springboard
  ?? rootPackageJson.devDependencies?.springboard
  ?? rootPackageJson.optionalDependencies?.springboard;

if (!isGitRef(springboardSpec)) {
  console.log('Springboard dependency is not a git ref; skipping git-ref build.');
  process.exit(0);
}

const springboardPackageJsonPath = require.resolve('springboard/package.json', { paths: [repoRoot] });
const springboardDir = path.dirname(springboardPackageJsonPath);
const distIndex = path.join(springboardDir, 'dist/index.js');

if (fs.existsSync(distIndex)) {
  console.log(`Springboard git ref already has built output at ${distIndex}; skipping.`);
  process.exit(0);
}

const tsconfig = path.join(springboardDir, 'tsconfig.build.json');
if (!fs.existsSync(tsconfig)) {
  throw new Error(`Cannot build Springboard git ref because ${tsconfig} is missing.`);
}

console.log(`Building Springboard git ref from ${springboardDir}`);
run('pnpm', ['exec', 'tsc', '-p', tsconfig], repoRoot);

if (!fs.existsSync(distIndex)) {
  throw new Error(`Springboard build completed but ${distIndex} was not created.`);
}

function isGitRef(spec) {
  return typeof spec === 'string' && /^(git\+|github:)|github\.com/.test(spec);
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });

  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status}`);
  }
}
