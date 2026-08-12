import type { Kysely } from "kysely";
import type { DB } from "../../../../store/kysely_types";
import type { GitHubCiCompletionStatus, WorkflowRuntimeSnapshot } from "@vibe-dashboard/workflow-core";
import { PersistedWorkflowRuntimeService } from "./persistedWorkflowRuntime";

export type GitHubCiProviderStatus =
  | { state: "pending" | "running"; summary?: string; detailsUrl?: string }
  | { state: "completed"; conclusion: GitHubCiCompletionStatus; summary?: string; detailsUrl?: string };

export interface GitHubCiStatusClient {
  readStatus(input: {
    runId: string;
    workspaceId: string;
    turnId: string;
    ciRunId?: string;
    checkRunId?: string;
    repo?: string;
    sha?: string;
  }): Promise<GitHubCiProviderStatus>;
}

export class GitHubCiPollBackoffError extends Error {
  readonly retryAfterMs: number;

  constructor(message: string, retryAfterMs: number) {
    super(message);
    this.name = "GitHubCiPollBackoffError";
    this.retryAfterMs = retryAfterMs;
  }
}

export class GitHubCiWaitPoller {
  private readonly db: Kysely<DB>;
  private readonly runtime: PersistedWorkflowRuntimeService;
  private readonly client: GitHubCiStatusClient;
  private readonly now: () => number;
  private readonly minPollIntervalMs: number;
  private readonly backoffUntil = new Map<string, number>();

  constructor(options: {
    db: Kysely<DB>;
    runtime: PersistedWorkflowRuntimeService;
    client: GitHubCiStatusClient;
    now?: () => number;
    minPollIntervalMs?: number;
  }) {
    this.db = options.db;
    this.runtime = options.runtime;
    this.client = options.client;
    this.now = options.now ?? Date.now;
    this.minPollIntervalMs = options.minPollIntervalMs ?? 15_000;
  }

  async pollOnce(): Promise<{ checked: number; completed: number; backedOff: number }> {
    const rows = await this.db
      .selectFrom("WorkflowPersistedRun")
      .select(["runId", "workspaceId", "coreSnapshotJson"])
      .where("status", "=", "running")
      .execute();
    let checked = 0;
    let completed = 0;
    let backedOff = 0;
    for (const row of rows) {
      const snapshot = JSON.parse(row.coreSnapshotJson) as WorkflowRuntimeSnapshot;
      const waitingFor = snapshot.waitingFor;
      if (waitingFor?.kind !== "github_ci") continue;
      const key = `${row.runId}:${waitingFor.turnId}`;
      if ((this.backoffUntil.get(key) ?? 0) > this.now()) {
        backedOff += 1;
        continue;
      }
      checked += 1;
      try {
        const status = await this.client.readStatus({
          runId: row.runId,
          workspaceId: row.workspaceId,
          turnId: waitingFor.turnId,
          ciRunId: waitingFor.ciRunId,
          checkRunId: waitingFor.checkRunId,
          repo: waitingFor.repo,
          sha: waitingFor.sha,
        });
        if (status.state === "completed") {
          const result = await this.runtime.completeGithubCiWatch({
            runId: row.runId,
            turnId: waitingFor.turnId,
            responseRef: `github-ci:${waitingFor.turnId}`,
            status: status.conclusion,
            statusSummary: status.summary ?? status.conclusion,
            detailsUrl: status.detailsUrl,
          });
          if (result.applied) completed += 1;
          this.backoffUntil.delete(key);
        } else {
          this.backoffUntil.set(key, this.now() + this.minPollIntervalMs);
        }
      } catch (error) {
        const normalized = normalizePollError(error);
        this.backoffUntil.set(key, this.now() + normalized.retryAfterMs);
        backedOff += 1;
        await this.runtime.recordGithubCiWatchPollError({
          runId: row.runId,
          turnId: waitingFor.turnId,
          error: normalized,
        });
      }
    }
    return { checked, completed, backedOff };
  }
}

function normalizePollError(error: unknown): { name: string; message: string; retryAfterMs: number } {
  if (error instanceof GitHubCiPollBackoffError) {
    return { name: error.name, message: error.message, retryAfterMs: error.retryAfterMs };
  }
  if (error instanceof Error) {
    return { name: error.name, message: error.message, retryAfterMs: 60_000 };
  }
  return { name: "GitHubCiPollError", message: String(error), retryAfterMs: 60_000 };
}
