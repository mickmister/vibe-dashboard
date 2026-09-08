#!/usr/bin/env node
// Vibe Kanban CLI
// Manages workspaces, sessions, and read-only inspection commands

import { fileURLToPath } from 'url';
import { VKService, type PullRequestDetail, type WorkspaceRepoInput } from './vk-service.js';
import { config, type Executor } from './vk-config.js';

const service = new VKService();

type FlagValue = string | boolean | string[];
type FlagMap = Record<string, FlagValue>;

function parseArgs() {
  const args = process.argv.slice(2);
  const command = args[0];
  const positional: string[] = [];
  const flags: FlagMap = {};

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const nextArg = args[i + 1];
      if (nextArg && !nextArg.startsWith('--')) {
        const existing = flags[key];
        if (Array.isArray(existing)) {
          existing.push(nextArg);
        } else if (existing !== undefined) {
          flags[key] = [String(existing), nextArg];
        } else {
          flags[key] = nextArg;
        }
        i++;
      } else {
        const existing = flags[key];
        if (Array.isArray(existing)) {
          existing.push('true');
        } else if (existing !== undefined) {
          flags[key] = [String(existing), 'true'];
        } else {
          flags[key] = true;
        }
      }
    } else {
      positional.push(arg);
    }
  }

  return { command, positional, flags };
}

async function main() {
  const { command, positional, flags } = parseArgs();

  try {
    switch (command) {
      case 'projects':
        throw new Error('vk projects has been removed from Vibe Kanban. Use the Vibe Kanban UI instead.');
        break;

      case 'create-project':
        throw new Error('vk create-project has been removed from this CLI. Use the Vibe Kanban UI instead.');
        break;

      case 'tasks':
        throw new Error('vk tasks has been removed from Vibe Kanban. Use the Vibe Kanban UI instead.');
        break;

      case 'create-task':
        throw new Error('vk create-task has been removed from this CLI. Use the Vibe Kanban UI instead.');
        break;

      case 'workspace':
        await commandWorkspace(positional, flags);
        break;

      case 'create-workspace':
        await commandCreateWorkspace(positional, flags);
        break;

      case 'repos':
        await commandRepos(flags);
        break;

      case 'repo':
        await commandRepo(positional[0], flags);
        break;

      case 'workspace-repos':
        await commandWorkspaceRepos(positional[0], flags);
        break;

      case 'dev-script':
        await commandDevScript(positional, flags);
        break;

      case 'dev-server':
        await commandDevServer(positional, flags);
        break;

      case 'sessions':
        await commandSessions(positional[0]);
        break;

      case 'status':
        await commandStatus(positional);
        break;

      case 'processes':
        await commandProcesses(positional[0]);
        break;

      case 'fetch':
        await commandFetch(positional[0], flags);
        break;

      case 'create-session':
        await commandCreateSession(positional[0], positional[1]);
        break;

      case 'send':
        await commandSend(positional[0], positional[1]);
        break;

      case 'summary':
        await commandSummary(flags);
        break;

      case 'help':
      case '--help':
      case '-h':
      case undefined:
        printHelp();
        break;

      default:
        console.error(`Unknown command: ${command}`);
        console.error('Run "vk help" for usage information.');
        process.exit(1);
    }
  } catch (err) {
    if (err instanceof Error) {
      console.error('Error:', err.message);
    } else {
      console.error('Error:', err);
    }
    process.exit(1);
  }
}

function getFlagString(flags: FlagMap, key: string): string | undefined {
  const value = flags[key];
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value[value.length - 1];
  return undefined;
}

function getFlagStrings(flags: FlagMap, key: string): string[] {
  const value = flags[key];
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value;
  return [];
}

function isExecutor(value: string): value is Executor {
  return Object.prototype.hasOwnProperty.call(config.executors, value);
}

function parseRepoSpec(spec: string): { repoId: string; targetBranch?: string } {
  const separator = spec.indexOf(':');
  if (separator === -1) {
    return { repoId: spec };
  }

  return {
    repoId: spec.slice(0, separator),
    targetBranch: spec.slice(separator + 1),
  };
}


export interface ParsedPrUrl {
  url: string;
  prNumber: number;
  slug?: string;
}

