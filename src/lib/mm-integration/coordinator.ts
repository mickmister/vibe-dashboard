import {
  buildIssueTitleFromCommandText,
  buildRootPostGuidanceMessage,
  buildSessionRootPostMessage,
  buildSlashCommandAck,
  buildSlashCommandUsage,
  buildWorkspaceChannelName,
  buildWorkspaceDisplayName,
} from './reconcile';
import type {
  MattermostCoordinator,
  MattermostCoordinatorDeps,
  MattermostPostEvent,
  MattermostSlashCommandRequest,
  MattermostSlashCommandResponse,
  VkWebhookEvent,
  VkWorkspaceRepo,
  VkWorkspaceSummary,
} from './types';

const PROVIDER = 'mattermost' as const;
const MATTERMOST_TEAM_NAME_MIN_LENGTH = 2;
const MATTERMOST_TEAM_NAME_MAX_LENGTH = 64;

function slugifyMattermostName(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');

  let normalized = slug || 'vk';

  if (!/^[a-z]/.test(normalized)) {
    normalized = `vk-${normalized}`;
  }

  if (normalized.length < MATTERMOST_TEAM_NAME_MIN_LENGTH) {
    normalized = `${normalized}k`;
  }

  return normalized
    .slice(0, MATTERMOST_TEAM_NAME_MAX_LENGTH)
    .replace(/-+$/g, '') || 'vk';
}

function mattermostNameWithSuffix(base: string, suffix: string): string {
  const normalizedSuffix = slugifyMattermostName(suffix);
  const trimmedSuffix = normalizedSuffix.slice(
    Math.max(0, normalizedSuffix.length - 8),
  );
  const maxBaseLength =
    MATTERMOST_TEAM_NAME_MAX_LENGTH - trimmedSuffix.length - 1;
  const trimmedBase = base.slice(0, Math.max(2, maxBaseLength)).replace(/-+$/g, '');
  return `${trimmedBase}-${trimmedSuffix}`
    .slice(0, MATTERMOST_TEAM_NAME_MAX_LENGTH)
    .replace(/-+$/g, '');
}

function repoSortKey(repo: VkWorkspaceRepo): string {
  return (repo.displayName || repo.name || repo.id).trim().toLowerCase();
}

function sortWorkspaceRepos(repos: VkWorkspaceRepo[]): VkWorkspaceRepo[] {
  return [...repos].sort((left, right) => {
    const byName = repoSortKey(left).localeCompare(repoSortKey(right));
    return byName || left.id.localeCompare(right.id);
  });
}

function repoDisplayName(repo: VkWorkspaceRepo): string {
  return repo.displayName?.trim() || repo.name.trim() || repo.id;
}

function defaultLogger() {
  return console;
}

function resolveMattermostSpace(input: {
  payload: MattermostSlashCommandRequest;
  defaultTeamId?: string | null;
}): {
  spaceId: string;
  spaceLabel: string | null;
} {
  const payloadTeamId = input.payload.teamId.trim();
  if (payloadTeamId) {
    return {
      spaceId: payloadTeamId,
      spaceLabel: input.payload.teamDomain.trim() || null,
    };
  }

  const defaultTeamId = input.defaultTeamId?.trim();
  if (defaultTeamId) {
    return {
      spaceId: defaultTeamId,
      spaceLabel: null,
    };
  }

  throw new Error('Mattermost team selection was missing from both payload and config');
}

export class DefaultMattermostCoordinator implements MattermostCoordinator {
  private started = false;
  private readonly runningSessionIds = new Set<string>();
  private readonly logger;

  constructor(private readonly deps: MattermostCoordinatorDeps) {
    this.logger = deps.logger ?? defaultLogger();
  }

  async ensureStarted(): Promise<void> {
    if (this.started) {
      return;
    }

    await this.deps.store.ensureSchema();
    this.started = true;
  }

  observeWorkspaceSummaries(summaries: VkWorkspaceSummary[]): void {
    this.runningSessionIds.clear();

    for (const summary of summaries) {
      if (
        summary.latestSessionId &&
        summary.latestProcessStatus === 'running'
      ) {
        this.runningSessionIds.add(summary.latestSessionId);
      }
    }
  }

