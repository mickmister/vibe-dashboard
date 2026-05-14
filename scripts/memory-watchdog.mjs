#!/usr/bin/env node

import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import os from 'node:os';
import http from 'node:http';
import https from 'node:https';

const execFile = promisify(execFileCallback);

const config = {
  webhookUrl: process.env.MEMORY_WATCHDOG_MATTERMOST_WEBHOOK_URL?.trim() ?? '',
  channel: process.env.MEMORY_WATCHDOG_MATTERMOST_CHANNEL?.trim() ?? '',
  username: process.env.MEMORY_WATCHDOG_MATTERMOST_USERNAME?.trim() || 'memory-watchdog',
  iconEmoji: process.env.MEMORY_WATCHDOG_MATTERMOST_ICON_EMOJI?.trim() || ':warning:',
  dryRun: parseBoolean(process.env.MEMORY_WATCHDOG_DRY_RUN, false),
  sendTestNotification: parseBoolean(process.env.MEMORY_WATCHDOG_SEND_TEST_NOTIFICATION, false),
  processThresholdMb: parsePositiveNumber(process.env.MEMORY_WATCHDOG_PROCESS_THRESHOLD_MB, 4096),
  totalThresholdPercent: parsePositiveNumber(process.env.MEMORY_WATCHDOG_TOTAL_THRESHOLD_PERCENT, 60),
  intervalSeconds: parsePositiveNumber(process.env.MEMORY_WATCHDOG_INTERVAL_SECONDS, 30),
  totalGrowthDeltaPercent: parsePositiveNumber(process.env.MEMORY_WATCHDOG_TOTAL_GROWTH_DELTA_PERCENT, 5),
  totalReminderSeconds: parsePositiveNumber(process.env.MEMORY_WATCHDOG_TOTAL_REMINDER_SECONDS, 600),
  triggerStreak: parsePositiveInteger(process.env.MEMORY_WATCHDOG_TRIGGER_STREAK, 2),
  resolveStreak: parsePositiveInteger(process.env.MEMORY_WATCHDOG_RESOLVE_STREAK, 2),
  topCount: parsePositiveInteger(process.env.MEMORY_WATCHDOG_TOP_COUNT, 5),
  snapshotLineLimit: parsePositiveInteger(process.env.MEMORY_WATCHDOG_SNAPSHOT_LINE_LIMIT, 20),
};

const activeTotalAlert = {
  active: false,
  breachStreak: 0,
  clearStreak: 0,
  activatedAtMs: 0,
  lastNotificationAtMs: 0,
  lastGrowthNotificationPercent: 0,
};

const processAlerts = new Map();

let shuttingDown = false;

process.on('SIGINT', () => {
  shuttingDown = true;
});

process.on('SIGTERM', () => {
  shuttingDown = true;
});

await main();

async function main() {
  if (!config.webhookUrl) {
    console.error('[memory-watchdog] MEMORY_WATCHDOG_MATTERMOST_WEBHOOK_URL is required');
    process.exit(1);
  }

  console.log(
    `[memory-watchdog] starting with process threshold ${config.processThresholdMb} MiB, total threshold ${config.totalThresholdPercent}%, interval ${config.intervalSeconds}s`,
  );

  if (config.sendTestNotification) {
    await sendTestNotification();
  }

  while (!shuttingDown) {
    try {
      await runCheck();
    } catch (error) {
      console.error('[memory-watchdog] check failed:', error);
    }

    await sleep(config.intervalSeconds * 1000);
  }

  console.log('[memory-watchdog] shutting down');
}

async function runCheck() {
  const [memoryStats, processes] = await Promise.all([
    getMemoryStats(),
    getProcesses(),
  ]);

  const overThresholdProcesses = processes.filter(
    (processInfo) => processInfo.rssMiB >= config.processThresholdMb,
  );

  await handleTotalMemoryAlert(memoryStats, processes);
  await handleProcessAlerts(memoryStats, overThresholdProcesses);
}

