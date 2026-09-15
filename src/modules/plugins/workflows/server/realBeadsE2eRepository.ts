import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, mkdtemp, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const STATUSES = new Set(["open", "in_progress", "blocked", "closed"]);
const EXPECTED_BEADS_VERSION = "1.2.2";
const OWNER_FILE = ".vd-real-beads-owner.json";
const BASE_OWNER_FILE = ".vd-real-beads-base.json";
const BASE_DIRECTORY = "vd-real-beads-e2e";
const OPERATION_WAIT_MS = 10_000;

export type RealBeadsTask = { id: string; title: string; status: string; ready: boolean; dependencies: string[]; revision: string };
export type RealBeadsSnapshot = { schemaVersion: "vd.real-beads-e2e.v1"; tasks: RealBeadsTask[] };
type Run = (file: string, args: string[], cwd: string, env: NodeJS.ProcessEnv) => Promise<string>;
type Executables = { bd: string; git: string };
type Owner = { schemaVersion: 1; ownerId: string; processId: number; createdAt: string; rootIdentity: string };
export type RealBeadsE2eRepositoryOptions = { executables?: Executables; run?: Run };

/** Docker-test-only owner of an isolated, real Beads repository. */
export class RealBeadsE2eRepository {
  private constructor(
    private readonly baseRoot: string,
    private readonly root: string,
    private readonly owner: Owner,
    private readonly rootDevice: bigint,
    private readonly rootInode: bigint,
    private readonly executables: Executables,
    private readonly run: Run,
  ) {}

  static async create(options: RealBeadsE2eRepositoryOptions = {}): Promise<RealBeadsE2eRepository> {
    rejectUnknownOptions(options, ["executables", "run"]);
    const baseRoot = await prepareOwnedBase();
    const executables = validateExecutablePaths(options.executables ?? {
      bd: "/usr/local/bin/bd",
      git: "/usr/bin/git",
    });
    const run = options.run ?? runCommand;
    await verifyBeadsVersion(executables.bd, run, baseRoot);
    const root = await mkdtemp(`${baseRoot}/run-`);
    await chmod(root, 0o700);
    const rootStats = await stat(root, { bigint: true });
    const owner: Owner = {
      schemaVersion: 1,
      ownerId: randomUUID(),
      processId: process.pid,
      createdAt: new Date().toISOString(),
      rootIdentity: `${rootStats.dev}:${rootStats.ino}`,
    };
    await writeFile(`${root}/${OWNER_FILE}`, JSON.stringify(owner), { mode: 0o600, flag: "wx" });
    const fixture = new RealBeadsE2eRepository(baseRoot, root, owner, rootStats.dev, rootStats.ino, executables, run);
    try {
      await fixture.initialize();
      return fixture;
    } catch (error) {
      await fixture.teardown();
      throw error;
    }
  }

  /** Removes only old, valid fixture roots whose creating process no longer exists. */
  static async cleanupStale(olderThanMs: number, now = Date.now()): Promise<number> {
    if (!Number.isFinite(olderThanMs) || olderThanMs < 0) throw new Error("Fixture cleanup request is invalid.");
    const base = await prepareOwnedBase();
    const { readdir } = await import("node:fs/promises");
    let removed = 0;
    for (const entry of await readdir(base, { withFileTypes: true })) {
      if (!entry.isDirectory() || !entry.name.startsWith("run-")) continue;
      const root = join(base, entry.name);
      try {
        const canonical = await realpath(root);
        assertContained(base, canonical);
        if (canonical !== root) continue;
        const owner = JSON.parse(await readFile(`${root}/${OWNER_FILE}`, "utf8")) as Owner;
        const rootStats = await stat(root, { bigint: true });
        if (owner.rootIdentity !== `${rootStats.dev}:${rootStats.ino}`) continue;
        if (now - Date.parse(owner.createdAt) < olderThanMs || processExists(owner.processId)) continue;
        const deleting = `${root}.deleting-${owner.ownerId}`;
        await rename(root, deleting);
        const deletingCanonical = await realpath(deleting);
        assertContained(base, deletingCanonical);
        const deletingStats = await stat(deleting, { bigint: true });
        const deletingOwner = JSON.parse(await readFile(`${deleting}/${OWNER_FILE}`, "utf8")) as Owner;
        if (deletingOwner.ownerId !== owner.ownerId || deletingOwner.rootIdentity !== `${deletingStats.dev}:${deletingStats.ino}`) continue;
        await rm(deleting, { recursive: true, force: false });
        removed += 1;
      } catch {
        // Unknown or changed roots are retained for safe inspection.
      }
    }
    return removed;
  }

