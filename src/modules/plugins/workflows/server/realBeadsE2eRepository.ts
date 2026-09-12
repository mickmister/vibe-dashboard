import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const STATUSES = new Set(["open", "in_progress", "blocked", "closed"]);

export type RealBeadsTask = {
  id: string;
  title: string;
  status: string;
  ready: boolean;
  dependencies: string[];
  revision: string;
};
export type RealBeadsSnapshot = {
  schemaVersion: "vd.real-beads-e2e.v1";
  tasks: RealBeadsTask[];
};
type Run = (file: "bd" | "git", args: string[], cwd: string, env: NodeJS.ProcessEnv) => Promise<string>;

/** Docker-test-only owner of an isolated, real Beads repository. */
export class RealBeadsE2eRepository {
  private readonly home: string;
  constructor(private readonly root: string, private readonly run: Run = runCommand) {
    if (!root.startsWith("/tmp/vd-real-beads-e2e/")) throw new Error("Real task fixture root is not authorized.");
    this.home = `${root}/home`;
  }
  async reset(): Promise<void> {
    await rm(this.root, { recursive: true, force: true });
    await mkdir(this.home, { recursive: true, mode: 0o700 });
    await chmod(this.root, 0o700);
    await this.command("git", ["init", "--quiet"]);
    await this.command("bd", ["init", "--prefix", "native", "--non-interactive", "--quiet"]);
  }
  async teardown(): Promise<void> {
    await rm(this.root, { recursive: true, force: true });
  }
  async createTask(input: { operationId: string; id: string; title: string; status?: string }): Promise<RealBeadsTask> {
    const id = safeId(input.id), title = safeText(input.title, "Task title");
    await this.once(input.operationId, { type: "create", id, title }, () => this.command("bd", ["create", title, "--id", id, "--silent"]));
    if (input.status && input.status !== "open") await this.setStatus(id, input.status, `${input.operationId}-status`);
    return this.task(id);
  }
  async addDependency(taskId: string, prerequisiteId: string, operationId: string): Promise<void> {
    const task = safeId(taskId), prerequisite = safeId(prerequisiteId);
    await this.once(operationId, { type: "dependency", task, prerequisite }, () => this.command("bd", ["dep", "add", task, prerequisite]));
  }
  async addNote(taskId: string, note: string, operationId: string): Promise<void> {
    const id = safeId(taskId), text = safeText(note, "Task note");
    await this.once(operationId, { type: "note", id, text }, () => this.command("bd", ["update", id, "--append-notes", text]));
  }
  async setStatus(taskId: string, status: string, operationId: string): Promise<void> {
    if (!STATUSES.has(status)) throw new Error("Task status is not supported.");
    const id = safeId(taskId);
    await this.once(operationId, { type: "status", id, status }, () => this.command("bd", ["update", id, "--status", status]));
  }
  async snapshot(): Promise<RealBeadsSnapshot> {
    const rows = parseArray(await this.command("bd", ["list", "--all", "--limit", "0", "--json"]));
    const ready = new Set(parseArray(await this.command("bd", ["ready", "--json"])).map((row) => String(row.id)));
    const tasks = await Promise.all(rows.map(async (row) => {
      const dependencies = parseArray(await this.command("bd", ["dep", "list", String(row.id), "--json"])).map((dep) => String(dep.id)).sort();
      const detail = parseArray(await this.command("bd", ["show", String(row.id), "--json"]))[0] ?? row;
      return normalizeTask(detail, dependencies, ready.has(String(row.id)));
    }));
    return { schemaVersion: "vd.real-beads-e2e.v1", tasks: tasks.sort((a, b) => a.id.localeCompare(b.id)) };
  }
  private async task(id: string): Promise<RealBeadsTask> {
    const snapshot = await this.snapshot();
    const task = snapshot.tasks.find((candidate) => candidate.id === id);
    if (!task) throw new Error("Task fixture could not be read.");
    return task;
  }
  private async command(file: "bd" | "git", args: string[]): Promise<string> {
    try {
      return await this.run(file, args, this.root, {
        ...process.env,
        HOME: this.home,
        BD_NON_INTERACTIVE: "1",
        GIT_AUTHOR_NAME: "VD E2E",
        GIT_AUTHOR_EMAIL: "vd-e2e@example.invalid",
        GIT_COMMITTER_NAME: "VD E2E",
        GIT_COMMITTER_EMAIL: "vd-e2e@example.invalid",
      });
    } catch {
      throw new Error("The authoritative task fixture operation failed.");
    }
  }
  private async once(operationId: string, payload: unknown, effect: () => Promise<unknown>): Promise<void> {
    const operation = safeId(operationId), digest = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
    const directory = `${this.root}/.vd-e2e-operations`, file = `${directory}/${operation}.json`;
    await mkdir(directory, { recursive: true, mode: 0o700 });
    try { await writeFile(file, JSON.stringify({ digest, state: "pending" }), { mode: 0o600, flag: "wx" }); }
    catch (error: any) {
      if (error?.code !== "EEXIST") throw error;
      const existing = JSON.parse(await readFile(file, "utf8"));
      if (existing.digest !== digest) throw new Error("Fixture operation conflicts with an earlier request.");
      if (existing.state === "complete") return;
      throw new Error("Fixture operation needs a clean test reset.");
    }
    await effect();
    const temporary = `${file}.${process.pid}.tmp`; await writeFile(temporary, JSON.stringify({ digest, state: "complete" }), { mode: 0o600 }); await rename(temporary, file);
  }
}

async function runCommand(file: "bd" | "git", args: string[], cwd: string, env: NodeJS.ProcessEnv): Promise<string> {
  try { return (await execFileAsync(file, args, { cwd, env, timeout: 30_000, maxBuffer: 2_000_000 })).stdout; }
  catch { throw new Error("The authoritative task fixture operation failed."); }
}
function parseArray(value: string): any[] { try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed : [parsed]; } catch { throw new Error("The authoritative task fixture response was invalid."); } }
function safeId(value: string): string { if (!ID.test(value)) throw new Error("Task ID is invalid."); return value; }
function safeText(value: string, label: string): string { const text = value.trim(); if (!text || text.length > 2_000) throw new Error(`${label} is invalid.`); return text; }
function normalizeTask(row: any, dependencies: string[], ready: boolean): RealBeadsTask {
  const base = { id: safeId(String(row.id)), title: safeText(String(row.title), "Task title"), status: String(row.status), ready, dependencies };
  const revisionInput = { ...base, notes: typeof row.notes === "string" ? row.notes : "" };
  return { ...base, revision: createHash("sha256").update(JSON.stringify(revisionInput)).digest("hex") };
}
