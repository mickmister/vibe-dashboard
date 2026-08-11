import React, { useEffect, useMemo, useState } from 'react';
import { useModule } from '../hooks/useModule';
import type { AgentTeam, TeamAgent, UpdateAgentTeamInput } from '../teams/agentTeams';
import {
  fetchWorkflowRunEvents,
  fetchWorkflowRuns,
  WorkflowLaunchRequestError,
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
import { vkClient, type Session, type Workspace } from '../lib/vk-client';
import { applyResolvedSessionsToTeam, resolveTeamSessionMappings } from '../lib/teamSessionMappingApi';
import { buildTeamNudgePreview, runTeamGuardrailNudgeWorkflow, type TeamNudgePreview } from '../lib/teamGuardrailNudgeApi';
import type { TeamAgentActivitySnapshot, TeamGuardrailNudgeWorkflowOutput } from '../workflows/team-guardrail-nudge';
import type { UpdateWorkflowTemplateInput, WorkflowTemplate } from '../templates/workflowTemplates';
import { collectWorkflowQueueRefs, summarizeWorkflowError, workflowStatusLabel, type WorkflowQueueRef } from '../lib/workflowRunDetails';
import { fetchDeclarativeWorkflowDefinitions, fetchWorkflowInstanceStatus, fetchWorkflowWebhookInbox, fetchWorkflowWebhookProvisioningStatus, runDeclarativeWorkflow, type DeclarativeWorkflowDefinitionEntry, type WorkflowInstanceStatusResponse, type WorkflowWebhookInboxListResponse, type WorkflowWebhookProvisioningStatus } from '../lib/declarativeWorkflowsApi';
import { buildDeclarativeWorkflowInput, createDraftFromDefinition, createMinimalWorkflowTeam, describeDefinitionRoles, filterWorkflowSessionsForWorkspace, validateDeclarativeWorkflowLaunch, type DeclarativeWorkflowLaunchDraft } from '../lib/declarativeWorkflowLaunch';

const inputClass = 'w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100';
const buttonClass = 'rounded-md border border-zinc-700 px-3 py-2 text-sm hover:bg-zinc-900 disabled:opacity-50';
const primaryButtonClass = 'rounded-md bg-cyan-600 px-3 py-2 text-sm font-medium text-white hover:bg-cyan-500 disabled:opacity-50';

export function AgentTeamsDashboard(): React.ReactElement {
  const agentTeamsModule = useModule('agentTeams');
  const workflowTemplatesModule = useModule('workflowTemplates');
  const teamState = agentTeamsModule.states.teams.useState();
  const templateState = workflowTemplatesModule.states.templates.useState();
  const selectedTeam = teamState.teams.find((team) => team.id === teamState.selectedTeamId) ?? teamState.teams[0] ?? null;
  const visibleTemplates = templateState.templates.filter((template) => !template.teamId || template.teamId === selectedTeam?.id);
  const selectedTemplate = visibleTemplates.find((template) => template.id === templateState.selectedTemplateId) ?? visibleTemplates[0] ?? null;
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
  const [mappingWorkspaceId, setMappingWorkspaceId] = useState('');
  const [sessionOptions, setSessionOptions] = useState<Session[]>([]);
  const [sessionOptionsError, setSessionOptionsError] = useState<string | null>(null);
  const [workflowSessionOptions, setWorkflowSessionOptions] = useState<Session[]>([]);
  const [workflowSessionOptionsError, setWorkflowSessionOptionsError] = useState<string | null>(null);
  const [resolvingSessions, setResolvingSessions] = useState(false);
  const [sessionMappingError, setSessionMappingError] = useState<string | null>(null);
  const [allowAutoCreate, setAllowAutoCreate] = useState(true);
  const [allowRoleNameReuse, setAllowRoleNameReuse] = useState(true);
  const [nudgeActivity, setNudgeActivity] = useState<TeamAgentActivitySnapshot[]>([]);
  const [nudgeTaskPrompt, setNudgeTaskPrompt] = useState('');
  const [nudgeStaleAfterMinutes, setNudgeStaleAfterMinutes] = useState('');
  const [nudgeRunning, setNudgeRunning] = useState(false);
  const [nudgeError, setNudgeError] = useState<string | null>(null);
  const [nudgeResult, setNudgeResult] = useState<{ runId: string; output: TeamGuardrailNudgeWorkflowOutput | null } | null>(null);
  const [templateError, setTemplateError] = useState<string | null>(null);
  const [workflowDefinitions, setWorkflowDefinitions] = useState<DeclarativeWorkflowDefinitionEntry[]>([]);
  const [selectedDefinitionId, setSelectedDefinitionId] = useState('two-agent-review-round');
  const [definitionError, setDefinitionError] = useState<string | null>(null);
  const [loadingDefinitions, setLoadingDefinitions] = useState(false);
  const [workflowDraft, setWorkflowDraft] = useState<DeclarativeWorkflowLaunchDraft>(() => createDraftFromDefinition(null));
  const [workflowLaunchErrors, setWorkflowLaunchErrors] = useState<Partial<Record<keyof DeclarativeWorkflowLaunchDraft, string>>>({});
  const [workflowLaunchError, setWorkflowLaunchError] = useState<string | null>(null);
  const [launchingDeclarative, setLaunchingDeclarative] = useState(false);
  const [selectedInstanceId, setSelectedInstanceId] = useState<string | null>(() => readSavedWorkflowInstanceId());
  const [instanceStatus, setInstanceStatus] = useState<WorkflowInstanceStatusResponse | null>(null);
  const [instanceStatusError, setInstanceStatusError] = useState<string | null>(null);
  const [loadingInstanceStatus, setLoadingInstanceStatus] = useState(false);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [webhookProvisioning, setWebhookProvisioning] = useState<WorkflowWebhookProvisioningStatus | null>(null);
  const [webhookInbox, setWebhookInbox] = useState<WorkflowWebhookInboxListResponse | null>(null);
  const [webhookStatusError, setWebhookStatusError] = useState<string | null>(null);

  const selectedRun = useMemo(
    () => runs.find((run) => run.runId === selectedRunId) ?? runs[0] ?? null,
    [runs, selectedRunId],
  );
  const selectedDefinition = useMemo(
    () => workflowDefinitions.find((entry) => entry.definition.id === selectedDefinitionId)?.definition ?? workflowDefinitions[0]?.definition ?? null,
    [workflowDefinitions, selectedDefinitionId],
  );

  const loadWorkflowDefinitions = async () => {
    setLoadingDefinitions(true);
    setDefinitionError(null);
    try {
      const response = await fetchDeclarativeWorkflowDefinitions();
      const active = response.definitions.filter((entry) => entry.status === 'active');
      setWorkflowDefinitions(active);
      setSelectedDefinitionId((current) => active.some((entry) => entry.definition.id === current) ? current : active.find((entry) => entry.definition.id === 'two-agent-review-round')?.definition.id ?? active[0]?.definition.id ?? '');
    } catch (caught) {
      setDefinitionError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setLoadingDefinitions(false);
    }
  };

  const loadWorkflowInfrastructureStatus = async () => {
    setWebhookStatusError(null);
    try {
      const [provisioning, inbox] = await Promise.all([
        fetchWorkflowWebhookProvisioningStatus(),
        fetchWorkflowWebhookInbox({ limit: 5 }),
      ]);
      setWebhookProvisioning(provisioning);
      setWebhookInbox(inbox);
    } catch (caught) {
      setWebhookStatusError(caught instanceof Error ? caught.message : String(caught));
    }
  };

  const loadInstanceStatus = async (instanceId: string) => {
    setLoadingInstanceStatus(true);
    setInstanceStatusError(null);
    try {
      setInstanceStatus(await fetchWorkflowInstanceStatus(instanceId));
    } catch (caught) {
      setInstanceStatusError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setLoadingInstanceStatus(false);
    }
  };

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
    void loadWorkflowDefinitions();
    void loadWorkflowInfrastructureStatus();
    void vkClient.getWorkspaces()
      .then((loaded) => { setWorkspaces(loaded); setWorkspaceError(null); })
      .catch((caught) => { setWorkspaceError(caught instanceof Error ? caught.message : String(caught)); });
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
    setMappingWorkspaceId(selectedTeam?.agents.find((agent) => agent.vkWorkspaceId)?.vkWorkspaceId ?? '');
    setNudgeActivity(createDefaultNudgeActivity(selectedTeam));
    setNudgeResult(null);
    setNudgeError(null);
    setNudgeStaleAfterMinutes(selectedTeam?.policies.nudgeAfterMs ? String(Math.max(1, Math.round(selectedTeam.policies.nudgeAfterMs / 60_000))) : '');
  }, [selectedTeam?.id]);

  useEffect(() => {
    setWorkflowDraft((current) => createDraftFromDefinition(selectedDefinition, current));
    setWorkflowLaunchErrors({});
    setWorkflowLaunchError(null);
  }, [selectedDefinition?.id]);

  useEffect(() => {
    writeSavedWorkflowInstanceId(selectedInstanceId);
    if (!selectedInstanceId) {
      setInstanceStatus(null);
      return;
    }
    void loadInstanceStatus(selectedInstanceId);
    const interval = window.setInterval(() => {
      void loadInstanceStatus(selectedInstanceId);
      void loadWorkflowInfrastructureStatus();
    }, 5000);
    return () => window.clearInterval(interval);
  }, [selectedInstanceId]);

  useEffect(() => {
    const workspaceForSessions = mappingWorkspaceId.trim();
    if (!workspaceForSessions) {
      setSessionOptions([]);
      setSessionOptionsError(null);
      return;
    }
    void vkClient.getSessions(workspaceForSessions)
      .then((sessions) => {
        setSessionOptions(sessions);
        setSessionOptionsError(null);
      })
      .catch((caught) => {
        setSessionOptions([]);
        setSessionOptionsError(caught instanceof Error ? caught.message : String(caught));
      });
  }, [mappingWorkspaceId]);

  useEffect(() => {
    const workspaceForWorkflow = workflowDraft.workspaceId.trim();
    if (!workspaceForWorkflow) {
      setWorkflowSessionOptions([]);
      setWorkflowSessionOptionsError(null);
      return;
    }
    void vkClient.getSessions(workspaceForWorkflow)
      .then((sessions) => {
        setWorkflowSessionOptions(sessions);
        setWorkflowSessionOptionsError(null);
      })
      .catch((caught) => {
        setWorkflowSessionOptions([]);
        setWorkflowSessionOptionsError(caught instanceof Error ? caught.message : String(caught));
      });
  }, [workflowDraft.workspaceId]);


  const launchDeclarativeWorkflow = async () => {
    const validation = validateDeclarativeWorkflowLaunch(selectedDefinition, workflowDraft);
    setWorkflowLaunchErrors(validation.fieldErrors);
    setWorkflowLaunchError(validation.formError);
    if (!validation.ok || !selectedDefinition) return;
    setLaunchingDeclarative(true);
    setWorkflowLaunchError(null);
    try {
      const input = buildDeclarativeWorkflowInput(workflowDraft);
      const response = await runDeclarativeWorkflow(selectedDefinition.id, {
        input,
        team: createMinimalWorkflowTeam({
          sourceRole: workflowDraft.sourceRole.trim() || 'implementer',
          reviewRole: workflowDraft.reviewRole.trim() || 'reviewer',
          sourceSessionId: workflowDraft.sourceSessionId.trim() || null,
          reviewSessionId: workflowDraft.reviewSessionId.trim() || null,
          workspaceId: workflowDraft.workspaceId.trim(),
          workflowId: selectedDefinition.id,
        }),
        trigger: 'manual_ui',
      });
      setSelectedInstanceId(response.result.instance.instanceId);
      await loadInstanceStatus(response.result.instance.instanceId);
    } catch (caught) {
      setWorkflowLaunchError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setLaunchingDeclarative(false);
    }
  };

  const createTemplate = async () => {
    setTemplateError(null);
    try {
      await workflowTemplatesModule.actions.createTemplate({
        name: `Workflow template ${templateState.templates.length + 1}`,
        description: null,
        teamId: selectedTeam?.id ?? null,
        body: 'Please work on this task:\n\n{{task}}',
        targetRoles: selectedTeam?.agents.filter((agent) => agent.enabled).map((agent) => agent.role) ?? [],
        defaultWorkflowId: 'manual-agent-team-runner',
      });
    } catch (caught) {
      setTemplateError(caught instanceof Error ? caught.message : String(caught));
    }
  };

  const updateTemplate = async (templateId: string, patch: UpdateWorkflowTemplateInput) => {
    setTemplateError(null);
    try {
      await workflowTemplatesModule.actions.updateTemplate({ templateId, patch });
    } catch (caught) {
      setTemplateError(caught instanceof Error ? caught.message : String(caught));
    }
  };

  const useTemplateForManualRun = (template: WorkflowTemplate) => {
    setTaskPrompt(template.body);
    if (template.targetRoles.length) {
      const roles = new Set(template.targetRoles.map((role) => role.toLowerCase()));
      setTargetAgentIds(selectedTeam?.agents.filter((agent) => roles.has(agent.role.toLowerCase()) && agent.enabled).map((agent) => agent.id) ?? []);
    }
  };

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



  const resolveSessionMappings = async (): Promise<AgentTeam | null> => {
    if (!selectedTeam) return null;
    const workspaceId = mappingWorkspaceId.trim();
    if (!workspaceId) {
      setSessionMappingError('Choose a VK workspace before resolving sessions.');
      return null;
    }
    setResolvingSessions(true);
    setSessionMappingError(null);
    try {
      const resolution = await resolveTeamSessionMappings({
        team: selectedTeam,
        workspaceId,
        workflowId: 'manual-agent-team-runner',
        roleIds: targetAgentIds.length ? targetAgentIds : undefined,
        overrides: Object.fromEntries(selectedTeam.agents.flatMap((agent) => agent.vkSessionId ? [[agent.id, { sessionId: agent.vkSessionId, executor: agent.executor ?? null }]] : [])),
        allowAutoCreate,
        allowRoleNameReuse,
      });
      if (!resolution.ok) {
        setSessionMappingError(resolution.errors.map((error) => error.error ?? error.roleName).join('; ') || 'Unable to resolve sessions');
        return null;
      }
      const resolvedTeam = applyResolvedSessionsToTeam(selectedTeam, resolution);
      await updateTeam({ agents: resolvedTeam.agents });
      return resolvedTeam;
    } catch (caught) {
      setSessionMappingError(caught instanceof Error ? caught.message : String(caught));
      return null;
    } finally {
      setResolvingSessions(false);
    }
  };


  const nudgePreview = useMemo<TeamNudgePreview | null>(() => {
    if (!selectedTeam) return null;
    try {
      return buildTeamNudgePreview({
        team: selectedTeam,
        agentActivity: nudgeActivity,
        staleAfterMinutes: nudgeStaleAfterMinutes.trim() ? Number(nudgeStaleAfterMinutes) : null,
      });
    } catch {
      return null;
    }
  }, [selectedTeam, nudgeActivity, nudgeStaleAfterMinutes]);

  const updateNudgeActivity = (agentId: string, patch: Partial<TeamAgentActivitySnapshot>) => {
    setNudgeActivity((current) => {
      const next = current.some((snapshot) => snapshot.agentId === agentId)
        ? current.map((snapshot) => snapshot.agentId === agentId ? { ...snapshot, ...patch } : snapshot)
        : [...current, { agentId, lastActivityAt: null, nudgeCount: 0, ...patch }];
      return next;
    });
  };

  const runGuardrailNudge = async () => {
    if (!selectedTeam) return;
    setNudgeRunning(true);
    setNudgeError(null);
    setNudgeResult(null);
    try {
      const staleAfterMinutes = nudgeStaleAfterMinutes.trim() ? Number(nudgeStaleAfterMinutes) : undefined;
      if (staleAfterMinutes !== undefined && (!Number.isFinite(staleAfterMinutes) || staleAfterMinutes <= 0)) {
        throw new Error('Stale threshold must be a positive number of minutes.');
      }
      const response = await runTeamGuardrailNudgeWorkflow({
        team: selectedTeam,
        agentActivity: nudgeActivity,
        taskPrompt: nudgeTaskPrompt.trim() ? nudgeTaskPrompt : null,
        staleAfterMinutes,
      });
      setNudgeResult({ runId: response.run.runId, output: (response.run.output as TeamGuardrailNudgeWorkflowOutput | null) ?? null });
      setSelectedRunId(response.run.runId);
      if (response.run.status === 'failed') {
        setNudgeError(`Workflow run failed after it was persisted: ${summarizeWorkflowError(response.run.error) ?? 'select the run for details'}`);
      }
      await loadRuns();
    } catch (caught) {
      setNudgeError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setNudgeRunning(false);
    }
  };

  const launchRun = async () => {
    if (!selectedTeam) return;
    setRunning(true);
    setRunError(null);
    try {
      const mappedTeam = mappingWorkspaceId.trim() ? await resolveSessionMappings() : selectedTeam;
      if (!mappedTeam) return;
      const response = await runManualAgentTeamWorkflow({
        team: mappedTeam,
        taskPrompt,
        context: context.trim() ? context : null,
        targetAgentIds,
      });
      if (response.run.status === 'failed') {
        setRunError(`Workflow run failed after it was persisted: ${summarizeWorkflowError(response.run.error) ?? 'events below may have details'}`);
      } else {
        setTaskPrompt('');
      }
      setSelectedRunId(response.run.runId);
      await loadRuns();
    } catch (caught) {
      setRunError(formatWorkflowLaunchCatch(caught));
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
            <button className={buttonClass} onClick={() => { void loadActivity(); void loadRuns(); void loadWorkflowInfrastructureStatus(); if (selectedInstanceId) void loadInstanceStatus(selectedInstanceId); }} disabled={loadingRuns || loadingActivity || loadingInstanceStatus}>Refresh status</button>
            <button className={primaryButtonClass} onClick={() => void createTeam()}>New team</button>
          </div>
        </header>

        <DeclarativeWorkflowPanel
          definitions={workflowDefinitions}
          selectedDefinition={selectedDefinition}
          selectedDefinitionId={selectedDefinitionId}
          draft={workflowDraft}
          fieldErrors={workflowLaunchErrors}
          launchError={workflowLaunchError}
          loadingDefinitions={loadingDefinitions}
          definitionError={definitionError}
          launching={launchingDeclarative}
          workspaces={workspaces}
          workspaceError={workspaceError}
          sessions={workflowSessionOptions}
          sessionsError={workflowSessionOptionsError}
          selectedInstanceId={selectedInstanceId}
          instanceStatus={instanceStatus}
          instanceStatusError={instanceStatusError}
          loadingInstanceStatus={loadingInstanceStatus}
          webhookProvisioning={webhookProvisioning}
          webhookInbox={webhookInbox}
          webhookStatusError={webhookStatusError}
          onReloadDefinitions={() => void loadWorkflowDefinitions()}
          onDefinitionChange={setSelectedDefinitionId}
          onDraftChange={(patch) => setWorkflowDraft((current) => ({ ...current, ...patch }))}
          onLaunch={() => void launchDeclarativeWorkflow()}
          onRefreshInstance={() => selectedInstanceId ? void loadInstanceStatus(selectedInstanceId) : undefined}
        />

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
              <TeamEditor team={selectedTeam} sessions={sessionOptions} mappingWorkspaceId={mappingWorkspaceId} onUpdate={updateTeam} onUpdateAgent={updateAgent} onDelete={() => void agentTeamsModule.actions.deleteTeam({ teamId: selectedTeam.id })} />
            ) : null}

            {selectedTeam ? (
              <section className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
                <h2 className="font-medium">Launch manual team run</h2>
                {runError ? <div role="alert" className="mt-3 rounded border border-red-800 bg-red-950/40 p-3 text-sm text-red-200">{runError}</div> : null}
                <div className="mt-3 grid gap-3">
                  <SessionMappingControls workspaceId={mappingWorkspaceId} onWorkspaceIdChange={setMappingWorkspaceId} sessions={sessionOptions} sessionsError={sessionOptionsError} allowAutoCreate={allowAutoCreate} onAllowAutoCreateChange={setAllowAutoCreate} allowRoleNameReuse={allowRoleNameReuse} onAllowRoleNameReuseChange={setAllowRoleNameReuse} resolving={resolvingSessions} mappingError={sessionMappingError} onResolve={() => void resolveSessionMappings()} />
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
                  <button className={primaryButtonClass} disabled={running || resolvingSessions || !taskPrompt.trim()} onClick={() => void launchRun()}>{running || resolvingSessions ? 'Preparing…' : 'Run team workflow'}</button>
                </div>
              </section>
            ) : null}
          </section>
        </div>

        {selectedTeam ? (
          <GuardrailNudgePanel
            team={selectedTeam}
            activity={nudgeActivity}
            preview={nudgePreview}
            taskPrompt={nudgeTaskPrompt}
            staleAfterMinutes={nudgeStaleAfterMinutes}
            running={nudgeRunning}
            error={nudgeError}
            result={nudgeResult}
            onActivityChange={updateNudgeActivity}
            onTaskPromptChange={setNudgeTaskPrompt}
            onStaleAfterMinutesChange={setNudgeStaleAfterMinutes}
            onRun={() => void runGuardrailNudge()}
            onSelectRun={setSelectedRunId}
          />
        ) : null}

        <WorkflowTemplatesPanel
          templates={visibleTemplates}
          selectedTemplate={selectedTemplate}
          selectedTeamId={selectedTeam?.id ?? null}
          error={templateError}
          onCreate={() => void createTemplate()}
          onResetBuiltIn={() => void workflowTemplatesModule.actions.resetBuiltInExample()}
          onSelect={(templateId) => void workflowTemplatesModule.actions.selectTemplate({ templateId })}
          onUpdate={(templateId, patch) => void updateTemplate(templateId, patch)}
          onDelete={(templateId) => void workflowTemplatesModule.actions.deleteTemplate({ templateId })}
          onDuplicate={(templateId) => void workflowTemplatesModule.actions.duplicateTemplate({ templateId })}
          onUseTemplate={useTemplateForManualRun}
        />

        <ActivityAttentionPanel activity={activity} error={activityError} loading={loadingActivity} onRefresh={() => void loadActivity()} />

        <WorkflowRunsPanel runs={runs} selectedRun={selectedRun} events={events} error={runsError} loading={loadingRuns} onSelectRun={setSelectedRunId} />
      </div>
    </main>
  );
}


