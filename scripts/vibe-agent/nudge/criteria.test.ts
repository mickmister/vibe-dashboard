import { describe, expect, it } from 'vitest';
import type { ConversationEntry, ExecutionProcess } from '../types.js';
import { decideNudgeForProcess, hasAssistantMessageAfterLastToolUse, isNudgePrompt, selectNudgeCandidateForSession } from './criteria.js';

function entry(type: string, content = ''): ConversationEntry {
  return { content: { entry_type: { type }, content } };
}

function process(overrides: Partial<ExecutionProcess>): ExecutionProcess {
  return {
    id: 'process-1',
    session_id: 'session-1',
    status: 'failed',
    created_at: '2026-06-25T15:28:28.000Z',
    started_at: '2026-06-25T15:28:28.000Z',
    updated_at: '2026-06-25T15:28:28.000Z',
    completed_at: '2026-06-25T15:29:19.000Z',
    exit_code: 1,
    dropped: false,
    run_reason: 'codingagent',
    executor_action: { typ: { prompt: 'Please continue' } },
    ...overrides,
  };
}

describe('nudge criteria from real VK turn shapes', () => {
  it('recognizes simple continue prompts', () => {
    expect(isNudgePrompt('Please continue')).toBe(true);
    expect(isNudgePrompt('continue.')).toBe(true);
    expect(isNudgePrompt('Please continue with tests')).toBe(false);
  });

  it('does not nudge an on-purpose completed response ending', () => {
    const decision = decideNudgeForProcess(
      process({ status: 'completed', completed_at: '2026-06-25T15:17:50.000Z', exit_code: 0 }),
      [
        entry('thinking', 'Reviewing'),
        entry('tool_use', 'git status'),
        entry('assistant_message', 'Conclusion: fix the retry scoping bug before merge.'),
      ]
    );
    expect(decision.shouldNudge).toBe(false);
    expect(decision.reason).toBe('completed-process');
  });

  it('does not nudge commit follow-up turns with final assistant confirmation', () => {
    const entries = [
      entry('tool_use', 'git add src/file.ts && git commit -m "Fix"'),
      entry('assistant_message', 'Committed the changes. Working tree is clean.'),
    ];
    expect(hasAssistantMessageAfterLastToolUse(entries)).toBe(true);
    const decision = decideNudgeForProcess(
      process({ status: 'completed', completed_at: '2026-06-17T19:33:50.000Z', exit_code: 0 }),
      entries
    );
    expect(decision.shouldNudge).toBe(false);
  });

  it('nudges failed mid-task turns that ended after tool use without final assistant response', () => {
    const decision = decideNudgeForProcess(
      process({ executor_action: { typ: { prompt: 'Review current code thoroughly' } } }),
      [
        entry('thinking', 'Inspecting code and tools availability'),
        entry('tool_use', 'pwd && git status --short'),
        entry('thinking', 'Inspecting code and tools availability'),
      ]
    );
    expect(decision.shouldNudge).toBe(true);
    expect(decision.reason).toBe('terminal-process-stopped-before-final-response');
    expect(decision.evidence.hasFinalAssistantMessage).toBe(false);
  });

  it('nudges failed continue turns that made progress but never produced a final response', () => {
    const decision = decideNudgeForProcess(
      process({ executor_action: { typ: { prompt: 'Please continue' } } }),
      [
        entry('assistant_message', 'I’ll continue and do targeted code reads.'),
        entry('tool_use', 'rg "stop" crates -n'),
        entry('tool_use', 'sed -n "1,120p" src/file.ts'),
        entry('thinking', 'Reviewing status and next steps'),
      ]
    );
    expect(decision.shouldNudge).toBe(true);
    expect(decision.evidence.promptIsNudge).toBe(true);
  });

  it('does not nudge failed turns that already gave a final answer after the last tool', () => {
    const decision = decideNudgeForProcess(
      process({ status: 'failed' }),
      [
        entry('tool_use', 'rg something'),
        entry('assistant_message', 'I could not finish because cargo is unavailable. Next steps: run cargo test locally.'),
      ]
    );
    expect(decision.shouldNudge).toBe(false);
    expect(decision.reason).toBe('terminal-process-has-final-assistant-response');
  });

  it('does not nudge devserver/setup processes', () => {
    const decision = decideNudgeForProcess(
      process({ run_reason: 'devserver', executor_action: {}, status: 'failed' }),
      []
    );
    expect(decision.shouldNudge).toBe(false);
    expect(decision.reason).toBe('not-codingagent-process');
  });

  it('keeps active stale nudges opt-in for storm prevention', () => {
    const active = process({
      status: 'running',
      completed_at: null,
      updated_at: '2026-06-25T15:00:00.000Z',
    });
    const entries = [entry('tool_use', 'pnpm test')];
    expect(decideNudgeForProcess(active, entries, { now: new Date('2026-06-25T15:20:00.000Z') }).shouldNudge).toBe(false);
    expect(decideNudgeForProcess(active, entries, {
      now: new Date('2026-06-25T15:20:00.000Z'),
      enableActiveStaleNudge: true,
      activeStaleAfterMs: 10 * 60 * 1000,
    }).reason).toBe('active-process-stale');
  });

  it('selects only the latest codingagent turn so old stopped turns do not create a storm', () => {
    const oldFailed = process({
      id: 'old-failed',
      status: 'failed',
      created_at: '2026-06-25T15:00:00.000Z',
      completed_at: '2026-06-25T15:05:00.000Z',
    });
    const latestCompleted = process({
      id: 'latest-completed',
      status: 'completed',
      exit_code: 0,
      created_at: '2026-06-25T15:10:00.000Z',
      completed_at: '2026-06-25T15:12:00.000Z',
    });
    const candidate = selectNudgeCandidateForSession(
      [oldFailed, latestCompleted],
      new Map([
        [oldFailed.id, [entry('tool_use', 'rg stop'), entry('thinking', 'still working')]],
        [latestCompleted.id, [entry('tool_use', 'git status'), entry('assistant_message', 'Done.')]],
      ])
    );
    expect(candidate).toBeNull();
  });

  it('selects a latest failed terminal turn that stopped before a final response', () => {
    const failed = process({
      id: 'latest-failed',
      status: 'failed',
      created_at: '2026-06-25T15:10:00.000Z',
      completed_at: '2026-06-25T15:12:00.000Z',
    });
    const candidate = selectNudgeCandidateForSession(
      [failed],
      new Map([[failed.id, [entry('tool_use', 'pwd && git status'), entry('thinking', 'checking')]]])
    );
    expect(candidate?.process.id).toBe('latest-failed');
    expect(candidate?.decision.reason).toBe('terminal-process-stopped-before-final-response');
  });
});
