import React from "react";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SpacesOverviewView, type DashboardWorkspace } from "../SpacesOverview";
import { DefaultSpacesOverviewLayout } from "./DefaultSpacesOverview.view";
import { denseWorkspaceListSpacesOverviewUI } from "./SpacesOverview.alternates";
import type { SpacesOverviewPresentation } from "./SpacesOverview.contracts";
import { lightStudioSkin } from "../../theme/skins";
import {
  storybookRepoBranches,
  storybookRepos,
  storybookSavedSessions,
  storybookVKWorkspaces,
  storybookWorkspace,
  storybookWorkspaceSummaries,
} from "../../stories/fixtures";

const skinnedViewFiles = [
  "src/components/spaces-overview/DefaultSpacesOverview.view.tsx",
  "src/components/spaces-overview/DenseWorkspaceListSection.view.tsx",
  "src/components/spaces-overview/RunningDevServersSection.view.tsx",
  "src/components/spaces-overview/SpacePickerModal.view.tsx",
  "src/components/spaces-overview/craftSections.view.tsx",
  "src/components/spaces-overview/workspaceList.view.tsx",
];

const hardcodedTextColorUtility =
  /\b(?:hover:|group-hover:|disabled:hover:)?text-(?:white|black|zinc|slate|gray|neutral|stone|red|green|amber|yellow|blue|cyan|indigo|violet|purple|primary)-[^\s"`']+/g;

const dashboardWorkspaces: DashboardWorkspace[] = storybookVKWorkspaces.map(
  (workspace) => {
    const summary = storybookWorkspaceSummaries.find(
      (candidate) => candidate.workspace_id === workspace.id,
    );
    return {
      id: workspace.id,
      name: workspace.name || workspace.branch,
      branch: workspace.branch,
      pinned: workspace.pinned,
      created_at: workspace.created_at,
      updated_at: workspace.updated_at,
      task_id: workspace.task_id,
      container_ref: workspace.container_ref,
      files_changed: summary?.files_changed ?? null,
      lines_added: summary?.lines_added ?? null,
      lines_removed: summary?.lines_removed ?? null,
      latest_process_status: summary?.latest_process_status ?? null,
      latest_process_completed_at: summary?.latest_process_completed_at ?? null,
      has_pending_approval: summary?.has_pending_approval ?? false,
      has_running_dev_server: summary?.has_running_dev_server ?? false,
      has_unseen_turns: summary?.has_unseen_turns ?? false,
      pr_status: summary?.pr_status ?? null,
      repos: storybookRepoBranches[workspace.id] ?? [],
    };
  },
);

const densePresentation: SpacesOverviewPresentation = (props) =>
  React.createElement(DefaultSpacesOverviewLayout, {
    ...props,
    ui: denseWorkspaceListSpacesOverviewUI,
    viewPackId: "dense-workspace-list",
  });

function renderSpacesOverview(
  overrides: Partial<React.ComponentProps<typeof SpacesOverviewView>> = {},
) {
  return renderToStaticMarkup(
    React.createElement(SpacesOverviewView, {
      workspace: storybookWorkspace,
      savedSessions: storybookSavedSessions,
      currentSessionId: storybookSavedSessions[0]?.id,
      workspaces: dashboardWorkspaces,
      repos: storybookRepos,
      loading: false,
      error: null,
      stoppingDevServerIds: new Set<string>(),
      onResumeSession: () => undefined,
      onRenameSession: () => undefined,
      onDeleteSession: () => undefined,
      onStartNewSession: () => undefined,
      onNavigateToTabGroup: () => undefined,
      onStopDevServer: () => undefined,
      onOpenWorkspaceInSpace: async () => undefined,
      ...overrides,
    }),
  );
}

describe("SpacesOverview skin customization seam", () => {
  it("wraps the surface in SkinRoot and exposes semantic surface and slot attributes", () => {
    const html = renderSpacesOverview();

    expect(html).toContain("data-vd-skin-root=\"true\"");
    expect(html).toMatch(
      /<div class="[^"]*\bh-full\b[^"]*\bw-full\b" data-vd-density=/,
    );
    expect(html).toContain("data-vd-surface=\"spaces-overview\"");
    expect(html).toContain("data-vd-slot=\"page-header\"");
    expect(html).toContain("data-vd-slot=\"recent-sessions\"");
    expect(html).toContain("data-vd-slot=\"workspace-list\"");
    expect(html).toContain("data-vd-slot=\"spaces-list\"");
    expect(html).toContain("data-vd-component=\"row\"");
    expect(html).toContain("data-vd-text=\"primary\"");
    expect(html).toContain("data-vd-text=\"secondary\"");
  });

  it("keeps SpacesOverview foreground colors controlled by semantic skin hooks", () => {
    const hardcodedColorMatches = skinnedViewFiles.flatMap((filePath) => {
      const source = readFileSync(filePath, "utf8");

      return Array.from(source.matchAll(hardcodedTextColorUtility), (match) => ({
        filePath,
        utility: match[0],
      }));
    });

    expect(hardcodedColorMatches).toEqual([]);
  });

  it("can materially change SpacesOverview through an alternate global skin without changing the controller", () => {
    const html = renderSpacesOverview({
      skinState: {
        version: 1,
        userSkins: [],
        activeGlobalSkinId: lightStudioSkin.id,
      },
    });

    expect(html).toContain(`data-vd-skin-id="${lightStudioSkin.id}"`);
    expect(html).toContain("--vd-color-background:#f8fafc");
    expect(html).toContain("--vd-surface-spaces-overview-background:#f8fafc");
  });

  it("can swap the SpacesOverview view pack independently of skin selection", () => {
    const html = renderSpacesOverview({
      presentation: densePresentation,
      skinState: {
        version: 1,
        userSkins: [],
        activeGlobalSkinId: lightStudioSkin.id,
      },
    });

    expect(html).toContain(`data-vd-skin-id="${lightStudioSkin.id}"`);
    expect(html).toContain("data-vd-view-pack=\"dense-workspace-list\"");
    expect(html).toContain("VK Workspaces");
  });
});
