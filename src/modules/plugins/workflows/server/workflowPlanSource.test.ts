import { describe, expect, it } from "vitest";
import { workflowTaskStructuralRevision } from "./workflowPlanSource";

describe("workflow plan task revisions", () => {
  it("binds structural content and dependencies but not dynamic readiness", () => {
    const base = { id: "b-1", title: "Task", dependencies: ["b-0"], contentRevision: "content-1" };
    expect(workflowTaskStructuralRevision(base)).toBe(workflowTaskStructuralRevision({ ...base, dependencies: ["b-0"] }));
    expect(workflowTaskStructuralRevision(base)).not.toBe(workflowTaskStructuralRevision({ ...base, contentRevision: "content-2" }));
    expect(workflowTaskStructuralRevision(base)).not.toBe(workflowTaskStructuralRevision({ ...base, dependencies: [] }));
  });
});