async function sendTestNotification() {
  const [memoryStats, processes, snapshots] = await Promise.all([
    getMemoryStats(),
    getProcesses(),
    getSnapshots(),
  ]);

  await sendMattermostMessage({
    severity: 'info',
    title: 'Memory watchdog test notification',
    lines: [
      `Host: ${os.hostname()}`,
      `No threshold breach is required for this preview.`,
      `Current used memory: ${formatPercent(memoryStats.usedPercent)} (${formatBytes(memoryStats.usedBytes)} of ${formatBytes(memoryStats.totalBytes)})`,
      `Configured thresholds: host > ${formatPercent(config.totalThresholdPercent)}, process > ${formatBytes(mebibytesToBytes(config.processThresholdMb))}`,
      '',
      'Top resident-memory processes:',
      ...formatProcessList(processes.slice(0, config.topCount)),
    ],
    snapshots,
  });
}

async function handleTotalMemoryAlert(memoryStats, processes) {
  const isBreaching = memoryStats.usedPercent > config.totalThresholdPercent;
  const now = Date.now();

  if (isBreaching) {
    activeTotalAlert.breachStreak += 1;
    activeTotalAlert.clearStreak = 0;
  } else {
    activeTotalAlert.clearStreak += 1;
    activeTotalAlert.breachStreak = 0;
  }

  if (!activeTotalAlert.active && activeTotalAlert.breachStreak >= config.triggerStreak) {
    activeTotalAlert.active = true;
    activeTotalAlert.activatedAtMs = now;
    activeTotalAlert.lastNotificationAtMs = now;
    activeTotalAlert.lastGrowthNotificationPercent = memoryStats.usedPercent;

    const snapshots = await getSnapshots();
    await sendMattermostMessage({
      severity: 'alert',
      title: `Host memory usage ${formatPercent(memoryStats.usedPercent)} > ${formatPercent(config.totalThresholdPercent)}`,
      lines: [
        `Host: ${os.hostname()}`,
        `Used memory: ${formatPercent(memoryStats.usedPercent)} (${formatBytes(memoryStats.usedBytes)} of ${formatBytes(memoryStats.totalBytes)})`,
        `Available memory: ${formatBytes(memoryStats.availableBytes)}`,
        `Threshold: ${formatPercent(config.totalThresholdPercent)}`,
        '',
        'Top resident-memory processes:',
        ...formatProcessList(processes.slice(0, config.topCount)),
      ],
      snapshots,
    });

    return;
  }

  if (activeTotalAlert.active && isBreaching) {
    const hasGrownMaterially =
      memoryStats.usedPercent >= activeTotalAlert.lastGrowthNotificationPercent + config.totalGrowthDeltaPercent;
    const reminderIsDue =
      now - activeTotalAlert.lastNotificationAtMs >= config.totalReminderSeconds * 1000;

    if (hasGrownMaterially) {
      const previousGrowthNotificationPercent = activeTotalAlert.lastGrowthNotificationPercent;
      activeTotalAlert.lastGrowthNotificationPercent = memoryStats.usedPercent;
      activeTotalAlert.lastNotificationAtMs = now;

      const snapshots = await getSnapshots();
      await sendMattermostMessage({
        severity: 'alert',
        title: `Host memory usage is continuing to grow: ${formatPercent(memoryStats.usedPercent)}`,
        lines: [
          `Host: ${os.hostname()}`,
          `Used memory: ${formatPercent(memoryStats.usedPercent)} (${formatBytes(memoryStats.usedBytes)} of ${formatBytes(memoryStats.totalBytes)})`,
          `Available memory: ${formatBytes(memoryStats.availableBytes)}`,
          `Threshold: ${formatPercent(config.totalThresholdPercent)}`,
          `Previous reported level: ${formatPercent(previousGrowthNotificationPercent)}`,
          `Alert active for: ${formatDuration(now - activeTotalAlert.activatedAtMs)}`,
          '',
          'Top resident-memory processes:',
          ...formatProcessList(processes.slice(0, config.topCount)),
        ],
        snapshots,
      });

      return;
    }

    if (reminderIsDue) {
      activeTotalAlert.lastNotificationAtMs = now;

      const snapshots = await getSnapshots();
      await sendMattermostMessage({
        severity: 'alert',
        title: `Host memory usage is still high at ${formatPercent(memoryStats.usedPercent)}`,
        lines: [
          `Host: ${os.hostname()}`,
          `Used memory: ${formatPercent(memoryStats.usedPercent)} (${formatBytes(memoryStats.usedBytes)} of ${formatBytes(memoryStats.totalBytes)})`,
          `Available memory: ${formatBytes(memoryStats.availableBytes)}`,
          `Threshold: ${formatPercent(config.totalThresholdPercent)}`,
          `Alert active for: ${formatDuration(now - activeTotalAlert.activatedAtMs)}`,
          '',
          'Top resident-memory processes:',
          ...formatProcessList(processes.slice(0, config.topCount)),
        ],
        snapshots,
      });
    }
  }

  if (activeTotalAlert.active && !isBreaching && activeTotalAlert.clearStreak >= config.resolveStreak) {
    activeTotalAlert.active = false;
    activeTotalAlert.activatedAtMs = 0;
    activeTotalAlert.lastNotificationAtMs = 0;
    activeTotalAlert.lastGrowthNotificationPercent = 0;

    await sendMattermostMessage({
      severity: 'resolve',
      title: `Host memory usage recovered to ${formatPercent(memoryStats.usedPercent)}`,
      lines: [
        `Host: ${os.hostname()}`,
        `Used memory: ${formatPercent(memoryStats.usedPercent)} (${formatBytes(memoryStats.usedBytes)} of ${formatBytes(memoryStats.totalBytes)})`,
        `Available memory: ${formatBytes(memoryStats.availableBytes)}`,
        `Threshold: ${formatPercent(config.totalThresholdPercent)}`,
      ],
    });
  }
}

