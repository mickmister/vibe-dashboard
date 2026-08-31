import type {
  SpacesOverviewComponentProps,
  SpacesOverviewUIPack,
  SpacesOverviewViewActions,
  SpacesOverviewViewModel,
} from "./SpacesOverview.contracts";
import {
  RecentlyCreatedTabGroups,
  RecentlyVisitedTabGroups,
  RecentSessionsSection,
  SpacesSection,
  StarredTabGroups,
} from "./craftSections.view";
import { RunningDevServersSection } from "./RunningDevServersSection.view";
import { SpacePickerModal } from "./SpacePickerModal.view";
import { Pagination, RepoFilterBar, WorkspaceRow } from "./workspaceList.view";
import { createSpacesOverviewUI } from "./SpacesOverview.ui";

export function DefaultPageHeader(_props: SpacesOverviewComponentProps) {
  return (
    <div className="mb-6">
      <h1 className="text-2xl font-bold text-white">Dashboard</h1>
      <p className="text-sm text-zinc-500 mt-1">Workspace activity feed</p>
    </div>
  );
}

export function DefaultRecentSessionsSection({
  model,
  actions,
}: SpacesOverviewComponentProps) {
  return <RecentSessionsSection model={model} actions={actions} />;
}

export function DefaultStarredCraftSection({
  model,
  actions,
}: SpacesOverviewComponentProps) {
  return (
    <StarredTabGroups
      items={model.starredTabGroups}
      onNavigateToTabGroup={actions.navigateToTabGroup}
      tabGroupDisplayLabelById={model.tabGroupDisplayLabelById}
    />
  );
}

export function DefaultRunningDevServersSection({
  model,
  actions,
}: SpacesOverviewComponentProps) {
  return (
    <RunningDevServersSection
      workspaces={model.workspaces}
      loading={model.loading}
      onStop={actions.stopDevServer}
      stoppingIds={model.stoppingDevServerIds}
      workspaceTabGroupMap={model.workspaceTabGroupMap}
      onNavigateToTabGroup={actions.navigateToTabGroup}
      onRequestOpenWorkspace={
        model.canOpenWorkspaceInSpace
          ? actions.openSpacePickerForWorkspace
          : undefined
      }
    />
  );
}

export function DefaultRecentlyVisitedCraftSection({
  model,
  actions,
}: SpacesOverviewComponentProps) {
  return (
    <RecentlyVisitedTabGroups
      items={model.recentlyVisited.items}
      page={model.recentlyVisited.page}
      totalPages={model.recentlyVisited.totalPages}
      onPageChange={actions.setRecentlyVisitedPage}
      onNavigateToTabGroup={actions.navigateToTabGroup}
      tabGroupDisplayLabelById={model.tabGroupDisplayLabelById}
    />
  );
}

export function DefaultRecentlyCreatedCraftSection({
  model,
  actions,
}: SpacesOverviewComponentProps) {
  return (
    <RecentlyCreatedTabGroups
      items={model.recentlyCreated.items}
      page={model.recentlyCreated.page}
      totalPages={model.recentlyCreated.totalPages}
      onPageChange={actions.setRecentlyCreatedPage}
      onNavigateToTabGroup={actions.navigateToTabGroup}
      tabGroupDisplayLabelById={model.tabGroupDisplayLabelById}
    />
  );
}