function DeclarativeWorkflowPanel(props: {
  definitions: DeclarativeWorkflowDefinitionEntry[];
  selectedDefinition: DeclarativeWorkflowDefinitionEntry['definition'] | null;
  selectedDefinitionId: string;
  draft: DeclarativeWorkflowLaunchDraft;
  fieldErrors: Partial<Record<keyof DeclarativeWorkflowLaunchDraft, string>>;
  launchError: string | null;
  loadingDefinitions: boolean;
  definitionError: string | null;
  launching: boolean;
  workspaces: Workspace[];
  workspaceError: string | null;
  sessions: Session[];
  sessionsError: string | null;
  selectedInstanceId: string | null;
  instanceStatus: WorkflowInstanceStatusResponse | null;
  instanceStatusError: string | null;
  loadingInstanceStatus: boolean;
  webhookProvisioning: WorkflowWebhookProvisioningStatus | null;
  webhookInbox: WorkflowWebhookInboxListResponse | null;
  webhookStatusError: string | null;
  onReloadDefinitions: () => void;
  onDefinitionChange: (definitionId: string) => void;
  onDraftChange: (patch: Partial<DeclarativeWorkflowLaunchDraft>) => void;
  onLaunch: () => void;
  onRefreshInstance: () => void | undefined;
}) {
  const definition = props.selectedDefinition;
  const roles = definition ? describeDefinitionRoles(definition) : [];
  const requiredInputs = definition ? Object.entries(definition.inputs).filter(([, spec]) => spec.required) : [];
  const selectedWorkspaceSessions = filterWorkflowSessionsForWorkspace(props.sessions, props.draft.workspaceId);
  return (
    <section className="rounded-lg border border-cyan-900/60 bg-cyan-950/10 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-medium text-cyan-100">Durable workflow launch</h2>
          <p className="mt-1 text-sm text-zinc-400">Choose a declarative workflow, map source/reviewer roles or sessions, launch, then let VD own durable handoff and webhook wakeups.</p>
        </div>
        <button className={buttonClass} onClick={props.onReloadDefinitions} disabled={props.loadingDefinitions}>{props.loadingDefinitions ? 'Loading definitions…' : 'Reload definitions'}</button>
      </div>
      {props.definitionError ? <div role="alert" className="mt-3 rounded border border-red-800 bg-red-950/40 p-3 text-sm text-red-200">Workflow definition load failed: {props.definitionError}</div> : null}
      {props.definitions.length === 0 && !props.loadingDefinitions ? <div role="alert" className="mt-3 rounded border border-amber-800 bg-amber-950/40 p-3 text-sm text-amber-100">No active workflow definitions are available. Restore the built-in definitions or save an active JSON definition before launching.</div> : null}
      <div className="mt-4 grid gap-4 lg:grid-cols-[360px_1fr]">
        <div className="space-y-3">
          <label className="block text-sm">Workflow definition
            <select className={`${inputClass} mt-1`} value={props.selectedDefinitionId} onChange={(event) => props.onDefinitionChange(event.target.value)}>
              {props.definitions.map((entry) => <option key={`${entry.definitionId}:${entry.version}:${entry.source}`} value={entry.definition.id}>{entry.name} v{entry.version} · {entry.source}</option>)}
            </select>
          </label>
          {definition ? (
            <div className="rounded-md border border-zinc-800 bg-zinc-950/70 p-3 text-sm">
              <div className="font-medium">{definition.name}</div>
              <div className="mt-1 text-xs text-zinc-500">{definition.id} · v{definition.version} · {definition.trigger}</div>
              {definition.description ? <p className="mt-2 text-zinc-300">{definition.description}</p> : null}
              <div className="mt-3 grid gap-2 text-xs text-zinc-400 sm:grid-cols-2">
                <div><span className="text-zinc-500">Required:</span> {requiredInputs.map(([key]) => key).join(', ') || 'none'}</div>
                <div><span className="text-zinc-500">Roles:</span> {roles.join(', ') || 'none'}</div>
                <div><span className="text-zinc-500">Refs-only:</span> {definition.policies.refsOnlyStorage ? 'yes' : 'no'}</div>
                <div><span className="text-zinc-500">Stale:</span> {definition.policies.stall.staleAfterMinutes}m{definition.policies.stall.autoNudge ? ' + auto-nudge policy' : ''}</div>
              </div>
            </div>
          ) : <p className="rounded border border-zinc-800 bg-zinc-950 p-3 text-sm text-zinc-400">Select an active workflow definition.</p>}
          <WebhookStatusCard provisioning={props.webhookProvisioning} inbox={props.webhookInbox} error={props.webhookStatusError} />
        </div>
        <div className="space-y-4">
          {props.launchError ? <div role="alert" className="rounded border border-red-800 bg-red-950/40 p-3 text-sm text-red-200">{props.launchError}</div> : null}
          <div className="grid gap-3 md:grid-cols-2">
            <label className="text-sm">Workspace
              <select className={`${inputClass} mt-1`} value={props.draft.workspaceId} onChange={(event) => props.onDraftChange({ workspaceId: event.target.value })}>
                <option value="">Choose workspace…</option>
                {props.workspaces.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name || workspace.branch || workspace.id}</option>)}
              </select>
              <FieldError message={props.fieldErrors.workspaceId || props.workspaceError} />
            </label>
            <label className="text-sm">Optional lane
              <input className={`${inputClass} mt-1`} value={props.draft.laneId} onChange={(event) => props.onDraftChange({ laneId: event.target.value })} placeholder="default lane" />
            </label>
            <label className="text-sm md:col-span-2">Task / prompt
              <textarea className={`${inputClass} mt-1`} rows={4} value={props.draft.task} onChange={(event) => props.onDraftChange({ task: event.target.value })} placeholder="Ask implementer/source agent to research, plan, or implement…" />
              <FieldError message={props.fieldErrors.task} />
            </label>
            <RoleOrSessionFields label="Source / implementer" role={props.draft.sourceRole} sessionId={props.draft.sourceSessionId} roleError={props.fieldErrors.sourceRole} sessionError={props.fieldErrors.sourceSessionId} sessions={selectedWorkspaceSessions} defaultRole="implementer" onChange={(patch) => props.onDraftChange({ sourceRole: patch.role, sourceSessionId: patch.sessionId })} />
            <RoleOrSessionFields label="Reviewer" role={props.draft.reviewRole} sessionId={props.draft.reviewSessionId} roleError={props.fieldErrors.reviewRole} sessionError={props.fieldErrors.reviewSessionId} sessions={selectedWorkspaceSessions} defaultRole="reviewer" onChange={(patch) => props.onDraftChange({ reviewRole: patch.role, reviewSessionId: patch.sessionId })} />
            <label className="text-sm md:col-span-2">Optional overseer notification session
              <select className={`${inputClass} mt-1`} value={props.draft.overseerSessionId} onChange={(event) => props.onDraftChange({ overseerSessionId: event.target.value })}>
                <option value="">No completion notification</option>
                {selectedWorkspaceSessions.map((session) => <option key={session.id} value={session.id}>{session.name || session.id} · {session.executor}</option>)}
              </select>
              <p className="mt-1 text-xs text-zinc-500">If set, VD queues exactly one guarded completion notification after reviewer completion.</p>
            </label>
          </div>
          {props.sessionsError ? <div role="alert" className="rounded border border-amber-800 bg-amber-950/40 p-2 text-xs text-amber-100">Session picker could not load sessions for the selected workspace controls: {props.sessionsError}</div> : null}
          <div className="flex flex-wrap items-center gap-3">
            <button className={primaryButtonClass} disabled={props.launching || !definition} onClick={props.onLaunch}>{props.launching ? 'Launching durable workflow…' : 'Launch durable workflow'}</button>
            <span className="text-xs text-zinc-500">Returns immediately after queuing the source prompt and creating a durable wait trigger.</span>
          </div>
          <WorkflowInstanceTimeline status={props.instanceStatus} selectedInstanceId={props.selectedInstanceId} error={props.instanceStatusError} loading={props.loadingInstanceStatus} onRefresh={props.onRefreshInstance} />
        </div>
      </div>
    </section>
  );
}