export function parsePullRequestUrl(value: string): ParsedPrUrl | null {
  try {
    const url = new URL(value);
    const githubMatch = url.pathname.match(/^\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:\/.*)?$/);
    if (githubMatch) {
      return {
        url: value,
        prNumber: Number(githubMatch[3]),
        slug: `${githubMatch[1].toLowerCase()}/${githubMatch[2].replace(/\.git$/, '').toLowerCase()}`,
      };
    }

    const gitlabMatch = url.pathname.match(/^\/(.+)\/-\/merge_requests\/(\d+)(?:\/.*)?$/);
    if (gitlabMatch) {
      return {
        url: value,
        prNumber: Number(gitlabMatch[2]),
        slug: gitlabMatch[1].replace(/\.git$/, '').toLowerCase(),
      };
    }
  } catch {
    return null;
  }

  return null;
}

function remoteSlug(remoteUrl: string): string | null {
  const cleaned = remoteUrl.replace(/\.git$/, '');
  try {
    const parsed = new URL(cleaned);
    const parts = parsed.pathname.replace(/^\/+/, '').split('/').filter(Boolean);
    if (parts.length >= 2) return parts.slice(-2).join('/').toLowerCase();
  } catch {
    const sshMatch = cleaned.match(/^[^@]+@[^:]+:(.+)$/);
    if (sshMatch) {
      const parts = sshMatch[1].split('/').filter(Boolean);
      if (parts.length >= 2) return parts.slice(-2).join('/').toLowerCase();
    }
  }
  return null;
}

function boolFlag(flags: FlagMap, key: string, defaultValue: boolean): boolean {
  const value = flags[key];
  if (value === undefined) return defaultValue;
  if (value === true) return true;
  const str = Array.isArray(value) ? String(value[value.length - 1]) : String(value);
  return !['false', '0', 'no', 'off'].includes(str.toLowerCase());
}

// Command implementations

function printRepo(repo: Awaited<ReturnType<VKService['getRepo']>>) {
  console.log(`Repo:        ${repo.id}`);
  console.log(`Name:        ${repo.display_name || repo.name}`);
  console.log(`Path:        ${repo.path}`);
  console.log(`Dev Script:  ${repo.dev_server_script || '(none)'}`);
}

function printProcess(proc: any) {
  const action = proc.executor_action?.typ ?? {};
  console.log(`Process:     ${proc.id}`);
  console.log(`Session:     ${proc.session_id}`);
  console.log(`Status:      ${proc.status}`);
  console.log(`Run Reason:  ${proc.run_reason || '(unknown)'}`);
  console.log(`Created:     ${proc.created_at}`);
  console.log(`Completed:   ${proc.completed_at || '(running)'}`);
  if (action.working_dir) console.log(`Working Dir: ${action.working_dir}`);
  if (action.script) console.log(`Script:      ${action.script}`);
}


async function commandWorkspace(positional: string[], flags: FlagMap) {
  const subcommand = positional[0];
  switch (subcommand) {
    case 'create-from-pr':
      await commandWorkspaceCreateFromPr(positional.slice(1), flags);
      break;
    default:
      console.error('Usage: vk workspace <create-from-pr> ...');
      console.error('Example: vk workspace create-from-pr --repo <repo-id> --remote origin --pr 123');
      process.exit(1);
  }
}

async function findRepoAndRemoteForPrUrl(prUrl: ParsedPrUrl, requestedRemote?: string): Promise<{ repoId: string; remoteName?: string }> {
  if (!prUrl.slug) {
    throw new Error('Could not infer repository from PR URL; pass --repo <repo-id>.');
  }

  const matches: { repoId: string; remoteName: string }[] = [];
  const repos = await service.listRepos();
  for (const repo of repos) {
    let remotes;
    try {
      remotes = await service.listRepoRemotes(repo.id);
    } catch {
      continue;
    }
    for (const remote of remotes) {
      if (requestedRemote && remote.name !== requestedRemote) continue;
      if (remoteSlug(remote.url) === prUrl.slug) {
        matches.push({ repoId: repo.id, remoteName: remote.name });
      }
    }
  }

  if (matches.length === 0) {
    throw new Error(`No configured Vibe Kanban repo remote matches ${prUrl.slug}; pass --repo <repo-id>.`);
  }
  if (matches.length > 1) {
    throw new Error(`Multiple configured repo remotes match ${prUrl.slug}; pass --repo <repo-id>${requestedRemote ? '' : ' and --remote <name>'}.`);
  }
  return matches[0];
}

