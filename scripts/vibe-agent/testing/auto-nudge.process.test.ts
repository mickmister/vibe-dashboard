import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { FakeVkServer, type FakeVkProcess, type FakeVkScenario } from './fake-vk-server.js';

const builtCli = resolve('dist/vibe-agent/nudge/auto-nudge.js');
const now = '2026-09-21T00:00:00.000Z';
const processValue = (id: string, sessionId: string, status: FakeVkProcess['status'], final?: string): FakeVkProcess => ({ id, session_id: sessionId, status, created_at: now, started_at: now, updated_at: now, completed_at: status === 'running' ? null : now, exit_code: status === 'completed' ? 0 : 1, run_reason: 'codingagent', dropped: false, executor_action: { typ: { prompt: 'work' } }, conversation: final == null ? [] : [{ content: { entry_type: { type: 'assistant_message' }, content: final } }] });
const children: ChildProcess[] = []; const servers: FakeVkServer[] = []; const dirs: string[] = [];
afterEach(async () => { for (const child of children.splice(0)) if (child.exitCode == null) child.kill('SIGKILL'); await Promise.all(servers.splice(0).map(server => server.stop())); dirs.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true })); });
function scenario(processes: FakeVkProcess[] = []): FakeVkScenario { return { workspaces: [{ id: 'workspace' }], sessions: [{ id: 'impl', workspace_id: 'workspace', name: 'impl', executor: 'CODEX', created_at: now, updated_at: now, processes }, { id: 'overseer', workspace_id: 'workspace', name: 'overseer', executor: 'CODEX', created_at: now, updated_at: now, processes: [] }], followUps: [] }; }
async function launch(value: FakeVkScenario, extraArgs: string[] = [], initialState?: unknown) {
  const server = await new FakeVkServer(value).start(); servers.push(server);
  const dir = mkdtempSync(join(tmpdir(), 'auto-nudge-process-')); dirs.push(dir);
  const config = join(dir, 'config.json'); const state = join(dir, 'state.json'); const lock = join(dir, 'owner.lock'); const responseRoutes = join(dir, 'response-routes.json');
  writeFileSync(config, JSON.stringify({ version: 1, workspaces: [{ workspaceId: 'workspace', overseerSessionId: 'overseer' }] }));
  if (initialState) writeFileSync(state, JSON.stringify(initialState));
  const child = spawn(process.execPath, [builtCli, '--config', config, '--state', state, ...extraArgs], { env: { ...process.env, VIBE_API_URL: server.baseUrl, VK_ORIGIN: 'http://vd.test', VD_AUTO_NUDGE_LOCK_PATH: lock, VD_CALLBACK_REGISTRY_PATH: join(dir, 'callbacks.json'), VD_RESPONSE_ROUTES_PATH: responseRoutes }, stdio: ['ignore', 'pipe', 'pipe'] }); children.push(child);
  let stdout = ''; let stderr = ''; child.stdout!.on('data', chunk => { stdout += chunk; }); child.stderr!.on('data', chunk => { stderr += chunk; });
  return { server, child, dir, state, lock, output: () => ({ stdout, stderr }) };
}
async function waitUntil(predicate: () => boolean, timeoutMs = 3_000): Promise<void> { const expires = Date.now() + timeoutMs; while (!predicate()) { if (Date.now() >= expires) throw new Error('condition timed out'); await new Promise(resolve => setTimeout(resolve, 10)); } }
async function exit(child: ChildProcess): Promise<number | null> { if (child.exitCode !== null || child.signalCode !== null) return child.exitCode; return new Promise(resolve => child.once('exit', code => resolve(code))); }

describe('built auto-nudge CLI lifecycle', () => {
  if (!existsSync(builtCli)) throw new Error(`Missing built auto-nudge CLI at ${builtCli}; run npm run build:vibe-agent-cli before process tests`);
  it('releases its owner lock promptly on SIGTERM during poll sleep', async () => {
    const running = await launch(scenario()); await waitUntil(() => running.output().stdout.includes('auto-nudge-cycle'));
    expect(existsSync(running.lock)).toBe(true); const started = Date.now(); running.child.kill('SIGTERM');
    expect([0, null]).toContain(await exit(running.child)); expect(Date.now() - started).toBeLessThan(1_000); expect(existsSync(running.lock)).toBe(false);
  });

  it('cancels an exact-process response wait and releases its lock', async () => {
    const complete = processValue('complete', 'impl', 'completed', 'Finished'); const value = scenario([complete]);
    value.followUps = [{ sessionId: 'overseer', process: processValue('checkpoint', 'overseer', 'running') }];
    const running = await launch(value); await waitUntil(() => running.server.journal.some(item => item.type === 'process-polled'));
    const started = Date.now(); running.child.kill('SIGTERM'); expect([0, null]).toContain(await exit(running.child));
    expect(Date.now() - started).toBeLessThan(1_500); expect(existsSync(running.lock)).toBe(false);
  });

  it('restarts from a durable indeterminate checkpoint without sending', async () => {
    const complete = processValue('complete', 'impl', 'completed', 'Finished');
    const initialState = { version: 1, nudgedProcessIds: [], outbox: {}, triggers: { complete: { processId: 'complete', workspaceId: 'workspace', sessionId: 'impl', observedAt: now, status: 'checkpoint-sent', checkpointProcessId: null, baselineProcessIds: ['complete'], updatedAt: now, error: null } } };
    const running = await launch(scenario([complete]), ['--once'], initialState);
    expect(await exit(running.child)).toBe(0);
    expect(running.server.journal.filter(item => item.type === 'follow-up-accepted')).toHaveLength(0);
    expect(running.output().stdout).toContain('indeterminate'); expect(existsSync(running.lock)).toBe(false);
  });
});
