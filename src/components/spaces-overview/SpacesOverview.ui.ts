import type { SpacesOverviewUIPack } from "./SpacesOverview.contracts";

export function createSpacesOverviewUI(
  ui: SpacesOverviewUIPack,
): SpacesOverviewUIPack {
  return ui;
}

export function extendSpacesOverviewUI(
  base: SpacesOverviewUIPack,
  overrides: Partial<SpacesOverviewUIPack>,
): SpacesOverviewUIPack {
  return {
    ...base,
    ...overrides,
  };
}
