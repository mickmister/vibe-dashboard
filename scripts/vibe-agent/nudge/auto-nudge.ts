#!/usr/bin/env node
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { client as defaultClient } from '../core/client.js';
import type { ConversationEntry, ExecutionProcess, SendMessageBody, Session } from '../types.js';
import { conversationEntryText, conversationEntryType, decideNudgeForProcess, isActiveProcess } from './criteria.js';
import { callbacksForSession, DEFAULT_CALLBACK_REGISTRY_PATH } from './callback-registry.js';

const DEFAULT_STATE_PATH = '/var/lib/vd/auto-nudge/state.json';
const DEFAULT_LOCK_PATH = '/var/lib/vd/auto-nudge/owner.lock';
const DEFAULT_POLL_MS = 5 * 60_000;
const OVERSEER_PROMPT = `- If all milestones are complete, stop and say "DONE" as your full response
- If you have just completed a milestone, make sure it gets reviewed by the appropriate agents.
- If you approve the review, continue to the next milestone.

Make sure to use vibe-agent send --respond ... to communicate with teammates`;

export interface AutoNudgeConfig {
  version: 1;
  discord?: { enabled: boolean };
  workspaces: Array<{ workspaceId: string; overseerSessionId: string }>;
}
export type TriggerStatus = 'observed' | 'checkpoint-sent' | 'done' | 'delegated' | 'waiting-callback' | 'rate-limited' | 'retryable-failure';
export interface TriggerState { processId: string; workspaceId: string; sessionId: string; observedAt: string; status: TriggerStatus; checkpointProcessId: string | null; updatedAt: string; error: string | null }
export interface OutboxItem { id: string; workspaceId: string; content: string; createdAt: string; deliveredAt: string | null; attempts: number }
export interface AutoNudgeState { version: 1; nudgedProcessIds: string[]; triggers: Record<string, TriggerState>; outbox: Record<string, OutboxItem> }
export interface AutoNudgeClient {
  getSessions(workspaceId: string): Promise<Session[]>;
  getSessionProcesses(sessionId: string): Promise<ExecutionProcess[]>;
  fetchConversation(processId: string, timeoutMs?: number): Promise<ConversationEntry[]>;
  sendMessage(sessionId: string, body: SendMessageBody): Promise<ExecutionProcess>;
  sendAndWaitForFinalResponse(sessionId: string, body: SendMessageBody, timeoutMs: number): Promise<{ process: ExecutionProcess; response: string | null }>;
}
export interface AutoNudgeOptions {
  config: AutoNudgeConfig; statePath: string; callbackRegistryPath: string;
  now: () => Date; unacknowledgedAfterMs: number; operationTimeoutMs: number; responseTimeoutMs: number;
  concurrency: number; dryRun: boolean; discordWebhookUrl?: string;
  deliverDiscord?: (url: string, content: string) => Promise<void>;
}
export interface AutoNudgeCycleResult { workspaces: number; teammateNudges: number; checkpoints: number; discordDeliveries: number; errors: string[] }

function requiredString(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} must be a non-empty string`);
  return value;
}
export function loadAutoNudgeConfig(filePath: string): AutoNudgeConfig {
  const value = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Partial<AutoNudgeConfig>;
  if (value.version !== 1) throw new Error('config.version must be 1');
  if (!Array.isArray(value.workspaces) || value.workspaces.length === 0) throw new Error('config.workspaces must be a non-empty array');
  const seen = new Set<string>();
  const workspaces = value.workspaces.map((item, index) => {
    const workspaceId = requiredString(item?.workspaceId, `workspaces[${index}].workspaceId`);
    const overseerSessionId = requiredString(item?.overseerSessionId, `workspaces[${index}].overseerSessionId`);
    if (seen.has(workspaceId)) throw new Error(`duplicate workspaceId: ${workspaceId}`);
    seen.add(workspaceId); return { workspaceId, overseerSessionId };
  });
  return { version: 1, discord: { enabled: value.discord?.enabled === true }, workspaces };
}
export function readAutoNudgeState(filePath: string): AutoNudgeState {
  try {
    const value = JSON.parse(fs.readFileSync(filePath, 'utf8')) as AutoNudgeState;
    if (value.version === 1 && Array.isArray(value.nudgedProcessIds) && value.triggers && value.outbox) return value;
  } catch { /* Fresh state. */ }
  return { version: 1, nudgedProcessIds: [], triggers: {}, outbox: {} };
}
export function writeAutoNudgeState(filePath: string, state: AutoNudgeState): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp.${process.pid}.${Date.now()}`;
  fs.writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, filePath);
}
function body(prompt: string, session: Session): SendMessageBody { return { prompt, executor_config: { executor: session.executor }, retry_process_id: null, force_when_dirty: null, perform_git_reset: null }; }
function finalMessage(entries: ConversationEntry[]): string | null {
  const messages = entries.filter(entry => conversationEntryType(entry) === 'assistant_message').map(conversationEntryText).map(text => text.trim()).filter(Boolean);
  return messages.length ? messages[messages.length - 1] : null;
}
function terminalTime(process: ExecutionProcess): number { return new Date(process.completed_at ?? process.updated_at ?? process.created_at).getTime(); }
async function deadline<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try { return await Promise.race([promise, new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms); })]); }
  finally { if (timer) clearTimeout(timer); }
}
async function defaultDiscordDelivery(url: string, content: string): Promise<void> {
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content }) });
  if (!response.ok) throw new Error(`Discord webhook returned HTTP ${response.status}`);
}
async function processOutbox(options: AutoNudgeOptions, state: AutoNudgeState, result: AutoNudgeCycleResult): Promise<void> {
  if (!options.config.discord?.enabled) return;
  if (!options.discordWebhookUrl) throw new Error('DISCORD_WEBHOOK_URL is required when Discord is enabled');
  for (const item of Object.values(state.outbox).filter(item => !item.deliveredAt)) {
    item.attempts += 1; writeAutoNudgeState(options.statePath, state);
    try {
      await deadline((options.deliverDiscord ?? defaultDiscordDelivery)(options.discordWebhookUrl, item.content), options.operationTimeoutMs, 'Discord delivery');
      item.deliveredAt = options.now().toISOString(); writeAutoNudgeState(options.statePath, state); result.discordDeliveries++;
    } catch (error) { result.errors.push(`Discord event ${item.id}: ${(error as Error).message}`); writeAutoNudgeState(options.statePath, state); }
  }
}
async function mapLimit<T>(values: T[], limit: number, task: (value: T) => Promise<void>): Promise<void> {
  let index = 0;
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, async () => { while (index < values.length) { const value = values[index++]; await task(value); } }));
}

