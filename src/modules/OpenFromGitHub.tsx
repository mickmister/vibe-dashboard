import React, { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import type { SavedWorkspaceSession, WorkspaceState } from "../types";
import {
  branchBelongsToRemoteOrLocal,
  chooseBestContainingBranch,
  findMatchingRepoRemotes,
  findOpenWorkspaceLocation,
  findWorkspaceIdsForPr,
  getRemoteDefaultBranch,
  getOpenFromGithubUrl,
  parseGithubOpenUrl,
  removeOpenFromGithubParam,
  resolveGithubTreeBlobBranch,
  resolveGithubTreeBlobCommitTarget,
  selectPreferredRemoteBranch,
  type MatchingRepoRemote,
  type ParsedGithubIssueUrl,
  type ParsedGithubPrUrl,
  type ParsedGithubTreeBlobUrl,
  type OpenWorkspaceLocation,
  type ResolvedGithubTreeBlobTarget,
} from "../lib/openFromGithub";
import {
  vkClient,
  type PullRequestDetail,
  type Workspace as VkWorkspace,
} from "../lib/vk-client";
import { buildSavedVoyageDashboardPath } from "../lib/voyageUrl";

export interface OpenFromGitHubProps {
  workspace: WorkspaceState;
  savedVoyages?: SavedWorkspaceSession[];
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
  createSavedSessionForSelection: (args: {
    name: string;
    spaceId: string;
    tabGroupId: string;
    tabId?: string;
  }) => Promise<SavedWorkspaceSession | undefined>;
  addSelectionToSavedSession: (args: {
    sessionId: string;
    spaceId: string;
    tabGroupId: string;
    voyageEntryId?: string;
    tabId?: string;
    viewIds?: string[];
  }) => Promise<SavedWorkspaceSession | undefined>;
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
      targetBranch?: string;
      checkoutBranch?: string;
      createBranch?: boolean;
      workspaceName?: string;
    }
  | {
      type: "create-tree-blob";
      match: MatchingRepoRemote;
      target: ResolvedGithubTreeBlobTarget;
      targetBranch: string;
      checkoutBranch?: string;
      createBranch?: boolean;
      workspaceName?: string;
    };

type ExistingVoyageChoice = {
  savedVoyage: SavedWorkspaceSession;
  voyageEntryId?: string;
};

type UnclonedTarget =
  | { type: "pr"; parsed: ParsedGithubPrUrl; prInfo: PullRequestDetail }
  | { type: "issue"; issue: ParsedGithubIssueUrl }
  | { type: "tree-blob"; target: ParsedGithubTreeBlobUrl };

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
      type: "choose-work-mode";
      target:
        | Extract<PendingTarget, { type: "create-issue" }>
        | Extract<PendingTarget, { type: "create-tree-blob" }>;
      branches: string[];
      selectedBranch: string;
      defaultCreateBranch: boolean;
    }
  | {
      type: "choose-space";
      target: PendingTarget;
    }
  | {
      type: "choose-voyage";
      title: string;
      message: string;
      choices: ExistingVoyageChoice[];
      mode:
        | {
            type: "existing-location";
            openLocation: OpenWorkspaceLocation;
          }
        | {
            type: "target";
            target: PendingTarget;
          };
    }
  | {
      type: "confirm-reopen-archived";
      workspace: VkWorkspace;
      issue: ParsedGithubIssueUrl;
    }
  | {
      type: "choose-pr-workspace";
      workspaces: VkWorkspace[];
      prInfo: PullRequestDetail;
    }
  | { type: "choose-clone-intent"; target: UnclonedTarget }
  | {
      type: "choose-fork";
      target: UnclonedTarget;
      sourceRepoUrl: string;
      forks: Array<{ fullName: string; cloneUrl: string }>;
    }
  | {
      type: "await-fork";
      target: UnclonedTarget;
      sourceRepoUrl: string;
      forkUrl: string;
      viewer: string;
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
  savedVoyages = [],
  addSpace,
  deleteTabGroup,
  addVKWorkspace,
  selectSessionTabGroup,
  selectSessionTab,
  createSavedSessionForSelection,
  addSelectionToSavedSession,
}: OpenFromGitHubProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const processedUrlRef = useRef<string | null>(null);
  const mountedRef = useRef(true);
  const latestRuntimeRef = useRef({
    workspace,
    savedVoyages,
    location,
    navigate,
    addSpace,
    deleteTabGroup,
    addVKWorkspace,
    selectSessionTabGroup,
    selectSessionTab,
    createSavedSessionForSelection,
    addSelectionToSavedSession,
  });
  latestRuntimeRef.current = {
    workspace,
    savedVoyages,
    location,
    navigate,
    addSpace,
    deleteTabGroup,
    addVKWorkspace,
    selectSessionTabGroup,
    selectSessionTab,
    createSavedSessionForSelection,
    addSelectionToSavedSession,
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

  const routeExistingLocation = (args: {
    openLocation: OpenWorkspaceLocation;
    title: string;
    message: string;
  }) => {
    const existingVoyages = findSavedVoyagesForTabGroup(
      latestRuntimeRef.current.savedVoyages,
      args.openLocation.tabGroupId,
    );

    if (existingVoyages.length === 1) {
      const [existingVoyage] = existingVoyages;
      if (existingVoyage) {
        openSavedVoyage(
          existingVoyage.savedVoyage,
          existingVoyage.voyageEntryId ||
            existingVoyage.savedVoyage.activeVoyageEntryId,
        );
      }
      return;
    }

    if (existingVoyages.length > 1) {
      setDialog({
        type: "choose-voyage",
        title: args.title,
        message: args.message,
        choices: existingVoyages,
        mode: {
          type: "existing-location",
          openLocation: args.openLocation,
        },
      });
      return;
    }

    setDialog({
      type: "choose-voyage",
      title: args.title,
      message:
        "This craft is open, but it is not part of any saved Voyage yet. Choose a recently opened Voyage to add it to, or create a new Voyage.",
      choices: getRecentVoyageChoices(latestRuntimeRef.current.savedVoyages),
      mode: {
        type: "existing-location",
        openLocation: args.openLocation,
      },
    });
  };

  const openSavedVoyage = (
    savedVoyage: SavedWorkspaceSession,
    voyageEntryId: string,
  ) => {
    const { workspace, savedVoyages, location, navigate } =
      latestRuntimeRef.current;
    const nextSearch = removeOpenFromGithubParam(location.search);
    const nextPath = buildSavedVoyageDashboardPath({
      currentSearch: nextSearch,
      workspace,
      session: savedVoyage,
      savedSessions: savedVoyages,
      voyageEntryId,
    });
    setDialog(null);
    navigate(nextPath, { replace: true });
  };

  const chooseVoyageForTarget = (target: PendingTarget) => {
    if (
      (target.type === "create-issue" || target.type === "create-tree-blob") &&
      target.createBranch === undefined
    ) {
      void showWorkMode(target);
      return;
    }
    setDialog({
      type: "choose-voyage",
      title: `${getTargetVerb(target)} in Voyage`,
      message:
        "Choose a recently opened Voyage to add this craft to, or create a new Voyage.",
      choices: getRecentVoyageChoices(latestRuntimeRef.current.savedVoyages),
      mode: {
        type: "target",
        target,
      },
    });
  };

  const showWorkMode = async (
    target:
      | Extract<PendingTarget, { type: "create-issue" }>
      | Extract<PendingTarget, { type: "create-tree-blob" }>,
  ) => {
    try {
      const branches = await vkClient.getRepoBranches(target.match.repo.id);
      const available = branches
        .map((branch) => branch.name)
        .filter((branch) => branchBelongsToRemoteOrLocal(branch, target.match.remote.name));
      const selectedBranch = target.type === "create-tree-blob"
        ? target.targetBranch
        : await getIssueTargetBranch(target.match);
      const configuredDefault = getRemoteDefaultBranch(
        target.match.repo.default_target_branch,
        target.match.remote.name,
      );
      const defaultCreateBranch =
        selectedBranch === configuredDefault ||
        selectedBranch === `${target.match.remote.name}/main`;
      setDialog({
        type: "choose-work-mode",
        target,
        branches: available.includes(selectedBranch)
          ? available
          : [selectedBranch, ...available],
        selectedBranch,
        defaultCreateBranch,
      });
    } catch (error) {
      setDialog({
        type: "error",
        title: "Could not load repository branches",
        message: error instanceof Error ? error.message : "Unknown branch lookup error.",
      });
    }
  };

  const selectVoyageForDialog = async (choice: ExistingVoyageChoice) => {
    if (dialog?.type !== "choose-voyage") return;
    if (dialog.mode.type === "existing-location") {
      await addExistingLocationToVoyage(dialog.mode.openLocation, choice);
      return;
    }
    await openWorkspaceInVoyage(dialog.mode.target, choice.savedVoyage);
  };

  const addExistingLocationToVoyage = async (
    openLocation: OpenWorkspaceLocation,
    choice: ExistingVoyageChoice,
  ) => {
    const result = await latestRuntimeRef.current.addSelectionToSavedSession({
      sessionId: choice.savedVoyage.id,
      spaceId: openLocation.spaceId,
      tabGroupId: openLocation.tabGroupId,
      voyageEntryId: choice.voyageEntryId,
    });
    const savedVoyage = result || choice.savedVoyage;
    const voyageEntryId =
      result?.activeVoyageEntryId || choice.voyageEntryId || undefined;
    openSavedVoyage(savedVoyage, voyageEntryId || savedVoyage.activeVoyageEntryId);
  };

  const createVoyageForDialog = async (name: string) => {
    if (dialog?.type !== "choose-voyage") return;
    if (dialog.mode.type === "existing-location") {
      await createVoyageFromExistingLocation(name, dialog.mode.openLocation);
      return;
    }
    await openWorkspaceInNewVoyage(dialog.mode.target, name);
  };

  const createVoyageFromExistingLocation = async (
    name: string,
    openLocation: OpenWorkspaceLocation,
  ) => {
    const savedVoyage =
      await latestRuntimeRef.current.createSavedSessionForSelection({
        name,
        spaceId: openLocation.spaceId,
        tabGroupId: openLocation.tabGroupId,
      });
    if (!savedVoyage) {
      setDialog({
        type: "error",
        title: "Could not create Voyage",
        message: "The existing craft could not be saved into a new Voyage.",
      });
      return;
    }
    openSavedVoyage(savedVoyage, savedVoyage.activeVoyageEntryId);
  };

  const getFallbackSpaceId = (preferredSpaceId?: string): string | undefined => {
    const { workspace } = latestRuntimeRef.current;
    if (
      preferredSpaceId &&
      workspace.spaces.some((space) => space.id === preferredSpaceId)
    ) {
      return preferredSpaceId;
    }
    return (
      workspace.spaces.find((space) => !space.isSystem)?.id ||
      workspace.spaces[0]?.id
    );
  };

  const openWorkspaceInVoyage = async (
    target: PendingTarget,
    savedVoyage: SavedWorkspaceSession,
  ): Promise<boolean> => {
    const spaceId = getFallbackSpaceId(savedVoyage.activeSpaceId);
    if (!spaceId) {
      setDialog({
        type: "error",
        title: "Could not open Voyage",
        message: "No space is available to host the new craft.",
      });
      clearParam();
      return false;
    }

    const result = await openWorkspaceInSpace(target, spaceId, {
      clearWhenDone: false,
      selectWhenDone: false,
    });
    if (!result) return false;

    const updatedVoyage =
      await latestRuntimeRef.current.addSelectionToSavedSession({
        sessionId: savedVoyage.id,
        spaceId,
        tabGroupId: result.tabGroupId,
        tabId: result.agentTabId,
      });
    openSavedVoyage(
      updatedVoyage || savedVoyage,
      updatedVoyage?.activeVoyageEntryId || savedVoyage.activeVoyageEntryId,
    );
    return true;
  };

  const openWorkspaceInNewVoyage = async (
    target: PendingTarget,
    name: string,
  ): Promise<boolean> => {
    const spaceId = getFallbackSpaceId();
    if (!spaceId) {
      setDialog({
        type: "error",
        title: "Could not create Voyage",
        message: "No space is available to host the new craft.",
      });
      clearParam();
      return false;
    }

    const result = await openWorkspaceInSpace(target, spaceId, {
      clearWhenDone: false,
      selectWhenDone: false,
    });
    if (!result) return false;

    const savedVoyage =
      await latestRuntimeRef.current.createSavedSessionForSelection({
        name,
        spaceId,
        tabGroupId: result.tabGroupId,
        tabId: result.agentTabId,
      });
    if (!savedVoyage) {
      setDialog({
        type: "error",
        title: "Could not create Voyage",
        message: "The new craft could not be saved into a new Voyage.",
      });
      return false;
    }

    openSavedVoyage(savedVoyage, savedVoyage.activeVoyageEntryId);
    return true;
  };

  const openWorkspaceInSpace = async (
    target: PendingTarget,
    spaceId: string,
    options: { clearWhenDone?: boolean; selectWhenDone?: boolean } = {},
  ): Promise<
    | {
        tabGroupId: string;
        agentTabId: string;
      }
    | false
  > => {
    const { clearWhenDone = true, selectWhenDone = true } = options;
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

      if (result && selectWhenDone) {
        latestRuntimeRef.current.selectSessionTab(
          spaceId,
          result.tabGroupId,
          result.agentTabId,
        );
      }

      setDialog(null);
      if (clearWhenDone) {
        clearParam();
      }
      return result
        ? {
            tabGroupId: result.tabGroupId,
            agentTabId: result.agentTabId,
          }
        : false;
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
          create_branch: target.createBranch ?? true,
          checkout_branch: target.createBranch === false ? target.checkoutBranch : null,
          name: target.workspaceName,
        })
      ).workspace;
      if (!isCurrentTarget()) throw new StaleOpenFromGithubRunError();
      return workspace;
    }

    if (target.type === "create-issue") {
      const targetBranch = target.targetBranch ?? await getIssueTargetBranch(target.match);
      if (!isCurrentTarget()) throw new StaleOpenFromGithubRunError();
      const workspace = await createIssueWorkspaceOnce(target, targetBranch);
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

  const finishProvisionedTarget = async (
    target: UnclonedTarget,
    repoUrl: string,
    upstreamRepoUrl?: string,
  ) => {
    setDialog({
      type: "processing",
      title: "Preparing GitHub repository",
      message: `Cloning and registering ${repoUrl}`,
    });
    const ensured = upstreamRepoUrl
      ? await vkClient.ensureGithubRepo(repoUrl, upstreamRepoUrl)
      : await vkClient.ensureGithubRepo(repoUrl);
    const remotes = await vkClient.getRepoRemotes(ensured.repo.id).catch(() => []);
    const source = target.type === "pr" ? target.parsed : target.type === "issue" ? target.issue : target.target;
    const matches = findMatchingRepoRemotes(
      [ensured.repo],
      new Map([[ensured.repo.id, remotes]]),
      source,
    );
    const match = matches[0] ?? {
      repo: ensured.repo,
      remote: {
        name: upstreamRepoUrl ? "upstream" : "origin",
        url: upstreamRepoUrl ?? repoUrl,
      },
    };

    if (target.type === "pr") {
      chooseVoyageForTarget({ type: "create", match, prInfo: target.prInfo });
    } else if (target.type === "issue") {
      chooseVoyageForTarget({ type: "create-issue", match, issue: target.issue });
    } else {
      await resolveTreeBlobMatch(match, target.target, () => false);
    }
  };

  const chooseCloneIntent = async (
    target: UnclonedTarget,
    intent: "analysis" | "changes",
  ) => {
    const sourceRepoUrl = `https://github.com/${
      target.type === "pr"
        ? target.parsed.normalizedRepo
        : target.type === "issue"
          ? target.issue.normalizedRepo
          : target.target.normalizedRepo
    }`;
    try {
      if (intent === "analysis") {
        await finishProvisionedTarget(target, sourceRepoUrl);
        return;
      }

      setDialog({
        type: "processing",
        title: "Checking GitHub access",
        message: `Checking push access with gh CLI for ${sourceRepoUrl}`,
      });
      const access = await vkClient.getGithubRepoAccess(sourceRepoUrl);
      if (access.sourceCanPush) {
        await finishProvisionedTarget(target, sourceRepoUrl);
      } else if (access.writableForks.length === 1 && access.writableForks[0]) {
        await finishProvisionedTarget(
          target,
          `https://github.com/${access.writableForks[0].fullName}`,
          sourceRepoUrl,
        );
      } else if (access.writableForks.length > 1) {
        setDialog({
          type: "choose-fork",
          target,
          sourceRepoUrl,
          forks: access.writableForks,
        });
      } else {
        window.open(access.forkUrl, "_blank", "noopener,noreferrer");
        setDialog({
          type: "await-fork",
          target,
          sourceRepoUrl,
          forkUrl: access.forkUrl,
          viewer: access.viewer,
        });
      }
    } catch (error) {
      setDialog({
        type: "error",
        title: "Could not prepare GitHub repository",
        message: error instanceof Error ? error.message : "Unknown GitHub repository error.",
      });
    }
  };

  useEffect(() => {
    if (dialog?.type !== "await-fork") return;
    const recheck = () => {
      if (document.visibilityState === "visible") {
        void chooseCloneIntent(dialog.target, "changes");
      }
    };
    window.addEventListener("focus", recheck);
    document.addEventListener("visibilitychange", recheck);
    return () => {
      window.removeEventListener("focus", recheck);
      document.removeEventListener("visibilitychange", recheck);
    };
  }, [dialog]);

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
          if (!isNotFoundError(error)) {
            throw error;
          }
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
          routeExistingLocation({
            openLocation,
            title: "Open existing issue workspace?",
            message: `GitHub issue ${issue.normalizedIssueUrl} is already open in multiple Voyages. Choose which one to open.`,
          });
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

        chooseVoyageForTarget({
          type: "existing-issue",
          workspace: existingWorkspace,
          issue,
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

    setDialog({ type: "choose-clone-intent", target: { type: "issue", issue } });
    return null;
  };

  const showCreateIssueOptions = async (
    issue: ParsedGithubIssueUrl,
    isCancelled: () => boolean,
  ) => {
    const matches = await findOrEnsureIssueRepo(issue, isCancelled);
    if (isCancelled()) return;
    if (matches === null) return;
    if (matches.length === 1 && matches[0]) {
      chooseVoyageForTarget({ type: "create-issue", match: matches[0], issue });
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
      if (matches === null) return;

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
      type: "choose-clone-intent",
      target: { type: "tree-blob", target },
    });
    return null;
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

    if (target.kind === "tree" && target.segments.length === 0) {
      const preferredBranch = selectPreferredRemoteBranch(
        branches.map((branch) => branch.name),
        match.repo.default_target_branch,
        match.remote.name,
      );
      if (preferredBranch) {
        chooseVoyageForTarget({
            type: "create-tree-blob",
            match,
            target: {
              kind: "tree",
              owner: target.owner,
              repo: target.repo,
              normalizedRepo: target.normalizedRepo,
              ref: getGithubRefForTargetBranchName(
                preferredBranch,
                match.remote.name,
              ),
              path: null,
              normalizedUrl: target.normalizedUrl,
              permalinkCommit: null,
            },
          targetBranch: preferredBranch,
        });
        return;
      }
    }

    const branchResult = resolveGithubTreeBlobBranch(
      target,
      branches,
      match.remote.name,
    );
    if (branchResult) {
      chooseVoyageForTarget({
          type: "create-tree-blob",
          match,
          target: branchResult.resolved,
        targetBranch: branchResult.targetBranch,
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
      match.remote.name,
    );
    if (bestBranch) {
      chooseVoyageForTarget({
          type: "create-tree-blob",
          match,
          target: commitTarget,
        targetBranch: bestBranch,
      });
      return;
    }

    const availableBranches = (
      containingBranches.length
        ? containingBranches
        : branches.map((branch) => branch.name)
    ).filter((branch) =>
      branchBelongsToRemoteOrLocal(branch, match.remote.name),
    );
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
            "Only GitHub pull request, issue, repo root, tree, and blob URLs are supported for external_view_url.",
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
        const [activeSummaries, archivedSummaries] = await Promise.all([
          vkClient.getWorkspaceSummaries(false),
          vkClient.getWorkspaceSummaries(true),
        ]);
        const existingWorkspaceIds = findWorkspaceIdsForPr(
          [...activeSummaries.summaries, ...archivedSummaries.summaries],
          parsedPr,
          prInfo,
        );

        if (cancelled) return;

        if (existingWorkspaceIds.length > 1) {
          const existingWorkspaces = await Promise.all(
            existingWorkspaceIds.map((id) => vkClient.getWorkspace(id)),
          );
          if (cancelled) return;
          setDialog({
            type: "choose-pr-workspace",
            workspaces: existingWorkspaces.sort(
              (left, right) => Number(left.archived) - Number(right.archived),
            ),
            prInfo,
          });
          return;
        }

        const existingWorkspaceId = existingWorkspaceIds[0];
        if (existingWorkspaceId) {
          const openLocation = findOpenWorkspaceLocation(
            latestRuntimeRef.current.workspace,
            existingWorkspaceId,
          );
          if (openLocation) {
            routeExistingLocation({
              openLocation,
              title: "Open existing PR workspace?",
              message: `PR #${prInfo.number}: ${prInfo.title} is already open in multiple Voyages. Choose which one to open.`,
            });
            return;
          }

          const existingWorkspace =
            await vkClient.getWorkspace(existingWorkspaceId);
          if (cancelled) return;
          chooseVoyageForTarget({
            type: "existing",
            workspace: existingWorkspace,
            prInfo,
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
            type: "choose-clone-intent",
            target: { type: "pr", parsed: parsedPr, prInfo },
          });
          return;
        }

        if (matches.length === 1) {
          const [match] = matches;
          if (!match) return;
          chooseVoyageForTarget({ type: "create", match, prInfo });
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
          chooseVoyageForTarget({
            type: "create",
            match,
            prInfo: dialog.target.prInfo,
          });
          return;
        }
        if (dialog.target.type === "issue") {
          chooseVoyageForTarget({
            type: "create-issue",
            match,
            issue: dialog.target.issue,
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
      onSelectPrWorkspace={(selectedWorkspace) => {
        if (dialog?.type !== "choose-pr-workspace") return;
        chooseVoyageForTarget({
          type: "existing",
          workspace: selectedWorkspace,
          prInfo: dialog.prInfo,
        });
      }}
      onSelectCloneIntent={(intent) => {
        if (dialog?.type !== "choose-clone-intent") return;
        void chooseCloneIntent(dialog.target, intent);
      }}
      onSelectFork={(fork) => {
        if (dialog?.type !== "choose-fork") return;
        void finishProvisionedTarget(
          dialog.target,
          `https://github.com/${fork.fullName}`,
          dialog.sourceRepoUrl,
        );
      }}
      onRecheckFork={() => {
        if (dialog?.type !== "await-fork") return;
        void chooseCloneIntent(dialog.target, "changes");
      }}
      onSelectBranch={(branch) => {
        if (dialog?.type !== "choose-branch") return;
        chooseVoyageForTarget({
            type: "create-tree-blob",
            match: dialog.match,
            target: dialog.target,
          targetBranch: branch,
        });
      }}
      onConfirmWorkMode={({ branch, createBranch, workspaceName }) => {
        if (dialog?.type !== "choose-work-mode") return;
        const configuredDefault = getRemoteDefaultBranch(
          dialog.target.match.repo.default_target_branch,
          dialog.target.match.remote.name,
        ) ?? `${dialog.target.match.remote.name}/main`;
        chooseVoyageForTarget({
          ...dialog.target,
          targetBranch: createBranch ? branch : configuredDefault,
          checkoutBranch: createBranch ? undefined : branch,
          createBranch,
          workspaceName,
        });
      }}
      onSelectSpace={(spaceId) => {
        if (dialog?.type !== "choose-space") return;
        void openWorkspaceInSpace(dialog.target, spaceId);
      }}
      onSelectVoyage={(choice) => {
        void selectVoyageForDialog(choice);
      }}
      onConfirmReopenArchived={() => {
        if (dialog?.type !== "confirm-reopen-archived") return;
        chooseVoyageForTarget({
          type: "existing-issue",
          workspace: dialog.workspace,
          issue: dialog.issue,
        });
      }}
      onForgetStaleIssueMapping={() => {
        if (dialog?.type !== "stale-issue-mapping") return;
        void forgetStaleIssueMappingAndCreateReplacement(dialog.issue);
      }}
      onCreateSpace={(name) => {
        void createSpaceAndOpen(name);
      }}
      onCreateVoyage={(name) => {
        void createVoyageForDialog(name);
      }}
    />
  );
}

function findSavedVoyagesForTabGroup(
  savedVoyages: SavedWorkspaceSession[],
  tabGroupId: string,
): ExistingVoyageChoice[] {
  return savedVoyages
    .flatMap((savedVoyage) => {
      const matchingEntries = savedVoyage.voyageEntries.filter(
        (entry) => entry.tabGroupId === tabGroupId,
      );
      if (!matchingEntries.length) return [];
      const activeMatchingEntry = matchingEntries.find(
        (entry) => entry.id === savedVoyage.activeVoyageEntryId,
      );
      const entry = activeMatchingEntry || matchingEntries[0];
      return entry ? [{ savedVoyage, voyageEntryId: entry.id }] : [];
    })
    .sort(
      (a, b) =>
        Date.parse(b.savedVoyage.updatedAt) - Date.parse(a.savedVoyage.updatedAt),
    );
}

function getRecentVoyageChoices(
  savedVoyages: SavedWorkspaceSession[],
): ExistingVoyageChoice[] {
  return [...savedVoyages]
    .sort(
      (a, b) =>
        Date.parse(b.updatedAt) - Date.parse(a.updatedAt),
    )
    .map((savedVoyage) => ({
      savedVoyage,
      voyageEntryId: savedVoyage.activeVoyageEntryId,
    }));
}

function formatVoyageTimestamp(value: string): string {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return value;
  return new Date(timestamp).toLocaleString();
}

class StaleOpenFromGithubRunError extends Error {
  constructor() {
    super("Stale external_view_url run");
    this.name = "StaleOpenFromGithubRunError";
  }
}

function isNotFoundError(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "status" in error &&
      (error as { status?: unknown }).status === 404,
  );
}

const issueWorkspaceCreations = new Map<string, Promise<VkWorkspace>>();

function createIssueWorkspaceOnce(
  target: Extract<PendingTarget, { type: "create-issue" }>,
  targetBranch: string,
): Promise<VkWorkspace> {
  const key = `${target.issue.owner.toLowerCase()}/${target.issue.repo.toLowerCase()}#${target.issue.number}`;
  const active = issueWorkspaceCreations.get(key);
  if (active) return active;

  const creation = (async () => {
    const workspace = (
      await vkClient.createWorkspaceFromIssue({
        repo_id: target.match.repo.id,
        target_branch: targetBranch,
        issue_url: target.issue.normalizedIssueUrl,
        issue_number: target.issue.number,
        run_setup: true,
        create_branch: target.createBranch ?? true,
        checkout_branch: target.createBranch === false ? target.checkoutBranch : null,
        name: target.workspaceName,
      })
    ).workspace;

    let lastError: unknown;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        await vkClient.putGithubIssueWorkspaceMapping({
          owner: target.issue.owner.toLowerCase(),
          repo: target.issue.repo.toLowerCase(),
          number: target.issue.number,
          workspaceId: workspace.id,
          branch: workspace.branch,
        });
        return workspace;
      } catch (error) {
        lastError = error;
        if (attempt < 3) {
          await new Promise((resolve) => setTimeout(resolve, attempt * 250));
        }
      }
    }

    const detail = lastError instanceof Error ? ` ${lastError.message}` : "";
    throw new Error(
      `Workspace ${workspace.name || workspace.id} was created, but VD could not save its GitHub issue mapping after three attempts. The workspace was left intact. Open it from VK and retry the issue later.${detail}`,
    );
  })().finally(() => {
    issueWorkspaceCreations.delete(key);
  });

  issueWorkspaceCreations.set(key, creation);
  return creation;
}

function getGithubRefForTargetBranchName(
  branchName: string,
  remoteName: string,
): string {
  return branchName.startsWith(`${remoteName}/`)
    ? branchName.slice(remoteName.length + 1)
    : branchName;
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

async function getIssueTargetBranch(match: MatchingRepoRemote): Promise<string> {
  const fallback = getRemoteDefaultBranch(
    match.repo.default_target_branch,
    match.remote.name,
  ) ?? `${match.remote.name}/main`;

  let branches: Awaited<ReturnType<typeof vkClient.getRepoBranches>>;
  try {
    branches = await vkClient.getRepoBranches(match.repo.id);
  } catch {
    // If branch discovery fails, keep issue provisioning usable by falling back
    // to the backend's configured repo default, scoped to the matched remote.
    return fallback;
  }

  const selected = selectPreferredRemoteBranch(
    branches.map((branch) => branch.name),
    match.repo.default_target_branch,
    match.remote.name,
  );
  if (selected) {
    return selected;
  }

  throw new Error(
    `Could not find ${fallback} or ${match.remote.name}/main in fetched branches for ${match.repo.display_name || match.repo.name}. ` +
      `Fetch ${match.remote.name} and try again.`,
  );
}

function OpenFromGithubDialog({
  state,
  workspace,
  onClose,
  onSelectRepo,
  onSelectPrWorkspace,
  onSelectCloneIntent,
  onSelectFork,
  onRecheckFork,
  onSelectSpace,
  onSelectVoyage,
  onSelectBranch,
  onConfirmWorkMode,
  onCreateSpace,
  onCreateVoyage,
  onConfirmReopenArchived,
  onForgetStaleIssueMapping,
}: {
  state: DialogState;
  workspace: WorkspaceState;
  onClose: () => void;
  onSelectRepo: (match: MatchingRepoRemote) => void;
  onSelectPrWorkspace: (workspace: VkWorkspace) => void;
  onSelectCloneIntent: (intent: "analysis" | "changes") => void;
  onSelectFork: (fork: { fullName: string; cloneUrl: string }) => void;
  onRecheckFork: () => void;
  onSelectSpace: (spaceId: string) => void;
  onSelectVoyage: (choice: ExistingVoyageChoice) => void;
  onSelectBranch: (branch: string) => void;
  onConfirmWorkMode: (args: {
    branch: string;
    createBranch: boolean;
    workspaceName: string;
  }) => void;
  onCreateSpace: (name: string) => void;
  onCreateVoyage: (name: string) => void;
  onConfirmReopenArchived: () => void;
  onForgetStaleIssueMapping: () => void;
}) {
  const [newSpaceName, setNewSpaceName] = useState("");
  const [newVoyageName, setNewVoyageName] = useState("");
  const [workModeBranch, setWorkModeBranch] = useState("");
  const [createWorkBranch, setCreateWorkBranch] = useState(true);
  const [workspaceName, setWorkspaceName] = useState("");

  useEffect(() => {
    if (state?.type !== "choose-work-mode") return;
    setWorkModeBranch(state.selectedBranch);
    setCreateWorkBranch(state.defaultCreateBranch);
    setWorkspaceName(
      state.target.type === "create-issue"
        ? `Issue #${state.target.issue.number}`
        : `GitHub ${state.target.target.kind} ${state.target.target.ref}`,
    );
  }, [state]);

  if (!state) return null;

  const spaces = workspace.spaces.filter((space) => !space.isSystem);
  const title =
    state.type === "choose-repo"
      ? "Choose repository"
      : state.type === "choose-pr-workspace"
        ? "Choose PR workspace"
      : state.type === "choose-clone-intent"
        ? "How will you use this repository?"
      : state.type === "choose-fork"
        ? "Choose a writable fork"
      : state.type === "await-fork"
        ? "Create a GitHub fork"
      : state.type === "choose-work-mode"
        ? "Choose branch and workspace mode"
      : state.type === "choose-space"
        ? `${getTargetVerb(state.target)} in space`
        : state.type === "confirm-reopen-archived"
          ? "Reopen archived issue workspace?"
          : state.type === "stale-issue-mapping"
            ? "Issue workspace no longer exists"
            : state.type === "choose-voyage"
              ? state.title
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
      : state.type === "choose-pr-workspace"
        ? `Multiple workspaces match PR #${state.prInfo.number}. Choose the workspace to open.`
      : state.type === "choose-clone-intent"
        ? "This repository is not cloned yet. Analysis clones the source repository. Making changes checks your gh CLI account for push access or a writable fork."
      : state.type === "choose-fork"
        ? "Several writable forks are available to your authenticated gh CLI account."
      : state.type === "await-fork"
        ? `No writable fork was found for ${state.viewer}. Create one on GitHub, then return to this window. VD rechecks automatically on focus.`
      : state.type === "choose-work-mode"
        ? "Choose a branch. Non-default branches work directly by default. Protected or default base branches create a new editable workspace branch by default."
      : state.type === "choose-space"
        ? state.target.type === "create-tree-blob"
          ? state.target.createBranch === false
            ? `Work directly on ${state.target.checkoutBranch}. Changes will target ${state.target.targetBranch}.`
            : `Create an editable workspace branch from ${state.target.targetBranch}.`
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

        {state.type === "choose-pr-workspace" ? (
          <div className="space-y-2">
            {state.workspaces.map((candidate) => (
              <button
                key={candidate.id}
                type="button"
                className="w-full rounded-lg border border-neutral-700 bg-neutral-800 p-3 text-left transition-colors hover:bg-neutral-700"
                onClick={() => onSelectPrWorkspace(candidate)}
              >
                <div className="text-sm font-medium text-white">
                  {candidate.name || candidate.branch}
                </div>
                <div className="mt-1 text-xs text-neutral-400">
                  {candidate.archived ? "Archived" : "Active"}
                </div>
              </button>
            ))}
          </div>
        ) : null}

        {state.type === "choose-clone-intent" ? (
          <div className="space-y-2">
            <button type="button" className="w-full rounded-lg border border-neutral-700 bg-neutral-800 p-3 text-left hover:bg-neutral-700" onClick={() => onSelectCloneIntent("changes")}>
              <div className="text-sm font-medium text-white">Make changes</div>
              <div className="mt-1 text-xs text-neutral-400">Use a writable source repository or fork.</div>
            </button>
            <button type="button" className="w-full rounded-lg border border-neutral-700 bg-neutral-800 p-3 text-left hover:bg-neutral-700" onClick={() => onSelectCloneIntent("analysis")}>
              <div className="text-sm font-medium text-white">Analyze only</div>
              <div className="mt-1 text-xs text-neutral-400">Clone the linked source repository without requiring a fork.</div>
            </button>
          </div>
        ) : null}

        {state.type === "choose-fork" ? (
          <div className="space-y-2">
            {state.forks.map((fork) => (
              <button key={fork.fullName} type="button" className="w-full rounded-lg border border-neutral-700 bg-neutral-800 p-3 text-left hover:bg-neutral-700" onClick={() => onSelectFork(fork)}>
                <div className="text-sm font-medium text-white">{fork.fullName}</div>
              </button>
            ))}
          </div>
        ) : null}

        {state.type === "await-fork" ? (
          <div className="space-y-2">
            <a href={state.forkUrl} target="_blank" rel="noreferrer" className="block w-full rounded-lg bg-blue-600 px-3 py-2 text-center text-sm font-medium text-white hover:bg-blue-500">Open GitHub fork page</a>
            <button type="button" className="w-full rounded-lg border border-neutral-700 px-3 py-2 text-sm text-white hover:bg-neutral-800" onClick={onRecheckFork}>Check again</button>
            <button type="button" className="w-full rounded-lg border border-neutral-700 px-3 py-2 text-sm text-neutral-300 hover:bg-neutral-800" onClick={() => onSelectCloneIntent("analysis")}>Continue as analysis only</button>
          </div>
        ) : null}

        {state.type === "choose-work-mode" ? (
          <div className="space-y-3">
            <label className="block text-sm text-neutral-300">
              Branch
              <select value={workModeBranch} onChange={(event) => setWorkModeBranch(event.target.value)} className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-800 p-2 text-white">
                {state.branches.map((branch) => <option key={branch} value={branch}>{branch}</option>)}
              </select>
            </label>
            <label className="flex items-start gap-2 rounded-lg border border-neutral-700 bg-neutral-800 p-3 text-sm text-white">
              <input type="checkbox" checked={createWorkBranch} onChange={(event) => setCreateWorkBranch(event.target.checked)} />
              <span>Create a new branch from this base. Clear this to work directly on the selected branch.</span>
            </label>
            {createWorkBranch ? (
              <label className="block text-sm text-neutral-300">
                Suggested workspace name
                <input value={workspaceName} onChange={(event) => setWorkspaceName(event.target.value)} className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-800 p-2 text-white" />
              </label>
            ) : null}
            <button type="button" className="w-full rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-500" disabled={!workModeBranch || (createWorkBranch && !workspaceName.trim())} onClick={() => onConfirmWorkMode({ branch: workModeBranch, createBranch: createWorkBranch, workspaceName: workspaceName.trim() || `Direct ${workModeBranch}` })}>Continue</button>
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

        {state.type === "choose-voyage" ? (
          <div className="space-y-4">
            <div className="space-y-2">
              {state.choices.length === 0 ? (
                <div className="rounded-lg border border-neutral-800 bg-neutral-950 p-3 text-sm text-neutral-500">
                  No recently opened Voyages yet. Create one below.
                </div>
              ) : (
                state.choices.map((choice) => (
                  <button
                    key={`${choice.savedVoyage.id}:${choice.voyageEntryId || "active"}`}
                    type="button"
                    className="w-full rounded-lg border border-neutral-700 bg-neutral-800 p-3 text-left transition-colors hover:bg-neutral-700"
                    onClick={() => onSelectVoyage(choice)}
                  >
                    <div className="text-sm font-medium text-white">
                      {choice.savedVoyage.name}
                    </div>
                    <div className="mt-1 text-xs text-neutral-400">
                      Updated {formatVoyageTimestamp(choice.savedVoyage.updatedAt)}
                    </div>
                  </button>
                ))
              )}
            </div>

            <div className="flex gap-2 border-t border-neutral-800 pt-4">
              <input
                className="min-w-0 flex-1 rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-white outline-none focus:border-neutral-500"
                placeholder="New Voyage name"
                value={newVoyageName}
                onChange={(event) => setNewVoyageName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && newVoyageName.trim()) {
                    onCreateVoyage(newVoyageName.trim());
                    setNewVoyageName("");
                  }
                }}
              />
              <button
                type="button"
                disabled={!newVoyageName.trim()}
                className="rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
                onClick={() => {
                  if (!newVoyageName.trim()) return;
                  onCreateVoyage(newVoyageName.trim());
                  setNewVoyageName("");
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
