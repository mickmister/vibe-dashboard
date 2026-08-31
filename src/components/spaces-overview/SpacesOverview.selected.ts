import {
  defaultSpacesOverviewUI,
  DefaultSpacesOverviewLayout,
} from "./DefaultSpacesOverview.view";
import type { SpacesOverviewPresentation } from "./SpacesOverview.contracts";

export const selectedSpacesOverviewUI = defaultSpacesOverviewUI;

export const selectedSpacesOverviewView: SpacesOverviewPresentation = (props) =>
  DefaultSpacesOverviewLayout({
    ...props,
    ui: selectedSpacesOverviewUI,
  });