async function handleProcessAlerts(memoryStats, breachingProcesses) {
  const currentKeys = new Set();

  for (const processInfo of breachingProcesses) {
    const key = getProcessKey(processInfo);
    currentKeys.add(key);

    let state = processAlerts.get(key);
    if (!state) {
      state = { active: false, breachStreak: 0, clearStreak: 0, processInfo };
      processAlerts.set(key, state);
    }

    state.processInfo = processInfo;
    state.breachStreak += 1;
    state.clearStreak = 0;

    if (!state.active && state.breachStreak >= config.triggerStreak) {
      state.active = true;

      const snapshots = await getSnapshots();
      const processIdentity = formatProcessIdentity(processInfo, 100);
      await sendMattermostMessage({
        severity: 'alert',
        title: `Process ${processIdentity} (${processInfo.pid}) RSS ${formatBytes(processInfo.rssBytes)} > ${formatBytes(mebibytesToBytes(config.processThresholdMb))}`,
        lines: [
          `Host: ${os.hostname()}`,
          `PID: ${processInfo.pid}`,
          `PPID: ${processInfo.ppid}`,
          `Command: ${processInfo.comm}`,
          `RSS: ${formatBytes(processInfo.rssBytes)} (${formatMiB(processInfo.rssMiB)})`,
          `Threshold: ${formatBytes(mebibytesToBytes(config.processThresholdMb))}`,
          `System used memory: ${formatPercent(memoryStats.usedPercent)}`,
          `Args: ${formatProcessArgs(processInfo, 180)}`,
        ],
        snapshots,
      });
    }
  }

  for (const [key, state] of processAlerts.entries()) {
    if (currentKeys.has(key)) {
      continue;
    }

    state.clearStreak += 1;
    state.breachStreak = 0;

    if (state.active && state.clearStreak >= config.resolveStreak) {
      state.active = false;

      await sendMattermostMessage({
        severity: 'resolve',
        title: `Process ${formatProcessIdentity(state.processInfo, 100)} (${state.processInfo.pid}) memory recovered`,
        lines: [
          `Host: ${os.hostname()}`,
          `Last seen RSS above threshold: ${formatBytes(state.processInfo.rssBytes)} (${formatMiB(state.processInfo.rssMiB)})`,
          `Args: ${formatProcessArgs(state.processInfo, 180)}`,
          'The process exited or dropped back below the configured RSS threshold.',
        ],
      });

      processAlerts.delete(key);
    } else if (!state.active && state.clearStreak >= config.resolveStreak) {
      processAlerts.delete(key);
    }
  }
}