async function commandWorkspaceCreateFromPr(positional: string[], flags: FlagMap) {
  const urlFlag = getFlagString(flags, 'url') ?? getFlagString(flags, 'pr-url');
  const repoFlag = getFlagString(flags, 'repo');
  const remoteFlag = getFlagString(flags, 'remote') ?? getFlagString(flags, 'remote-name');
  const prFlag = getFlagString(flags, 'pr') ?? getFlagString(flags, 'pr-number');

  const urlArg = positional.find(arg => parsePullRequestUrl(arg));
  const prUrl = urlFlag ? parsePullRequestUrl(urlFlag) : (urlArg ? parsePullRequestUrl(urlArg) : null);
  const nonUrlPositionals = positional.filter(arg => arg !== urlArg);

  let repoId: string | undefined = repoFlag ?? nonUrlPositionals[0];
  let remoteName: string | undefined = remoteFlag ?? nonUrlPositionals[1];
  let prNumber = prFlag ? Number(prFlag) : Number(nonUrlPositionals[2]);

  let pr: PullRequestDetail;
  if (prUrl) {
    prNumber = prUrl.prNumber;
    if (!repoId) {
      const match = await findRepoAndRemoteForPrUrl(prUrl, remoteName);
      repoId = match.repoId;
      remoteName = match.remoteName;
    }
    pr = await service.getPrInfo(prUrl.url);
  } else {
    if (!repoId || !remoteName || !Number.isInteger(prNumber) || prNumber <= 0) {
      console.error('Usage: vk workspace create-from-pr --repo <repo-id> --remote <remote-name> --pr <number> [--no-setup] [--json]');
      console.error('       vk workspace create-from-pr <repo-id> <remote-name> <pr-number> [--no-setup] [--json]');
      console.error('       vk workspace create-from-pr <pr-url> [--repo <repo-id>] [--remote <remote-name>] [--no-setup] [--json]');
      process.exit(1);
    }
    const prs = await service.listOpenPrs(repoId, remoteName);
    const found = prs.find(candidate => Number(candidate.number) === prNumber);
    if (!found) {
      throw new Error(`PR #${prNumber} was not found among open pull requests for repo ${repoId} remote ${remoteName}.`);
    }
    pr = found;
  }

  if (!repoId || !Number.isInteger(prNumber) || prNumber <= 0) {
    throw new Error('Missing repo or valid PR number.');
  }

  const result = await service.createWorkspaceFromPr({
    repo_id: repoId,
    pr_number: prNumber,
    pr_title: pr.title,
    pr_url: pr.url,
    head_branch: pr.head_branch,
    base_branch: pr.base_branch,
    run_setup: flags['no-setup'] === true ? false : boolFlag(flags, 'run-setup', true),
    remote_name: remoteName ?? null,
  });

  if (flags.json === true) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  const workspace = result.workspace;
  console.log('Workspace created from PR:');
  console.log(`  ID:        ${workspace.id}`);
  console.log(`  Name:      ${workspace.name || pr.title}`);
  console.log(`  PR:        #${prNumber} ${pr.url}`);
  console.log(`  Branch:    ${workspace.branch || pr.head_branch}`);
  console.log(`  Container: ${workspace.container_ref || '(pending)'}`);
  console.log('');
  console.log('To check status:');
  console.log(`  vk status ${workspace.id}`);
}

