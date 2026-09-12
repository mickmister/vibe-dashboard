import { describe, expect, it } from "vitest";
import { rm } from "node:fs/promises";
import { RealBeadsE2eRepository } from "./realBeadsE2eRepository";

describe("real Beads E2E repository contract", () => {
  it("rejects caller-selected paths, unsafe IDs, and unsupported states", async () => {
    expect(() => new RealBeadsE2eRepository("/workspace/source")).toThrow("not authorized");
    const calls: string[][] = [];
    const fixture = new RealBeadsE2eRepository("/tmp/vd-real-beads-e2e/unit", async (_file, args) => { calls.push(args); return "[]"; });
    await expect(fixture.createTask({ operationId: "create-bad", id: "../escape", title: "Task" })).rejects.toThrow("Task ID");
    await expect(fixture.setStatus("native-a", "deleted", "status-bad")).rejects.toThrow("not supported");
    expect(calls).toEqual([]);
  });

  it("does not expose command, path, or provider output on failure", async () => {
    const root = `/tmp/vd-real-beads-e2e/unit-error-${process.pid}`;
    await rm(root, { recursive: true, force: true });
    const fixture = new RealBeadsE2eRepository(
      root,
      async () => {
        throw new Error("bd create failed at /private/repository with raw stdout");
      },
    );
    await expect(
      fixture.createTask({
        operationId: "create-safe-error",
        id: "native-safe",
        title: "Safe task",
      }),
    ).rejects.toThrow("authoritative task fixture operation failed");
  });
});

describe.skipIf(process.env.VD_REAL_BEADS_E2E !== "1")("real pinned Beads repository in Docker", () => {
  it("persists deterministic ordered tasks, notes, revisions, and readiness across restart", async () => {
    const root = "/tmp/vd-real-beads-e2e/native-ordered";
    const first = new RealBeadsE2eRepository(root); await first.reset();
    await first.createTask({ operationId: "create-plan", id: "native-plan", title: "Plan work" });
    await first.createTask({ operationId: "create-build", id: "native-build", title: "Build work" });
    await first.createTask({ operationId: "create-review", id: "native-review", title: "Review work" });
    await first.addDependency("native-build", "native-plan", "dep-build-plan");
    await first.addDependency("native-review", "native-build", "dep-review-build");
    const beforeNote = (await first.snapshot()).tasks.find((task) => task.id === "native-plan")!.revision;
    await first.addNote("native-plan", "Validated task context.", "note-plan-1");
    await first.addNote("native-plan", "Validated task context.", "note-plan-1");
    await expect(first.addNote("native-plan", "Different replay.", "note-plan-1")).rejects.toThrow("conflicts");
    const initial = await first.snapshot();
    expect(initial.tasks.find((task) => task.id === "native-plan")!.revision).not.toBe(beforeNote);
    expect(initial.tasks.map((task) => [task.id, task.dependencies, task.ready])).toEqual([
      ["native-build", ["native-plan"], false],
      ["native-plan", [], true],
      ["native-review", ["native-build"], false],
    ]);
    const planRevision = initial.tasks.find((task) => task.id === "native-plan")!.revision;
    await first.setStatus("native-plan", "closed", "close-plan");
    const restarted = new RealBeadsE2eRepository(root); const afterPlan = await restarted.snapshot();
    expect(afterPlan.tasks.find((task) => task.id === "native-plan")).toMatchObject({ status: "closed", ready: false });
    expect(afterPlan.tasks.find((task) => task.id === "native-plan")!.revision).not.toBe(planRevision);
    expect(afterPlan.tasks.find((task) => task.id === "native-build")!.ready).toBe(true);
    await restarted.setStatus("native-build", "closed", "close-build");
    expect((await restarted.snapshot()).tasks.find((task) => task.id === "native-review")!.ready).toBe(true);
  }, 120_000);
});
