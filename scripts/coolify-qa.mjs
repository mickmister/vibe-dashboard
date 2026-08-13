#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

const DEFAULT_PROJECT_UUID = 'qggkwso04cgg0kgcos8gskk8';
const DEFAULT_ENVIRONMENT_UUID = 'dksgc48844g4o8kko8gosk48';
const DEFAULT_SERVER_UUID = 'y80og4woc8osok44s4s84gss';
const DEFAULT_REPO = 'https://github.com/mickmister/vibe-dashboard';
const DEFAULT_COMPOSE_LOCATION = '/docker-compose.yaml';
const DEFAULT_IMAGE = 'ghcr.io/mickmister/vk-vd';

function usage() {
  console.log(`Usage:
  node scripts/coolify-qa.mjs status [--prefix vkvd-qa-slot-]
  node scripts/coolify-qa.mjs bootstrap --slot <n> --branch <branch> --host-port <port> [--image-tag <tag>] [--name <name>] [--compose-location <path>]
  node scripts/coolify-qa.mjs deploy --slot <n> --branch <branch> --host-port <port> --image-tag <tag> [--name <name>] [--wait-image] [--confirm]

Environment:
  COOLIFY_BASE_URL      Coolify URL; may include /project/... or /api/v1
  COOLIFY_API_TOKEN     Coolify API token with read/write/deploy

Defaults:
  project=${DEFAULT_PROJECT_UUID}
  environment=${DEFAULT_ENVIRONMENT_UUID}
  server=${DEFAULT_SERVER_UUID}
  repo=${DEFAULT_REPO}
`);
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      args._.push(arg);
      continue;
    }
    const key = arg.slice(2);
    if (['wait-image', 'confirm', 'dry-run'].includes(key)) {
      args[key] = true;
      continue;
    }
    const value = argv[++i];
    if (value == null) throw new Error(`Missing value for --${key}`);
    args[key] = value;
  }
  return args;
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function coolifyBaseUrl() {
  let base = requiredEnv('COOLIFY_BASE_URL');
  base = base.split('/project/')[0];
  base = base.split('/api/v1')[0];
  return base.replace(/\/$/, '');
}