  /** Reopens the same test-owned repository to prove restart persistence. */
  restart(): RealBeadsE2eRepository {
    return new RealBeadsE2eRepository(this.baseRoot, this.root, this.owner, this.rootDevice, this.rootInode, this.executables, this.run);
  }

  async teardown(): Promise<void> {
    await this.assertOwnedRoot();
    const deleting = `${this.root}.deleting-${this.owner.ownerId}`;
    await rename(this.root, deleting);
    await this.assertOwnedPath(deleting);
    await rm(deleting, { recursive: true, force: false });
  }

  async createTask(input: { operationId: string; id: string; title: string; status?: string }): Promise<RealBeadsTask> {
    const id = safeId(input.id);
    const title = safeText(input.title, "Task title");
    if (title.startsWith("-")) throw new Error("Task title is invalid.");
    await this.once(input.operationId, { type: "create", id, title }, () =>
      this.command("bd", ["create", "--title", title, "--id", id, "--silent"]));
    if (input.status && input.status !== "open") await this.setStatus(id, input.status, `${input.operationId}-status`);
    return this.task(id);
  }

  async addDependency(taskId: string, prerequisiteId: string, operationId: string): Promise<void> {
    const task = safeId(taskId);
    const prerequisite = safeId(prerequisiteId);
    await this.once(operationId, { type: "dependency", task, prerequisite }, () =>
      this.command("bd", ["dep", "add", task, prerequisite]));
  }

  async addNote(taskId: string, note: string, operationId: string): Promise<void> {
    const id = safeId(taskId);
    const text = safeText(note, "Task note");
    await this.once(operationId, { type: "note", id, text }, () =>
      this.command("bd", ["update", id, "--append-notes", text]));
  }

  async setStatus(taskId: string, status: string, operationId: string): Promise<void> {
    if (!STATUSES.has(status)) throw new Error("Task status is not supported.");
    const id = safeId(taskId);
    await this.once(operationId, { type: "status", id, status }, () =>
      this.command("bd", ["update", id, "--status", status]));
  }

  async snapshot(): Promise<RealBeadsSnapshot> {
    const rows = parseArray(await this.command("bd", ["list", "--all", "--limit", "0", "--json"]));
    const ready = new Set(parseArray(await this.command("bd", ["ready", "--json"])).map((row) => String(row.id)));
    const tasks: RealBeadsTask[] = [];
    // The released Beads store serializes local repository access; avoid concurrent readers.
    for (const row of rows) {
      const dependencies = parseArray(await this.command("bd", ["dep", "list", String(row.id), "--json"]))
        .map((dependency) => String(dependency.id)).sort();
      const detail = parseArray(await this.command("bd", ["show", String(row.id), "--json"]))[0] ?? row;
      tasks.push(normalizeTask(detail, dependencies, ready.has(String(row.id))));
    }
    return { schemaVersion: "vd.real-beads-e2e.v1", tasks: tasks.sort((a, b) => a.id.localeCompare(b.id)) };
  }

  private async initialize(): Promise<void> {
    await mkdir(`${this.root}/home`, { mode: 0o700 });
    await mkdir(`${this.root}/tmp`, { mode: 0o700 });
    await this.command("git", ["init", "--quiet"]);
    await this.command("bd", ["init", "--prefix", "native", "--non-interactive", "--quiet"]);
  }

