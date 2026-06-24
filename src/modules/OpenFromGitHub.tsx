import React, { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import type { WorkspaceState } from "../types";
import {
  chooseBestContainingBranch,
  findMatchingRepoRemotes,
  findOpenWorkspaceLocation,
  findWorkspaceIdForPr,
  getOpenFromGithubUrl,
  parseGithubOpenUrl,
  removeOpenFromGithubParam,
  resolveGithubTreeBlobBranch,
  resolveGithubTreeBlobCommitTarget,
  type MatchingRepoRemote,
  type ParsedGithubIssueUrl,
  type ParsedGithubTreeBlobUrl,
  type ResolvedGithubTreeBlobTarget,
} from "../lib/openFromGithub";
import {
  vkClient,
  type PullRequestDetail,
  type Repo,
  type Workspace as VkWorkspace,
} from "../lib/vk-client";

export interface OpenFromGitHubProps {
  workspace: WorkspaceState;
  addSpace: (args: {
    name: string;
  }) => Promise<{ spaceId: string; tabGroupId: string } | undefined>;
  deleteTabGroup: (args: { spaceId: string; tabGroupId: string }) => Promise<
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
  selectSessionTab: (
    spaceId: string,
    tabGroupId: string,
    tabId: string,
  ) => void;
}

type PendingTarget =
  | {
      type: "existing";
      workspace: VkWorkspace;
      prInfo: PullRequestDetail;
    }
  | {
      type: "create";
      match: MatchingRepoRemote;
      prInfo: PullRequestDetail;
    }
  | {
      type: "existing-issue";
      workspace: VkWorkspace;
      issue: ParsedGithubIssueUrl;
    }
  | {
      type: "create-issue";
      match: MatchingRepoRemote;
      issue: ParsedGithubIssueUrl;
    }
  | {
      type: "create-tree-blob";
      match: MatchingRepoRemote;
      target: ResolvedGithubTreeBlobTarget;
      targetBranch: string;
    };

type DialogState =
  | null
  | {
      type: "processing";
      title: string;
      message: string;
    }
  | {
      type: "choose-repo";
      target:
        | { type: "pr"; prInfo: PullRequestDetail }
        | { type: "issue"; issue: ParsedGithubIssueUrl }
        | { type: "tree-blob"; target: ParsedGithubTreeBlobUrl };
      matches: MatchingRepoRemote[];
    }
  | {
      type: "choose-branch";
      match: MatchingRepoRemote;
      target: ResolvedGithubTreeBlobTarget;
      branches: string[];
      message: string;
    }
  | {
      type: "choose-space";
      target: PendingTarget;
    }
  | {
      type: "confirm-reopen-archived";
      workspace: VkWorkspace;
      issue: ParsedGithubIssueUrl;
    }
  | {
      type: "stale-issue-mapping";
      issue: ParsedGithubIssueUrl;
      workspaceId: string;
    }
  | {
      type: "opening";
      title: string;
      message: string;
    }
  | {
      type: "error";
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
  const mountedRef = useRef(true);
  const latestRuntimeRef = useRef({
    workspace,
    location,
    navigate,
    addSpace,
    deleteTabGroup,
    addVKWorkspace,
    selectSessionTabGroup,
    selectSessionTab,
  });
  latestRuntimeRef.current = {
    workspace,
    location,
    navigate,
    addSpace,
    deleteTabGroup,
    addVKWorkspace,
    selectSessionTabGroup,
    selectSessionTab,
  };
  const [dialog, setDialog] = useState<DialogState>(null);

  const requestedUrl = getOpenFromGithubUrl(location.search);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const clearParam = () => {
    const { location: latestLocation, navigate: latestNavigate } =
      latestRuntimeRef.current;
    const nextSearch = removeOpenFromGithubParam(latestLocation.search);
    latestNavigate(`${latestLocation.pathname}${nextSearch}`, {
      replace: true,
    });
  };

  const isTargetCurrent = (target: PendingTarget): boolean =>
    mountedRef.current &&
    isSameOpenTarget(
      target,
      getOpenFromGithubUrl(latestRuntimeRef.current.location.search),
    );

  const openWorkspaceInSpace = async (
    target: PendingTarget,
    spaceId: string,
  ): Promise<boolean> => {
    const isCurrentTarget = () => isTargetCurrent(target);
    if (!isCurrentTarget()) return false;

    try {
      setDialog({
        type: "opening",
        title: target.type === "create-tree-blob"
          ? "Opening GitHub URL"
          : target.type.endsWith("issue")
            ? "Opening GitHub issue"
            : "Opening GitHub PR",
        message: "Preparing the VK workspace and opening it in VD.",
      });

      const workspaceToOpen = await resolveWorkspaceToOpen(
        target,
        isCurrentTarget,
      );
      if (!isCurrentTarget()) return false;

      const result = await latestRuntimeRef.current.addVKWorkspace({
        taskAttemptId: workspaceToOpen.id,
        name: workspaceToOpen.name || getTargetTitle(target),
        containerRef: workspaceToOpen.container_ref || "",
        activeSpaceId: spaceId,
      });

      if (!isCurrentTarget()) return false;

      if (result) {
        latestRuntimeRef.current.selectSessionTab(
          spaceId,
          result.tabGroupId,
          result.agentTabId,
        );
      }

      setDialog(null);
      clearParam();
      return true;
    } catch (error) {
      if (error instanceof StaleOpenFromGithubRunError || !isCurrentTarget()) {
        return false;
      }
      setDialog({
        type: "error",
        title: target.type === "create-tree-blob"
          ? "Could not open GitHub URL"
          : target.type.endsWith("issue")
            ? "Could not open GitHub issue"
            : "Could not open GitHub PR",
        message:
          error instanceof Error
            ? error.message
            : "Unknown error while opening GitHub URL.",
      });
      clearParam();
      return false;
    }
  };

  const resolveWorkspaceToOpen = async (
    target: PendingTarget,
    isCurrentTarget: () => boolean,
  ): Promise<VkWorkspace> => {
    if (target.type === "existing" || target.type === "existing-issue") {
      if (target.workspace.archived) {
        const workspace = await vkClient.updateWorkspace(target.workspace.id, {
          archived: false,
        });
        if (!isCurrentTarget()) throw new StaleOpenFromGithubRunError();
        return workspace;
      }
      return target.workspace;
    }

    if (target.type === "create-tree-blob") {
      const workspace = (
        await vkClient.createWorkspaceFromTreeBlob({
          repo_id: target.match.repo.id,
          target_branch: target.targetBranch,
          normalized_url: target.target.normalizedUrl,
          ref: target.target.ref,
          kind: target.target.kind,
          path: target.target.path,
          permalink_commit: target.target.permalinkCommit,
        })
      ).workspace;
      if (!isCurrentTarget()) throw new StaleOpenFromGithubRunError();
      return workspace;
    }

    if (target.type === "create-issue") {
      const targetBranch = await getIssueTargetBranch(target.match.repo);
      if (!isCurrentTarget()) throw new StaleOpenFromGithubRunError();
      const workspace = (
        await vkClient.createWorkspaceFromIssue({
          repo_id: target.match.repo.id,
          target_branch: targetBranch,
          issue_url: target.issue.normalizedIssueUrl,
          issue_number: target.issue.number,
          run_setup: true,
        })
      ).workspace;
      if (!isCurrentTarget()) throw new StaleOpenFromGithubRunError();
      await vkClient.putGithubIssueWorkspaceMapping({
        owner: target.issue.owner.toLowerCase(),
        repo: target.issue.repo.toLowerCase(),
        number: target.issue.number,
        workspaceId: workspace.id,
        branch: workspace.branch,
      });
      if (!isCurrentTarget()) throw new StaleOpenFromGithubRunError();
      return workspace;
    }

    const workspace = (
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
    if (!isCurrentTarget()) throw new StaleOpenFromGithubRunError();
    return workspace;
  };

  const createSpaceAndOpen = async (name: string) => {
    if (dialog?.type !== "choose-space") return;
    const result = await latestRuntimeRef.current.addSpace({ name });
    if (!result?.spaceId) return;
    const didOpen = await openWorkspaceInSpace(dialog.target, result.spaceId);
    if (didOpen) {
      await latestRuntimeRef.current.deleteTabGroup({
        spaceId: result.spaceId,
        tabGroupId: result.tabGroupId,
      });
    }
  };

  const runIssueOpen = async (
    issue: ParsedGithubIssueUrl,
    isCancelled: () => boolean,
  ) => {
    setDialog({
      type: "processing",
      title: "Opening GitHub issue",
      message: `Resolving ${issue.normalizedIssueUrl}`,
    });

    try {
      const mapping = await vkClient.getGithubIssueWorkspaceMapping({
        owner: issue.owner.toLowerCase(),
        repo: issue.repo.toLowerCase(),
        number: issue.number,
      });
      if (isCancelled()) return;

      if (mapping.mapping) {
        let existingWorkspace: VkWorkspace;
        try {
          existingWorkspace = await vkClient.getWorkspace(
            mapping.mapping.workspaceId,
          );
          if (isCancelled()) return;
        } catch (error) {
          if (isCancelled()) return;
          setDialog({
            type: "stale-issue-mapping",
            issue,
            workspaceId: mapping.mapping.workspaceId,
          });
          return;
        }

        const openLocation = findOpenWorkspaceLocation(
          latestRuntimeRef.current.workspace,
          existingWorkspace.id,
        );
        if (openLocation && !existingWorkspace.archived) {
          latestRuntimeRef.current.selectSessionTabGroup(
            openLocation.spaceId,
            openLocation.tabGroupId,
          );
          setDialog(null);
          clearParam();
          return;
        }

        if (existingWorkspace.archived) {
          setDialog({
            type: "confirm-reopen-archived",
            workspace: existingWorkspace,
            issue,
          });
          return;
        }

        setDialog({
          type: "choose-space",
          target: {
            type: "existing-issue",
            workspace: existingWorkspace,
            issue,
          },
        });
        return;
      }

      await showCreateIssueOptions(issue, isCancelled);
    } catch (error) {
      if (isCancelled()) return;
      setDialog({
        type: "error",
        title: "Could not open GitHub issue",
        message:
          error instanceof Error
            ? error.message
            : "Unknown error while resolving GitHub issue.",
      });
      clearParam();
    }
  };

  const findOrEnsureIssueRepo = async (
    issue: ParsedGithubIssueUrl,
    isCancelled: () => boolean,
  ) => {
    const repos = await vkClient.getRepos();
    if (isCancelled()) return [];
    const remoteResults = await Promise.allSettled(
      repos.map(async (repo) => ({
        repoId: repo.id,
        remotes: await vkClient.getRepoRemotes(repo.id),
      })),
    );
    const remotesByRepoId = new Map(
      remoteResults.flatMap((result) =>
        result.status === "fulfilled"
          ? [[result.value.repoId, result.value.remotes] as const]
          : [],
      ),
    );
    if (isCancelled()) return [];
    const matches = findMatchingRepoRemotes(repos, remotesByRepoId, issue);
    if (matches.length > 0) return matches;

    setDialog({
      type: "processing",
      title: "Opening GitHub issue",
      message: `Cloning and registering ${issue.normalizedRepo}`,
    });
    const ensured = await vkClient.ensureGithubRepo(
      `https://github.com/${issue.normalizedRepo}`,
    );
    if (isCancelled()) return [];
    const ensuredRemotes = await vkClient
      .getRepoRemotes(ensured.repo.id)
      .catch(() => []);
    if (isCancelled()) return [];
    return findMatchingRepoRemotes(
      [ensured.repo],
      new Map([[ensured.repo.id, ensuredRemotes]]),
      issue,
    );
  };

  const showCreateIssueOptions = async (
    issue: ParsedGithubIssueUrl,
    isCancelled: () => boolean,
  ) => {
    const matches = await findOrEnsureIssueRepo(issue, isCancelled);
    if (isCancelled()) return;
    if (matches.length === 1 && matches[0]) {
      setDialog({
        type: "choose-space",
        target: { type: "create-issue", match: matches[0], issue },
      });
      return;
    }

    if (matches.length > 1) {
      setDialog({
        type: "choose-repo",
        target: { type: "issue", issue },
        matches,
      });
      return;
    }

    setDialog({
      type: "error",
      title: "Could not open GitHub issue",
      message: `No matching repository found for ${issue.normalizedRepo}.`,
    });
    clearParam();
  };

  const forgetStaleIssueMappingAndCreateReplacement = async (
    issue: ParsedGithubIssueUrl,
  ) => {
    const isCancelled = () => {
      if (!mountedRef.current) return true;
      const requestedUrl = getOpenFromGithubUrl(
        latestRuntimeRef.current.location.search,
      );
      const parsed = requestedUrl ? parseGithubOpenUrl(requestedUrl) : null;
      return (
        parsed?.type !== "issue" ||
        parsed.issue.normalizedIssueUrl !== issue.normalizedIssueUrl
      );
    };

    setDialog({
      type: "processing",
      title: "Repairing GitHub issue mapping",
      message: `Forgetting stale workspace mapping for ${issue.normalizedIssueUrl}`,
    });

    try {
      await vkClient.deleteGithubIssueWorkspaceMapping({
        owner: issue.owner.toLowerCase(),
        repo: issue.repo.toLowerCase(),
        number: issue.number,
      });
      if (isCancelled()) return;
      await showCreateIssueOptions(issue, isCancelled);
    } catch (error) {
      if (isCancelled()) return;
      setDialog({
        type: "error",
        title: "Could not repair GitHub issue mapping",
        message:
          error instanceof Error
            ? error.message
            : "Unknown error while repairing GitHub issue mapping.",
      });
      clearParam();
    }
  };

  const runTreeBlobOpen = async (
    target: ParsedGithubTreeBlobUrl,
    isCancelled: () => boolean,
  ) => {
    setDialog({
      type: "processing",
      title: "Opening GitHub URL",
      message: `Resolving ${target.normalizedUrl}`,
    });

    try {
      const matches = await findOrEnsureTreeBlobRepo(target, isCancelled);
      if (isCancelled()) return;

      if (matches.length === 1 && matches[0]) {
        await resolveTreeBlobMatch(matches[0], target, isCancelled);
        return;
      }

      if (matches.length > 1) {
        setDialog({
          type: "choose-repo",
          target: { type: "tree-blob", target },
          matches,
        });
        return;
      }

      setDialog({
        type: "error",
        title: "Could not open GitHub URL",
        message: `No matching repository found for ${target.normalizedRepo}.`,
      });
      clearParam();
    } catch (error) {
      if (isCancelled()) return;
      setDialog({
        type: "error",
        title: "Could not open GitHub URL",
        message:
          error instanceof Error
            ? error.message
            : "Unknown error while resolving GitHub URL.",
      });
      clearParam();
    }
  };

  const findOrEnsureTreeBlobRepo = async (
    target: ParsedGithubTreeBlobUrl,
    isCancelled: () => boolean,
  ) => {
    const repos = await vkClient.getRepos();
    if (isCancelled()) return [];
    const remoteResults = await Promise.allSettled(
      repos.map(async (repo) => ({
        repoId: repo.id,
        remotes: await vkClient.getRepoRemotes(repo.id),
      })),
    );
    const remotesByRepoId = new Map(
      remoteResults.flatMap((result) =>
        result.status === "fulfilled"
          ? [[result.value.repoId, result.value.remotes] as const]
          : [],
      ),
    );
    if (isCancelled()) return [];
    const matches = findMatchingRepoRemotes(repos, remotesByRepoId, target);
    if (matches.length > 0) return matches;

    setDialog({
      type: "processing",
      title: "Opening GitHub URL",
      message: `Cloning and registering ${target.normalizedRepo}`,
    });
    const ensured = await vkClient.ensureGithubRepo(
      `https://github.com/${target.normalizedRepo}`,
    );
    if (isCancelled()) return [];
    const ensuredRemotes = await vkClient
      .getRepoRemotes(ensured.repo.id)
      .catch(() => []);
    if (isCancelled()) return [];
    const ensuredMatches = findMatchingRepoRemotes(
      [ensured.repo],
      new Map([[ensured.repo.id, ensuredRemotes]]),
      target,
    );
    return ensuredMatches.length > 0
      ? ensuredMatches
      : [
          {
            repo: ensured.repo,
            remote: {
              name: "origin",
              url: `https://github.com/${target.normalizedRepo}.git`,
            },
          },
        ];
  };

  const resolveTreeBlobMatch = async (
    match: MatchingRepoRemote,
    target: ParsedGithubTreeBlobUrl,
    isCancelled: () => boolean,
  ) => {
    setDialog({
      type: "processing",
      title: "Opening GitHub URL",
      message: `Resolving branch/ref for ${target.normalizedUrl}`,
    });

    let branches: Awaited<ReturnType<typeof vkClient.getRepoBranches>>;
    try {
      branches = await vkClient.getRepoBranches(match.repo.id);
    } catch (error) {
      if (isCancelled()) return;
      setDialog({
        type: "error",
        title: "Could not load repository branches",
        message:
          error instanceof Error
            ? `Could not load branches for ${match.repo.display_name || match.repo.name}. Fetch/register the repo and try again. ${error.message}`
            : `Could not load branches for ${match.repo.display_name || match.repo.name}. Fetch/register the repo and try again.`,
      });
      clearParam();
      return;
    }
    if (isCancelled()) return;

    const branchResult = resolveGithubTreeBlobBranch(
      target,
      branches,
      match.remote.name,
    );
    if (branchResult) {
      setDialog({
        type: "choose-space",
        target: {
          type: "create-tree-blob",
          match,
          target: branchResult.resolved,
          targetBranch: branchResult.targetBranch,
        },
      });
      return;
    }

    const commitTarget = resolveGithubTreeBlobCommitTarget(target);
    if (!commitTarget?.permalinkCommit) {
      setDialog({
        type: "error",
        title: "Unsupported GitHub ref",
        message: `Could not resolve ${target.normalizedUrl} to a fetched branch. Tags and missing refs are unsupported unless they appear in the VK branch list. Fetch the repo or choose a branch URL and try again.`,
      });
      clearParam();
      return;
    }

    let containingBranches: string[];
    try {
      containingBranches = (
        await vkClient.getGitBranchesContainingCommit({
          repoId: match.repo.id,
          commit: commitTarget.permalinkCommit,
        })
      ).branches;
    } catch (error) {
      if (isCancelled()) return;
      setDialog({
        type: "error",
        title: "Could not resolve commit permalink",
        message:
          error instanceof Error
            ? `Could not find branches containing ${commitTarget.permalinkCommit}. Fetch the repo and verify the commit exists, then try again. ${error.message}`
            : `Could not find branches containing ${commitTarget.permalinkCommit}. Fetch the repo and verify the commit exists, then try again.`,
      });
      clearParam();
      return;
    }
    if (isCancelled()) return;

    const bestBranch = chooseBestContainingBranch(
      containingBranches,
      match.repo.default_target_branch,
    );
    if (bestBranch) {
      setDialog({
        type: "choose-space",
        target: {
          type: "create-tree-blob",
          match,
          target: commitTarget,
          targetBranch: bestBranch,
        },
      });
      return;
    }

    const availableBranches = containingBranches.length
      ? containingBranches
      : branches.map((branch) => branch.name);
    if (availableBranches.length === 0) {
      setDialog({
        type: "error",
        title: "No branch base available",
        message: `No branch containing ${commitTarget.permalinkCommit} was found, and no repository branches could be loaded to choose a base manually. Fetch the repo and try again.`,
      });
      clearParam();
      return;
    }

    setDialog({
      type: "choose-branch",
      match,
      target: commitTarget,
      branches: availableBranches,
      message: containingBranches.length
        ? `Commit ${commitTarget.permalinkCommit} is contained in multiple branches. Choose the branch to use as the base for a new VK workspace branch.`
        : `No branch containing ${commitTarget.permalinkCommit} was found. Choose an available branch to use as the base for a new VK workspace branch, or cancel and fetch the repo first.`,
    });
  };

  useEffect(() => {
    if (!requestedUrl) {
      processedUrlRef.current = null;
      return;
    }
    if (processedUrlRef.current === requestedUrl) return;
    processedUrlRef.current = requestedUrl;

    let cancelled = false;

    const run = async () => {
      const parsedOpenUrl = parseGithubOpenUrl(requestedUrl);
      if (!parsedOpenUrl) {
        setDialog({
          type: "error",
          title: "Unsupported GitHub URL",
          message:
            "Only GitHub pull request, issue, tree, and blob URLs are supported for open_from_github.",
        });
        clearParam();
        return;
      }

      if (parsedOpenUrl.type === "issue") {
        await runIssueOpen(parsedOpenUrl.issue, () => cancelled);
        return;
      }

      if (parsedOpenUrl.type === "tree-blob") {
        await runTreeBlobOpen(parsedOpenUrl.target, () => cancelled);
        return;
      }

      const parsedPr = parsedOpenUrl.pr;

      setDialog({
        type: "processing",
        title: "Opening GitHub PR",
        message: `Resolving ${parsedPr.normalizedPrUrl}`,
      });

      try {
        const prInfo = await vkClient.getPrInfo(parsedPr.normalizedPrUrl);
        if (cancelled) return;
        const summaries = await vkClient.getWorkspaceSummaries(false);
        const existingWorkspaceId = findWorkspaceIdForPr(
          summaries.summaries,
          parsedPr,
          prInfo,
        );

        if (cancelled) return;

        if (existingWorkspaceId) {
          const openLocation = findOpenWorkspaceLocation(
            latestRuntimeRef.current.workspace,
            existingWorkspaceId,
          );
          if (openLocation) {
            latestRuntimeRef.current.selectSessionTabGroup(
              openLocation.spaceId,
              openLocation.tabGroupId,
            );
            setDialog(null);
            clearParam();
            return;
          }

          const existingWorkspace =
            await vkClient.getWorkspace(existingWorkspaceId);
          if (cancelled) return;
          setDialog({
            type: "choose-space",
            target: {
              type: "existing",
              workspace: existingWorkspace,
              prInfo,
            },
          });
          return;
        }

        const repos = await vkClient.getRepos();
        if (cancelled) return;
        const remoteResults = await Promise.allSettled(
          repos.map(async (repo) => ({
            repoId: repo.id,
            remotes: await vkClient.getRepoRemotes(repo.id),
          })),
        );
        const remotesByRepoId = new Map(
          remoteResults.flatMap((result) =>
            result.status === "fulfilled"
              ? [[result.value.repoId, result.value.remotes] as const]
              : [],
          ),
        );
        const matches = findMatchingRepoRemotes(
          repos,
          remotesByRepoId,
          parsedPr,
        );

        if (cancelled) return;

        if (matches.length === 0) {
          setDialog({
            type: "processing",
            title: "Opening GitHub PR",
            message: `Cloning and registering ${parsedPr.normalizedRepo}`,
          });
          const ensured = await vkClient.ensureGithubRepo(
            `https://github.com/${parsedPr.normalizedRepo}`,
          );
          if (cancelled) return;
          const remoteResults = await Promise.allSettled([
            vkClient.getRepoRemotes(ensured.repo.id),
          ]);
          const ensuredRemotes =
            remoteResults[0]?.status === "fulfilled"
              ? remoteResults[0].value
              : [];
          const ensuredMatches = findMatchingRepoRemotes(
            [ensured.repo],
            new Map([[ensured.repo.id, ensuredRemotes]]),
            parsedPr,
          );
          const match = ensuredMatches[0] ?? {
            repo: ensured.repo,
            remote: {
              name: "origin",
              url: `https://github.com/${parsedPr.normalizedRepo}.git`,
            },
          };
          setDialog({
            type: "choose-space",
            target: { type: "create", match, prInfo },
          });
          return;
        }

        if (matches.length === 1) {
          const [match] = matches;
          if (!match) return;
          setDialog({
            type: "choose-space",
            target: { type: "create", match, prInfo },
          });
          return;
        }

        setDialog({
          type: "choose-repo",
          target: { type: "pr", prInfo },
          matches,
        });
      } catch (error) {
        if (cancelled) return;
        setDialog({
          type: "error",
          title: "Could not open GitHub PR",
          message:
            error instanceof Error
              ? error.message
              : "Unknown error while resolving GitHub PR.",
        });
        clearParam();
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [requestedUrl]);

  return (
    <OpenFromGithubDialog
      state={dialog}
      workspace={workspace}
      onClose={() => {
        setDialog(null);
        clearParam();
      }}
      onSelectRepo={(match) => {
        if (dialog?.type !== "choose-repo") return;
        if (dialog.target.type === "pr") {
          setDialog({
            type: "choose-space",
            target: {
              type: "create",
              match,
              prInfo: dialog.target.prInfo,
            },
          });
          return;
        }
        if (dialog.target.type === "issue") {
          setDialog({
            type: "choose-space",
            target: {
              type: "create-issue",
              match,
              issue: dialog.target.issue,
            },
          });
          return;
        }
        const treeBlobTarget = dialog.target.target;
        void resolveTreeBlobMatch(match, treeBlobTarget, () => {
          const requestedUrl = getOpenFromGithubUrl(
            latestRuntimeRef.current.location.search,
          );
          const parsed = requestedUrl ? parseGithubOpenUrl(requestedUrl) : null;
          return (
            !mountedRef.current ||
            parsed?.type !== "tree-blob" ||
            parsed.target.normalizedUrl !== treeBlobTarget.normalizedUrl
          );
        });
      }}
      onSelectBranch={(branch) => {
        if (dialog?.type !== "choose-branch") return;
        setDialog({
          type: "choose-space",
          target: {
            type: "create-tree-blob",
            match: dialog.match,
            target: dialog.target,
            targetBranch: branch,
          },
        });
      }}
      onSelectSpace={(spaceId) => {
        if (dialog?.type !== "choose-space") return;
        void openWorkspaceInSpace(dialog.target, spaceId);
      }}
      onConfirmReopenArchived={() => {
        if (dialog?.type !== "confirm-reopen-archived") return;
        setDialog({
          type: "choose-space",
          target: {
            type: "existing-issue",
            workspace: dialog.workspace,
            issue: dialog.issue,
          },
        });
      }}
      onForgetStaleIssueMapping={() => {
        if (dialog?.type !== "stale-issue-mapping") return;
        void forgetStaleIssueMappingAndCreateReplacement(dialog.issue);
      }}
      onCreateSpace={(name) => {
        void createSpaceAndOpen(name);
      }}
    />
  );
}

class StaleOpenFromGithubRunError extends Error {
  constructor() {
    super("Stale open_from_github run");
    this.name = "StaleOpenFromGithubRunError";
  }
}

function isSameOpenTarget(
  target: PendingTarget,
  requestedUrl: string | null,
): boolean {
  if (!requestedUrl) return false;
  const parsed = parseGithubOpenUrl(requestedUrl);
  if (!parsed) return false;

  if (target.type === "existing" || target.type === "create") {
    const prUrl = target.prInfo.url || target.prInfo.number.toString();
    const parsedTarget = parseGithubOpenUrl(prUrl);
    return (
      parsed.type === "pr" &&
      parsedTarget?.type === "pr" &&
      parsed.pr.normalizedPrUrl === parsedTarget.pr.normalizedPrUrl
    );
  }

  if (target.type === "create-tree-blob") {
    return (
      parsed.type === "tree-blob" &&
      parsed.target.normalizedUrl === target.target.normalizedUrl
    );
  }

  return (
    parsed.type === "issue" &&
    parsed.issue.normalizedIssueUrl === target.issue.normalizedIssueUrl
  );
}

function getTargetTitle(target: PendingTarget): string {
  if (target.type === "existing" || target.type === "create") {
    return target.prInfo.title;
  }
  if (target.type === "create-tree-blob") {
    return `${target.target.kind} ${target.target.ref}`;
  }
  return `issue #${target.issue.number}`;
}

function getTargetVerb(target: PendingTarget): string {
  if (target.type === "create-tree-blob") return "Open GitHub URL";
  return target.type.endsWith("issue") ? "Open GitHub issue" : "Open GitHub PR";
}

async function getIssueTargetBranch(repo: Repo): Promise<string> {
  const fallback = repo.default_target_branch?.trim() || "origin/main";

  try {
    const branches = await vkClient.getRepoBranches(repo.id);
    if (branches.some((branch) => branch.name === "origin/main")) {
      return "origin/main";
    }
  } catch {
    // If branch discovery fails, keep issue provisioning usable by falling back
    // to the backend's configured repo default.
  }

  return fallback;
}

function OpenFromGithubDialog({
  state,
  workspace,
  onClose,
  onSelectRepo,
  onSelectSpace,
  onSelectBranch,
  onCreateSpace,
  onConfirmReopenArchived,
  onForgetStaleIssueMapping,
}: {
  state: DialogState;
  workspace: WorkspaceState;
  onClose: () => void;
  onSelectRepo: (match: MatchingRepoRemote) => void;
  onSelectSpace: (spaceId: string) => void;
  onSelectBranch: (branch: string) => void;
  onCreateSpace: (name: string) => void;
  onConfirmReopenArchived: () => void;
  onForgetStaleIssueMapping: () => void;
}) {
  const [newSpaceName, setNewSpaceName] = useState("");

  if (!state) return null;

  const spaces = workspace.spaces.filter((space) => !space.isSystem);
  const title =
    state.type === "choose-repo"
      ? "Choose repository"
      : state.type === "choose-space"
        ? `${getTargetVerb(state.target)} in space`
        : state.type === "confirm-reopen-archived"
          ? "Reopen archived issue workspace?"
          : state.type === "stale-issue-mapping"
            ? "Issue workspace no longer exists"
            : state.type === "choose-branch"
              ? "Choose branch base"
              : state.title;
  const message =
    state.type === "choose-repo"
      ? state.target.type === "pr"
        ? `Multiple VK repos match PR #${state.target.prInfo.number}: ${state.target.prInfo.title}`
        : state.target.type === "issue"
          ? `Multiple VK repos match issue #${state.target.issue.number}: ${state.target.issue.normalizedIssueUrl}`
          : `Multiple VK repos match ${state.target.target.normalizedUrl}`
      : state.type === "choose-space"
        ? state.target.type === "create-tree-blob"
          ? `V1 creates a new VK workspace branch from ${state.target.targetBranch} so your existing GitHub branch or permalink commit is not checked out and edited directly. Direct reuse of arbitrary non-PR branches is not supported yet.`
          : `Choose a space for ${getTargetTitle(state.target)}`
        : state.type === "confirm-reopen-archived"
          ? `GitHub issue ${state.issue.normalizedIssueUrl} is mapped to archived workspace ${state.workspace.name || state.workspace.branch}. Reopen and unarchive it instead of creating a duplicate branch?`
          : state.type === "stale-issue-mapping"
            ? `GitHub issue ${state.issue.normalizedIssueUrl} was mapped to deleted workspace ${state.workspaceId}. Forget the stale mapping before creating a replacement workspace.`
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

        {state.type === "processing" || state.type === "opening" ? (
          <div className="py-6 text-sm text-neutral-300">Working…</div>
        ) : null}

        {state.type === "error" ? (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
            {state.message}
          </div>
        ) : null}

        {state.type === "choose-repo" ? (
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

        {state.type === "choose-branch" ? (
          <div className="space-y-2">
            {state.branches.map((branch) => (
              <button
                key={branch}
                type="button"
                className="w-full rounded-lg border border-neutral-700 bg-neutral-800 p-3 text-left font-mono text-sm text-white transition-colors hover:bg-neutral-700"
                onClick={() => onSelectBranch(branch)}
              >
                {branch}
              </button>
            ))}
          </div>
        ) : null}

        {state.type === "confirm-reopen-archived" ? (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-100">
            Reopening will make the prior workspace active again and reuse
            branch <span className="font-mono">{state.workspace.branch}</span>.
          </div>
        ) : null}

        {state.type === "stale-issue-mapping" ? (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-100">
            The previous workspace record is gone. Forgetting this mapping lets
            VD create and store a replacement issue workspace.
          </div>
        ) : null}

        {state.type === "choose-space" ? (
          <div className="space-y-4">
            {state.target.type === "create-tree-blob" ? (
              <div className="rounded-lg border border-blue-500/30 bg-blue-500/10 p-3 text-sm text-blue-100">
                Create new VK workspace branch from {" "}
                <span className="font-mono">{state.target.targetBranch}</span>.
                {state.target.target.path ? (
                  <>
                    {" "}
                    Initial prompt includes path {" "}
                    <span className="font-mono">
                      {state.target.target.path}
                    </span>
                    .
                  </>
                ) : null}
              </div>
            ) : null}
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
                  if (event.key === "Enter" && newSpaceName.trim()) {
                    onCreateSpace(newSpaceName.trim());
                    setNewSpaceName("");
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
                  setNewSpaceName("");
                }}
              >
                Create
              </button>
            </div>
          </div>
        ) : null}

        <div className="mt-5 flex justify-end gap-2">
          {state.type === "confirm-reopen-archived" ? (
            <button
              type="button"
              className="rounded-lg border border-amber-500/50 bg-amber-500/20 px-3 py-2 text-sm font-medium text-amber-100 hover:bg-amber-500/30"
              onClick={onConfirmReopenArchived}
            >
              Reopen workspace
            </button>
          ) : null}
          {state.type === "stale-issue-mapping" ? (
            <button
              type="button"
              className="rounded-lg border border-amber-500/50 bg-amber-500/20 px-3 py-2 text-sm font-medium text-amber-100 hover:bg-amber-500/30"
              onClick={onForgetStaleIssueMapping}
            >
              Forget mapping and create replacement
            </button>
          ) : null}
          <button
            type="button"
            className="rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-neutral-200 hover:bg-neutral-700"
            onClick={onClose}
          >
            {state.type === "error" ? "Close" : "Cancel"}
          </button>
        </div>
      </div>
    </div>
  );
}