async function commandCreateWorkspace(positional: string[], flags: FlagMap) {
  const message = getFlagString(flags, 'message') ?? getFlagString(flags, 'prompt') ?? positional.join(' ').trim();
  const repoSpecs = getFlagStrings(flags, 'repo');
  const executorValue = getFlagString(flags, 'executor') ?? 'CODEX';
  const variant = getFlagString(flags, 'variant');

  if (!message || repoSpecs.length === 0) {
    console.error('Usage: vk create-workspace --message "prompt" --repo <repo-id[:target-branch]> [--repo <repo-id[:target-branch]>...] [--executor <executor>] [--variant <variant>] [--json]');
    console.error('');
    console.error('Examples:');
    console.error('  vk create-workspace --message "Implement feature X" --repo e63a1dae-fb15-4f69-a28a-e739cb8c4de5:main');
    console.error('  vk create-workspace "Implement feature X" --repo e63a1dae-fb15-4f69-a28a-e739cb8c4de5 --executor CODEX');
    process.exit(1);
  }

  if (!isExecutor(executorValue)) {
    console.error(`Invalid executor: ${executorValue}`);
    console.error(`Valid executors: ${Object.keys(config.executors).join(', ')}`);
    process.exit(1);
  }

  const repos: WorkspaceRepoInput[] = [];
  for (const spec of repoSpecs) {
    const parsed = parseRepoSpec(spec);
    if (!parsed.repoId) {
      console.error(`Invalid repo spec: ${spec}`);
      process.exit(1);
    }

    let targetBranch = parsed.targetBranch;
    if (!targetBranch) {
      const repo = await service.getRepo(parsed.repoId);
      targetBranch = repo.default_target_branch || 'main';
    }

    repos.push({ repo_id: parsed.repoId, target_branch: targetBranch });
  }

  const executor_config = variant
    ? { executor: executorValue, variant }
    : { executor: executorValue };

  const result = await service.startWorkspace({
    message,
    repos,
    executor_config,
    linked_issue: null,
    attachments: [],
  });

  if (flags.json === true) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  const workspace = result.workspace;
  console.log('Workspace created:');
  console.log(`  ID:        ${workspace.id}`);
  console.log(`  Name:      ${workspace.name || '(none)'}`);
  console.log(`  Branch:    ${workspace.branch || '(unknown)'}`);
  console.log(`  Container: ${workspace.container_ref || '(pending)'}`);
  if (result.session?.id) {
    console.log(`  Session:   ${result.session.id}`);
  }
  if (result.execution_process?.id) {
    console.log(`  Process:   ${result.execution_process.id}`);
  }
  console.log('');
  console.log('To check status:');
  console.log(`  vk status ${workspace.id}`);
}

async function commandRepos(flags: FlagMap) {
  const repos = await service.listRepos({ recent: flags.recent === true });
  if (flags.json === true) {
    console.log(JSON.stringify(repos, null, 2));
    return;
  }
  if (repos.length === 0) {
    console.log('No repositories found.');
    return;
  }
  console.log(flags.recent === true ? 'Recent repositories:' : 'Repositories:');
  console.log('='.repeat(80));
  for (const repo of repos) {
    printRepo(repo);
    console.log('');
  }
}

async function commandRepo(repoId: string, flags: FlagMap) {
  if (!repoId) {
    console.error('Usage: vk repo <repo-id> [--json]');
    process.exit(1);
  }
  const repo = await service.getRepo(repoId);
  if (flags.json === true) {
    console.log(JSON.stringify(repo, null, 2));
    return;
  }
  printRepo(repo);
}

async function commandWorkspaceRepos(workspaceId: string, flags: FlagMap) {
  if (!workspaceId) {
    console.error('Usage: vk workspace-repos <workspace-id> [--json]');
    process.exit(1);
  }
  const repos = await service.getWorkspaceRepos(workspaceId);
  if (flags.json === true) {
    console.log(JSON.stringify(repos, null, 2));
    return;
  }
  if (repos.length === 0) {
    console.log('No repositories found for this workspace.');
    return;
  }
  console.log(`Repositories for workspace ${workspaceId.substring(0, 8)}...:`);
  console.log('='.repeat(80));
  for (const repo of repos) {
    printRepo(repo);
    console.log(`Target:      ${repo.target_branch}`);
    console.log('');
  }
}

async function commandDevScript(positional: string[], flags: FlagMap) {
  const subcommand = positional[0];
  const repoId = positional[1];

  if (!subcommand || !['get', 'set', 'clear'].includes(subcommand) || !repoId) {
    console.error('Usage: vk dev-script <get|set|clear> <repo-id> [script] [--json]');
    console.error('Examples:');
    console.error('  vk dev-script get <repo-id>');
    console.error('  vk dev-script set <repo-id> "pnpm dev --host 0.0.0.0"');
    console.error('  vk dev-script clear <repo-id>');
    process.exit(1);
  }

  if (subcommand === 'get') {
    const repo = await service.getRepo(repoId);
    if (flags.json === true) {
      console.log(JSON.stringify({ repo_id: repo.id, dev_server_script: repo.dev_server_script ?? null }, null, 2));
    } else {
      console.log(repo.dev_server_script || '(none)');
    }
    return;
  }

  const script = subcommand === 'clear' ? null : positional.slice(2).join(' ').trim();
  if (subcommand === 'set' && !script) {
    console.error('Usage: vk dev-script set <repo-id> "script"');
    process.exit(1);
  }

  const repo = await service.setDevServerScript(repoId, script || null);
  if (flags.json === true) {
    console.log(JSON.stringify(repo, null, 2));
    return;
  }
  console.log(subcommand === 'clear' ? 'Dev server script cleared:' : 'Dev server script updated:');
  printRepo(repo);
}