function RoleOrSessionFields(props: { label: string; role: string; sessionId: string; roleError?: string; sessionError?: string; sessions: Session[]; defaultRole: string; onChange: (patch: { role: string; sessionId: string }) => void }) {
  return (
    <div className="rounded-md border border-zinc-800 bg-zinc-950/70 p-3">
      <div className="text-sm font-medium">{props.label}</div>
      <label className="mt-2 block text-xs text-zinc-400">Role/name for auto-create or reuse
        <input className={`${inputClass} mt-1`} value={props.role} onChange={(event) => props.onChange({ role: event.target.value, sessionId: props.sessionId })} placeholder={props.defaultRole} />
        <FieldError message={props.roleError} />
      </label>
      <label className="mt-2 block text-xs text-zinc-400">Or explicit existing VK session
        <select className={`${inputClass} mt-1`} value={props.sessionId} onChange={(event) => props.onChange({ role: props.role, sessionId: event.target.value })}>
          <option value="">Resolver may reuse/create by role</option>
          {props.sessions.map((session) => <option key={session.id} value={session.id}>{session.name || session.id} · {session.executor}</option>)}
        </select>
        <FieldError message={props.sessionError} />
      </label>
      <VkSessionLink workspaceId={props.sessions.find((session) => session.id === props.sessionId)?.workspace_id ?? null} sessionId={props.sessionId} className="mt-2" />
    </div>
  );
}

