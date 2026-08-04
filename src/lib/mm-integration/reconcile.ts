import type {
  MattermostSlashCommandRequest,
  VkRemoteIssue,
  VkWorkspace,
} from './types';

const CHANNEL_NAME_LIMIT = 64;

function slugifySegment(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

export function buildIssueTitleFromCommandText(text: string): string {
  const firstLine = text
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean);

  if (!firstLine) {
    return 'Mattermost request';
  }

  return firstLine.length > 80 ? `${firstLine.slice(0, 77)}...` : firstLine;
}

export function buildWorkspaceChannelName(input: {
  prefix: string;
  workspace: Pick<VkWorkspace, 'id' | 'name'>;
  issue: Pick<VkRemoteIssue, 'title'>;
}): string {
  const prefix = slugifySegment(input.prefix) || 'vk';
  const base =
    slugifySegment(input.workspace.name ?? '') ||
    slugifySegment(input.issue.title) ||
    'workspace';
  const suffix = input.workspace.id.slice(-8).toLowerCase();
  const raw = `${prefix}-${base}-${suffix}`;

  if (raw.length <= CHANNEL_NAME_LIMIT) {
    return raw;
  }

  const maxBaseLength =
    CHANNEL_NAME_LIMIT - prefix.length - suffix.length - 2;
  const trimmedBase = base.slice(0, Math.max(8, maxBaseLength));
  return `${prefix}-${trimmedBase}-${suffix}`.slice(0, CHANNEL_NAME_LIMIT);
}

export function buildWorkspaceDisplayName(input: {
  workspace: Pick<VkWorkspace, 'id' | 'name'>;
  issue: Pick<VkRemoteIssue, 'title'>;
}): string {
  return input.workspace.name?.trim() || input.issue.title.trim() || input.workspace.id;
}

export function buildSlashCommandUsage(command = '/vibe'): string {
  return `Usage: ${command} <task description>`;
}

export function buildRootPostGuidanceMessage(command = '/vibe'): string {
  return [
    `Use \`${command} <task description>\` to start new work from this channel.`,
    'Replies inside an existing mapped session thread are routed back to VK.',
  ].join('\n');
}

export function buildSessionRootPostMessage(input: {
  issue: Pick<VkRemoteIssue, 'title'>;
  workspace: Pick<VkWorkspace, 'id' | 'name'>;
  prompt: string;
}): string {
  const workspaceName = input.workspace.name?.trim() || input.workspace.id;

  return [
    `Started VK workspace **${workspaceName}**.`,
    `Issue: ${input.issue.title}`,
    '',
    input.prompt,
  ].join('\n');
}

export function buildSlashCommandAck(input: {
  request: MattermostSlashCommandRequest;
  workspace: Pick<VkWorkspace, 'name' | 'id'>;
}): string {
  const workspaceName = input.workspace.name?.trim() || input.workspace.id;
  return `Started ${workspaceName} from ${input.request.command}.`;
}