async function getMemoryStats() {
  try {
    const meminfo = await fs.readFile('/proc/meminfo', 'utf8');
    const values = new Map();

    for (const line of meminfo.split('\n')) {
      const match = line.match(/^([A-Za-z_()]+):\s+(\d+)\s+kB$/);
      if (match) {
        values.set(match[1], Number.parseInt(match[2], 10) * 1024);
      }
    }

    const totalBytes = values.get('MemTotal');
    const availableBytes = values.get('MemAvailable');

    if (!totalBytes || availableBytes == null) {
      throw new Error('failed to parse MemTotal or MemAvailable from /proc/meminfo');
    }

    const usedBytes = totalBytes - availableBytes;
    const usedPercent = (usedBytes / totalBytes) * 100;

    return {
      totalBytes,
      availableBytes,
      usedBytes,
      usedPercent,
    };
  } catch (error) {
    if (!isMissingProcfsError(error)) {
      throw error;
    }
  }

  try {
    const { stdout } = await execFile('free', ['-b']);
    const memoryLine = stdout
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line.startsWith('Mem:'));

    if (!memoryLine) {
      throw new Error('missing Mem: line in free -b output');
    }

    const [, total, used, free, , , available] = memoryLine.split(/\s+/);
    const totalBytes = Number.parseInt(total, 10);
    const usedBytes = Number.parseInt(used, 10);
    const availableBytes = Number.parseInt(available ?? free, 10);

    if (!Number.isFinite(totalBytes) || !Number.isFinite(usedBytes) || !Number.isFinite(availableBytes)) {
      throw new Error('failed to parse free -b output');
    }

    return {
      totalBytes,
      availableBytes,
      usedBytes,
      usedPercent: (usedBytes / totalBytes) * 100,
    };
  } catch {
    const totalBytes = os.totalmem();
    const availableBytes = os.freemem();
    const usedBytes = totalBytes - availableBytes;

    return {
      totalBytes,
      availableBytes,
      usedBytes,
      usedPercent: (usedBytes / totalBytes) * 100,
    };
  }
}

async function getProcesses() {
  const stdout = await getPsOutput();

  const processes = [];

  for (const line of stdout.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    const match = trimmed.match(/^(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s*(.*)$/);
    if (!match) {
      continue;
    }

    const pid = Number.parseInt(match[1], 10);
    const ppid = Number.parseInt(match[2], 10);
    const rssKiB = Number.parseInt(match[3], 10);
    const comm = match[4];
    const args = match[5];

    processes.push({
      pid,
      ppid,
      comm,
      args,
      rssKiB,
      rssBytes: rssKiB * 1024,
      rssMiB: rssKiB / 1024,
    });
  }

  processes.sort((left, right) => right.rssKiB - left.rssKiB);
  return processes;
}

async function getSnapshots() {
  const [freeSnapshot, topSnapshot] = await Promise.all([
    captureCommand(['free', '-h']),
    captureCommand(['sh', '-c', `top -b -n 1 | head -n ${config.snapshotLineLimit}`]),
  ]);

  return { freeSnapshot, topSnapshot };
}

async function captureCommand(commandAndArgs) {
  try {
    const [command, ...args] = commandAndArgs;
    const { stdout, stderr } = await execFile(command, args, { maxBuffer: 1024 * 1024 });
    return [stdout.trim(), stderr.trim()].filter(Boolean).join('\n');
  } catch (error) {
    return `failed to capture ${commandAndArgs.join(' ')}: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function getPsOutput() {
  const commands = [
    ['ps', ['-axo', 'pid=,ppid=,rss=,comm=,command=']],
    ['ps', ['-eo', 'pid=,ppid=,rss=,comm=,args=']],
  ];

  let lastError;

  for (const [command, args] of commands) {
    try {
      const { stdout } = await execFile(command, args, { maxBuffer: 1024 * 1024 });
      if (stdout.trim()) {
        return stdout;
      }
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError ?? new Error('failed to collect process list');
}

async function sendMattermostMessage({ severity, title, lines, snapshots }) {
  const emoji = severity === 'resolve'
    ? ':white_check_mark:'
    : severity === 'info'
      ? ':mag:'
      : ':rotating_light:';
  const blocks = [];

  if (snapshots?.freeSnapshot) {
    blocks.push(`free -h\n${snapshots.freeSnapshot}`);
  }

  if (snapshots?.topSnapshot) {
    blocks.push(`top -b -n 1\n${snapshots.topSnapshot}`);
  }

  const textParts = [
    `${emoji} ${title}`,
    ...lines,
  ];

  if (blocks.length > 0) {
    textParts.push(...blocks.map((block) => `\`\`\`\n${truncate(block, 3500)}\n\`\`\``));
  }

  const payload = {
    text: textParts.join('\n'),
    username: config.username,
    icon_emoji: config.iconEmoji,
  };

  if (config.channel) {
    payload.channel = config.channel;
  }

  if (config.dryRun) {
    console.log(`[memory-watchdog] dry run payload for: ${title}`);
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  await postJson(config.webhookUrl, payload);
  console.log(`[memory-watchdog] sent ${severity} notification: ${title}`);
}