function WorkflowInstanceTimeline(props: { status: WorkflowInstanceStatusResponse | null; selectedInstanceId: string | null; error: string | null; loading: boolean; onRefresh: () => void | undefined }) {
  if (!props.selectedInstanceId && !props.status) return <p className="rounded border border-zinc-800 bg-zinc-950 p-3 text-sm text-zinc-400">No durable workflow instance launched in this browser session yet. Existing instances remain available in persisted run/status APIs.</p>;
  return (
    <div className="rounded-md border border-zinc-800 bg-zinc-950/70 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-medium">Durable instance status</h3>
        <div className="flex flex-wrap gap-2">
          {props.selectedInstanceId ? <a className={buttonClass} href={`/dashboard/workflows/${encodeURIComponent(props.selectedInstanceId)}`}>Open clean page</a> : null}
          <button className={buttonClass} onClick={props.onRefresh} disabled={props.loading}>{props.loading ? 'Refreshing…' : 'Refresh instance'}</button>
        </div>
      </div>
      {props.error ? <div role="alert" className="mt-2 rounded border border-red-800 bg-red-950/40 p-2 text-sm text-red-200">Instance status failed to load: {props.error}</div> : null}
      {props.status ? <>
        <dl className="mt-3 grid gap-2 text-sm md:grid-cols-3">
          <Ref label="Instance" value={props.status.instance.instanceId} />
          <Ref label="Workflow" value={props.status.instance.workflowId} />
          <Ref label="Status" value={props.status.instance.status} />
          <Ref label="Current step" value={props.status.instance.currentStepId} />
          <Ref label="Created" value={formatTimestamp(props.status.instance.createdAt)} />
          <Ref label="Updated" value={formatTimestamp(props.status.instance.updatedAt)} />
        </dl>
        {props.status.instance.error ? <div className="mt-3 rounded border border-red-900 bg-red-950/30 p-3 text-sm text-red-100"><div className="font-medium">Workflow instance error</div><pre className="mt-2 max-h-48 overflow-auto text-xs">{JSON.stringify(props.status.instance.error, null, 2)}</pre></div> : null}
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          <div><h4 className="text-sm font-medium">Steps</h4><div className="mt-2 space-y-2">{props.status.steps.map((step) => <StepStateCard key={step.id} step={step} />)}</div></div>
          <div><h4 className="text-sm font-medium">Triggers / waits</h4><div className="mt-2 space-y-2">{props.status.triggers.length ? props.status.triggers.map((trigger) => <TriggerCard key={trigger.triggerId} trigger={trigger} />) : <p className="text-sm text-zinc-500">No triggers recorded.</p>}</div></div>
        </div>
        {props.status.output ? <div className="mt-4"><h4 className="text-sm font-medium">Final output refs</h4><pre className="mt-2 max-h-56 overflow-auto rounded border border-zinc-800 bg-zinc-950 p-2 text-xs text-zinc-300">{JSON.stringify(props.status.output, null, 2)}</pre></div> : null}
      </> : null}
    </div>
  );
}

