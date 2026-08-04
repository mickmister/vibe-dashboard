import React, { useEffect, useMemo, useState } from 'react';
import { useModule } from '../hooks/useModule';
import type { AgentTeam, TeamAgent, UpdateAgentTeamInput } from '../teams/agentTeams';
import {
  fetchWorkflowRunEvents,
  fetchWorkflowRuns,
  runManualAgentTeamWorkflow,
  type WorkflowRunEventReadModel,
  type WorkflowRunReadModel,
} from '../lib/workflowRunsApi';
import {
  fetchWorkflowActivity,
  selectAttentionSessions,
  summarizeActivity,
  type WorkflowActivityScanResponse,
} from '../lib/workflowActivityApi';
import { buildVkSessionUrl } from '../utils/origin';

const inputClass = 'w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100';
const buttonClass = 'rounded-md border border-zinc-700 px-3 py-2 text-sm hover:bg-zinc-900 disabled:opacity-50';
const primaryButtonClass = 'rounded-md bg-cyan-600 px-3 py-2 text-sm font-medium text-white hover:bg-cyan-500 disabled:opacity-50';

export function AgentTeamsDashboard(): React.ReactElement {
  const agentTeamsModule = useModule('agentTeams');
  const teamState = agentTeamsModule.states.teams.useState();
  const selectedTeam = teamState.teams.find((team) => team.id === teamState.selectedTeamId) ?? teamState.teams[0] ?? null;
  const [taskPrompt, setTaskPrompt] = useState('');
  const [context, setContext] = useState('');
  const [targetAgentIds, setTargetAgentIds] = useState<string[]>([]);
  const [runError, setRunError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [runs, setRuns] = useState<WorkflowRunReadModel[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [events, setEvents] = useState<WorkflowRunEventReadModel[]>([]);
  const [runsError, setRunsError] = useState<string | null>(null);
  const [loadingRuns, setLoadingRuns] = useState(false);
  const [activity, setActivity] = useState<WorkflowActivityScanResponse | null>(null);
  const [activityError, setActivityError] = useState<string | null>(null);
  const [loadingActivity, setLoadingActivity] = useState(false);

  const selectedRun = useMemo(
    () => runs.find((run) => run.runId === selectedRunId) ?? runs[0] ?? null,
    [runs, selectedRunId],
  );



  const loadActivity = async () => {
    setLoadingActivity(true);
    setActivityError(null);
    try {
      setActivity(await fetchWorkflowActivity({ maxActiveExecutions: selectedTeam?.policies.maxConcurrentAgents ?? 8 }));
    } catch (caught) {
      setActivityError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setLoadingActivity(false);
    }
  };

  const loadRuns = async () => {
    setLoadingRuns(true);
    setRunsError(null);
    try {
      const response = await fetchWorkflowRuns({ limit: 25 });
      setRuns(response.runs);
      setSelectedRunId((current) => current && response.runs.some((run) => run.runId === current) ? current : response.runs[0]?.runId ?? null);
    } catch (caught) {
      setRunsError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setLoadingRuns(false);
    }
  };

  useEffect(() => {
    void loadRuns();
    void loadActivity();
  }, []);

  useEffect(() => {
    const interval = window.setInterval(() => {
      void loadActivity();
    }, 5000);
    return () => window.clearInterval(interval);
  }, [selectedTeam?.policies.maxConcurrentAgents]);

  useEffect(() => {
    if (!selectedRun?.runId) {
      setEvents([]);
      return;
    }
    void fetchWorkflowRunEvents(selectedRun.runId, { limit: 100 })
      .then((response) => setEvents(response.events))
      .catch((caught) => setRunsError(caught instanceof Error ? caught.message : String(caught)));
  }, [selectedRun?.runId]);

  useEffect(() => {
    setTargetAgentIds(selectedTeam?.agents.filter((agent) => agent.enabled).map((agent) => agent.id) ?? []);
  }, [selectedTeam?.id]);

  const createTeam = async () => {
    await agentTeamsModule.actions.createTeam({
      name: `Agent Team ${teamState.teams.length + 1}`,
      agents: [{ role: 'orchestrator', displayName: 'Orchestrator' }],
      workflowBindings: [{ workflowId: 'manual-agent-team-runner' }],
    });
  };

  const updateTeam = async (patch: UpdateAgentTeamInput) => {
    if (!selectedTeam) return;
    await agentTeamsModule.actions.updateTeam({ teamId: selectedTeam.id, patch });
  };

  const updateAgent = async (agentId: string, patch: Partial<TeamAgent>) => {
    if (!selectedTeam) return;
    await updateTeam({
      agents: selectedTeam.agents.map((agent) => agent.id === agentId ? { ...agent, ...patch } : agent),
    });
  };

  const launchRun = async () => {
    if (!selectedTeam) return;
    setRunning(true);
    setRunError(null);
    try {
      const response = await runManualAgentTeamWorkflow({
        team: selectedTeam,
        taskPrompt,
        context: context.trim() ? context : null,
        targetAgentIds,
      });
      setTaskPrompt('');
      setSelectedRunId(response.run.runId);
      await loadRuns();
    } catch (caught) {
      setRunError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setRunning(false);
    }
  };

  return (
    <main className="dark min-h-screen overflow-auto bg-zinc-950 p-6 text-zinc-100">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">Agent Teams</h1>
            <p className="mt-1 text-sm text-zinc-400">Configure manual teams, queue guarded VK prompts, and inspect workflow runs.</p>
          </div>
          <div className="flex gap-2">
            <button className={buttonClass} onClick={() => { void loadActivity(); void loadRuns(); }} disabled={loadingRuns || loadingActivity}>Refresh status</button>
            <button className={primaryButtonClass} onClick={() => void createTeam()}>New team</button>
          </div>
        </header>

        <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
          <section className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
            <h2 className="font-medium">Teams</h2>
            <div className="mt-3 space-y-2">
              {teamState.teams.length === 0 ? <p className="text-sm text-zinc-400">No teams yet.</p> : teamState.teams.map((team) => (
                <button key={team.id} className={`w-full rounded-md border px-3 py-2 text-left text-sm ${selectedTeam?.id === team.id ? 'border-cyan-600 bg-cyan-950/40' : 'border-zinc-800 hover:bg-zinc-900'}`} onClick={() => void agentTeamsModule.actions.selectTeam({ teamId: team.id })}>
                  <div className="font-medium">{team.name}</div>
                  <div className="text-xs text-zinc-500">{team.agents.length} agents · {team.workflowBindings.length} bindings</div>
                </button>
              ))}
            </div>
          </section>

          <section className="space-y-6">
            {selectedTeam ? (
              <TeamEditor team={selectedTeam} onUpdate={updateTeam} onUpdateAgent={updateAgent} onDelete={() => void agentTeamsModule.actions.deleteTeam({ teamId: selectedTeam.id })} />
            ) : null}

            {selectedTeam ? (
              <section className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
                <h2 className="font-medium">Launch manual team run</h2>
                {runError ? <div role="alert" className="mt-3 rounded border border-red-800 bg-red-950/40 p-3 text-sm text-red-200">{runError}</div> : null}
                <div className="mt-3 grid gap-3">
                  <textarea className={inputClass} rows={4} placeholder="Task/backlog prompt" value={taskPrompt} onChange={(event) => setTaskPrompt(event.target.value)} />
                  <textarea className={inputClass} rows={3} placeholder="Optional context" value={context} onChange={(event) => setContext(event.target.value)} />
                  <div className="grid gap-2 sm:grid-cols-2">
                    {selectedTeam.agents.map((agent) => (
                      <label key={agent.id} className="flex items-center gap-2 text-sm text-zinc-300">
                        <input type="checkbox" checked={targetAgentIds.includes(agent.id)} disabled={!agent.enabled} onChange={(event) => setTargetAgentIds((current) => event.target.checked ? [...new Set([...current, agent.id])] : current.filter((id) => id !== agent.id))} />
                        {agent.displayName} <span className="text-xs text-zinc-500">{agent.vkSessionId || 'missing session'}</span>
                      </label>
                    ))}
                  </div>
                  <button className={primaryButtonClass} disabled={running || !taskPrompt.trim()} onClick={() => void launchRun()}>{running ? 'Queueing…' : 'Run team workflow'}</button>
                </div>
              </section>
            ) : null}
          </section>
        </div>

        <ActivityAttentionPanel activity={activity} error={activityError} loading={loadingActivity} onRefresh={() => void loadActivity()} />

        <WorkflowRunsPanel runs={runs} selectedRun={selectedRun} events={events} error={runsError} loading={loadingRuns} onSelectRun={setSelectedRunId} />
      </div>
    </main>
  );
}

function TeamEditor(props: { team: AgentTeam; onUpdate: (patch: UpdateAgentTeamInput) => Promise<void>; onUpdateAgent: (agentId: string, patch: Partial<TeamAgent>) => Promise<void>; onDelete: () => void }) {
  const { team } = props;
  return (
    <section className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-medium">Team editor</h2>
        <button className={buttonClass} onClick={props.onDelete}>Delete</button>
      </div>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <label className="text-sm">Name<input className={`${inputClass} mt-1`} value={team.name} onChange={(event) => void props.onUpdate({ name: event.target.value })} /></label>
        <label className="text-sm">Description<input className={`${inputClass} mt-1`} value={team.description ?? ''} onChange={(event) => void props.onUpdate({ description: event.target.value || null })} /></label>
        <label className="text-sm">Max concurrent agents<input className={`${inputClass} mt-1`} type="number" min={1} value={team.policies.maxConcurrentAgents} onChange={(event) => void props.onUpdate({ policies: { maxConcurrentAgents: Number(event.target.value) } })} /></label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={team.policies.allowWorkspaceParallelism} onChange={(event) => void props.onUpdate({ policies: { allowWorkspaceParallelism: event.target.checked } })} /> Allow workspace parallelism later</label>
      </div>
      <div className="mt-4 space-y-3">
        <div className="flex items-center justify-between"><h3 className="text-sm font-medium text-zinc-300">Agents</h3><button className={buttonClass} onClick={() => void props.onUpdate({ agents: [...team.agents, createBlankAgent()] })}>Add agent</button></div>
        <label className="text-sm">Orchestrator<select className={`${inputClass} mt-1`} value={team.orchestratorAgentId} onChange={(event) => void props.onUpdate({ orchestratorAgentId: event.target.value })}>{team.agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.displayName} ({agent.role})</option>)}</select></label>
        {team.agents.map((agent) => (
          <div key={agent.id} className="grid gap-2 rounded-md border border-zinc-800 p-3 md:grid-cols-5">
            <input className={inputClass} value={agent.displayName} onChange={(event) => void props.onUpdateAgent(agent.id, { displayName: event.target.value })} />
            <input className={inputClass} value={agent.role} onChange={(event) => void props.onUpdateAgent(agent.id, { role: event.target.value })} />
            <div className="md:col-span-2"><input className={inputClass} placeholder="VK session id" value={agent.vkSessionId ?? ''} onChange={(event) => void props.onUpdateAgent(agent.id, { vkSessionId: event.target.value || null })} /><VkSessionLink className="mt-1" workspaceId={agent.vkWorkspaceId} sessionId={agent.vkSessionId} /></div>
            <div className="flex items-center justify-between gap-2"><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={agent.enabled} onChange={(event) => void props.onUpdateAgent(agent.id, { enabled: event.target.checked })} /> Enabled</label><button className="text-xs text-red-300 disabled:opacity-40" disabled={agent.id === team.orchestratorAgentId || team.agents.length <= 1} onClick={() => void props.onUpdate({ agents: team.agents.filter((entry) => entry.id !== agent.id) })}>Remove</button></div>
          </div>
        ))}
      </div>
    </section>
  );
}