  async handleSlashCommand(
    payload: MattermostSlashCommandRequest
  ): Promise<MattermostSlashCommandResponse> {
    await this.ensureStarted();

    const prompt = payload.text.trim();
    if (!prompt) {
      return {
        responseType: 'ephemeral',
        text: buildSlashCommandUsage(payload.command || '/vibe'),
      };
    }

    const issue = await this.deps.vkClient.createRemoteIssue({
      title: buildIssueTitleFromCommandText(prompt),
      description: prompt,
      projectId: this.deps.config.vk.defaultProjectId,
      statusId: this.deps.config.vk.defaultIssueStatusId,
    });

    const startedWorkspace = await this.deps.vkClient.startWorkspace({
      name: issue.title,
      prompt,
      repos: [
        {
          repoId: this.deps.config.vk.defaultRepoId,
          targetBranch: this.deps.config.vk.defaultRepoBranch,
        },
      ],
      linkedIssue: {
        issueId: issue.id,
        remoteProjectId: issue.projectId,
      },
      executorConfig: {
        executor: this.deps.config.vk.defaultExecutor,
        variant: this.deps.config.vk.defaultExecutorVariant ?? null,
      },
    });

    const workspace = startedWorkspace.workspace;
    const sessionId = startedWorkspace.executionProcess.sessionId;

    let mapping = await this.deps.store.getWorkspaceBinding(workspace.id);
    if (!mapping) {
      const targetSpace = resolveMattermostSpace({
        payload,
        defaultTeamId: this.deps.config.mattermost.teamId,
      });
      const channelName = buildWorkspaceChannelName({
        prefix: this.deps.config.mattermost.channelPrefix,
        workspace,
        issue,
      });
      const displayName = buildWorkspaceDisplayName({ workspace, issue });
      const channel = await this.deps.mattermostClient.createChannel({
        teamId: targetSpace.spaceId,
        name: channelName,
        displayName,
        purpose: issue.title,
      });

      mapping = await this.deps.store.upsertWorkspaceBinding({
        workspaceId: workspace.id,
        provider: PROVIDER,
        spaceId: targetSpace.spaceId,
        spaceLabel: targetSpace.spaceLabel,
        channelId: channel.id,
        channelName: channel.name,
      });
    }

    let sessionThread = await this.deps.store.getSessionThreadBinding(sessionId);
    if (!sessionThread) {
      const rootPost = await this.deps.mattermostClient.createPost({
        channelId: mapping.channelId,
        message: buildSessionRootPostMessage({
          issue,
          workspace,
          prompt,
        }),
        props: {
          vk_bridge_origin: 'mattermost-bot',
          vk_workspace_id: workspace.id,
          vk_session_id: sessionId,
        },
      });

      sessionThread = await this.deps.store.upsertSessionThreadBinding({
        sessionId,
        workspaceId: workspace.id,
        provider: PROVIDER,
        channelId: mapping.channelId,
        threadId: rootPost.postId,
      });
    }

    this.logger.info(
      `[mattermost] started workspace ${workspace.id} from slash command in channel ${payload.channelId}`
    );

    return {
      responseType: 'ephemeral',
      text: buildSlashCommandAck({
        request: payload,
        workspace,
      }),
    };
  }

  async handlePost(event: MattermostPostEvent): Promise<void> {
    await this.ensureStarted();

    if (event.isBotPost || !event.message.trim()) {
      return;
    }

    if (!event.rootId) {
      const workspaceChannel =
        await this.deps.store.getWorkspaceBindingByChannelId(
        PROVIDER,
          event.channelId
        );

      if (!workspaceChannel) {
        return;
      }

      await this.deps.mattermostClient.createEphemeralPost({
        userId: event.userId,
        channelId: event.channelId,
        message: buildRootPostGuidanceMessage('/vibe'),
      });
      return;
    }

    const thread = await this.deps.store.getSessionThreadBindingByThreadId(
      PROVIDER,
      event.rootId
    );
    if (!thread) {
      return;
    }

    const followUpInput = {
      message: event.message.trim(),
      executorConfig: {
        executor: this.deps.config.vk.defaultExecutor,
        variant: this.deps.config.vk.defaultExecutorVariant ?? null,
      },
    };

    if (this.runningSessionIds.has(thread.sessionId)) {
      await this.deps.vkClient.queueFollowUp(thread.sessionId, followUpInput);
    } else {
      await this.deps.vkClient.followUp(thread.sessionId, followUpInput);
    }
  }