function StepStateCard({ step }: { step: WorkflowInstanceStatusResponse['steps'][number] }) {
  return <div className={`rounded border p-2 text-xs ${step.status === 'failed' ? 'border-red-900 bg-red-950/20' : step.status === 'waiting' ? 'border-amber-900 bg-amber-950/20' : 'border-zinc-800 bg-zinc-950'}`}><div className="flex justify-between gap-2"><span className="font-medium text-zinc-100">{step.stepKey}</span><span>{step.status}</span></div><div className="mt-1 text-zinc-500">attempts {step.attemptCount}{step.waitingTriggerId ? ` · wait ${step.waitingTriggerId}` : ''}</div>{step.blockedReason ? <div className="mt-1 text-amber-200">{step.blockedReason}</div> : null}{step.error ? <pre className="mt-2 max-h-32 overflow-auto text-red-100">{JSON.stringify(step.error, null, 2)}</pre> : null}{step.output ? <pre className="mt-2 max-h-32 overflow-auto text-zinc-400">{JSON.stringify(step.output, null, 2)}</pre> : null}</div>;
}

function TriggerCard({ trigger }: { trigger: WorkflowInstanceStatusResponse['triggers'][number] }) {
  return <div className={`rounded border p-2 text-xs ${trigger.status === 'active' ? 'border-cyan-900 bg-cyan-950/20' : trigger.status === 'satisfied' ? 'border-emerald-900 bg-emerald-950/20' : 'border-zinc-800 bg-zinc-950'}`}><div className="flex justify-between gap-2"><span className="font-medium text-zinc-100">{trigger.stepKey ?? trigger.triggerId}</span><span>{trigger.status}</span></div><div className="mt-1 grid gap-1 text-zinc-500"><span>session {trigger.sessionId ?? '—'}</span><span>mode {trigger.mode}</span><span>timeout {trigger.timeoutAt ? formatTimestamp(trigger.timeoutAt) : '—'}</span><span>satisfied by {trigger.satisfiedByExecutionProcessId ?? '—'}</span></div><VkSessionLink workspaceId={trigger.workspaceId} sessionId={trigger.sessionId} className="mt-1" /></div>;
}

function WebhookStatusCard(props: { provisioning: WorkflowWebhookProvisioningStatus | null; inbox: WorkflowWebhookInboxListResponse | null; error: string | null }) {
  const state = props.provisioning?.state;
  return <div className="rounded-md border border-zinc-800 bg-zinc-950/70 p-3 text-sm"><h3 className="font-medium">Webhook wakeup status</h3>{props.error ? <div role="alert" className="mt-2 text-xs text-amber-200">Webhook status failed to load: {props.error}</div> : null}{state ? <dl className="mt-2 grid gap-1 text-xs text-zinc-400"><Ref label="Provisioning" value={state.status} /><Ref label="Subscription" value={state.vkSubscriptionId} /><Ref label="Target" value={state.targetUrl} /><Ref label="Secret" value={state.secretSet ? 'configured (redacted)' : 'missing'} /><Ref label="Last success" value={state.lastSuccessAt ? formatTimestamp(state.lastSuccessAt) : '—'} /></dl> : <p className="mt-2 text-xs text-zinc-500">Provisioning state not recorded yet.</p>}{state?.lastError ? <pre className="mt-2 max-h-28 overflow-auto text-xs text-amber-100">{JSON.stringify(state.lastError, null, 2)}</pre> : null}<div className="mt-3 text-xs text-zinc-500">Recent terminal webhook events: {props.inbox?.events.length ?? 0}</div>{props.inbox?.events.slice(0, 3).map((event) => <div key={event.inboxId} className="mt-1 rounded bg-zinc-900 p-1 text-xs text-zinc-400">{event.eventType} · {event.eventStatus ?? 'unknown'} · {event.status} · {event.executionProcessId ?? 'no execution ref'}</div>)}</div>;
}

function FieldError({ message }: { message?: string | null }) {
  return message ? <div role="alert" className="mt-1 text-xs text-red-200">{message}</div> : null;
}



function readSavedWorkflowInstanceId(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem('vd.lastWorkflowInstanceId');
}

function writeSavedWorkflowInstanceId(instanceId: string | null): void {
  if (typeof window === 'undefined') return;
  if (instanceId) window.localStorage.setItem('vd.lastWorkflowInstanceId', instanceId);
  else window.localStorage.removeItem('vd.lastWorkflowInstanceId');
}

