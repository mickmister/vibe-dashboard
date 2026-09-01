import { describe, expect, it } from "vitest";
import type { DashboardWorkspace } from "./SpacesOverview.contracts";
import { sortDashboardWorkspaces } from "./SpacesOverview.model";

function workspace(
  overrides: Partial<DashboardWorkspace> & Pick<DashboardWorkspace, "id">,
): DashboardWorkspace {
  const { id, ...rest } = overrides;

  return {
    id,
    name: id,
    branch: `vk/${id}`,
    pinned: false,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    task_id: `task_${id}`,
    container_ref: null,
    files_changed: null,
    lines_added: null,
    lines_removed: null,
    latest_process_status: null,
    latest_process_completed_at: null,
    has_pending_approval: false,
    has_running_dev_server: false,
    has_unseen_turns: false,
    pr_status: null,
    repos: [],
    ...rest,
  };
}

describe("sortDashboardWorkspaces", () => {
  it("keeps pinned workspaces first before recency", () => {
    const sorted = sortDashboardWorkspaces([
      workspace({
        id: "newer-unpinned",
        updated_at: "2026-02-03T00:00:00.000Z",
      }),
      workspace({
        id: "older-pinned",
        pinned: true,
        updated_at: "2026-02-01T00:00:00.000Z",
      }),
    ]);

    expect(sorted.map((item) => item.id)).toEqual([
      "older-pinned",
      "newer-unpinned",
    ]);
  });

  it("uses latest process completion time before workspace update time", () => {
    const sorted = sortDashboardWorkspaces([
      workspace({
        id: "updated-recently",
        updated_at: "2026-02-03T00:00:00.000Z",
      }),
      workspace({
        id: "completed-recently",
        latest_process_completed_at: "2026-02-04T00:00:00.000Z",
        updated_at: "2026-02-01T00:00:00.000Z",
      }),
    ]);

    expect(sorted.map((item) => item.id)).toEqual([
      "completed-recently",
      "updated-recently",
    ]);
  });
});