export async function runAutoNudgeCycle(client: AutoNudgeClient, options: AutoNudgeOptions): Promise<AutoNudgeCycleResult> {
  const state = readAutoNudgeState(options.statePath);
  const result: AutoNudgeCycleResult = { workspaces: 0, teammateNudges: 0, checkpoints: 0, discordDeliveries: 0, errors: [] };
  await mapLimit(options.config.workspaces, options.concurrency, async configured => {
    result.workspaces++;
    try {
      const sessions = await deadline(client.getSessions(configured.workspaceId), options.operationTimeoutMs, 'get sessions');
      const overseer = sessions.find(item => item.id === configured.overseerSessionId);
      if (!overseer) throw new Error(`configured overseer session ${configured.overseerSessionId} was not found`);
      const processMap = new Map<string, ExecutionProcess[]>();
      await mapLimit(sessions, options.concurrency, async session => {
        processMap.set(session.id, await deadline(client.getSessionProcesses(session.id), options.operationTimeoutMs, 'get processes'));
      });
      const overseerActive = (processMap.get(overseer.id) ?? []).some(isActiveProcess);
      for (const teammate of sessions.filter(item => item.id !== overseer.id)) {
        const processes = (processMap.get(teammate.id) ?? []).filter(item => item.run_reason === 'codingagent' && !item.dropped).sort((a, b) => terminalTime(b) - terminalTime(a));
        if (processes.some(isActiveProcess)) continue;
        const latest = processes[0]; if (!latest) continue;
        const entries = await deadline(client.fetchConversation(latest.id, options.operationTimeoutMs), options.operationTimeoutMs, 'fetch conversation');
        const decision = decideNudgeForProcess(latest, entries, { enableActiveStaleNudge: false, now: options.now() });
        if (decision.shouldNudge && !state.nudgedProcessIds.includes(latest.id)) {
          if (!options.dryRun) await deadline(client.sendMessage(teammate.id, body('Please continue', teammate)), options.operationTimeoutMs, 'send teammate nudge');
          state.nudgedProcessIds.push(latest.id); writeAutoNudgeState(options.statePath, state); result.teammateNudges++; continue;
        }
        if (latest.status !== 'completed' || !finalMessage(entries)) continue;
        const age = options.now().getTime() - terminalTime(latest); if (age < options.unacknowledgedAfterMs) continue;
        const now = options.now().toISOString();
        const trigger = state.triggers[latest.id] ?? { processId: latest.id, workspaceId: configured.workspaceId, sessionId: teammate.id, observedAt: now, status: 'observed' as const, checkpointProcessId: null, updatedAt: now, error: null };
        state.triggers[latest.id] = trigger;
        if (['done', 'delegated', 'rate-limited'].includes(trigger.status)) continue;
        const callbacks = callbacksForSession(options.callbackRegistryPath, teammate.id, options.now());
        if (callbacks.some(item => item.status === 'running')) {
          trigger.status = 'waiting-callback'; trigger.updatedAt = now; writeAutoNudgeState(options.statePath, state); continue;
        }
        if (overseerActive || options.dryRun) { writeAutoNudgeState(options.statePath, state); continue; }
        trigger.status = 'checkpoint-sent'; trigger.updatedAt = now; writeAutoNudgeState(options.statePath, state);
        try {
          const response = await client.sendAndWaitForFinalResponse(overseer.id, body(OVERSEER_PROMPT, overseer), options.responseTimeoutMs);
          trigger.checkpointProcessId = response.process.id;
          if (response.response?.trim() === 'DONE') {
            trigger.status = 'done';
          } else {
            const refreshed = await deadline(
              Promise.all(sessions.filter(item => item.id !== overseer.id).map(item => client.getSessionProcesses(item.id))),
              options.operationTimeoutMs,
              'verify checkpoint delegation',
            );
            const delegated = refreshed.flat().some(item => new Date(item.created_at).getTime() >= new Date(response.process.created_at).getTime());
            const callbackRegistered = callbacksForSession(options.callbackRegistryPath, overseer.id, options.now())
              .some(item => new Date(item.startedAt).getTime() >= new Date(response.process.created_at).getTime());
            trigger.status = delegated || callbackRegistered ? 'delegated' : 'observed';
          }
          trigger.updatedAt = options.now().toISOString(); trigger.error = null; result.checkpoints++;
        } catch (error) { trigger.status = 'retryable-failure'; trigger.error = (error as Error).message; trigger.updatedAt = options.now().toISOString(); }
        writeAutoNudgeState(options.statePath, state);
      }
    } catch (error) { result.errors.push(`workspace ${configured.workspaceId}: ${(error as Error).message}`); }
  });
  await processOutbox(options, state, result);
  return result;
}