function SessionMappingControls(props: {
  workspaceId: string;
  onWorkspaceIdChange: (value: string) => void;
  sessions: Session[];
  sessionsError: string | null;
  allowAutoCreate: boolean;
  onAllowAutoCreateChange: (value: boolean) => void;
  allowRoleNameReuse: boolean;
  onAllowRoleNameReuseChange: (value: boolean) => void;
  resolving: boolean;
  mappingError: string | null;
  onResolve: () => void;
}) {
  return (
    <div className="rounded-md border border-zinc-800 bg-zinc-950/70 p-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="min-w-64 flex-1 text-sm">VK workspace for this run
          <input className={`${inputClass} mt-1`} placeholder="Workspace id" value={props.workspaceId} onChange={(event) => props.onWorkspaceIdChange(event.target.value)} />
        </label>
        <button className={buttonClass} type="button" onClick={props.onResolve} disabled={props.resolving || !props.workspaceId.trim()}>{props.resolving ? 'Resolving…' : 'Resolve role sessions'}</button>
      </div>
      <div className="mt-3 flex flex-wrap gap-4 text-sm text-zinc-300">
        <label className="flex items-center gap-2"><input type="checkbox" checked={props.allowRoleNameReuse} onChange={(event) => props.onAllowRoleNameReuseChange(event.target.checked)} /> Reuse sessions by role/name</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={props.allowAutoCreate} onChange={(event) => props.onAllowAutoCreateChange(event.target.checked)} /> Auto-create missing role sessions</label>
        <span className="text-xs text-zinc-500">{props.sessions.length ? `${props.sessions.length} existing sessions loaded` : 'No existing sessions loaded'}</span>
      </div>
      {props.sessionsError ? <div role="alert" className="mt-2 text-xs text-amber-200">Unable to load existing sessions: {props.sessionsError}</div> : null}
      {props.mappingError ? <div role="alert" className="mt-2 rounded border border-red-800 bg-red-950/40 p-2 text-xs text-red-200">{props.mappingError}</div> : null}
      <p className="mt-2 text-xs text-zinc-500">Workflow launch uses the resolver first. Existing selections win; otherwise VD reuses by role/name or creates sessions when enabled.</p>
    </div>
  );
}

