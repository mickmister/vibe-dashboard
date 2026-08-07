import { describe, expect, it } from 'vitest';
import {
  formatFullSummaryText,
  mapWithConcurrency,
  parseFullSummaryArgs,
} from './vibe-agent.js';

describe('parseFullSummaryArgs', () => {
  it('uses bounded defaults for large workspaces', () => {
    expect(parseFullSummaryArgs([])).toMatchObject({
      limitTurns: 100,
      limitSessions: 25,
      conversationTimeoutMs: 30_000,
    });
  });

  it('parses conversation timeout duration flags', () => {
    expect(parseFullSummaryArgs(['--conversation-timeout', '45s']).conversationTimeoutMs).toBe(45_000);
    expect(parseFullSummaryArgs(['--conversation-timeout-ms=12000']).conversationTimeoutMs).toBe(12_000);
  });
});

describe('mapWithConcurrency', () => {
  it('preserves input order while limiting active work', async () => {
    let active = 0;
    let maxActive = 0;
    const results = await mapWithConcurrency([3, 2, 1, 0], 2, async (value) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise(resolve => setTimeout(resolve, value));
      active -= 1;
      return value * 2;
    });

    expect(results).toEqual([6, 4, 2, 0]);
    expect(maxActive).toBeLessThanOrEqual(2);
  });
});

describe('formatFullSummaryText', () => {
  it('includes recoverable conversation fetch errors in text output', () => {
    const output = formatFullSummaryText({
      workspace_id: 'workspace-1',
      workspace_name: null,
      reader_session_id: 'reader-1',
      excluded_current_session_id: null,
      excluded_session_ids: [],
      guardrails: {
        total_matching_sessions: 1,
        sessions_returned: 1,
        turns_returned: 1,
        limited: false,
        message: null,
      },
      turns: [{
        session: {
          id: 'session-1',
          executor: 'CODEX',
          role: 'impl',
          name: null,
          created_at: '2026-01-01T00:00:00.000Z',
        },
        process: {
          id: 'process-1',
          status: 'completed',
          created_at: '2026-01-01T00:00:01.000Z',
          completed_at: '2026-01-01T00:00:02.000Z',
          run_reason: 'manual',
        },
        initialUserPrompt: 'hello',
        agentPreResponse: null,
        toolCalls: { reads: 0, writes: 0, webSearches: 0, other: 0, total: 0 },
        agentResponse: null,
        conversationFetchError: 'Timed out waiting for process process-1 after 30000ms',
        gitCommits: [],
        gitCommitSummaryNote: 'Skipped',
        gitRepositoryPath: null,
      }],
    });

    expect(output).toContain('<conversation_fetch_error>Timed out waiting for process process-1 after 30000ms</conversation_fetch_error>');
  });
});
