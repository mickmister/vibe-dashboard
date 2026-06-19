import React, { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import type { WorkspaceState } from '../types';
import {
  findMatchingRepoRemotes,
  findOpenWorkspaceLocation,
  findWorkspaceIdForPr,
  getOpenFromGithubUrl,
  parseGithubPrUrl,
  removeOpenFromGithubParam,
  type MatchingRepoRemote,
} from '../lib/openFromGithub';
import {
  vkClient,
  type PullRequestDetail,
  type Workspace as VkWorkspace,
} from '../lib/vk-client';

export interface OpenFromGitHubProps {
  workspace: WorkspaceState;
  addSpace: (
    args: { name: string }
  ) => Promise<{ spaceId: string; tabGroupId: string } | undefined>;
  deleteTabGroup: (args: {
    spaceId: string;
    tabGroupId: string;
  }) => Promise<
    | {
        wasDeleted: boolean;
        deletedTabGroupId?: string;
        nextTabGroupId?: string;
      }
    | undefined
  >;
  addVKWorkspace: (args: {
    taskAttemptId: string;
    name: string;
    containerRef: string;
    activeSpaceId: string;
  }) => Promise<
    { tabGroupId: string; pairId: string; agentTabId: string } | undefined
  >;
  selectSessionTabGroup: (spaceId: string, tabGroupId: string) => void;
  selectSessionTab: (spaceId: string, tabGroupId: string, tabId: string) => void;
}

type PendingTarget =
  | {
      type: 'existing';
      workspace: VkWorkspace;
      prInfo: PullRequestDetail;
    }
  | {
      type: 'create';
      match: MatchingRepoRemote;
      prInfo: PullRequestDetail;
    };

type DialogState =
  | null
  | {
      type: 'processing';
      title: string;
      message: string;
    }
  | {
      type: 'choose-repo';
      prInfo: PullRequestDetail;
      matches: MatchingRepoRemote[];
    }
  | {
      type: 'choose-space';
      target: PendingTarget;
    }
  | {
      type: 'opening';
      title: string;
      message: string;
    }
  | {
      type: 'error';
      title: string;
      message: string;
    };

export function hasOpenFromGitHubParam(search: string): boolean {
  return getOpenFromGithubUrl(search) != null;
}

export function OpenFromGitHub({
  workspace,
  addSpace,
  deleteTabGroup,
  addVKWorkspace,
  selectSessionTabGroup,
  selectSessionTab,
}: OpenFromGitHubProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const processedUrlRef = useRef<string | null>(null);
  const [dialog, setDialog] = useState<DialogState>(null);

  const clearParam = () => {
    const nextSearch = removeOpenFromGithubParam(location.search);
    navigate(`${location.pathname}${nextSearch}`, { replace: true });
  };

  const openWorkspaceInSpace = async (
    target: PendingTarget,
    spaceId: string
  ): Promise<boolean> => {
    try {
      setDialog({
        type: 'opening',
        title: 'Opening GitHub PR',
        message: 'Preparing the VK workspace and opening it in VD.',
      });

      const workspaceToOpen =
        target.type === 'existing'
          ? target.workspace
          : (
              await vkClient.createWorkspaceFromPr({
                repo_id: target.match.repo.id,
                pr_number: target.prInfo.number,
                pr_title: target.prInfo.title,
                pr_url: target.prInfo.url,
                head_branch: target.prInfo.head_branch,
                base_branch: target.prInfo.base_branch,
                run_setup: true,
                remote_name: target.match.remote.name,
              })
            ).workspace;

      const result = await addVKWorkspace({
        taskAttemptId: workspaceToOpen.id,
        name: workspaceToOpen.name || target.prInfo.title,
        containerRef: workspaceToOpen.container_ref || '',
        activeSpaceId: spaceId,
      });

      if (result) {
        selectSessionTab(spaceId, result.tabGroupId, result.agentTabId);
      }

      setDialog(null);
      clearParam();
      return true;
    } catch (error) {
      setDialog({
        type: 'error',
        title: 'Could not open GitHub PR',
        message:
          error instanceof Error
            ? error.message
            : 'Unknown error while opening GitHub PR.',
      });
      clearParam();
      return false;
    }
  };

  const createSpaceAndOpen = async (name: string) => {
    if (dialog?.type !== 'choose-space') return;
    const result = await addSpace({ name });
    if (!result?.spaceId) return;
    const didOpen = await openWorkspaceInSpace(dialog.target, result.spaceId);
    if (didOpen) {
      await deleteTabGroup({
        spaceId: result.spaceId,
        tabGroupId: result.tabGroupId,
      });
    }
  };

  useEffect(() => {
    const requestedUrl = getOpenFromGithubUrl(location.search);
    if (!requestedUrl) return;
    if (processedUrlRef.current === requestedUrl) return;
    processedUrlRef.current = requestedUrl;

    let cancelled = false;

    const run = async () => {
      const parsedPr = parseGithubPrUrl(requestedUrl);
      if (!parsedPr) {
        setDialog({
          type: 'error',
          title: 'Unsupported GitHub URL',
          message:
            'Only GitHub pull request URLs are supported for open_from_github right now.',
        });
        clearParam();
        return;
      }

      setDialog({
        type: 'processing',
        title: 'Opening GitHub PR',
        message: `Resolving ${parsedPr.normalizedPrUrl}`,
      });

      try {
        const prInfo = await vkClient.getPrInfo(parsedPr.normalizedPrUrl);
        const summaries = await vkClient.getWorkspaceSummaries(false);
        const existingWorkspaceId = findWorkspaceIdForPr(
          summaries.summaries,
          parsedPr,
          prInfo,
        );

        if (cancelled) return;

        if (existingWorkspaceId) {
          const openLocation = findOpenWorkspaceLocation(
            workspace,
            existingWorkspaceId
          );
          if (openLocation) {
            selectSessionTabGroup(
              openLocation.spaceId,
              openLocation.tabGroupId
            );
            setDialog(null);
            clearParam();
            return;
          }

          const existingWorkspace =
            await vkClient.getWorkspace(existingWorkspaceId);
          if (cancelled) return;
          setDialog({
            type: 'choose-space',
            target: {
              type: 'existing',
              workspace: existingWorkspace,
              prInfo,
            },
          });
          return;
        }

        const repos = await vkClient.getRepos();
        const remoteResults = await Promise.allSettled(
          repos.map(async (repo) => ({
            repoId: repo.id,
            remotes: await vkClient.getRepoRemotes(repo.id),
          })),
        );
        const remotesByRepoId = new Map(
          remoteResults.flatMap((result) =>
            result.status === 'fulfilled'
              ? [[result.value.repoId, result.value.remotes] as const]
              : [],
          ),
        );
        const matches = findMatchingRepoRemotes(
          repos,
          remotesByRepoId,
          parsedPr
        );

        if (cancelled) return;

        if (matches.length === 0) {
          setDialog({
            type: 'error',
            title: 'Repository not registered in VK',
            message:
              'This PR belongs to a GitHub repo that is not registered in VK. Register or clone the repo in VK, then try again.',
          });
          clearParam();
          return;
        }

        if (matches.length === 1) {
          const [match] = matches;
          if (!match) return;
          setDialog({
            type: 'choose-space',
            target: { type: 'create', match, prInfo },
          });
          return;
        }

        setDialog({
          type: 'choose-repo',
          prInfo,
          matches,
        });
      } catch (error) {
        if (cancelled) return;
        setDialog({
          type: 'error',
          title: 'Could not open GitHub PR',
          message:
            error instanceof Error
              ? error.message
              : 'Unknown error while resolving GitHub PR.',
        });
        clearParam();
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [location.search, workspace]);

  return (
    <OpenFromGithubDialog
      state={dialog}
      workspace={workspace}
      onClose={() => {
        setDialog(null);
        clearParam();
      }}
      onSelectRepo={(match) => {
        if (dialog?.type !== 'choose-repo') return;
        setDialog({
          type: 'choose-space',
          target: {
            type: 'create',
            match,
            prInfo: dialog.prInfo,
          },
        });
      }}
      onSelectSpace={(spaceId) => {
        if (dialog?.type !== 'choose-space') return;
        void openWorkspaceInSpace(dialog.target, spaceId);
      }}
      onCreateSpace={(name) => {
        void createSpaceAndOpen(name);
      }}
    />
  );
}

function OpenFromGithubDialog({
  state,
  workspace,
  onClose,
  onSelectRepo,
  onSelectSpace,
  onCreateSpace,
}: {
  state: DialogState;
  workspace: WorkspaceState;
  onClose: () => void;
  onSelectRepo: (match: MatchingRepoRemote) => void;
  onSelectSpace: (spaceId: string) => void;
  onCreateSpace: (name: string) => void;
}) {
  const [newSpaceName, setNewSpaceName] = useState('');

  if (!state) return null;

  const spaces = workspace.spaces.filter((space) => !space.isSystem);
  const title =
    state.type === 'choose-repo'
      ? 'Choose repository'
      : state.type === 'choose-space'
        ? 'Open GitHub PR in space'
        : state.title;
  const message =
    state.type === 'choose-repo'
      ? `Multiple VK repos match PR #${state.prInfo.number}: ${state.prInfo.title}`
      : state.type === 'choose-space'
        ? `Choose a space for PR #${state.target.prInfo.number}: ${state.target.prInfo.title}`
        : state.message;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 px-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-xl border border-neutral-700 bg-neutral-900 p-5 text-neutral-100 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-white">{title}</h2>
          <p className="mt-1 text-sm text-neutral-400">{message}</p>
        </div>

        {state.type === 'processing' || state.type === 'opening' ? (
          <div className="py-6 text-sm text-neutral-300">Working…</div>
        ) : null}

        {state.type === 'error' ? (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
            {state.message}
          </div>
        ) : null}

        {state.type === 'choose-repo' ? (
          <div className="space-y-2">
            {state.matches.map((match) => (
              <button
                key={`${match.repo.id}:${match.remote.name}`}
                type="button"
                className="w-full rounded-lg border border-neutral-700 bg-neutral-800 p-3 text-left transition-colors hover:bg-neutral-700"
                onClick={() => onSelectRepo(match)}
              >
                <div className="text-sm font-medium text-white">
                  {match.repo.display_name || match.repo.name}
                </div>
                <div className="mt-1 text-xs text-neutral-400">
                  {match.remote.name} · {match.remote.url}
                </div>
              </button>
            ))}
          </div>
        ) : null}

        {state.type === 'choose-space' ? (
          <div className="space-y-4">
            <div className="space-y-2">
              {spaces.length === 0 ? (
                <div className="rounded-lg border border-neutral-800 bg-neutral-950 p-3 text-sm text-neutral-500">
                  No user-created spaces yet. Create one below.
                </div>
              ) : (
                spaces.map((space) => (
                  <button
                    key={space.id}
                    type="button"
                    className="w-full rounded-lg border border-neutral-700 bg-neutral-800 p-3 text-left transition-colors hover:bg-neutral-700"
                    onClick={() => onSelectSpace(space.id)}
                  >
                    <div className="text-sm font-medium text-white">
                      {space.name}
                    </div>
                  </button>
                ))
              )}
            </div>

            <div className="flex gap-2 border-t border-neutral-800 pt-4">
              <input
                className="min-w-0 flex-1 rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-white outline-none focus:border-neutral-500"
                placeholder="New space name"
                value={newSpaceName}
                onChange={(event) => setNewSpaceName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && newSpaceName.trim()) {
                    onCreateSpace(newSpaceName.trim());
                    setNewSpaceName('');
                  }
                }}
              />
              <button
                type="button"
                disabled={!newSpaceName.trim()}
                className="rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
                onClick={() => {
                  if (!newSpaceName.trim()) return;
                  onCreateSpace(newSpaceName.trim());
                  setNewSpaceName('');
                }}
              >
                Create
              </button>
            </div>
          </div>
        ) : null}

        <div className="mt-5 flex justify-end">
          <button
            type="button"
            className="rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-neutral-200 hover:bg-neutral-700"
            onClick={onClose}
          >
            {state.type === 'error' ? 'Close' : 'Cancel'}
          </button>
        </div>
      </div>
    </div>
  );
}
