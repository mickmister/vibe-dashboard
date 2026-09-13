import { lstat, mkdir, readFile, readdir, realpath, rename, rm, symlink, writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { RealBeadsE2eRepository } from "./realBeadsE2eRepository";

const executablePaths = { bd: "/usr/local/bin/bd", git: "/usr/bin/git" };

function fakeRunner(overrides?: { version?: string; delayUpdate?: boolean; failInit?: boolean }) {
  const calls: Array<{ file: string; args: string[]; cwd: string; env: NodeJS.ProcessEnv }> = [];
  let updates = 0;
  const run = async (file: string, args: string[], cwd: string, env: NodeJS.ProcessEnv): Promise<string> => {
    calls.push({ file, args, cwd, env });
    const command = args[0] ?? "";
    if (command === "version") return `bd version ${overrides?.version ?? "1.2.2"}\n`;
    if (overrides?.failInit && file.endsWith("git") && command === "init") throw new Error("raw failure /private/repo");
    if (command === "update") {
      updates += 1;
      if (overrides?.delayUpdate) await new Promise((resolve) => setTimeout(resolve, 40));
    }
    if (["list", "ready", "show"].includes(command) || command === "dep" && args[1] === "list") return "[]";
    return "";
  };
  return { run, calls, get updates() { return updates; } };
}

async function freshBase(name: string): Promise<string> {
  const base = `/tmp/vd-real-beads-e2e-tests/${name}-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  await mkdir(base, { recursive: true, mode: 0o700 });
  return realpath(base);
}

async function createFake(name: string, runner = fakeRunner()) {
  const baseRoot = await freshBase(name);
  const fixture = await RealBeadsE2eRepository.create({ baseRoot, executables: executablePaths, run: runner.run });
  return { baseRoot, fixture, runner };
}

describe("real Beads E2E repository contract", () => {
  it("uses unique canonical roots and rejects traversal, symlink ancestors, and option-shaped values", async () => {
    const baseRoot = await freshBase("unique");
    const runner = fakeRunner();
    const [firstFixture, second] = await Promise.all([
      RealBeadsE2eRepository.create({ baseRoot, executables: executablePaths, run: runner.run }),
      RealBeadsE2eRepository.create({ baseRoot, executables: executablePaths, run: runner.run }),
    ]);
    const first = { baseRoot, fixture: firstFixture, runner };
    expect((first.fixture as any).root).not.toBe((second as any).root);
    await expect(first.fixture.createTask({ operationId: "bad-id", id: "../escape", title: "Task" })).rejects.toThrow("Task ID");
    await expect(first.fixture.createTask({ operationId: "bad-title", id: "native-a", title: "--help" })).rejects.toThrow("Task title");
    await expect(RealBeadsE2eRepository.create({ baseRoot: `${first.baseRoot}/../escape`, executables: executablePaths, run: first.runner.run })).rejects.toThrow("not authorized");
    await first.fixture.teardown();
    await second.teardown();

    const parent = await freshBase("symlink-parent");
    const target = await freshBase("symlink-target");
    await symlink(target, `${parent}/linked`);
    await expect(RealBeadsE2eRepository.create({ baseRoot: `${parent}/linked/child`, executables: executablePaths, run: fakeRunner().run })).rejects.toThrow("not authorized");
    await rm(parent, { recursive: true, force: true });
    await rm(target, { recursive: true, force: true });
  });

  it("uses absolute executables, exact Beads 1.2.2, and a minimal environment", async () => {
    await expect(RealBeadsE2eRepository.create({ baseRoot: await freshBase("relative-exe"), executables: { bd: "bd", git: "/usr/bin/git" }, run: fakeRunner().run })).rejects.toThrow("executable");
    const mismatchBase = await freshBase("version-mismatch");
    await expect(RealBeadsE2eRepository.create({ baseRoot: mismatchBase, executables: executablePaths, run: fakeRunner({ version: "1.2.1" }).run })).rejects.toThrow("version");
    expect(await readdir(mismatchBase)).toEqual([]);

    const created = await createFake("environment");
    const call = created.runner.calls.find(({ args }) => args[0] === "init")!;
    expect(call.file.startsWith("/")).toBe(true);
    expect(call.env).not.toHaveProperty("BD_DB");
    expect(call.env).not.toHaveProperty("BEADS_DIR");
    expect(call.env).not.toHaveProperty("GIT_DIR");
    expect(call.env).not.toHaveProperty("GIT_WORK_TREE");
    expect(call.env).not.toHaveProperty("NODE_OPTIONS");
    expect(Object.keys(call.env).sort()).toEqual([
      "BD_NON_INTERACTIVE", "GIT_AUTHOR_EMAIL", "GIT_AUTHOR_NAME", "GIT_COMMITTER_EMAIL",
      "GIT_COMMITTER_NAME", "GIT_CONFIG_NOSYSTEM", "HOME", "LANG", "LC_ALL", "PATH", "TMPDIR",
    ]);
    await created.fixture.teardown();
  });

  it("waits for a concurrent identical operation and rejects conflicting replay", async () => {
    const created = await createFake("operation-race", fakeRunner({ delayUpdate: true }));
    const restarted = created.fixture.restart();
    await Promise.all([
      created.fixture.addNote("native-a", "One note", "same-operation"),
      restarted.addNote("native-a", "One note", "same-operation"),
    ]);
    expect(created.runner.updates).toBe(1);
    await expect(restarted.addNote("native-a", "Different note", "same-operation")).rejects.toThrow("conflicts");
    await created.fixture.teardown();
  });

  it("fails closed on symlink swaps and refuses teardown when ownership changes", async () => {
    const swapped = await createFake("swap");
    const root = (swapped.fixture as any).root as string;
    const moved = `${root}-moved`;
    await rename(root, moved);
    await symlink(moved, root);
    await expect(swapped.fixture.snapshot()).rejects.toThrow("ownership");
    await expect(swapped.fixture.teardown()).rejects.toThrow("ownership");
    expect((await lstat(moved)).isDirectory()).toBe(true);
    await rm(root, { force: true });
    await rm(moved, { recursive: true, force: true });

    const changed = await createFake("owner-change");
    const changedRoot = (changed.fixture as any).root as string;
    const marker = JSON.parse(await readFile(`${changedRoot}/.vd-real-beads-owner.json`, "utf8"));
    await writeFile(`${changedRoot}/.vd-real-beads-owner.json`, JSON.stringify({ ...marker, ownerId: "other" }));
    await expect(changed.fixture.teardown()).rejects.toThrow("ownership");
    expect((await lstat(changedRoot)).isDirectory()).toBe(true);
    await rm(changedRoot, { recursive: true, force: true });
  });

  it("cleans only stale owned roots and cleans failed initialization without leaking details", async () => {
    const stale = await createFake("stale");
    const root = (stale.fixture as any).root as string;
    const markerPath = `${root}/.vd-real-beads-owner.json`;
    const marker = JSON.parse(await readFile(markerPath, "utf8"));
    await writeFile(markerPath, JSON.stringify({ ...marker, createdAt: "2000-01-01T00:00:00.000Z", processId: 2_000_000_000 }));
    const unowned = `${stale.baseRoot}/run-unowned`;
    await mkdir(unowned);
    expect(await RealBeadsE2eRepository.cleanupStale(stale.baseRoot, 1, Date.now())).toBe(1);
    await expect(lstat(root)).rejects.toMatchObject({ code: "ENOENT" });
    expect((await lstat(unowned)).isDirectory()).toBe(true);

    const failureBase = await freshBase("failed-init");
    await expect(RealBeadsE2eRepository.create({ baseRoot: failureBase, executables: executablePaths, run: fakeRunner({ failInit: true }).run })).rejects.toThrow("authoritative task fixture operation failed");
    expect(await readdir(failureBase)).toEqual([]);
  });
});

describe.skipIf(process.env.VD_REAL_BEADS_E2E !== "1")("real pinned Beads repository in Docker", () => {
  it("persists deterministic ordered tasks, notes, revisions, and readiness across restart", async () => {
    const fixture = await RealBeadsE2eRepository.create();
    try {
      await fixture.createTask({ operationId: "create-plan", id: "native-plan", title: "Plan work" });
      await fixture.createTask({ operationId: "create-build", id: "native-build", title: "Build work" });
      await fixture.createTask({ operationId: "create-review", id: "native-review", title: "Review work" });
      await fixture.addDependency("native-build", "native-plan", "dep-build-plan");
      await fixture.addDependency("native-review", "native-build", "dep-review-build");
      const beforeNote = (await fixture.snapshot()).tasks.find((task) => task.id === "native-plan")!.revision;
      await fixture.addNote("native-plan", "Validated task context.", "note-plan-1");
      await fixture.addNote("native-plan", "Validated task context.", "note-plan-1");
      const initial = await fixture.snapshot();
      expect(initial.tasks.find((task) => task.id === "native-plan")!.revision).not.toBe(beforeNote);
      expect(initial.tasks.map((task) => [task.id, task.dependencies, task.ready])).toEqual([
        ["native-build", ["native-plan"], false], ["native-plan", [], true], ["native-review", ["native-build"], false],
      ]);
      const planRevision = initial.tasks.find((task) => task.id === "native-plan")!.revision;
      await fixture.setStatus("native-plan", "closed", "close-plan");
      const restarted = fixture.restart();
      const afterPlan = await restarted.snapshot();
      expect(afterPlan.tasks.find((task) => task.id === "native-plan")).toMatchObject({ status: "closed", ready: false });
      expect(afterPlan.tasks.find((task) => task.id === "native-plan")!.revision).not.toBe(planRevision);
      expect(afterPlan.tasks.find((task) => task.id === "native-build")!.ready).toBe(true);
      await restarted.setStatus("native-build", "closed", "close-build");
      expect((await restarted.snapshot()).tasks.find((task) => task.id === "native-review")!.ready).toBe(true);
    } finally {
      await fixture.teardown();
    }
  }, 120_000);
});
