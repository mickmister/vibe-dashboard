import { describe, expect, it } from "vitest";

import {
  parseVkWebhookEvent,
  signVkWebhookPayload,
  verifyVkWebhookSignature,
} from "./vk-webhook";

describe("vk webhook helpers", () => {
  it("parses snake_case VK webhook payloads", () => {
    const body = JSON.stringify({
      event_type: "execution.completed",
      delivery_id: "delivery-1",
      timestamp: "2026-01-01T00:00:00.000Z",
      title: "Task Execution Completed",
      message: "Done",
      workspace_id: "workspace-1",
      session_id: "session-1",
      execution_id: "execution-1",
      exit_code: 0,
    });

    expect(parseVkWebhookEvent(body)).toMatchObject({
      eventType: "execution.completed",
      deliveryId: "delivery-1",
      sessionId: "session-1",
      exitCode: 0,
    });
  });

  it("verifies HMAC signatures and rejects stale timestamps", () => {
    const body = JSON.stringify({ event_type: "execution.started" });
    const timestamp = "1767225600";
    const signature = signVkWebhookPayload("secret", timestamp, body);

    expect(
      verifyVkWebhookSignature({
        secret: "secret",
        timestamp,
        signature,
        body,
        nowMs: 1767225600_000,
      }),
    ).toBe(true);

    expect(
      verifyVkWebhookSignature({
        secret: "secret",
        timestamp,
        signature: signVkWebhookPayload("other", timestamp, body),
        body,
        nowMs: 1767225600_000,
      }),
    ).toBe(false);

    expect(
      verifyVkWebhookSignature({
        secret: "secret",
        timestamp,
        signature,
        body,
        nowMs: 1767225600_000 + 10 * 60 * 1000,
      }),
    ).toBe(false);
  });
});