async function commandDevServer(positional: string[], flags: FlagMap) {
  const subcommand = positional[0];

  switch (subcommand) {
    case 'start': {
      const workspaceId = positional[1];
      if (!workspaceId) {
        console.error('Usage: vk dev-server start <workspace-id> [--json]');
        process.exit(1);
      }
      const processes = await service.startDevServer(workspaceId);
      if (flags.json === true) {
        console.log(JSON.stringify(processes, null, 2));
        return;
      }
      if (processes.length === 0) {
        console.log('No dev server processes were started.');
        return;
      }
      console.log(`Started ${processes.length} dev server process(es):`);
      console.log('='.repeat(80));
      for (const proc of processes) {
        printProcess(proc);
        console.log('');
      }
      break;
    }

    case 'list': {
      const workspaceId = positional[1];
      if (!workspaceId) {
        console.error('Usage: vk dev-server list <workspace-id> [--json]');
        process.exit(1);
      }
      const processes = await service.listRunningDevServers(workspaceId);
      if (flags.json === true) {
        console.log(JSON.stringify(processes, null, 2));
        return;
      }
      if (processes.length === 0) {
        console.log('No running dev servers found for this workspace.');
        return;
      }
      console.log(`Running dev servers for workspace ${workspaceId.substring(0, 8)}...:`);
      console.log('='.repeat(80));
      for (const proc of processes) {
        printProcess(proc);
        console.log('');
      }
      break;
    }

    case 'stop': {
      const processId = positional[1];
      if (!processId) {
        console.error('Usage: vk dev-server stop <process-id>');
        process.exit(1);
      }
      await service.stopExecutionProcess(processId);
      console.log(`Stopped dev server process ${processId}`);
      break;
    }

    case 'logs': {
      const processId = positional[1];
      if (!processId) {
        console.error('Usage: vk dev-server logs <process-id> [--json] [--timeout <ms>]');
        process.exit(1);
      }
      const timeout = typeof flags.timeout === 'string' ? Number(flags.timeout) : 2000;
      const logs = await service.fetchRawLogs(processId, Number.isFinite(timeout) ? timeout : 2000);
      if (flags.json === true) {
        console.log(JSON.stringify(logs, null, 2));
        return;
      }
      for (const entry of logs) {
        const prefix = entry.type === 'STDERR' ? '[stderr] ' : '';
        process.stdout.write(prefix + entry.content);
        if (!entry.content.endsWith('\n')) process.stdout.write('\n');
      }
      break;
    }

    default:
      console.error('Usage: vk dev-server <start|list|stop|logs> ...');
      console.error('Examples:');
      console.error('  vk dev-server start <workspace-id>');
      console.error('  vk dev-server list <workspace-id>');
      console.error('  vk dev-server logs <process-id>');
      console.error('  vk dev-server stop <process-id>');
      process.exit(1);
  }
}

async function commandSessions(workspaceId: string) {
  if (!workspaceId) {
    console.error('Usage: vk sessions <workspace-id>');
    process.exit(1);
  }

  const sessions = await service.listSessions(workspaceId);

  if (sessions.length === 0) {
    console.log('No sessions found for this workspace.');
    console.log('');
    console.log('To create a session for review, use:');
    console.log(`  vk create-session ${workspaceId.substring(0, 8)}... CODEX`);
    return;
  }

  console.log(`Sessions for workspace ${workspaceId.substring(0, 8)}...:`);
  console.log('='.repeat(80));

  for (const session of sessions) {
    console.log(`Session:  ${session.id}`);
    console.log(`Executor: ${session.executor}`);
    console.log(`Created:  ${session.created_at}`);
    console.log(`Updated:  ${session.updated_at}`);
    console.log('');
  }
}

