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
const buildTargets = [
  {
    name: 'springboard',
    tsconfig: path.join(springboardDir, 'tsconfig.build.json'),
    output: path.join(springboardDir, 'dist/index.js'),
  },
  {
    name: '@springboard/vite-plugin',
    tsconfig: path.join(springboardDir, 'vite-plugin/tsconfig.json'),
    output: path.join(springboardDir, 'vite-plugin/dist/index.js'),
  },
];

const missingTargets = buildTargets.filter(({ output }) => !fs.existsSync(output));
if (missingTargets.length === 0) {
  console.log('Springboard git ref already has built outputs; skipping.');
  process.exit(0);
}

for (const target of missingTargets) {
  if (!fs.existsSync(target.tsconfig)) {
    throw new Error(`Cannot build ${target.name} from Springboard git ref because ${target.tsconfig} is missing.`);
  }

  console.log(`Building ${target.name} from Springboard git ref at ${springboardDir}`);
  run('pnpm', ['exec', 'tsc', '-p', target.tsconfig], repoRoot);

  if (!fs.existsSync(target.output)) {
    throw new Error(`${target.name} build completed but ${target.output} was not created.`);
  }
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
