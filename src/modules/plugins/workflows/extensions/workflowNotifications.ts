export type WorkflowNotificationChannel = 'pwa' | 'discord';
export type WorkflowNotificationStatus = 'completed' | 'failed' | 'blocked';
export type WorkflowNotificationSubjectKind = 'workflow_run' | 'meta_workflow_run';

export interface WorkflowNotificationPayload {
  notificationId: string;
  channel: WorkflowNotificationChannel;
  subjectKind: WorkflowNotificationSubjectKind;
  subjectId: string;
  status: WorkflowNotificationStatus;
  title: string;
  body: string;
  link: string | null;
  createdAt: number;
  metadata?: Record<string, unknown>;
}

export interface WorkflowNotificationProvider {
  providerType: string;
  channel: WorkflowNotificationChannel;
  isEnabled(): boolean;
  notify(payload: WorkflowNotificationPayload): Promise<{ deliveredRef?: string; skippedReason?: string }>;
}

export class InMemoryWorkflowNotificationProvider implements WorkflowNotificationProvider {
  readonly providerType = 'in_memory_workflow_notifications';
  readonly channel: WorkflowNotificationChannel;
  private enabled: boolean;
  readonly notifications: WorkflowNotificationPayload[] = [];

  constructor(options: { channel?: WorkflowNotificationChannel; enabled?: boolean } = {}) {
    this.channel = options.channel ?? 'pwa';
    this.enabled = options.enabled ?? true;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  async notify(payload: WorkflowNotificationPayload): Promise<{ deliveredRef?: string; skippedReason?: string }> {
    if (!this.enabled) return { skippedReason: 'notification_channel_disabled' };
    const safePayload = sanitizeWorkflowNotificationPayload({ ...payload, channel: this.channel });
    this.notifications.push(safePayload);
    return { deliveredRef: `${this.providerType}:${safePayload.notificationId}` };
  }
}

export function buildWorkflowRunTerminalNotification(input: {
  runId: string;
  workflowName: string;
  workspaceId: string;
  status: string;
  blockedReason?: { message?: string | null } | null;
  now: number;
  channel?: WorkflowNotificationChannel;
}): WorkflowNotificationPayload | null {
  const status = normalizeNotificationStatus(input.status);
  if (!status) return null;
  const workflowName = scrubProductText(input.workflowName || 'Workflow');
  const title = status === 'completed' ? `${workflowName} completed` : `${workflowName} needs attention`;
  const reason = input.blockedReason?.message ? ` ${scrubProductText(input.blockedReason.message, 180)}` : '';
  const body = status === 'completed'
    ? `Workflow completed in ${scrubProductText(input.workspaceId, 80)}.`
    : `Workflow ${status} in ${scrubProductText(input.workspaceId, 80)}.${reason}`;
  return sanitizeWorkflowNotificationPayload({
    notificationId: `workflow-run:${input.runId}:${status}`,
    channel: input.channel ?? 'pwa',
    subjectKind: 'workflow_run',
    subjectId: input.runId,
    status,
    title,
    body,
    link: `/dashboard/workflows/${encodeURIComponent(input.runId)}?workspaceId=${encodeURIComponent(input.workspaceId)}`,
    createdAt: input.now,
    metadata: { workspaceId: input.workspaceId },
  });
}

export function buildMetaWorkflowTerminalNotification(input: {
  metaRunId: string;
  title: string;
  parentWorkspaceId: string;
  status: string;
  blockedReason?: { message?: string | null } | null;
  now: number;
  channel?: WorkflowNotificationChannel;
}): WorkflowNotificationPayload | null {
  const status = normalizeNotificationStatus(input.status);
  if (!status) return null;
  const runTitle = scrubProductText(input.title || 'Meta-workflow');
  const title = status === 'completed' ? `${runTitle} completed` : `${runTitle} needs attention`;
  const reason = input.blockedReason?.message ? ` ${scrubProductText(input.blockedReason.message, 180)}` : '';
  const body = status === 'completed'
    ? `Meta-workflow completed in ${scrubProductText(input.parentWorkspaceId, 80)}.`
    : `Meta-workflow ${status} in ${scrubProductText(input.parentWorkspaceId, 80)}.${reason}`;
  return sanitizeWorkflowNotificationPayload({
    notificationId: `meta-workflow-run:${input.metaRunId}:${status}`,
    channel: input.channel ?? 'pwa',
    subjectKind: 'meta_workflow_run',
    subjectId: input.metaRunId,
    status,
    title,
    body,
    link: `/dashboard/workflows/meta-runs?workspaceId=${encodeURIComponent(input.parentWorkspaceId)}&metaRunId=${encodeURIComponent(input.metaRunId)}`,
    createdAt: input.now,
    metadata: { workspaceId: input.parentWorkspaceId },
  });
}

export function shouldNotifyWorkflowRun(input: { previousStatus: string; nextStatus: string; runInputs?: Record<string, unknown> }): boolean {
  if (input.previousStatus === input.nextStatus) return false;
  if (!normalizeNotificationStatus(input.nextStatus)) return false;
  if (typeof input.runInputs?.metaRunId === 'string' && typeof input.runInputs?.itemId === 'string') return false;
  return true;
}

export function sanitizeWorkflowNotificationPayload(payload: WorkflowNotificationPayload): WorkflowNotificationPayload {
  return {
    ...payload,
    notificationId: scrubIdentifier(payload.notificationId, 180),
    subjectId: scrubIdentifier(payload.subjectId, 180),
    title: scrubProductText(payload.title, 120),
    body: scrubProductText(payload.body, 240),
    link: sanitizeWorkflowNotificationLink(payload.link),
    metadata: payload.metadata ? sanitizeMetadata(payload.metadata) : undefined,
  };
}

export function normalizeNotificationStatus(status: string): WorkflowNotificationStatus | null {
  if (status === 'completed' || status === 'failed' || status === 'blocked') return status;
  return null;
}

export function scrubProductText(value: string, maxChars = 240): string {
  let text = value.replace(/\s+/g, ' ').trim();
  const replacements: Array<[RegExp, string]> = [
    [/\/Users\/[^\s)]+/g, 'a local path'],
    [/\bbd\s+(show|update|close|note|create|ready|open)\b/gi, 'a task action'],
    [/\b(shell|bash|zsh|git)\b/gi, 'automation'],
    [/\bwebhook\b/gi, 'automation update'],
    [/\bqueue item\b/gi, 'queued work'],
    [/\bHMAC\b/g, 'signature'],
    [/\brunReady\b/g, 'workflow wakeup'],
    [/\bWorkflowStepState\b/g, 'workflow step'],
    [/\braw XML\b/gi, 'workflow response'],
    [/\braw JSON\b/gi, 'workflow data'],
  ];
  for (const [pattern, replacement] of replacements) text = text.replace(pattern, replacement);
  if (text.length > maxChars) return `${text.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
  return text;
}

function scrubIdentifier(value: string, maxChars: number): string {
  const cleaned = value.replace(/[^A-Za-z0-9:._-]/g, '-').slice(0, maxChars);
  return cleaned || 'workflow-notification';
}

function sanitizeWorkflowNotificationLink(link: string | null): string | null {
  if (!link) return null;
  if (!link.startsWith('/dashboard/workflows')) return null;
  if (link.includes('/Users/') || /\b(webhook|queue item|raw JSON|raw XML)\b/i.test(link)) return null;
  return link.slice(0, 400);
}

function sanitizeMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (typeof value === 'string') safe[key] = scrubProductText(value, 120);
    else if (typeof value === 'number' || typeof value === 'boolean' || value == null) safe[key] = value;
  }
  return safe;
}

export type BrowserNotificationPermissionState = 'unsupported' | 'default' | 'granted' | 'denied';

export interface BrowserWorkflowNotificationState {
  supported: boolean;
  permission: BrowserNotificationPermissionState;
  enabled: boolean;
  message: string;
}

const BROWSER_WORKFLOW_NOTIFICATION_ENABLED_KEY = 'vd.workflow.notifications.enabled';
const BROWSER_WORKFLOW_NOTIFICATION_SEEN_KEY = 'vd.workflow.notifications.seen';

export function getBrowserWorkflowNotificationState(): BrowserWorkflowNotificationState {
  if (typeof window === 'undefined' || typeof Notification === 'undefined') {
    return { supported: false, permission: 'unsupported', enabled: false, message: 'Browser notifications are unavailable in this environment.' };
  }
  const enabled = window.localStorage.getItem(BROWSER_WORKFLOW_NOTIFICATION_ENABLED_KEY) === 'true';
  const permission = Notification.permission as BrowserNotificationPermissionState;
  return {
    supported: true,
    permission,
    enabled: enabled && permission === 'granted',
    message: permission === 'granted'
      ? enabled ? 'Workflow completion notifications are enabled for this browser.' : 'Enable browser notifications for workflow completion and failure.'
      : permission === 'denied'
        ? 'Browser notification permission is blocked. Enable it in your browser settings to receive workflow updates.'
        : 'Enable browser notifications when you want workflow completion and failure alerts.',
  };
}

export async function requestBrowserWorkflowNotifications(options: { suppressExisting?: WorkflowNotificationPayload[] } = {}): Promise<BrowserWorkflowNotificationState> {
  if (typeof window === 'undefined' || typeof Notification === 'undefined') return getBrowserWorkflowNotificationState();
  const permission = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission;
  window.localStorage.setItem(BROWSER_WORKFLOW_NOTIFICATION_ENABLED_KEY, permission === 'granted' ? 'true' : 'false');
  if (permission === 'granted' && options.suppressExisting?.length) {
    markBrowserWorkflowNotificationsSeen(options.suppressExisting);
  }
  return getBrowserWorkflowNotificationState();
}

export function markBrowserWorkflowNotificationsSeen(payloads: WorkflowNotificationPayload[]): void {
  if (typeof window === 'undefined') return;
  const seenRaw = window.localStorage.getItem(BROWSER_WORKFLOW_NOTIFICATION_SEEN_KEY) || '{}';
  const seen = safeParseRecord(seenRaw);
  for (const payload of payloads) {
    seen[`${payload.notificationId}:${payload.status}`] = Date.now();
  }
  window.localStorage.setItem(BROWSER_WORKFLOW_NOTIFICATION_SEEN_KEY, JSON.stringify(seen));
}

export function disableBrowserWorkflowNotifications(): BrowserWorkflowNotificationState {
  if (typeof window !== 'undefined') window.localStorage.setItem(BROWSER_WORKFLOW_NOTIFICATION_ENABLED_KEY, 'false');
  return getBrowserWorkflowNotificationState();
}

export function maybeNotifyBrowserWorkflowTerminal(payload: WorkflowNotificationPayload): boolean {
  const state = getBrowserWorkflowNotificationState();
  if (!state.supported || !state.enabled || state.permission !== 'granted') return false;
  const seenKey = `${payload.notificationId}:${payload.status}`;
  const seenRaw = window.localStorage.getItem(BROWSER_WORKFLOW_NOTIFICATION_SEEN_KEY) || '{}';
  const seen = safeParseRecord(seenRaw);
  if (seen[seenKey]) return false;
  const safePayload = sanitizeWorkflowNotificationPayload(payload);
  const notification = new Notification(safePayload.title, { body: safePayload.body, tag: safePayload.notificationId });
  if (safePayload.link) {
    notification.onclick = () => {
      window.focus();
      window.location.assign(safePayload.link!);
    };
  }
  seen[seenKey] = Date.now();
  window.localStorage.setItem(BROWSER_WORKFLOW_NOTIFICATION_SEEN_KEY, JSON.stringify(seen));
  return true;
}

function safeParseRecord(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}
