// @platform "node"
import { createHmac, timingSafeEqual } from "node:crypto";

import type { VkWebhookEvent, VkWebhookEventType } from "./types";

const VALID_EVENT_TYPES = new Set<VkWebhookEventType>([
  "execution.started",
  "execution.completed",
  "execution.failed",
  "execution.cancelled",
  "execution.halted",
  "approval.requested",
  "question.requested",
]);

type RawVkWebhookEvent = {
  event_type?: unknown;
  delivery_id?: unknown;
  timestamp?: unknown;
  occurred_at?: unknown;
  title?: unknown;
  message?: unknown;
  task_id?: unknown;
  task_title?: unknown;
  project_id?: unknown;
  project_name?: unknown;
  workspace_id?: unknown;
  session_id?: unknown;
  execution_id?: unknown;
  exit_code?: unknown;
};

export interface VerifyVkWebhookSignatureInput {
  secret?: string | null;
  timestamp: string | null;
  signature: string | null;
  body: string;
  nowMs?: number;
  toleranceSeconds?: number;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value
    : null;
}

function requiredString(value: unknown, field: string): string {
  const normalized = optionalString(value);
  if (!normalized) {
    throw new Error(`VK webhook field ${field} is required`);
  }
  return normalized;
}

function optionalNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function parseVkWebhookEvent(body: string): VkWebhookEvent {
  const payload = JSON.parse(body) as RawVkWebhookEvent;
  const rawEventType = requiredString(payload.event_type, "event_type");
  if (!VALID_EVENT_TYPES.has(rawEventType as VkWebhookEventType)) {
    throw new Error(`Unsupported VK webhook event_type: ${rawEventType}`);
  }

  return {
    eventType: rawEventType as VkWebhookEventType,
    deliveryId: requiredString(payload.delivery_id, "delivery_id"),
    occurredAt:
      optionalString(payload.occurred_at) ??
      requiredString(payload.timestamp, "timestamp"),
    title: requiredString(payload.title, "title"),
    message: requiredString(payload.message, "message"),
    taskId: optionalString(payload.task_id),
    taskTitle: optionalString(payload.task_title),
    projectId: optionalString(payload.project_id),
    projectName: optionalString(payload.project_name),
    workspaceId: optionalString(payload.workspace_id),
    sessionId: optionalString(payload.session_id),
    executionId: optionalString(payload.execution_id),
    exitCode: optionalNumber(payload.exit_code),
  };
}

export function signVkWebhookPayload(
  secret: string,
  timestamp: string,
  body: string,
): string {
  return `sha256=${createHmac("sha256", secret)
    .update(`${timestamp}.${body}`)
    .digest("hex")}`;
}

export function verifyVkWebhookSignature({
  secret,
  timestamp,
  signature,
  body,
  nowMs = Date.now(),
  toleranceSeconds = 5 * 60,
}: VerifyVkWebhookSignatureInput): boolean {
  const normalizedSecret = secret?.trim();
  if (!normalizedSecret) {
    return true;
  }

  if (!timestamp || !signature) {
    return false;
  }

  const parsedTimestamp = Number.parseInt(timestamp, 10);
  if (!Number.isFinite(parsedTimestamp)) {
    return false;
  }

  const skewSeconds = Math.abs(Math.floor(nowMs / 1000) - parsedTimestamp);
  if (skewSeconds > toleranceSeconds) {
    return false;
  }

  const expected = signVkWebhookPayload(normalizedSecret, timestamp, body);
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  return (
    actualBuffer.length === expectedBuffer.length &&
    timingSafeEqual(actualBuffer, expectedBuffer)
  );
}

// @platform end
