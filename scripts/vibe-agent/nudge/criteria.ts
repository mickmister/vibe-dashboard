import type { ConversationEntry, ExecutionProcess } from '../types.js';

const TERMINAL_PROCESS_STATUSES = new Set(['completed', 'failed', 'killed']);

export interface NudgeCriteriaOptions {
  now?: Date;
  activeStaleAfterMs?: number;
  enableActiveStaleNudge?: boolean;
}

export interface NudgeDecision {
  shouldNudge: boolean;
  reason: string;
  evidence: {
    processStatus: ExecutionProcess['status'];
    runReason: string;
    isActive: boolean;
    isTerminal: boolean;
    promptIsNudge: boolean;
    hasToolUse: boolean;
    hasThinking: boolean;
    hasFinalAssistantMessage: boolean;
    lastSubstantiveEntryType: string | null;
    activeAgeMs: number | null;
  };
}

export interface SessionNudgeCandidate {
  process: ExecutionProcess;
  decision: NudgeDecision;
}

export function conversationEntryType(entry: ConversationEntry | undefined): string | null {
  return entry?.content?.entry_type?.type ?? null;
}

export function conversationEntryText(entry: ConversationEntry | undefined): string {
  const content = entry?.content?.content;
  if (typeof content === 'string') return content;
  if (content == null) return '';
  return JSON.stringify(content);
}

export function isNudgePrompt(prompt: string | null | undefined): boolean {
  return /^please\s+continue\.?$|^continue\.?$/i.test((prompt ?? '').trim());
}

export function isTerminalProcess(process: Pick<ExecutionProcess, 'status' | 'completed_at'>): boolean {
  return TERMINAL_PROCESS_STATUSES.has(process.status) || process.completed_at != null;
}

export function isActiveProcess(process: Pick<ExecutionProcess, 'status' | 'completed_at' | 'dropped'>): boolean {
  return !process.dropped && !TERMINAL_PROCESS_STATUSES.has(process.status) && process.completed_at == null;
}

export function getLastSubstantiveEntryType(entries: ConversationEntry[]): string | null {
  for (let i = entries.length - 1; i >= 0; i--) {
    const type = conversationEntryType(entries[i]);
    if (!type || type === 'token_usage_info' || type === 'system_message') continue;
    return type;
  }
  return null;
}

export function hasAssistantMessageAfterLastToolUse(entries: ConversationEntry[]): boolean {
  const lastToolIndex = (() => {
    for (let i = entries.length - 1; i >= 0; i--) {
      if (conversationEntryType(entries[i]) === 'tool_use') return i;
    }
    return -1;
  })();

  const start = lastToolIndex === -1 ? 0 : lastToolIndex + 1;
  for (let i = start; i < entries.length; i++) {
    if (conversationEntryType(entries[i]) !== 'assistant_message') continue;
    if (conversationEntryText(entries[i]).trim()) return true;
  }
  return false;
}

function processPrompt(process: ExecutionProcess): string | null {
  const action = process.executor_action as any;
  const prompt = action?.typ?.prompt ?? action?.prompt;
  return typeof prompt === 'string' ? prompt : null;
}

function latestProcessTimestamp(process: ExecutionProcess): string | null {
  return process.updated_at ?? process.started_at ?? process.created_at ?? null;
}

export function decideNudgeForProcess(
  process: ExecutionProcess,
  entries: ConversationEntry[],
  options: NudgeCriteriaOptions = {},
): NudgeDecision {
  const now = options.now ?? new Date();
  const activeStaleAfterMs = options.activeStaleAfterMs ?? 10 * 60 * 1000;
  const active = isActiveProcess(process);
  const terminal = isTerminalProcess(process);
  const prompt = processPrompt(process);
  const promptIsNudge = isNudgePrompt(prompt);
  const hasToolUse = entries.some(entry => conversationEntryType(entry) === 'tool_use');
  const hasThinking = entries.some(entry => conversationEntryType(entry) === 'thinking');
  const lastSubstantiveEntryType = getLastSubstantiveEntryType(entries);
  const hasFinalAssistantMessage = hasAssistantMessageAfterLastToolUse(entries);
  const timestamp = latestProcessTimestamp(process);
  const activeAgeMs = active && timestamp ? now.getTime() - new Date(timestamp).getTime() : null;

  const evidence = {
    processStatus: process.status,
    runReason: process.run_reason,
    isActive: active,
    isTerminal: terminal,
    promptIsNudge,
    hasToolUse,
    hasThinking,
    hasFinalAssistantMessage,
    lastSubstantiveEntryType,
    activeAgeMs,
  };

  if (process.run_reason !== 'codingagent') {
    return { shouldNudge: false, reason: 'not-codingagent-process', evidence };
  }

  if (active) {
    if (!options.enableActiveStaleNudge) {
      return { shouldNudge: false, reason: 'active-stale-nudges-disabled', evidence };
    }
    if (activeAgeMs != null && activeAgeMs >= activeStaleAfterMs) {
      return { shouldNudge: true, reason: 'active-process-stale', evidence };
    }
    return { shouldNudge: false, reason: 'active-process-not-stale', evidence };
  }

  if (!terminal) {
    return { shouldNudge: false, reason: 'nonterminal-nonactive-process', evidence };
  }

  if (process.status === 'completed') {
    return { shouldNudge: false, reason: 'completed-process', evidence };
  }

  if (hasFinalAssistantMessage) {
    return { shouldNudge: false, reason: 'terminal-process-has-final-assistant-response', evidence };
  }

  if (hasToolUse || hasThinking || promptIsNudge) {
    return { shouldNudge: true, reason: 'terminal-process-stopped-before-final-response', evidence };
  }

  return { shouldNudge: false, reason: 'no-progress-evidence', evidence };
}

export function selectNudgeCandidateForSession(
  processes: ExecutionProcess[],
  entriesByProcessId: ReadonlyMap<string, ConversationEntry[]>,
  options: NudgeCriteriaOptions = {},
): SessionNudgeCandidate | null {
  const codingAgentProcesses = processes
    .filter(process => process.run_reason === 'codingagent' && !process.dropped)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  const activeProcess = codingAgentProcesses.find(isActiveProcess);
  if (activeProcess) {
    const decision = decideNudgeForProcess(activeProcess, entriesByProcessId.get(activeProcess.id) ?? [], options);
    return decision.shouldNudge ? { process: activeProcess, decision } : null;
  }

  const latestTerminalProcess = codingAgentProcesses.find(isTerminalProcess);
  if (!latestTerminalProcess) return null;

  const decision = decideNudgeForProcess(
    latestTerminalProcess,
    entriesByProcessId.get(latestTerminalProcess.id) ?? [],
    options,
  );
  return decision.shouldNudge ? { process: latestTerminalProcess, decision } : null;
}