export function DefaultWorkspaceListSection({
  model,
  actions,
}: SpacesOverviewComponentProps) {
  const {
    effectiveRepos,
    loading,
    error,
    selectedRepoId,
    sortedWorkspaces,
    pagedWorkspaces,
    workspacePage,
    workspaceTotalPages,
    stoppingDevServerIds,
    workspaceTabGroupMap,
    canOpenWorkspaceInSpace,
  } = model;

  return (
    <div className="mb-10">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold text-white">VK Workspaces</h2>
        {!loading && sortedWorkspaces.length > 0 && (
          <span className="text-xs text-zinc-500">
            {sortedWorkspaces.length} workspace
            {sortedWorkspaces.length !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      <RepoFilterBar
        repos={effectiveRepos}
        selectedRepoId={selectedRepoId}
        onSelectRepo={actions.selectRepo}
      />

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="w-6 h-6 border-2 border-zinc-600 border-t-zinc-300 rounded-full animate-spin" />
        </div>
      ) : error ? (
        <div className="text-center py-8">
          <p className="text-zinc-500 text-sm">{error}</p>
          <p className="text-zinc-600 text-xs mt-1">
            VK backend may not be running
          </p>
        </div>
      ) : sortedWorkspaces.length === 0 ? (
        <div className="text-center py-8">
          <p className="text-zinc-500 text-sm">
            {selectedRepoId
              ? "No workspaces for this repository"
              : "No active workspaces"}
          </p>
        </div>
      ) : (
        <>
          <div className="space-y-1">
            {pagedWorkspaces.map((workspace) => {
              const nav = workspaceTabGroupMap.get(workspace.id);
              const tabGroupNav = nav
                ? {
                    ...nav,
                    onNavigate: () =>
                      actions.navigateToTabGroup(nav.spaceId, nav.tabGroupId),
                  }
                : null;
              return (
                <WorkspaceRow
                  key={workspace.id}
                  workspace={workspace}
                  isStoppingDevServer={stoppingDevServerIds.has(workspace.id)}
                  onStopDevServer={
                    workspace.has_running_dev_server ||
                    stoppingDevServerIds.has(workspace.id)
                      ? () => actions.stopDevServer(workspace.id)
                      : undefined
                  }
                  {...(tabGroupNav ? { tabGroupNav } : {})}
                  {...(!tabGroupNav && canOpenWorkspaceInSpace
                    ? {
                        onOpenInNewTabGroup: () =>
                          actions.openSpacePickerForWorkspace(workspace),
                      }
                    : {})}
                />
              );
            })}
          </div>
          <Pagination
            page={workspacePage}
            totalPages={workspaceTotalPages}
            onPageChange={actions.setWorkspacePage}
          />
        </>
      )}
    </div>
  );
}

export function DefaultSpacesSection({
  model,
  actions,
}: SpacesOverviewComponentProps) {
  if (!model.hasSpaces) return null;

  return (
    <>
      <div className="border-t border-zinc-800 my-8" />
      <SpacesSection
        spacesWithTabGroups={model.spacesWithTabGroups}
        onNavigateToTabGroup={actions.navigateToTabGroup}
        tabGroupDisplayLabelById={model.tabGroupDisplayLabelById}
      />
    </>
  );
}

export function DefaultSpacePickerModal({
  model,
  actions,
}: SpacesOverviewComponentProps) {
  const {
    workspace,
    spacePickerTarget,
    pendingOpenCraftRequest,
    openCraftRetryRequest,
    openCraftActionError,
    canOpenWorkspaceInSpace,
  } = model;

  if (!(spacePickerTarget && canOpenWorkspaceInSpace)) return null;

  return (
    <SpacePickerModal
      workspace={workspace}
      targetWorkspace={spacePickerTarget}
      onSelect={(spaceId) => {
        actions.runOpenCraftRequest({
          workspace: spacePickerTarget,
          spaceId,
        });
      }}
      onClose={actions.closeSpacePicker}
      pendingSpaceId={
        pendingOpenCraftRequest?.workspace.id === spacePickerTarget.id
          ? pendingOpenCraftRequest.spaceId
          : null
      }
      actionError={openCraftActionError}
      onRetry={openCraftRetryRequest ? actions.retryOpenCraftRequest : undefined}
    />
  );
}

export const defaultSpacesOverviewUI = createSpacesOverviewUI({
  PageHeader: DefaultPageHeader,
  RecentSessionsSection: DefaultRecentSessionsSection,
  StarredCraftSection: DefaultStarredCraftSection,
  RunningDevServersSection: DefaultRunningDevServersSection,
  RecentlyVisitedCraftSection: DefaultRecentlyVisitedCraftSection,
  RecentlyCreatedCraftSection: DefaultRecentlyCreatedCraftSection,
  WorkspaceListSection: DefaultWorkspaceListSection,
  SpacesSection: DefaultSpacesSection,
  SpacePickerModal: DefaultSpacePickerModal,
});

export function DefaultSpacesOverviewLayout({
  model,
  actions,
  ui,
}: {
  model: SpacesOverviewViewModel;
  actions: SpacesOverviewViewActions;
  ui: SpacesOverviewUIPack;
}) {
  return (
    <div className="h-full w-full overflow-auto bg-zinc-900 p-6 md:p-8">
      <div className="max-w-4xl mx-auto">
        <ui.PageHeader model={model} actions={actions} />
        <ui.RecentSessionsSection model={model} actions={actions} />
        <ui.StarredCraftSection model={model} actions={actions} />
        <ui.RunningDevServersSection model={model} actions={actions} />
        <ui.RecentlyVisitedCraftSection model={model} actions={actions} />
        <ui.RecentlyCreatedCraftSection model={model} actions={actions} />
        <ui.WorkspaceListSection model={model} actions={actions} />
        <ui.SpacesSection model={model} actions={actions} />
      </div>
      <ui.SpacePickerModal model={model} actions={actions} />
    </div>
  );
}

export function DefaultSpacesOverviewView(
  props: SpacesOverviewComponentProps,
) {
  return <DefaultSpacesOverviewLayout {...props} ui={defaultSpacesOverviewUI} />;
}