async function commandStatus(workspaceIds: string[]) {
  if (workspaceIds.length === 0) {
    console.error('Usage: vk status <workspace-id> [workspace-id...]');
    process.exit(1);
  }

  const summaries = await service.getWorkspaceSummaries(workspaceIds);

  if (summaries.length === 0) {
    console.log('No workspace summaries found for the specified IDs.');
    return;
  }

  console.log('Workspace Status:');
  console.log('='.repeat(80));

  for (const summary of summaries) {
    console.log(`Workspace:      ${summary.workspace_id}`);
    console.log(`Session:        ${summary.latest_session_id || '(none)'}`);
    console.log(`Status:         ${summary.latest_process_status}`);
    console.log(`Completed:      ${summary.latest_process_completed_at || '(running)'}`);
    console.log(`Files Changed:  ${summary.files_changed ?? 'N/A'}`);
    console.log(`Lines +/-:      +${summary.lines_added ?? 0} / -${summary.lines_removed ?? 0}`);
    console.log(`Unseen Turns:   ${summary.has_unseen_turns}`);
    console.log(`PR Status:      ${summary.pr_status || '(none)'}`);
    console.log('');
  }
}

async function commandProcesses(sessionId: string) {
  if (!sessionId) {
    console.error('Usage: vk processes <session-id>');
    process.exit(1);
  }

  const processes = await service.getSessionProcesses(sessionId);

  if (processes.length === 0) {
    console.log('No execution processes found for this session.');
    return;
  }

  console.log(`Execution processes for session ${sessionId.substring(0, 8)}...:`);
  console.log('='.repeat(80));

  for (const proc of processes) {
    const promptSnippet = proc.executor_action?.typ?.prompt?.substring(0, 60) || '(no prompt)';
    console.log(`ID:        ${proc.id}`);
    console.log(`Status:    ${proc.status}`);
    console.log(`Created:   ${proc.created_at}`);
    console.log(`Completed: ${proc.completed_at || '(running)'}`);
    console.log(`Prompt:    ${promptSnippet}...`);
    console.log('');
  }
}

async function commandFetch(processId: string, flags: FlagMap) {
  if (!processId) {
    console.error('Usage: vk fetch <process-id> [--all] [--json]');
    console.error('');
    console.error('Options:');
    console.error('  --all   Show all entry types (thinking, tool_use, etc.)');
    console.error('  --json  Output raw JSON entries');
    process.exit(1);
  }

  const showAll = flags.all === true;
  const jsonOutput = flags.json === true;

  const entries = await service.fetchConversation(processId);

  if (jsonOutput) {
    console.log(JSON.stringify(entries, null, 2));
    return;
  }

  if (entries.length === 0) {
    console.log('No entries found (process may still be running)');
    return;
  }

  for (const entry of entries) {
    const entryType = entry.content?.entry_type?.type;
    const content = entry.content?.content;

    if (showAll) {
      console.log(`=== ${entryType || 'unknown'} ===`);
      if (content) {
        console.log(typeof content === 'string' ? content : JSON.stringify(content));
      }
      console.log('');
    } else if (entryType === 'assistant_message' && content) {
      console.log('=== ASSISTANT MESSAGE ===');
      console.log(content);
      console.log('');
    }
  }
}

async function commandCreateSession(workspaceId: string, executor: string) {
  if (!workspaceId || !executor) {
    console.error('Usage: vk create-session <workspace-id> <executor>');
    console.error('');
    console.error(`Executors: ${Object.keys(config.executors).join(', ')}`);
    process.exit(1);
  }

  if (!isExecutor(executor)) {
    console.error(`Invalid executor: ${executor}`);
    console.error(`Valid executors: ${Object.keys(config.executors).join(', ')}`);
    process.exit(1);
  }

  const session = await service.createSession(workspaceId, executor);

  console.log('Session created:');
  console.log(`  ID:       ${session.id}`);
  console.log(`  Executor: ${session.executor}`);
  console.log('');
  console.log('To send a message to this session:');
  console.log(`  vk send ${session.id} "Your prompt here"`);
}

async function commandSend(sessionId: string, prompt: string) {
  if (!sessionId || !prompt) {
    console.error('Usage: vk send <session-id> "<prompt>"');
    process.exit(1);
  }

  const executionProcess = await service.sendMessage(sessionId, prompt);

  console.log('Message sent:');
  console.log(`  Execution Process: ${executionProcess.id}`);
  console.log(`  Status:            ${executionProcess.status}`);
  console.log(`  Started:           ${executionProcess.created_at}`);
  console.log('');
  console.log('To fetch the conversation:');
  console.log(`  vk fetch ${executionProcess.id}`);
}