  async handleVkWebhook(
    event: VkWebhookEvent
  ): Promise<{ duplicate: boolean; posted: boolean }> {
    await this.ensureStarted();

    const idempotencyKey = `vk-webhook-delivery:${event.deliveryId}`;

    this.observeVkWebhookExecutionState(event);

    const target = await this.resolveWebhookPostTarget(event);
    if (!target) {
      this.logger.warn(
        `[mattermost] no Mattermost mapping for VK webhook delivery ${event.deliveryId}`
      );
      return { duplicate: false, posted: false };
    }

    const reserved = await this.deps.store.tryReserveConnectorState(
      idempotencyKey,
      {
        status: 'processing',
        reservedAt: new Date().toISOString(),
        deliveryId: event.deliveryId,
      },
    );
    if (!reserved) {
      return { duplicate: true, posted: false };
    }

    let post;
    try {
      post = await this.deps.mattermostClient.createPost({
        channelId: target.channelId,
        rootId: target.rootId,
        message: buildVkWebhookMattermostMessage(event),
        props: {
          vk_bridge_origin: 'vk-webhook',
          vk_webhook_delivery_id: event.deliveryId,
          vk_event_type: event.eventType,
          vk_workspace_id: event.workspaceId,
          vk_session_id: event.sessionId,
          vk_execution_id: event.executionId,
        },
      });
    } catch (error) {
      await this.deps.store.deleteConnectorState(idempotencyKey);
      throw error;
    }

    await this.deps.store.setConnectorState(idempotencyKey, {
      status: 'processed',
      processedAt: new Date().toISOString(),
      posted: true,
      postId: post.postId,
    });

    if (event.executionId && event.sessionId) {
      await this.deps.store.upsertExecutionPostBinding({
        executionId: event.executionId,
        sessionId: event.sessionId,
        provider: PROVIDER,
        channelId: post.channelId,
        messageId: post.postId,
        idempotencyKey,
      });
    }

    if (event.sessionId && event.workspaceId && !target.existingThread) {
      await this.deps.store.upsertSessionThreadBinding({
        sessionId: event.sessionId,
        workspaceId: event.workspaceId,
        provider: PROVIDER,
        channelId: post.channelId,
        threadId: post.postId,
      });
    }

    return { duplicate: false, posted: true };
  }

  private observeVkWebhookExecutionState(event: VkWebhookEvent): void {
    if (!event.sessionId) {
      return;
    }

    if (event.eventType === 'execution.started') {
      this.runningSessionIds.add(event.sessionId);
      return;
    }

    if (
      event.eventType === 'execution.completed' ||
      event.eventType === 'execution.failed' ||
      event.eventType === 'execution.cancelled' ||
      event.eventType === 'execution.halted'
    ) {
      this.runningSessionIds.delete(event.sessionId);
    }
  }

  private async resolveWebhookPostTarget(event: VkWebhookEvent): Promise<{
    channelId: string;
    rootId: string | null;
    existingThread: boolean;
  } | null> {
    if (event.sessionId) {
      const thread = await this.deps.store.getSessionThreadBinding(
        event.sessionId
      );
      if (thread) {
        return {
          channelId: thread.channelId,
          rootId: thread.threadId,
          existingThread: true,
        };
      }
    }

    if (event.workspaceId) {
      const workspace = await this.ensureWorkspaceChannelBinding(
        event.workspaceId,
      );
      if (workspace) {
        return {
          channelId: workspace.channelId,
          rootId: null,
          existingThread: false,
        };
      }
    }

    return null;
  }