function parseArgs(args: string[]): { configPath: string; statePath: string; once: boolean; dryRun: boolean } {
  let configPath = '', statePath = DEFAULT_STATE_PATH, once = false, dryRun = false;
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--config') configPath = args[++index] ?? '';
    else if (args[index] === '--state') statePath = args[++index] ?? '';
    else if (args[index] === '--once') once = true;
    else if (args[index] === '--dry-run') dryRun = true;
    else throw new Error(`Unknown argument: ${args[index]}`);
  }
  if (!configPath) throw new Error('--config <path> is required');
  return { configPath, statePath, once, dryRun };
}
function acquireLock(lockPath = DEFAULT_LOCK_PATH): () => void {
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  try { fs.mkdirSync(lockPath); } catch {
    const owner = Number.parseInt(fs.readFileSync(path.join(lockPath, 'pid'), 'utf8'), 10);
    try { process.kill(owner, 0); throw new Error(`another auto-nudge owner (${owner}) holds ${lockPath}`); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
      fs.rmSync(lockPath, { recursive: true, force: true });
      fs.mkdirSync(lockPath);
    }
  }
  fs.writeFileSync(path.join(lockPath, 'pid'), String(process.pid));
  return () => fs.rmSync(lockPath, { recursive: true, force: true });
}
function makeClient(): AutoNudgeClient {
  return {
    getSessions: id => defaultClient.getSessions(id), getSessionProcesses: id => defaultClient.getSessionProcesses(id),
    fetchConversation: (id, timeout) => defaultClient.fetchConversation(id, timeout), sendMessage: (id, request) => defaultClient.sendMessage(id, request),
    async sendAndWaitForFinalResponse(id, request, timeout) {
      const process = await defaultClient.sendMessage(id, request);
      const entries = await defaultClient.fetchConversation(process.id, timeout);
      return { process, response: finalMessage(entries) };
    },
  };
}
async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2)); const config = loadAutoNudgeConfig(args.configPath);
  const origin = requiredString(process.env.VK_ORIGIN, 'VK_ORIGIN');
  if (config.discord?.enabled) requiredString(process.env.DISCORD_WEBHOOK_URL, 'DISCORD_WEBHOOK_URL');
  const release = acquireLock(); let stopping = false;
  const stop = () => { stopping = true; }; process.once('SIGINT', stop); process.once('SIGTERM', stop);
  const options: AutoNudgeOptions = { config, statePath: args.statePath, callbackRegistryPath: process.env.VD_CALLBACK_REGISTRY_PATH ?? DEFAULT_CALLBACK_REGISTRY_PATH, now: () => new Date(), unacknowledgedAfterMs: 60_000, operationTimeoutMs: 15_000, responseTimeoutMs: 30 * 60_000, concurrency: 4, dryRun: args.dryRun, discordWebhookUrl: process.env.DISCORD_WEBHOOK_URL };
  void origin; // Validated for durable alert links; exhaustion alerts remain feature-gated pending a real Codex fixture.
  try { do { const result = await runAutoNudgeCycle(makeClient(), options); console.log(JSON.stringify({ type: 'auto-nudge-cycle', at: new Date().toISOString(), ...result })); if (!args.once && !stopping) await new Promise(resolve => setTimeout(resolve, DEFAULT_POLL_MS)); } while (!args.once && !stopping); }
  finally { release(); }
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) void main().catch(error => { console.error(`auto-nudge failed: ${(error as Error).message}`); process.exitCode = 1; });
