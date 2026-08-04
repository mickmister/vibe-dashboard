#!/usr/bin/env node
import { createHmac } from 'node:crypto';

const vdUrl = (process.env.VD_URL || 'http://localhost:3005').replace(/\/+$/, '');
const mmUrl = (process.env.MATTERMOST_URL || 'http://localhost:8065').replace(/\/+$/, '');
const botToken = process.env.MATTERMOST_E2E_BOT_TOKEN;
const secret = process.env.MATTERMOST_BRIDGE_VK_WEBHOOK_SECRET || 'vk-webhook-secret';
const workspaceId = process.env.FAKE_VK_WORKSPACE_ID || 'workspace-1';
const sessionId = process.env.FAKE_VK_SESSION_ID || 'session-1';

if (!botToken) {
  throw new Error('MATTERMOST_E2E_BOT_TOKEN is required');
}

function sign(timestamp, body) {
  return `sha256=${createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`;
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForVd() {
  for (let attempt = 1; attempt <= 90; attempt += 1) {
    try {
      const response = await fetch(`${vdUrl}/api/chat/health`);
      const data = await response.json();
      if (response.ok && data.ready && data.enabled && !data.startupError) return data;
    } catch {}
    await sleep(2000);
  }
  const response = await fetch(`${vdUrl}/api/chat/health`).catch(() => null);
  throw new Error(`Timed out waiting for VD chat integration readiness: ${response ? await response.text() : 'unreachable'}`);
}

async function vdJson(path, options = {}) {
  const response = await fetch(`${vdUrl}${path}`, options);
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(`${options.method || 'GET'} ${path} failed: ${response.status} ${text}`);
  return data;
}

async function mmJson(path) {
  const response = await fetch(`${mmUrl}/api/v4${path}`, {
    headers: { authorization: `Bearer ${botToken}`, accept: 'application/json' },
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(`Mattermost GET ${path} failed: ${response.status} ${text}`);
  return data;
}

async function postWebhook(deliveryId, signatureOverride) {
  const body = JSON.stringify({
    event_type: 'execution.completed',
    delivery_id: deliveryId,
    timestamp: new Date().toISOString(),
    title: 'Task Execution Completed',
    message: 'Container e2e completed successfully',
    workspace_id: workspaceId,
    session_id: sessionId,
    execution_id: 'execution-1',
    exit_code: 0,
  });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const response = await fetch(`${vdUrl}/api/mattermost/vk-webhook`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-vk-webhook-timestamp': timestamp,
      'x-vk-webhook-signature': signatureOverride || sign(timestamp, body),
    },
    body,
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  return { response, data, text };
}

await waitForVd();

const first = await postWebhook('delivery-container-1');
if (!first.response.ok || !first.data?.success || !first.data?.data?.posted) {
  throw new Error(`Expected first webhook to post, got ${first.response.status}: ${first.text}`);
}

const routing = await vdJson('/api/chat/routing');
const binding = routing.data.workspaceBindings.find((item) => item.workspaceId === workspaceId);
if (!binding?.channelId) {
  throw new Error(`Expected workspace binding for ${workspaceId}: ${JSON.stringify(routing)}`);
}
if (!binding.spaceLabel || !/alpha/i.test(binding.spaceLabel)) {
  throw new Error(`Expected auto-created Alpha repo team mapping, got ${JSON.stringify(binding)}`);
}

const posts = await mmJson(`/channels/${encodeURIComponent(binding.channelId)}/posts`);
const matchingPosts = Object.values(posts.posts || {}).filter((post) => post?.props?.vk_webhook_delivery_id === 'delivery-container-1');
if (matchingPosts.length !== 1) {
  throw new Error(`Expected exactly one Mattermost post for delivery-container-1, found ${matchingPosts.length}`);
}

const duplicate = await postWebhook('delivery-container-1');
if (!duplicate.response.ok || !duplicate.data?.success || !duplicate.data?.data?.duplicate) {
  throw new Error(`Expected duplicate webhook suppression, got ${duplicate.response.status}: ${duplicate.text}`);
}
const postsAfterDuplicate = await mmJson(`/channels/${encodeURIComponent(binding.channelId)}/posts`);
const matchingAfterDuplicate = Object.values(postsAfterDuplicate.posts || {}).filter((post) => post?.props?.vk_webhook_delivery_id === 'delivery-container-1');
if (matchingAfterDuplicate.length !== 1) {
  throw new Error(`Expected duplicate webhook not to create another post, found ${matchingAfterDuplicate.length}`);
}

const rejected = await postWebhook('delivery-container-bad-signature', 'sha256=bad');
if (rejected.response.status !== 401) {
  throw new Error(`Expected invalid signature to be rejected with 401, got ${rejected.response.status}: ${rejected.text}`);
}

console.log('Mattermost container e2e passed');