  private async task(id: string): Promise<RealBeadsTask> {
    const task = (await this.snapshot()).tasks.find((candidate) => candidate.id === id);
    if (!task) throw new Error("Task fixture could not be read.");
    return task;
  }

  private async command(tool: keyof Executables, args: string[]): Promise<string> {
    await this.assertOwnedRoot();
    try {
      return await this.run(this.executables[tool], args, this.root, minimalEnvironment(this.root));
    } catch {
      throw new Error("The authoritative task fixture operation failed.");
    }
  }

  private async once(operationId: string, payload: unknown, effect: () => Promise<unknown>): Promise<void> {
    await this.assertOwnedRoot();
    const operation = safeId(operationId);
    const digest = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
    const directory = `${this.root}/.vd-e2e-operations`;
    const file = `${directory}/${operation}.json`;
    await mkdir(directory, { recursive: true, mode: 0o700 });
    try {
      await writeFile(file, JSON.stringify({ digest, state: "pending" }), { mode: 0o600, flag: "wx" });
    } catch (error: any) {
      if (error?.code !== "EEXIST") throw error;
      await this.awaitOperation(file, digest);
      return;
    }
    try {
      await effect();
      await replaceOperation(file, digest, "complete");
    } catch (error) {
      await replaceOperation(file, digest, "failed");
      throw error;
    }
  }

  private async awaitOperation(file: string, digest: string): Promise<void> {
    const deadline = Date.now() + OPERATION_WAIT_MS;
    while (true) {
      await this.assertOwnedRoot();
      const existing = JSON.parse(await readFile(file, "utf8"));
      if (existing.digest !== digest) throw new Error("Fixture operation conflicts with an earlier request.");
      if (existing.state === "complete") return;
      if (existing.state === "failed") throw new Error("Fixture operation did not complete.");
      if (Date.now() >= deadline) throw new Error("Fixture operation outcome could not be reconciled.");
      await new Promise((resolveWait) => setTimeout(resolveWait, 10));
    }
  }

  private async assertOwnedRoot(): Promise<void> {
    await this.assertOwnedPath(this.root);
  }

  private async assertOwnedPath(candidate: string): Promise<void> {
    const base = await realpath(this.baseRoot);
    const root = await realpath(candidate);
    assertContained(base, root);
    const rootLink = await lstat(candidate);
    if (rootLink.isSymbolicLink()) throw new Error("Real task fixture ownership could not be verified.");
    const rootStats = await stat(candidate, { bigint: true });
    if (rootStats.dev !== this.rootDevice || rootStats.ino !== this.rootInode) throw new Error("Real task fixture ownership could not be verified.");
    const stored = JSON.parse(await readFile(`${root}/${OWNER_FILE}`, "utf8")) as Owner;
    if (stored.ownerId !== this.owner.ownerId || stored.rootIdentity !== this.owner.rootIdentity) {
      throw new Error("Real task fixture ownership could not be verified.");
    }
  }
}

async function replaceOperation(file: string, digest: string, state: "complete" | "failed"): Promise<void> {
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify({ digest, state }), { mode: 0o600, flag: "wx" });
  await rename(temporary, file);
}

async function prepareOwnedBase(): Promise<string> {
  const canonicalTemporaryDirectory = await realpath(tmpdir());
  const base = join(canonicalTemporaryDirectory, BASE_DIRECTORY);
  const expectedOwner = {
    schemaVersion: 1,
    purpose: "vd-real-beads-e2e",
    userId: typeof process.getuid === "function" ? process.getuid() : null,
    temporaryDirectory: canonicalTemporaryDirectory,
  };
  try {
    const link = await lstat(base);
    if (link.isSymbolicLink() || !link.isDirectory()) throw new Error("Real task fixture base is not authorized.");
    const canonical = await realpath(base);
    if (canonical !== base) throw new Error("Real task fixture base is not authorized.");
    const details = await stat(base);
    if ((details.mode & 0o777) !== 0o700 || expectedOwner.userId !== null && details.uid !== expectedOwner.userId) {
      throw new Error("Real task fixture base is not authorized.");
    }
    const owner = JSON.parse(await readFile(join(base, BASE_OWNER_FILE), "utf8"));
    if (JSON.stringify(owner) !== JSON.stringify(expectedOwner)) throw new Error("Real task fixture base is not authorized.");
    return canonical;
  } catch (error: any) {
    if (error?.code !== "ENOENT") throw error;
  }
  try {
    await mkdir(base, { mode: 0o700 });
  } catch (error: any) {
    if (error?.code === "EEXIST") return prepareOwnedBase();
    throw error;
  }
  await writeFile(join(base, BASE_OWNER_FILE), JSON.stringify(expectedOwner), { mode: 0o600, flag: "wx" });
  return base;
}