async function coolify(path, options = {}) {
  const url = `${coolifyBaseUrl()}${path}`;
  const res = await fetch(url, {
    method: options.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${requiredEnv('COOLIFY_API_TOKEN')}`,
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const text = await res.text();
  let body = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {}
  if (!res.ok) {
    const message = typeof body === 'string' ? body : JSON.stringify(body);
    throw new Error(`${options.method ?? 'GET'} ${path} failed ${res.status}: ${message}`);
  }
  return body;
}

function slotName(args) {
  if (args.name) return args.name;
  if (!args.slot) throw new Error('--slot is required');
  return `vkvd-qa-slot-${args.slot}`;
}

async function listApps() {
  return await coolify('/api/v1/applications');
}

async function findAppByName(name) {
  const apps = await listApps();
  return apps.find((app) => app.name === name);
}

async function bootstrap(args) {
  const name = slotName(args);
  const existing = await findAppByName(name);
  if (existing) {
    console.log(JSON.stringify({ action: 'found', uuid: existing.uuid, name: existing.name, status: existing.status }, null, 2));
    return existing;
  }
  if (!args.branch) throw new Error('--branch is required');
  const body = {
    project_uuid: args['project-uuid'] ?? DEFAULT_PROJECT_UUID,
    server_uuid: args['server-uuid'] ?? DEFAULT_SERVER_UUID,
    environment_uuid: args['environment-uuid'] ?? DEFAULT_ENVIRONMENT_UUID,
    git_repository: args.repo ?? DEFAULT_REPO,
    git_branch: args.branch,
    build_pack: 'dockercompose',
    ports_exposes: '3001',
    name,
    description: descriptionFor(args),
    docker_compose_location: args['compose-location'] ?? DEFAULT_COMPOSE_LOCATION,
    instant_deploy: false,
    autogenerate_domain: false,
    force_domain_override: false,
  };
  if (args['dry-run']) {
    console.log(JSON.stringify({ action: 'create', body }, null, 2));
    return null;
  }
  const created = await coolify('/api/v1/applications/public', { method: 'POST', body });
  console.log(JSON.stringify({ action: 'created', ...created }, null, 2));
  return await findAppByName(name);
}

function descriptionFor(args) {
  const parts = ['vkvd-qa'];
  if (args.slot) parts.push(`slot=${args.slot}`);
  if (args.branch) parts.push(`branch=${args.branch}`);
  if (args['image-tag']) parts.push(`image=${args['image-tag']}`);
  if (args['host-port']) parts.push(`hostPort=${args['host-port']}`);
  parts.push(`updated=${new Date().toISOString()}`);
  return parts.join(' ');
}

async function updateDescription(uuid, args) {
  await coolify(`/api/v1/applications/${uuid}`, {
    method: 'PATCH',
    body: {
      git_branch: args.branch,
      docker_compose_location: args['compose-location'] ?? DEFAULT_COMPOSE_LOCATION,
      description: descriptionFor(args),
    },
  });
}

async function upsertEnv(uuid, key, value) {
  const body = { key, value: String(value), is_preview: false, is_literal: true };
  try {
    await coolify(`/api/v1/applications/${uuid}/envs`, { method: 'POST', body });
    console.log(`created env ${key}`);
  } catch (error) {
    if (!String(error.message).includes('already exists')) throw error;
    await coolify(`/api/v1/applications/${uuid}/envs`, { method: 'PATCH', body });
    console.log(`updated env ${key}`);
  }
}

function dockerManifestExists(imageRef) {
  const result = spawnSync('docker', ['manifest', 'inspect', imageRef], { stdio: 'ignore' });
  return result.status === 0;
}

async function waitForImage(imageRef) {
  for (let attempt = 1; attempt <= 60; attempt++) {
    if (dockerManifestExists(imageRef)) return;
    console.log(`image not available yet: ${imageRef}; retry ${attempt}/60`);
    await new Promise((resolve) => setTimeout(resolve, 10_000));
  }
  throw new Error(`Timed out waiting for image: ${imageRef}`);
}

async function deploy(args) {
  if (!args.branch) throw new Error('--branch is required');
  if (!args['host-port']) throw new Error('--host-port is required');
  if (!args['image-tag']) throw new Error('--image-tag is required');
  if (!args.confirm && !args['dry-run']) throw new Error('deploy requires --confirm (or --dry-run)');
  const imageRef = `${args.image ?? DEFAULT_IMAGE}:${args['image-tag']}`;
  if (args['wait-image']) await waitForImage(imageRef);
  else if (!dockerManifestExists(imageRef)) throw new Error(`Image does not exist yet: ${imageRef}`);

  const app = await bootstrap(args);
  const uuid = app?.uuid;
  if (!uuid) return;
  await updateDescription(uuid, args);
  const envs = {
    VKVD_IMAGE_VERSION: args['image-tag'],
    CADDY_PORT: '3001',
    QA_SLOT_ID: `slot-${args.slot}`,
    QA_HOST_PORT: args['host-port'],
    SUDO_PASSWORD: args['sudo-password'] ?? `qa-slot-${args.slot}`,
    CODE_PASSWORD: args['code-password'] ?? '__unset__',
    ENABLE_VIBE_KANBAN: 'true',
    MEMORY_WATCHDOG_ENABLED: 'false',
    ENABLE_TAILSCALE: 'false',
  };
  if (args['dry-run']) {
    console.log(JSON.stringify({ action: 'deploy', uuid, imageRef, envs }, null, 2));
    return;
  }
  for (const [key, value] of Object.entries(envs)) await upsertEnv(uuid, key, value);
  const deployment = await coolify(`/api/v1/deploy?uuid=${encodeURIComponent(uuid)}`, { method: 'GET' });
  console.log(JSON.stringify({ action: 'deploy-triggered', uuid, deployment, url: `http://localhost:${args['host-port']}` }, null, 2));
}

async function status(args) {
  const prefix = args.prefix ?? 'vkvd-qa-slot-';
  const apps = await listApps();
  const slots = apps
    .filter((app) => app.name?.startsWith(prefix))
    .map((app) => ({ uuid: app.uuid, name: app.name, status: app.status, git_branch: app.git_branch, description: app.description, updated_at: app.updated_at }));
  console.log(JSON.stringify(slots, null, 2));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0];
  if (!cmd || cmd === 'help' || cmd === '--help') return usage();
  if (cmd === 'status') return status(args);
  if (cmd === 'bootstrap') return bootstrap(args);
  if (cmd === 'deploy') return deploy(args);
  throw new Error(`Unknown command: ${cmd}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