  private async ensureWorkspaceChannelBinding(workspaceId: string) {
    const existing = await this.deps.store.getWorkspaceBinding(workspaceId);
    if (existing) {
      return existing;
    }

    const repos = sortWorkspaceRepos(
      await this.deps.vkClient.listWorkspaceRepos(workspaceId),
    );
    if (repos.length === 0) {
      this.logger.warn(
        `[mattermost] cannot create Mattermost channel for workspace ${workspaceId}: no repos found`,
      );
      return null;
    }

    const targetSpace = await this.resolveSpaceForRepos(repos);
    const workspace = (await this.deps.vkClient.listWorkspaces()).find(
      (candidate) => candidate.id === workspaceId,
    );
    const displayName = workspace?.name?.trim() || workspaceId;
    const channel = await this.deps.mattermostClient.createChannel({
      teamId: targetSpace.spaceId,
      name: buildWorkspaceChannelName({
        prefix: this.deps.config.mattermost.channelPrefix,
        workspace: {
          id: workspaceId,
          name: displayName,
        },
        issue: {
          title: displayName,
        },
      }),
      displayName,
      purpose: `VK workspace ${workspaceId}`,
    });

    return this.deps.store.upsertWorkspaceBinding({
      workspaceId,
      provider: PROVIDER,
      spaceId: targetSpace.spaceId,
      spaceLabel: targetSpace.spaceLabel,
      channelId: channel.id,
      channelName: channel.name,
    });
  }

  private async resolveSpaceForRepos(repos: VkWorkspaceRepo[]): Promise<{
    spaceId: string;
    spaceLabel: string | null;
  }> {
    const routes = (await this.deps.store.listRepoChatRoutes(PROVIDER)).filter(
      (route) => route.enabled,
    );

    for (const repo of repos) {
      const route = routes.find((candidate) => candidate.repoId === repo.id);
      if (route) {
        return {
          spaceId: route.spaceId,
          spaceLabel: route.spaceLabel,
        };
      }
    }

    const firstRepo = repos[0];
    if (!firstRepo) {
      throw new Error('Cannot resolve Mattermost team without workspace repos');
    }

    const space = await this.ensureRepoTeam(firstRepo);
    const route = await this.deps.store.upsertRepoChatRoute({
      repoId: firstRepo.id,
      provider: PROVIDER,
      spaceId: space.spaceId,
      spaceLabel: space.spaceLabel,
      priority: 0,
      enabled: true,
    });

    return {
      spaceId: route.spaceId,
      spaceLabel: route.spaceLabel,
    };
  }

  private async ensureRepoTeam(repo: VkWorkspaceRepo): Promise<{
    spaceId: string;
    spaceLabel: string;
  }> {
    const displayName = repoDisplayName(repo);
    const desiredName = slugifyMattermostName(displayName);
    const teams = await this.deps.mattermostClient.listTeams();
    const existing = teams.find((team) => team.name === desiredName);
    if (existing) {
      return {
        spaceId: existing.id,
        spaceLabel: existing.displayName || existing.name,
      };
    }

    let created;
    try {
      created = await this.deps.mattermostClient.createTeam({
        name: desiredName,
        displayName,
      });
    } catch (error) {
      const fallbackName = mattermostNameWithSuffix(desiredName, repo.id);
      this.logger.warn(
        `[mattermost] failed to create team ${desiredName}; retrying with deterministic suffix ${fallbackName}`,
      );
      created = await this.deps.mattermostClient.createTeam({
        name: fallbackName,
        displayName,
      });
    }

    return {
      spaceId: created.id,
      spaceLabel: created.displayName || created.name,
    };
  }

  async getHealth() {
    await this.ensureStarted();

    return {
      ok: true,
      ready: this.started,
      runningSessionCount: this.runningSessionIds.size,
    };
  }
}

function buildVkWebhookMattermostMessage(event: VkWebhookEvent): string {
  const lines = [
    `**${event.title}**`,
    event.message,
    '',
    `Event: \`${event.eventType}\``,
  ];

  if (event.taskTitle) {
    lines.push(`Task: ${event.taskTitle}`);
  }
  if (event.projectName) {
    lines.push(`Project: ${event.projectName}`);
  }
  if (event.exitCode !== null) {
    lines.push(`Exit code: ${event.exitCode}`);
  }
  if (event.executionId) {
    lines.push(`Execution: \`${event.executionId}\``);
  }

  return lines.join('\n');
}

export function createMattermostCoordinator(
  deps: MattermostCoordinatorDeps
): MattermostCoordinator {
  return new DefaultMattermostCoordinator(deps);
}