function createBlankAgent(): TeamAgent {
  const suffix = Date.now().toString(36);
  return {
    id: `agent_${suffix}`,
    role: 'implementer',
    displayName: 'New Agent',
    enabled: true,
    vkWorkspaceId: null,
    vkSessionId: null,
    executor: null,
    instructions: null,
  };
}


function ActivityAttentionPanel(props: { activity: WorkflowActivityScanResponse | null; error: string | null; loading: boolean; onRefresh: () => void }) {
  const items = selectAttentionSessions(props.activity);
  const summary = summarizeActivity(props.activity);
  return (
    <section className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-medium">Live activity & attention</h2>
          <p className="mt-1 text-xs text-zinc-500">Recently updated sessions that are active, queued/reserved, waiting, or need attention.</p>
        </div>
        <button className={buttonClass} onClick={props.onRefresh} disabled={props.loading}>{props.loading ? 'Refreshing…' : 'Refresh activity'}</button>
      </div>
      {props.error ? <div role="alert" className="mt-3 rounded border border-red-800 bg-red-950/40 p-3 text-sm text-red-200">{props.error}</div> : null}
      <div className="mt-3 grid gap-2 sm:grid-cols-4">
        <Metric label="Active" value={summary.active} className="border-emerald-900 bg-emerald-950/20 text-emerald-200" />
        <Metric label="Queued/reserved" value={summary.queued} className="border-cyan-900 bg-cyan-950/20 text-cyan-200" />
        <Metric label="Waiting" value={summary.waiting} className="border-amber-900 bg-amber-950/20 text-amber-200" />
        <Metric label="Attention" value={summary.attention} className="border-red-900 bg-red-950/20 text-red-200" />
      </div>
      {props.activity && !props.activity.callbackStateAvailable ? <p className="mt-3 text-xs text-zinc-500">VK callback live state is not available in this snapshot. VD workflow callback/CI waits are shown when recorded; this does not imply hidden active agent turns.</p> : null}
      {props.activity?.warnings.length ? <div className="mt-3 rounded border border-amber-900 bg-amber-950/30 p-2 text-xs text-amber-200">{props.activity.warnings.join(' · ')}</div> : null}
      <div className="mt-4 space-y-2">
        {items.length === 0 ? <p className="text-sm text-zinc-400">No active or attention sessions right now.</p> : items.slice(0, 20).map((item) => (
          <div key={`${item.workspaceId}-${item.sessionId}-${item.triggerId ?? item.bindingId ?? ''}`} className={`rounded-md border p-3 ${activityCardClass(item.level, item.needsAttention)}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="flex items-center gap-2 text-sm font-medium"><ActivityDot level={item.level} />{item.roleName ?? item.roleId ?? 'Session'} <span className="text-xs font-normal text-zinc-500">{item.label}</span></div>
                <div className="mt-1 text-xs text-zinc-500">{item.reason} · updated {formatTimestamp(item.updatedAt)}</div>
              </div>
              <VkSessionLink workspaceId={item.workspaceId} sessionId={item.sessionId} />
            </div>
            <div className="mt-2 grid gap-2 text-xs text-zinc-400 sm:grid-cols-3">
              <span className="break-all">workspace {item.workspaceId}</span>
              <span className="break-all">session {item.sessionId}</span>
              <span>{item.runningExecutionProcessIds.length ? `executions ${item.runningExecutionProcessIds.join(', ')}` : item.queueCount ? `queue ${item.queueCount}` : item.externalWaitId ? `wait ${item.externalWaitId}` : 'no active refs'}</span>
            </div>
            {item.warnings.length ? <div className="mt-2 text-xs text-amber-200">{item.warnings.join(' · ')}</div> : null}
          </div>
        ))}
      </div>
    </section>
  );
}

function Metric({ label, value, className }: { label: string; value: number; className: string }) {
  return <div className={`rounded-md border px-3 py-2 ${className}`}><div className="text-xs uppercase opacity-80">{label}</div><div className="text-xl font-semibold">{value}</div></div>;
}

function ActivityDot({ level }: { level: 'active' | 'queued' | 'waiting' | 'attention' | 'idle' }) {
  const color = level === 'active' ? 'bg-emerald-400' : level === 'queued' ? 'bg-cyan-400' : level === 'waiting' ? 'bg-amber-400' : level === 'attention' ? 'bg-red-400' : 'bg-zinc-500';
  return <span className={`inline-block h-2.5 w-2.5 rounded-full ${color} ${level === 'active' ? 'animate-pulse' : ''}`} aria-hidden="true" />;
}

function activityCardClass(level: 'active' | 'queued' | 'waiting' | 'attention' | 'idle', needsAttention: boolean): string {
  if (level === 'attention' || needsAttention) return 'border-red-900 bg-red-950/20';
  if (level === 'active') return 'border-emerald-900 bg-emerald-950/20';
  if (level === 'waiting') return 'border-amber-900 bg-amber-950/20';
  if (level === 'queued') return 'border-cyan-900 bg-cyan-950/20';
  return 'border-zinc-800 bg-zinc-950';
}

function WorkflowRunsPanel(props: { runs: WorkflowRunReadModel[]; selectedRun: WorkflowRunReadModel | null; events: WorkflowRunEventReadModel[]; error: string | null; loading: boolean; onSelectRun: (runId: string) => void }) {
  const queuedAgents = getQueuedAgents(props.selectedRun?.output);
  return (
    <section className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
      <div className="flex items-center justify-between"><h2 className="font-medium">Workflow runs</h2>{props.loading ? <span className="text-xs text-zinc-500">Loading…</span> : null}</div>
      {props.error ? <div role="alert" className="mt-3 rounded border border-red-800 bg-red-950/40 p-3 text-sm text-red-200">{props.error}</div> : null}
      <div className="mt-3 grid gap-4 lg:grid-cols-[360px_1fr]">
        <div className="max-h-96 overflow-auto rounded border border-zinc-800">
          {props.runs.map((run) => <button key={run.runId} className={`block w-full border-b border-zinc-800 px-3 py-2 text-left text-sm ${props.selectedRun?.runId === run.runId ? 'bg-cyan-950/40' : 'hover:bg-zinc-900'}`} onClick={() => props.onSelectRun(run.runId)}><div className="font-medium">{run.workflowId}</div><div className="text-xs text-zinc-500">{run.status} · {run.runId}</div></button>)}
        </div>
        <div className="space-y-4 text-sm">
          {props.selectedRun ? <>
            <dl className="grid gap-2 md:grid-cols-2">
              <Ref label="Run" value={props.selectedRun.runId} /><Ref label="Workflow" value={props.selectedRun.workflowId} /><Ref label="Status" value={props.selectedRun.status} /><Ref label="Trigger" value={props.selectedRun.trigger} /><Ref label="Started" value={formatTimestamp(props.selectedRun.startedAt)} /><Ref label="Duration" value={props.selectedRun.durationMs == null ? '—' : `${props.selectedRun.durationMs}ms`} /><Ref label="VK workspace" value={props.selectedRun.vkWorkspaceId} /><Ref label="VK session" value={props.selectedRun.vkSessionId} href={buildVkSessionUrl({ workspaceId: props.selectedRun.vkWorkspaceId, sessionId: props.selectedRun.vkSessionId })} /><Ref label="VK queue item" value={props.selectedRun.vkQueueItemId} />
            </dl>
            {queuedAgents.length ? <div><h3 className="font-medium">Queued agents</h3><ul className="mt-2 space-y-1">{queuedAgents.map((agent) => <li key={`${agent.agentId}-${agent.queueItemId}`} className="rounded bg-zinc-950 p-2"><span className="font-medium">{agent.displayName}</span> · {agent.role} · {agent.queueItemId}<VkSessionLink workspaceId={agent.workspaceId ?? props.selectedRun?.vkWorkspaceId} sessionId={agent.sessionId} /></li>)}</ul></div> : null}
            <div><h3 className="font-medium">Events</h3><div className="mt-2 max-h-96 space-y-2 overflow-auto">{props.events.map((event) => <div key={event.id} className="rounded border border-zinc-800 p-2"><div className="text-xs text-zinc-500">#{event.eventIndex} {event.eventType} {event.stepId ? `· ${event.stepId}` : ''}</div><div>{event.message}</div>{event.data ? <pre className="mt-1 overflow-auto text-xs text-zinc-400">{JSON.stringify(event.data, null, 2)}</pre> : null}</div>)}</div></div>
          </> : <p className="text-zinc-400">No workflow runs yet.</p>}
        </div>
      </div>
    </section>
  );
}

function Ref({ label, value, href }: { label: string; value: unknown; href?: string | null }) {
  const content = value == null || value === '' ? '—' : String(value);
  return <div><dt className="text-xs uppercase text-zinc-500">{label}</dt><dd className="break-all text-zinc-200">{href && content !== '—' ? <a className="text-cyan-300 hover:text-cyan-200" href={href} target="_blank" rel="noreferrer">{content}</a> : content}</dd></div>;
}

function formatTimestamp(value: number): string {
  return Number.isFinite(value) ? new Date(value).toLocaleString() : '—';
}

function VkSessionLink({ workspaceId, sessionId, className = '' }: { workspaceId?: string | null; sessionId?: string | null; className?: string }) {
  const href = buildVkSessionUrl({ workspaceId, sessionId });
  if (!href) return null;
  return <div className={`text-xs ${className}`}><a className="text-cyan-300 hover:text-cyan-200" href={href} target="_blank" rel="noreferrer">Open VK session</a></div>;
}

function getQueuedAgents(output: unknown): Array<{ agentId: string; role: string; displayName: string; queueItemId: string; sessionId?: string; workspaceId?: string }> {
  if (!output || typeof output !== 'object') return [];
  const queuedAgents = (output as { queuedAgents?: unknown }).queuedAgents;
  if (!Array.isArray(queuedAgents)) return [];
  return queuedAgents.filter((entry): entry is { agentId: string; role: string; displayName: string; queueItemId: string; sessionId?: string; workspaceId?: string } => Boolean(entry && typeof entry === 'object' && typeof (entry as { queueItemId?: unknown }).queueItemId === 'string'));
}