async function commandSummary(flags: FlagMap) {
  const workspaceId = flags.workspace;

  if (!workspaceId || typeof workspaceId !== 'string') {
    console.error('Usage: vk summary --workspace <workspace-id>');
    console.error('');
    console.error('Shows latest user and agent messages for each session in the workspace.');
    process.exit(1);
  }

  const summaries = await service.getSessionSummary(workspaceId);

  if (summaries.length === 0) {
    console.log('No sessions found for this workspace.');
    return;
  }

  console.log(`Session Summary for workspace ${workspaceId.substring(0, 8)}...:`);
  console.log('='.repeat(80));
  console.log('');

  for (const summary of summaries) {
    console.log(`Session: ${summary.session.id}`);
    console.log(`Executor: ${summary.session.executor}`);
    console.log(`Updated: ${summary.session.updated_at}`);
    console.log('');

    if (summary.latestUserMessage) {
      console.log('Last User Message:');
      console.log(summary.latestUserMessage);
      console.log('');
    } else {
      console.log('Last User Message: (none)');
      console.log('');
    }

    if (summary.latestAgentMessage) {
      console.log('Last Agent Message:');
      console.log(summary.latestAgentMessage);
      console.log('');
    } else {
      console.log('Last Agent Message: (none)');
      console.log('');
    }

    console.log('-'.repeat(80));
    console.log('');
  }
}

function printHelp() {
  console.log('Vibe Kanban CLI');
  console.log('================');
  console.log('');
  console.log('Usage: vk <command> [options]');
  console.log('');
  console.log('Query Commands:');
  console.log('  repos [--recent] [--json]                  List registered repositories');
  console.log('  repo <repo-id> [--json]                    Show repository details');
  console.log('  workspace-repos <workspace-id> [--json]    List repos attached to workspace');
  console.log('  dev-script get <repo-id> [--json]          Show repo dev server script');
  console.log('  sessions <workspace-id>                    List sessions for workspace');
  console.log('  status <workspace-id>...                   Get workspace status summary');
  console.log('  processes <session-id>                     List execution processes');
  console.log('  fetch <process-id> [--all] [--json]        Fetch conversation logs');
  console.log('  summary --workspace <workspace-id>         Show latest messages per session');
  console.log('');
  console.log('Action Commands:');
  console.log('  dev-script set <repo-id> "<script>"        Update repo dev server script');
  console.log('  dev-script clear <repo-id>                 Clear repo dev server script');
  console.log('  dev-server start <workspace-id> [--json]   Start configured dev server(s)');
  console.log('  dev-server list <workspace-id> [--json]    List running workspace dev servers');
  console.log('  dev-server logs <process-id> [--json]      Fetch raw dev server logs');
  console.log('  dev-server stop <process-id>               Stop a dev server process');
  console.log('  create-session <workspace-id> <executor>   Create new session');
  console.log('  create-workspace --message "prompt" --repo <repo[:branch]>   Create and start workspace');
  console.log('  workspace create-from-pr --repo <repo> --remote <remote> --pr <n>  Create workspace from PR');
  console.log('  send <session-id> "<prompt>"               Send message to session');
  console.log('');
  console.log('Options:');
  console.log('  --all                 Show all entry types in conversation');
  console.log('  --json                Output raw JSON');
  console.log('  --workspace <id>      Specify workspace ID');
  console.log('  --message <prompt>    Initial workspace prompt');
  console.log('  --repo <id[:branch]>  Repository and optional target branch (repeatable)');
  console.log('  --executor <name>     Coding agent executor (default: CODEX)');
  console.log('  --variant <name>      Optional executor variant/profile');
  console.log('  --recent              Use recent repo ordering');
  console.log('  --timeout <ms>        WebSocket log wait time (default: 2000)');
  console.log('');
  console.log(`Executors: ${Object.keys(config.executors).join(', ')}`);
}

const invokedPath = process.argv[1] ?? '';
const isDirectInvocation = invokedPath && fileURLToPath(import.meta.url) === invokedPath;
const isBinShimInvocation = /(?:^|[\\/])bin[\\/]vk$/.test(invokedPath);

if (isDirectInvocation || isBinShimInvocation) {
  main();
}