async function postJson(urlString, payload) {
  if (typeof fetch === 'function') {
    const response = await fetch(urlString, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`webhook returned ${response.status}: ${body}`);
    }

    return;
  }

  const url = new URL(urlString);
  const body = JSON.stringify(payload);
  const client = url.protocol === 'https:' ? https : http;

  await new Promise((resolve, reject) => {
    const request = client.request(
      url,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (response) => {
        let responseBody = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => {
          responseBody += chunk;
        });
        response.on('end', () => {
          if (response.statusCode && response.statusCode >= 200 && response.statusCode < 300) {
            resolve();
            return;
          }

          reject(new Error(`webhook returned ${response.statusCode}: ${responseBody}`));
        });
      },
    );

    request.on('error', reject);
    request.write(body);
    request.end();
  });
}

function formatProcessList(processes) {
  if (processes.length === 0) {
    return ['- none'];
  }

  return processes.map(
    (processInfo) =>
      `- pid ${processInfo.pid}: ${formatBytes(processInfo.rssBytes)} (${formatProcessIdentity(processInfo, 120)})`,
  );
}

function getProcessKey(processInfo) {
  return `${processInfo.pid}:${processInfo.comm}`;
}

function formatProcessIdentity(processInfo, maxLength) {
  return formatProcessArgs(processInfo, maxLength);
}

function formatProcessArgs(processInfo, maxLength) {
  return slashTruncate(processInfo.args || processInfo.comm, maxLength);
}

function parsePositiveNumber(value, fallback) {
  const parsed = Number.parseFloat(value ?? '');
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value ?? '', 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

function parseBoolean(value, fallback) {
  if (value == null || value.trim() === '') {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }

  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }

  return fallback;
}

function isMissingProcfsError(error) {
  return (
    error instanceof Error &&
    'code' in error &&
    error.code === 'ENOENT'
  );
}

function formatPercent(value) {
  return `${value.toFixed(1)}%`;
}

function formatMiB(value) {
  return `${value.toFixed(1)} MiB`;
}

function formatBytes(bytes) {
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(value >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function formatDuration(durationMs) {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }

  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }

  return `${seconds}s`;
}

function mebibytesToBytes(mebibytes) {
  return mebibytes * 1024 * 1024;
}

function slashTruncate(value, maxLength) {
  const shortened = value
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => slashTruncateToken(token))
    .join(' ');

  return truncate(shortened, maxLength);
}

function slashTruncateToken(token) {
  if (!token.includes('/') || token.length <= 32) {
    return token;
  }

  const hasLeadingSlash = token.startsWith('/');
  const segments = token.split('/').filter(Boolean);
  if (segments.length <= 2) {
    return token;
  }

  const keptSegments = [segments.pop()];
  while (segments.length > 0) {
    const nextSegment = segments.pop();
    const candidate = `${hasLeadingSlash ? '/' : ''}.../${nextSegment}/${keptSegments.join('/')}`;
    if (candidate.length > 40) {
      break;
    }

    keptSegments.unshift(nextSegment);
  }

  return `${hasLeadingSlash ? '/' : ''}.../${keptSegments.join('/')}`;
}

function truncate(value, maxLength) {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, Math.max(0, maxLength - 3))}...`;
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
