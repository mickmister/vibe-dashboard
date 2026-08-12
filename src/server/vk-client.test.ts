import { describe, expect, it, vi } from "vitest";
import {
  VibeKanbanServerClient,
  VkApiError,
  resolveVibeApiBaseUrl,
  selectLatestSession,
  type Session,
} from "./vk-client";

describe("resolveVibeApiBaseUrl", () => {
  it("prefers VIBE_API_URL, falls back to VK_API_URL, then localhost API", () => {
    expect(
      resolveVibeApiBaseUrl({ VIBE_API_URL: "https://vk.example.com" }),
    ).toBe("https://vk.example.com/api");
    expect(
      resolveVibeApiBaseUrl({ VK_API_URL: "https://legacy.example.com/" }),
    ).toBe("https://legacy.example.com/api");
    expect(resolveVibeApiBaseUrl({})).toBe("http://localhost:3007/api");
  });

  it("does not append /api twice", () => {
    expect(
      resolveVibeApiBaseUrl({ VIBE_API_URL: "https://vk.example.com/api/" }),
    ).toBe("https://vk.example.com/api");
  });
});

describe("VibeKanbanServerClient", () => {
  it("fetches workspaces and workspace repos from VK API envelope", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === "http://vk.local/api/workspaces") {
        return jsonResponse({
          success: true,
          data: [{ id: "ws1", branch: "feature/x" }],
        });
      }
      if (url === "http://vk.local/api/workspaces/ws1/repos") {
        return jsonResponse({
          success: true,
          data: [
            {
              id: "repo1",
              name: "owner/repo",
              display_name: "owner/repo",
              target_branch: "feature/x",
            },
          ],
        });
      }
      throw new Error(`unexpected URL ${url}`);
    });
    const client = new VibeKanbanServerClient({
      baseUrl: "http://vk.local/api",
      fetch: fetchImpl,
    });

    await expect(client.getWorkspaces()).resolves.toEqual([
      { id: "ws1", branch: "feature/x" },
    ]);
    await expect(client.getWorkspaceRepos("ws1")).resolves.toEqual([
      {
        id: "repo1",
        name: "owner/repo",
        display_name: "owner/repo",
        target_branch: "feature/x",
      },
    ]);
  });

  it("fetches sessions and creates sessions", async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "http://vk.local/api/sessions?workspace_id=ws1") {
        return jsonResponse({
          success: true,
          data: [{ id: "s1", workspace_id: "ws1", executor: "CODEX" }],
        });
      }
      if (url === "http://vk.local/api/sessions" && init?.method === "POST") {
        expect(JSON.parse(String(init.body))).toEqual({
          workspace_id: "ws1",
          executor: "CODEX",
        });
        return jsonResponse({
          success: true,
          data: { id: "s2", workspace_id: "ws1", executor: "CODEX" },
        });
      }
      throw new Error(`unexpected request ${url}`);
    });
    const client = new VibeKanbanServerClient({
      baseUrl: "http://vk.local/api",
      fetch: fetchImpl,
    });

    await expect(client.getSessions("ws1")).resolves.toEqual([
      { id: "s1", workspace_id: "ws1", executor: "CODEX" },
    ]);
    await expect(
      client.createSession({ workspace_id: "ws1", executor: "CODEX" }),
    ).resolves.toEqual({
      id: "s2",
      workspace_id: "ws1",
      executor: "CODEX",
    });
  });

  it("sends follow-up messages using the live executor_config shape", async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "http://vk.local/api/sessions/session-1") {
        return jsonResponse({
          success: true,
          data: { id: "session-1", workspace_id: "ws1", executor: "CODEX" },
        });
      }
      if (
        url === "http://vk.local/api/sessions/session-1/follow-up" &&
        init?.method === "POST"
      ) {
        expect(JSON.parse(String(init.body))).toEqual({
          prompt: "CI failed. Please inspect it.",
          executor_config: { executor: "CODEX" },
          retry_process_id: null,
          force_when_dirty: null,
          perform_git_reset: null,
        });
        return jsonResponse({
          success: true,
          data: { id: "process-1", session_id: "session-1", status: "running" },
        });
      }
      throw new Error(`unexpected request ${url}`);
    });
    const client = new VibeKanbanServerClient({
      baseUrl: "http://vk.local/api",
      fetch: fetchImpl,
    });

    await expect(
      client.sendFollowUp("session-1", "CI failed. Please inspect it."),
    ).resolves.toEqual({
      id: "process-1",
      session_id: "session-1",
      status: "running",
    });
  });

  it("fetches, stops, and checks readiness endpoints used by hotswap seams", async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "http://vk.local/api/execution-processes/process-1") {
        return jsonResponse({
          success: true,
          data: { id: "process-1", session_id: "session-1", status: "killed" },
        });
      }
      if (
        url === "http://vk.local/api/execution-processes/process-1/stop" &&
        init?.method === "POST"
      ) {
        expect(JSON.parse(String(init.body))).toEqual({});
        return jsonResponse({ success: true, data: null });
      }
      if (url === "http://vk.local/api/health") {
        return jsonResponse({ success: true, data: "ok" });
      }
      if (url === "http://vk.local/api/info") {
        return jsonResponse({ success: true, data: { version: "test" } });
      }
      throw new Error(`unexpected request ${url}`);
    });
    const client = new VibeKanbanServerClient({
      baseUrl: "http://vk.local/api",
      fetch: fetchImpl,
    });

    await expect(
      client.getExecutionProcess("process-1"),
    ).resolves.toMatchObject({
      id: "process-1",
      status: "killed",
    });
    await expect(
      client.stopExecutionProcess("process-1"),
    ).resolves.toBeUndefined();
    await expect(client.checkHealth()).resolves.toBeUndefined();
    await expect(client.getInfo()).resolves.toEqual({ version: "test" });
  });

  it("queues workflow follow-up messages using the guarded VK queue path", async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (
        url === "http://vk.local/api/sessions/session-1/queue" &&
        init?.method === "POST"
      ) {
        expect(JSON.parse(String(init.body))).toEqual({
          message: "CI failed. Please inspect it.",
          source: "workflow",
        });
        return jsonResponse({
          success: true,
          data: {
            queued_item: {
              id: "queue-new",
              session_id: "session-1",
              workspace_id: "ws1",
              status: "queued",
              source: "workflow",
              priority: 60,
              data: {
                message: "CI failed. Please inspect it.",
                session_command: null,
              },
            },
            status: {
              status: "queued",
              count: 2,
              message: {
                id: "queue-existing",
                session_id: "session-1",
                workspace_id: "ws1",
                status: "queued",
                source: "from_user",
                priority: 100,
                data: { message: "already queued", session_command: null },
              },
              messages: [],
            },
          },
        });
      }
      throw new Error(`unexpected request ${url}`);
    });
    const client = new VibeKanbanServerClient({
      baseUrl: "http://vk.local/api",
      fetch: fetchImpl,
    });

    await expect(
      client.queueFollowUp("session-1", "CI failed. Please inspect it."),
    ).resolves.toMatchObject({
      queued_item: { id: "queue-new", source: "workflow" },
      status: {
        count: 2,
        message: { id: "queue-existing", source: "from_user" },
      },
    });
  });

  it("fetches activity and response-read endpoints used by scanner primitives", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === "http://vk.local/api/activity") {
        return jsonResponse({
          success: true,
          data: {
            generated_at: "2026-08-04T00:00:00.000Z",
            callback_state_available: false,
            workspaces: [],
          },
        });
      }
      if (
        url ===
        "http://vk.local/api/sessions/session-1/latest-response?afterExecutionProcessId=exec-before&afterCompletedAt=2026-08-04T00%3A00%3A00.000Z"
      ) {
        return jsonResponse({
          success: true,
          data: {
            execution_process_id: "exec-after",
            session_id: "session-1",
            workspace_id: "ws1",
            status: "completed",
            completed_at: "2026-08-04T00:01:00.000Z",
            coding_agent_turn_id: "turn-1",
            agent_session_id: "agent-session-1",
            agent_message_id: "agent-message-1",
            content: "done",
            truncated: false,
            max_chars: 4096,
            source_kind: "coding_agent_turn_summary",
            prompt_preview: "bounded prompt",
            prompt_truncated: false,
            prompt_max_chars: 4096,
            prompt_source_kind: "coding_agent_turn_prompt",
          },
        });
      }
      if (
        url === "http://vk.local/api/execution-processes/exec-after/repo-states"
      ) {
        return jsonResponse({
          success: true,
          data: [
            {
              id: "repo-state-1",
              execution_process_id: "exec-after",
              repo_id: "repo-1",
              before_head_commit: "before",
              after_head_commit: "after",
              merge_commit: null,
              created_at: "2026-08-04T00:00:00.000Z",
              updated_at: "2026-08-04T00:01:00.000Z",
            },
          ],
        });
      }
      if (
        url ===
        "http://vk.local/api/execution-processes/exec-after/final-message"
      ) {
        return jsonResponse({
          success: true,
          data: {
            execution_process_id: "exec-after",
            session_id: "session-1",
            workspace_id: "ws1",
            status: "completed",
            completed_at: "2026-08-04T00:01:00.000Z",
            coding_agent_turn_id: "turn-1",
            agent_session_id: "agent-session-1",
            agent_message_id: "agent-message-1",
            content: "done",
            truncated: false,
            max_chars: 4096,
            source_kind: "coding_agent_turn_summary",
            prompt_preview: "bounded prompt",
            prompt_truncated: false,
            prompt_max_chars: 4096,
            prompt_source_kind: "coding_agent_turn_prompt",
          },
        });
      }
      throw new Error(`unexpected request ${url}`);
    });
    const client = new VibeKanbanServerClient({
      baseUrl: "http://vk.local/api",
      fetch: fetchImpl,
    });

    await expect(client.getActivitySnapshot()).resolves.toMatchObject({
      generated_at: "2026-08-04T00:00:00.000Z",
      workspaces: [],
    });
    await expect(
      client.getSessionLatestResponse("session-1", {
        afterExecutionProcessId: "exec-before",
        afterCompletedAt: "2026-08-04T00:00:00.000Z",
      }),
    ).resolves.toMatchObject({
      execution_process_id: "exec-after",
      content: "done",
      prompt_preview: "bounded prompt",
      prompt_truncated: false,
      prompt_source_kind: "coding_agent_turn_prompt",
    });
    await expect(
      client.getExecutionProcessFinalMessage("exec-after"),
    ).resolves.toMatchObject({
      execution_process_id: "exec-after",
      content: "done",
      prompt_preview: "bounded prompt",
    });
    await expect(
      client.getExecutionProcessRepoStates("exec-after"),
    ).resolves.toEqual([
      expect.objectContaining({
        execution_process_id: "exec-after",
        repo_id: "repo-1",
        before_head_commit: "before",
        after_head_commit: "after",
      }),
    ]);
  });

  it("sends workflow provenance metadata with queued follow-ups", async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe("http://vk.local/api/sessions/session-1/queue");
      expect(JSON.parse(String(init?.body))).toMatchObject({
        message: "Review this",
        source: "workflow",
        provenance: {
          kind: "workflow",
          label: "Workflow automation",
          workflow_run_id: "run-1",
          workflow_name: "Dev Review Tester",
          workflow_design_id: "design-drt",
          workflow_version: 2,
        },
      });
      return jsonResponse({
        success: true,
        data: {
          queued_item: {
            id: "queue-workflow",
            session_id: "session-1",
            workspace_id: "ws1",
            status: "queued",
            source: "workflow",
            priority: 60,
            data: { message: "Review this", session_command: null },
          },
          status: { count: 1, message: null, messages: [], status: "queued" },
        },
      });
    });
    const client = new VibeKanbanServerClient({
      baseUrl: "http://vk.local/api",
      fetch: fetchImpl,
    });

    await client.queueFollowUp("session-1", "Review this", {
      source: "workflow",
      provenance: {
        kind: "workflow",
        label: "Workflow automation",
        workflow_run_id: "run-1",
        workflow_name: "Dev Review Tester",
        workflow_design_id: "design-drt",
        workflow_version: 2,
      },
    });
  });

  it("can queue system follow-up messages for guardrail traffic", async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe("http://vk.local/api/sessions/session-1/queue");
      expect(init?.method).toBe("POST");
      expect(JSON.parse(String(init?.body))).toEqual({
        message: "Status?",
        source: "system",
      });
      return jsonResponse({
        success: true,
        data: {
          queued_item: {
            id: "queue-system",
            session_id: "session-1",
            workspace_id: "ws1",
            status: "queued",
            source: "system",
            priority: 25,
            data: { message: "Status?", session_command: null },
          },
          status: { status: "queued", count: 1, message: null, messages: [] },
        },
      });
    });
    const client = new VibeKanbanServerClient({
      baseUrl: "http://vk.local/api",
      fetch: fetchImpl,
    });

    await expect(
      client.queueFollowUp("session-1", "Status?", { source: "system" }),
    ).resolves.toMatchObject({
      queued_item: { id: "queue-system", source: "system" },
    });
  });

  it("upserts generic VK webhook subscriptions without leaking response secrets", async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe("http://vk.local/api/webhook-subscriptions");
      expect(init?.method).toBe("POST");
      expect(JSON.parse(String(init?.body))).toEqual({
        id: null,
        name: "VD workflow wakeups",
        upsert_key: "vd.workflow_wakeups.v1",
        url: "http://127.0.0.1:3109/dashboard/api/workflow-webhooks/vk",
        enabled: true,
        event_filters: [
          "execution.completed",
          "execution.failed",
          "execution.killed",
        ],
        signing_secret: "secret",
        allow_external_url: false,
      });
      return jsonResponse({
        success: true,
        data: {
          created: true,
          subscription: {
            id: "sub-1",
            name: "VD workflow wakeups",
            upsert_key: "vd.workflow_wakeups.v1",
            url: "http://127.0.0.1:3109/dashboard/api/workflow-webhooks/vk",
            enabled: true,
            event_filters: [
              "execution.completed",
              "execution.failed",
              "execution.killed",
            ],
            signing_secret_set: true,
            created_at: "2026-08-08T00:00:00Z",
            updated_at: "2026-08-08T00:00:00Z",
          },
        },
      });
    });
    const client = new VibeKanbanServerClient({
      baseUrl: "http://vk.local/api",
      fetch: fetchImpl,
    });

    await expect(
      client.createOrUpsertWebhookSubscription({
        id: null,
        name: "VD workflow wakeups",
        upsert_key: "vd.workflow_wakeups.v1",
        url: "http://127.0.0.1:3109/dashboard/api/workflow-webhooks/vk",
        enabled: true,
        event_filters: [
          "execution.completed",
          "execution.failed",
          "execution.killed",
        ],
        signing_secret: "secret",
        allow_external_url: false,
      }),
    ).resolves.toMatchObject({
      created: true,
      subscription: { id: "sub-1", signing_secret_set: true },
    });
  });

  it("throws VkApiError with status and body for failed HTTP responses", async () => {
    const client = new VibeKanbanServerClient({
      baseUrl: "http://vk.local/api",
      fetch: async () =>
        new Response("nope", {
          status: 500,
          statusText: "Internal Server Error",
        }),
    });

    await expect(client.getWorkspaces()).rejects.toMatchObject({
      name: "VkApiError",
      status: 500,
      bodyText: "nope",
    });
  });

  it("throws VkApiError for unsuccessful VK envelopes", async () => {
    const client = new VibeKanbanServerClient({
      baseUrl: "http://vk.local/api",
      fetch: async () =>
        jsonResponse({
          success: false,
          data: null,
          message: "bad request",
          error_data: { code: "BAD" },
        }),
    });

    await expect(client.getWorkspaces()).rejects.toBeInstanceOf(VkApiError);
    await expect(client.getWorkspaces()).rejects.toMatchObject({
      message: "bad request",
      errorData: { code: "BAD" },
    });
  });
});

describe("selectLatestSession", () => {
  it("returns null for empty lists and otherwise chooses newest created_at timestamp", () => {
    expect(selectLatestSession([])).toBeNull();

    const sessions: Session[] = [
      {
        id: "old",
        workspace_id: "ws1",
        executor: "CODEX",
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-03T00:00:00Z",
      },
      {
        id: "new",
        workspace_id: "ws1",
        executor: "CODEX",
        created_at: "2026-01-02T00:00:00Z",
        updated_at: "2026-01-02T00:00:00Z",
      },
    ];

    expect(selectLatestSession(sessions)?.id).toBe("new");
  });
});

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}