function TeamEditor(props: { team: AgentTeam; sessions: Session[]; mappingWorkspaceId: string; onUpdate: (patch: UpdateAgentTeamInput) => Promise<void>; onUpdateAgent: (agentId: string, patch: Partial<TeamAgent>) => Promise<void>; onDelete: () => void }) {
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
            <div className="md:col-span-2 space-y-1">
              <select className={inputClass} value={agent.vkSessionId ?? ''} onChange={(event) => {
                const session = props.sessions.find((entry) => entry.id === event.target.value);
                void props.onUpdateAgent(agent.id, { vkSessionId: event.target.value || null, vkWorkspaceId: session?.workspace_id ?? (props.mappingWorkspaceId || (agent.vkWorkspaceId ?? null)), executor: session?.executor ?? agent.executor ?? null });
              }}>
                <option value="">Resolve/create on launch</option>
                {props.sessions.map((session) => <option key={session.id} value={session.id}>{session.name || session.id} · {session.executor}</option>)}
              </select>
              <input className={inputClass} placeholder="Advanced: VK session id" value={agent.vkSessionId ?? ''} onChange={(event) => void props.onUpdateAgent(agent.id, { vkSessionId: event.target.value || null, vkWorkspaceId: props.mappingWorkspaceId || (agent.vkWorkspaceId ?? null) })} />
              <VkSessionLink className="mt-1" workspaceId={agent.vkWorkspaceId} sessionId={agent.vkSessionId} />
            </div>
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


function WorkflowTemplatesPanel(props: {
  templates: WorkflowTemplate[];
  selectedTemplate: WorkflowTemplate | null;
  selectedTeamId: string | null;
  error: string | null;
  onCreate: () => void;
  onResetBuiltIn: () => void;
  onSelect: (templateId: string | null) => void;
  onUpdate: (templateId: string, patch: UpdateWorkflowTemplateInput) => void;
  onDelete: (templateId: string) => void;
  onDuplicate: (templateId: string) => void;
  onUseTemplate: (template: WorkflowTemplate) => void;
}) {
  const template = props.selectedTemplate;
  return (
    <section className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-medium">Workflow templates</h2>
          <p className="mt-1 text-xs text-zinc-500">Store reusable prompt/workflow defaults. Execution is still manual; templates populate the current team run.</p>
        </div>
        <div className="flex gap-2">
          <button className={buttonClass} onClick={props.onResetBuiltIn}>Add example</button>
          <button className={primaryButtonClass} onClick={props.onCreate}>New template</button>
        </div>
      </div>
      {props.error ? <div role="alert" className="mt-3 rounded border border-red-800 bg-red-950/40 p-3 text-sm text-red-200">{props.error}</div> : null}
      <div className="mt-4 grid gap-4 lg:grid-cols-[320px_1fr]">
        <div className="max-h-80 overflow-auto rounded border border-zinc-800">
          {props.templates.length ? props.templates.map((entry) => (
            <button key={entry.id} className={`block w-full border-b border-zinc-800 px-3 py-2 text-left text-sm ${template?.id === entry.id ? 'bg-cyan-950/40' : 'hover:bg-zinc-900'}`} onClick={() => props.onSelect(entry.id)}>
              <div className="font-medium">{entry.name}</div>
              <div className="text-xs text-zinc-500">{entry.teamId ? 'Team-scoped' : 'Global'} · {entry.defaultWorkflowId ?? 'no workflow'} · roles {entry.targetRoles.length || 'any'}</div>
            </button>
          )) : <p className="p-3 text-sm text-zinc-400">No templates yet. Add one or reset the example.</p>}
        </div>
        {template ? (
          <div className="space-y-3">
            <div className="grid gap-3 md:grid-cols-2">
              <label className="text-sm">Name<input className={`${inputClass} mt-1`} value={template.name} onChange={(event) => props.onUpdate(template.id, { name: event.target.value })} /></label>
              <label className="text-sm">Workflow<select className={`${inputClass} mt-1`} value={template.defaultWorkflowId ?? 'manual-agent-team-runner'} onChange={(event) => props.onUpdate(template.id, { defaultWorkflowId: event.target.value || null })}><option value="manual-agent-team-runner">manual-agent-team-runner</option><option value="team-guardrail-nudge">team-guardrail-nudge</option></select></label>
              <label className="text-sm">Description<input className={`${inputClass} mt-1`} value={template.description ?? ''} onChange={(event) => props.onUpdate(template.id, { description: event.target.value || null })} /></label>
              <label className="text-sm">Target roles<input className={`${inputClass} mt-1`} placeholder="implementer, reviewer" value={template.targetRoles.join(', ')} onChange={(event) => props.onUpdate(template.id, { targetRoles: parseCsv(event.target.value) })} /></label>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={template.teamId === props.selectedTeamId && Boolean(props.selectedTeamId)} onChange={(event) => props.onUpdate(template.id, { teamId: event.target.checked ? props.selectedTeamId : null })} disabled={!props.selectedTeamId} /> Scope to selected team</label>
              <label className="text-sm">Fan-in mode<input className={`${inputClass} mt-1`} placeholder="all_at_once / handle_as_they_come" value={template.policyOverrides?.fanInMode ?? ''} onChange={(event) => props.onUpdate(template.id, { policyOverrides: { ...template.policyOverrides, fanInMode: event.target.value || null } })} /></label>
              <label className="text-sm">Max concurrency override<input className={`${inputClass} mt-1`} type="number" min={1} value={template.policyOverrides?.maxConcurrentAgents ?? ''} onChange={(event) => props.onUpdate(template.id, { policyOverrides: { ...template.policyOverrides, maxConcurrentAgents: event.target.value ? Number(event.target.value) : null } })} /></label>
              <label className="text-sm">Max nudges override<input className={`${inputClass} mt-1`} type="number" min={0} value={template.policyOverrides?.maxNudgesPerRun ?? ''} onChange={(event) => props.onUpdate(template.id, { policyOverrides: { ...template.policyOverrides, maxNudgesPerRun: event.target.value ? Number(event.target.value) : null } })} /></label>
              <label className="text-sm md:col-span-2">Future skill file refs<input className={`${inputClass} mt-1`} placeholder="skills/tdd.md, skills/ux-review.md" value={(template.skillRefs ?? []).join(', ')} onChange={(event) => props.onUpdate(template.id, { skillRefs: parseCsv(event.target.value) })} /></label>
            </div>
            <label className="block text-sm">Prompt template body<textarea className={`${inputClass} mt-1`} rows={6} value={template.body} onChange={(event) => props.onUpdate(template.id, { body: event.target.value })} /></label>
            <div className="flex flex-wrap gap-2">
              <button className={primaryButtonClass} onClick={() => props.onUseTemplate(template)}>Use for manual run</button>
              <button className={buttonClass} onClick={() => props.onDuplicate(template.id)}>Duplicate</button>
              <button className="rounded-md border border-red-900 px-3 py-2 text-sm text-red-200 hover:bg-red-950/40" onClick={() => props.onDelete(template.id)}>Delete</button>
            </div>
          </div>
        ) : <p className="text-sm text-zinc-400">Select a template to edit.</p>}
      </div>
    </section>
  );
}

function parseCsv(value: string): string[] {
  return value.split(',').map((entry) => entry.trim()).filter(Boolean);
}


function GuardrailNudgePanel(props: {
  team: AgentTeam;
  activity: TeamAgentActivitySnapshot[];
  preview: TeamNudgePreview | null;
  taskPrompt: string;
  staleAfterMinutes: string;
  running: boolean;
  error: string | null;
  result: { runId: string; output: TeamGuardrailNudgeWorkflowOutput | null } | null;
  onActivityChange: (agentId: string, patch: Partial<TeamAgentActivitySnapshot>) => void;
  onTaskPromptChange: (value: string) => void;
  onStaleAfterMinutesChange: (value: string) => void;
  onRun: () => void;
  onSelectRun: (runId: string) => void;
}) {
  const preview = props.preview;
  const canRun = Boolean(preview && props.activity.length > 0 && !props.running);
  return (
    <section className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-medium">Manual guardrail nudges</h2>
          <p className="mt-1 text-xs text-zinc-500">Preview stale agents, then run the guarded team-guardrail-nudge workflow. Nudges are queued through VK /queue as system messages.</p>
        </div>
        <button className={primaryButtonClass} disabled={!canRun} onClick={props.onRun}>{props.running ? 'Queueing nudges…' : 'Run nudges now'}</button>
      </div>
      {props.error ? <div role="alert" className="mt-3 rounded border border-red-800 bg-red-950/40 p-3 text-sm text-red-200">{props.error}</div> : null}
      <div className="mt-3 grid gap-3 md:grid-cols-3">
        <label className="text-sm">Stale threshold minutes
          <input className={`${inputClass} mt-1`} type="number" min={1} placeholder={String(props.preview?.staleAfterMinutes ?? 30)} value={props.staleAfterMinutes} onChange={(event) => props.onStaleAfterMinutesChange(event.target.value)} />
        </label>
        <div className="rounded border border-zinc-800 bg-zinc-950 p-3 text-sm">
          <div className="text-xs uppercase text-zinc-500">Max nudge cap</div>
          <div className="mt-1 text-lg font-semibold text-zinc-100">{props.team.policies.maxNudgesPerRun}</div>
          <div className="text-xs text-zinc-500">per workflow run</div>
        </div>
        <label className="text-sm md:col-span-1">Optional task context
          <input className={`${inputClass} mt-1`} placeholder="Task or run context for the nudge" value={props.taskPrompt} onChange={(event) => props.onTaskPromptChange(event.target.value)} />
        </label>
      </div>
      <div className="mt-4 overflow-auto rounded border border-zinc-800">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-zinc-950 text-xs uppercase text-zinc-500"><tr><th className="px-3 py-2">Agent</th><th className="px-3 py-2">Last activity</th><th className="px-3 py-2">Prior nudges</th><th className="px-3 py-2">Session</th></tr></thead>
          <tbody>
            {props.team.agents.map((agent) => {
              const snapshot = props.activity.find((entry) => entry.agentId === agent.id) ?? { agentId: agent.id, lastActivityAt: null, nudgeCount: 0 };
              return (
                <tr key={agent.id} className="border-t border-zinc-800">
                  <td className="px-3 py-2"><div className="font-medium">{agent.displayName}</div><div className="text-xs text-zinc-500">{agent.role}{agent.enabled ? '' : ' · disabled'}</div></td>
                  <td className="px-3 py-2"><input className={inputClass} placeholder="ISO timestamp, blank = unknown" value={snapshot.lastActivityAt == null ? '' : String(snapshot.lastActivityAt)} onChange={(event) => props.onActivityChange(agent.id, { lastActivityAt: event.target.value || null })} /></td>
                  <td className="px-3 py-2"><input className={inputClass} type="number" min={0} value={snapshot.nudgeCount ?? 0} onChange={(event) => props.onActivityChange(agent.id, { nudgeCount: Math.max(0, Number(event.target.value) || 0) })} /></td>
                  <td className="px-3 py-2"><span className="break-all text-xs text-zinc-400">{agent.vkSessionId ?? 'missing session'}</span><VkSessionLink workspaceId={agent.vkWorkspaceId} sessionId={agent.vkSessionId} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="mt-4 grid gap-3 lg:grid-cols-3">
        <NudgePreviewColumn title="Will nudge" items={preview?.nudges ?? []} tone="cyan" empty="No stale eligible agents." />
        <NudgePreviewColumn title="Skipped" items={preview?.skipped.filter((item) => item.action === 'skip') ?? []} tone="zinc" empty="No skipped agents." />
        <NudgePreviewColumn title="Escalations" items={preview?.escalations ?? []} tone="amber" empty="No cap escalations." />
      </div>
      {props.result ? <NudgeResult result={props.result} onSelectRun={props.onSelectRun} /> : null}
    </section>
  );
}

function NudgePreviewColumn(props: { title: string; items: TeamNudgePreview['nudges']; tone: 'cyan' | 'zinc' | 'amber'; empty: string }) {
  const toneClass = props.tone === 'cyan' ? 'border-cyan-900 bg-cyan-950/20' : props.tone === 'amber' ? 'border-amber-900 bg-amber-950/20' : 'border-zinc-800 bg-zinc-950';
  return (
    <div className={`rounded-md border p-3 ${toneClass}`}>
      <h3 className="text-sm font-medium">{props.title}</h3>
      <div className="mt-2 space-y-2">
        {props.items.length ? props.items.map((item) => <div key={`${item.agentId}-${item.reason}`} className="rounded bg-zinc-950/70 p-2 text-xs"><div className="font-medium text-zinc-100">{item.displayName} · {item.role}</div><div className="mt-1 text-zinc-400">{item.reason}{item.staleMinutes == null ? '' : ` · stale ${item.staleMinutes}m`} · nudges {item.nudgeCount}</div>{!item.sessionId && item.action === 'nudge' ? <div className="mt-1 text-red-200">Missing VK session; workflow will fail before queueing.</div> : null}</div>) : <p className="text-xs text-zinc-500">{props.empty}</p>}
      </div>
    </div>
  );
}

function NudgeResult(props: { result: { runId: string; output: TeamGuardrailNudgeWorkflowOutput | null }; onSelectRun: (runId: string) => void }) {
  const output = props.result.output;
  return (
    <div className="mt-4 rounded-md border border-zinc-800 bg-zinc-950 p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div><span className="font-medium">Guardrail run:</span> {props.result.runId}</div>
        <button className={buttonClass} onClick={() => props.onSelectRun(props.result.runId)}>Show run details</button>
      </div>
      {output ? <div className="mt-3 grid gap-3 md:grid-cols-3"><ResultList title="Queued" items={'nudges' in output ? output.nudges.map((entry) => `${entry.displayName} · ${entry.queueItemId}`) : []} /><ResultList title="Skipped" items={output.skipped.map((entry) => `${entry.agentId} · ${entry.reason}`)} /><ResultList title="Escalations" items={output.escalations.map((entry) => `${entry.agentId} · ${entry.reason}`)} /></div> : <p className="mt-2 text-xs text-zinc-500">Run output was not available in the response; select the run for persisted details.</p>}
    </div>
  );
}

function ResultList(props: { title: string; items: string[] }) {
  return <div><h4 className="text-xs uppercase text-zinc-500">{props.title}</h4>{props.items.length ? <ul className="mt-1 space-y-1 text-xs text-zinc-300">{props.items.map((item) => <li key={item}>{item}</li>)}</ul> : <p className="mt-1 text-xs text-zinc-500">None</p>}</div>;
}

function createDefaultNudgeActivity(team: AgentTeam | null): TeamAgentActivitySnapshot[] {
  if (!team) return [];
  return team.agents.map((agent) => ({ agentId: agent.id, lastActivityAt: null, nudgeCount: 0 }));
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
  const queueRefs = collectWorkflowQueueRefs(props.selectedRun);
  const errorSummary = summarizeWorkflowError(props.selectedRun?.error);
  return (
    <section className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
      <div className="flex items-center justify-between"><h2 className="font-medium">Workflow runs</h2>{props.loading ? <span className="text-xs text-zinc-500">Loading…</span> : null}</div>
      {props.error ? <div role="alert" className="mt-3 rounded border border-red-800 bg-red-950/40 p-3 text-sm text-red-200">{props.error}</div> : null}
      <div className="mt-3 grid gap-4 lg:grid-cols-[360px_1fr]">
        <div className="max-h-96 overflow-auto rounded border border-zinc-800">
          {props.runs.map((run) => <button key={run.runId} className={`block w-full border-b border-zinc-800 px-3 py-2 text-left text-sm ${props.selectedRun?.runId === run.runId ? 'bg-cyan-950/40' : 'hover:bg-zinc-900'}`} onClick={() => props.onSelectRun(run.runId)}><div className="flex items-center justify-between gap-2"><span className="font-medium">{run.workflowId}</span><RunStatusBadge status={run.status} /></div><div className="mt-1 text-xs text-zinc-500">{run.runId}</div></button>)}
        </div>
        <div className="space-y-4 text-sm">
          {props.selectedRun ? <>
            <dl className="grid gap-2 md:grid-cols-2">
              <Ref label="Run" value={props.selectedRun.runId} /><Ref label="Workflow" value={props.selectedRun.workflowId} /><Ref label="Status" value={workflowStatusLabel(props.selectedRun.status)} /><Ref label="Trigger" value={props.selectedRun.trigger} /><Ref label="Started" value={formatTimestamp(props.selectedRun.startedAt)} /><Ref label="Duration" value={props.selectedRun.durationMs == null ? '—' : `${props.selectedRun.durationMs}ms`} /><Ref label="VK workspace" value={props.selectedRun.vkWorkspaceId} /><Ref label="VK session" value={props.selectedRun.vkSessionId} href={buildVkSessionUrl({ workspaceId: props.selectedRun.vkWorkspaceId, sessionId: props.selectedRun.vkSessionId })} /><Ref label="VK queue item" value={props.selectedRun.vkQueueItemId} />
            </dl>
            {props.selectedRun.status === 'failed' ? <div className="rounded border border-red-900 bg-red-950/30 p-3 text-sm text-red-100"><div className="font-medium">Workflow failed after a run was persisted.</div><div className="mt-1 text-red-200">{errorSummary ?? 'Check events below for step-level details.'}</div>{props.selectedRun.error ? <pre className="mt-2 max-h-48 overflow-auto text-xs text-red-100/80">{JSON.stringify(props.selectedRun.error, null, 2)}</pre> : null}</div> : null}
            {queueRefs.length ? <QueueRefsPanel refs={queueRefs} /> : null}
            <div><h3 className="font-medium">Events</h3><div className="mt-2 max-h-96 space-y-2 overflow-auto">{props.events.map((event) => <div key={event.id} className={`rounded border p-2 ${event.level === 'error' ? 'border-red-900 bg-red-950/20' : event.level === 'warn' ? 'border-amber-900 bg-amber-950/20' : 'border-zinc-800'}`}><div className="text-xs text-zinc-500">#{event.eventIndex} {event.eventType} {event.stepId ? `· ${event.stepId}` : ''} · {event.level}</div><div>{event.message}</div>{event.data ? <pre className="mt-1 overflow-auto text-xs text-zinc-400">{JSON.stringify(event.data, null, 2)}</pre> : null}</div>)}</div></div>
          </> : <p className="text-zinc-400">No workflow runs yet.</p>}
        </div>
      </div>
    </section>
  );
}


function QueueRefsPanel(props: { refs: WorkflowQueueRef[] }) {
  return (
    <div>
      <h3 className="font-medium">VK queue/session refs</h3>
      <div className="mt-2 space-y-2">
        {props.refs.map((ref) => (
          <div key={`${ref.label}-${ref.workspaceId ?? ''}-${ref.sessionId ?? ''}-${ref.queueItemId ?? ''}-${ref.agentId ?? ''}`} className="rounded bg-zinc-950 p-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div><span className="font-medium">{ref.displayName ?? ref.label}</span>{ref.role ? <span className="text-zinc-500"> · {ref.role}</span> : null}</div>
              <QueueStatusBadge status={ref.status} />
            </div>
            <div className="mt-1 grid gap-1 text-xs text-zinc-400 md:grid-cols-3">
              <span className="break-all">queue {ref.queueItemId ?? '—'}</span>
              <span className="break-all">session {ref.sessionId ?? '—'}</span>
              <span className="break-all">workspace {ref.workspaceId ?? '—'}</span>
            </div>
            <VkSessionLink workspaceId={ref.workspaceId} sessionId={ref.sessionId} />
          </div>
        ))}
      </div>
    </div>
  );
}

function RunStatusBadge({ status }: { status: WorkflowRunReadModel['status'] }) {
  const className = status === 'completed' ? 'border-emerald-800 bg-emerald-950/40 text-emerald-200' : status === 'failed' ? 'border-red-800 bg-red-950/40 text-red-200' : 'border-cyan-800 bg-cyan-950/40 text-cyan-200';
  return <span className={`rounded border px-2 py-0.5 text-xs ${className}`}>{workflowStatusLabel(status)}</span>;
}

function QueueStatusBadge({ status }: { status: WorkflowQueueRef['status'] }) {
  const label = status === 'queued' ? 'Queued' : status === 'running' ? 'Running' : status === 'failed' ? 'Failed' : status === 'cancelled' ? 'Cancelled' : 'Unknown';
  const className = status === 'queued' ? 'border-cyan-800 bg-cyan-950/40 text-cyan-200' : status === 'running' ? 'border-emerald-800 bg-emerald-950/40 text-emerald-200' : status === 'failed' ? 'border-red-800 bg-red-950/40 text-red-200' : status === 'cancelled' ? 'border-amber-800 bg-amber-950/40 text-amber-200' : 'border-zinc-700 bg-zinc-900 text-zinc-300';
  return <span className={`rounded border px-2 py-0.5 text-xs ${className}`}>{label}</span>;
}

function formatWorkflowLaunchCatch(caught: unknown): string {
  if (caught instanceof WorkflowLaunchRequestError && !caught.persistedRun) {
    return `Validation or request failed before a workflow run was persisted: ${caught.message}`;
  }
  if (caught instanceof Error) return caught.message;
  return String(caught);
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
