import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(import.meta.dirname, '..');
const dependencyConsumerPackageJsonPaths = [
  path.join(repoRoot, 'package.json'),
  path.join(repoRoot, 'apps/mobile/package.json'),
];

const springboardDirs = findGitRefSpringboardInstalls();

if (springboardDirs.length === 0) {
  console.log('Springboard dependency is not a git ref; skipping git-ref build.');
  process.exit(0);
}

let builtTargetCount = 0;
for (const { consumerLabel, springboardDir } of springboardDirs) {
  builtTargetCount += buildMissingTargets({ consumerLabel, springboardDir });
}

if (builtTargetCount === 0) {
  console.log('Springboard git ref already has built outputs in all resolved installs; skipping.');
}

function findGitRefSpringboardInstalls() {
  const installs = [];
  const seen = new Set();

  for (const packageJsonPath of dependencyConsumerPackageJsonPaths) {
    if (!fs.existsSync(packageJsonPath)) {
      continue;
    }

    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    const springboardSpec = packageJson.dependencies?.springboard
      ?? packageJson.devDependencies?.springboard
      ?? packageJson.optionalDependencies?.springboard;

    if (!isGitRef(springboardSpec)) {
      continue;
    }

    const consumerDir = path.dirname(packageJsonPath);
    const springboardPackageJsonPath = require.resolve('springboard/package.json', {
      paths: [consumerDir],
    });
    const springboardDir = path.dirname(springboardPackageJsonPath);

    if (!seen.has(springboardDir)) {
      seen.add(springboardDir);
      installs.push({
        consumerLabel: path.relative(repoRoot, packageJsonPath),
        springboardDir,
      });
    }
  }

  return installs;
}

function buildMissingTargets({ consumerLabel, springboardDir }) {
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

  for (const target of missingTargets) {
    if (!fs.existsSync(target.tsconfig)) {
      throw new Error(`Cannot build ${target.name} from Springboard git ref because ${target.tsconfig} is missing.`);
    }

    console.log(`Building ${target.name} from Springboard git ref for ${consumerLabel} at ${springboardDir}`);
    run('pnpm', ['exec', 'tsc', '-p', target.tsconfig], repoRoot);

    if (!fs.existsSync(target.output)) {
      throw new Error(`${target.name} build completed but ${target.output} was not created.`);
    }
  }

  return missingTargets.length;
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
