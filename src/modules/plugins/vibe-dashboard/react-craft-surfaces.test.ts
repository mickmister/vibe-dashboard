import { describe, expect, it } from "vitest";
import type { Tab, TabGroup } from "../../../types";
import {
  getReactCraftSurfaceTarget,
  hasReactCraftSurface,
} from "./react-craft-surfaces";

const workflowsTab: Tab = {
  id: "workflows",
  title: "Workflows",
  url: "http://localhost:3200/dashboard/workflows?workspaceId=workspace-a",
  ephemeral: {
    kind: "craft-surface",
    pluginId: "vibe-dashboard",
    surfaceKey: "workflows",
    sourceKey: "built-in-workflows",
  },
};

const workspaceTabGroup: Pick<TabGroup, "tabs" | "workspace"> = {
  workspace: {
    workspaceId: "workspace-a",
    workspaceDir: "/work/app",
  },
  tabs: [workflowsTab],
};

describe("first-party React craft surfaces", () => {
  it("resolves the built-in Workflows tab to a structured React surface target", () => {
    expect(getReactCraftSurfaceTarget(workflowsTab, workspaceTabGroup)).toEqual(
      {
        kind: "react",
        pluginId: "vibe-dashboard",
        surfaceKey: "workflows",
        props: { workspaceId: "workspace-a" },
      },
    );
  });

  it("advertises only registered first-party React surfaces", () => {
    expect(
      hasReactCraftSurface({
        pluginId: "vibe-dashboard",
        surfaceKey: "workflows",
      }),
    ).toBe(true);
    expect(
      hasReactCraftSurface({
        pluginId: "third-party",
        surfaceKey: "workflows",
      }),
    ).toBe(false);
  });

  it("leaves ordinary iframe tabs outside the React surface registry", () => {
    expect(
      getReactCraftSurfaceTarget(
        { id: "docs", title: "Docs", url: "https://example.test/docs" },
        workspaceTabGroup,
      ),
    ).toBeNull();
  });
});
