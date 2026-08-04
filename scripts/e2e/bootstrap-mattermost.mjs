#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

const baseUrl = (process.env.MATTERMOST_URL || 'http://localhost:8065').replace(/\/+$/, '');
const container = process.env.MATTERMOST_CONTAINER || 'mattermost';
const email = process.env.MATTERMOST_ADMIN_EMAIL || 'sysadmin@example.com';
const username = process.env.MATTERMOST_ADMIN_USERNAME || 'sysadmin';
const password = process.env.MATTERMOST_ADMIN_PASSWORD || 'Sysadmin123!';

function log(message) {
  console.error(`[mattermost-e2e-bootstrap] ${message}`);
}

function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const details = `${result.stdout || ''}${result.stderr || ''}`.trim();
    throw new Error(`${command} ${args.join(' ')} failed (${result.status})${details ? `\n${details}` : ''}`);
  }
  return result.stdout;
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForMattermost() {
  for (let attempt = 1; attempt <= 90; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/api/v4/system/ping`);
      if (response.ok) return;
    } catch {}
    await sleep(2000);
  }
  throw new Error(`Timed out waiting for Mattermost at ${baseUrl}`);
}

async function api(path, options = {}) {
  const response = await fetch(`${baseUrl}/api/v4${path}`, {
    method: options.method || 'GET',
    headers: {
      accept: 'application/json',
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const error = new Error(`${options.method || 'GET'} ${path} failed: ${response.status} ${data?.message || text}`);
    error.status = response.status;
    throw error;
  }
  return { response, data };
}

async function login() {
  const { response } = await api('/users/login', {
    method: 'POST',
    body: { login_id: email, password },
  });
  const token = response.headers.get('token');
  if (!token) throw new Error('Mattermost login did not return a token header');
  return token;
}

await waitForMattermost();
try {
  await login();
} catch {
  log('creating sysadmin user with mmctl --local');
  try {
    run('docker', [
      'exec', container, '/mattermost/bin/mmctl', '--local', 'user', 'create',
      '--email', email,
      '--username', username,
      '--password', password,
      '--system-admin',
    ]);
  } catch (error) {
    if (!/already exists|already in use/i.test(String(error.message))) throw error;
  }
}
const loginToken = await login();
const auth = { authorization: `Bearer ${loginToken}` };
const me = (await api('/users/me', { headers: auth })).data;
const created = await api(`/users/${encodeURIComponent(me.id)}/tokens`, {
  method: 'POST',
  headers: auth,
  body: { description: `vkvd-e2e-${Date.now()}` },
});

console.log(`MATTERMOST_E2E_BOT_TOKEN=${created.data.token}`);
console.log(`MATTERMOST_E2E_BOT_USER_ID=${me.id}`);
log(`bootstrapped ${me.username} (${me.id})`);
