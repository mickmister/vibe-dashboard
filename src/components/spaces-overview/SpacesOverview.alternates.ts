import { DenseWorkspaceListSection } from "./DenseWorkspaceListSection.view";
import { defaultSpacesOverviewUI } from "./DefaultSpacesOverview.view";
import type { SpacesOverviewUIPack } from "./SpacesOverview.contracts";
import { extendSpacesOverviewUI } from "./SpacesOverview.ui";

export const denseWorkspaceListSpacesOverviewUI: SpacesOverviewUIPack =
  extendSpacesOverviewUI(defaultSpacesOverviewUI, {
    WorkspaceListSection: DenseWorkspaceListSection,
  });