function assertContained(base: string, candidate: string): void {
  const child = relative(base, candidate);
  if (!child || child.startsWith("..") || isAbsolute(child)) throw new Error("Real task fixture root is not authorized.");
}

function rejectUnknownOptions(options: object, allowed: string[]): void {
  if (Object.keys(options).some((key) => !allowed.includes(key))) {
    throw new Error("Real task fixture configuration is not authorized.");
  }
}

function processExists(processId: number): boolean {
  try {
    process.kill(processId, 0);
    return true;
  } catch (error: any) {
    return error?.code !== "ESRCH";
  }
}

function validateExecutablePaths(executables: Executables): Executables {
  if (executables.bd !== "/usr/local/bin/bd" || executables.git !== "/usr/bin/git") {
    throw new Error("Fixture executable is not authorized.");
  }
  return executables;
}

async function verifyBeadsVersion(bdPath: string, run: Run, cwd: string): Promise<void> {
  let output: string;
  try {
    output = await run(bdPath, ["version"], cwd, minimalEnvironment(cwd));
  } catch {
    throw new Error("The required Beads fixture runtime is unavailable.");
  }
  const match = output.match(/(?:^|\s)(\d+\.\d+\.\d+)(?:\s|$)/);
  if (match?.[1] !== EXPECTED_BEADS_VERSION) throw new Error("The required Beads fixture runtime version is unavailable.");
}

function minimalEnvironment(root: string): NodeJS.ProcessEnv {
  return {
    HOME: `${root}/home`, TMPDIR: `${root}/tmp`, PATH: "/usr/local/bin:/usr/bin:/bin",
    LANG: "C.UTF-8", LC_ALL: "C.UTF-8", BD_NON_INTERACTIVE: "1", GIT_CONFIG_NOSYSTEM: "1",
    GIT_AUTHOR_NAME: "VD E2E", GIT_AUTHOR_EMAIL: "vd-e2e@example.invalid",
    GIT_COMMITTER_NAME: "VD E2E", GIT_COMMITTER_EMAIL: "vd-e2e@example.invalid",
  };
}

async function runCommand(file: string, args: string[], cwd: string, env: NodeJS.ProcessEnv): Promise<string> {
  try {
    return (await execFileAsync(file, args, { cwd, env, timeout: 30_000, maxBuffer: 2_000_000 })).stdout;
  } catch {
    throw new Error("The authoritative task fixture operation failed.");
  }
}

function parseArray(value: string): any[] {
  try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed : [parsed]; }
  catch { throw new Error("The authoritative task fixture response was invalid."); }
}
function safeId(value: string): string { if (!ID.test(value)) throw new Error("Task ID is invalid."); return value; }
function safeText(value: string, label: string): string {
  const text = value.trim();
  if (!text || text.length > 2_000) throw new Error(`${label} is invalid.`);
  return text;
}
function normalizeTask(row: any, dependencies: string[], ready: boolean): RealBeadsTask {
  const base = { id: safeId(String(row.id)), title: safeText(String(row.title), "Task title"), status: String(row.status), ready, dependencies };
  const revisionInput = { ...base, notes: typeof row.notes === "string" ? row.notes : "" };
  return { ...base, revision: createHash("sha256").update(JSON.stringify(revisionInput)).digest("hex") };
}
