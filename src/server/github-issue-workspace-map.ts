import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export interface GithubIssueIdentity {
  owner: string;
  repo: string;
  number: number;
  normalizedIssueUrl: string;
}

export interface GithubIssueWorkspaceMapping extends GithubIssueIdentity {
  workspaceId: string;
  branch: string;
  createdAt: string;
  updatedAt: string;
}

interface StoreFile {
  version: 1;
  mappings: GithubIssueWorkspaceMapping[];
}

export interface GithubIssueWorkspaceMapStoreOptions {
  filePath?: string;
  now?: () => Date;
}

export class GithubIssueWorkspaceMapStore {
  private readonly filePath: string;
  private readonly now: () => Date;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(options: GithubIssueWorkspaceMapStoreOptions = {}) {
    this.filePath = options.filePath ?? defaultStorePath();
    this.now = options.now ?? (() => new Date());
  }

  async get(
    identity: GithubIssueIdentity,
  ): Promise<GithubIssueWorkspaceMapping | null> {
    const store = await this.readStore();
    return (
      store.mappings.find(
        (mapping) => mapping.normalizedIssueUrl === identity.normalizedIssueUrl,
      ) ?? null
    );
  }

  async upsert(args: {
    identity: GithubIssueIdentity;
    workspaceId: string;
    branch: string;
  }): Promise<GithubIssueWorkspaceMapping> {
    const write = this.writeQueue.then(async () => {
      const store = await this.readStore();
      const timestamp = this.now().toISOString();
      const existingIndex = store.mappings.findIndex(
        (mapping) =>
          mapping.normalizedIssueUrl === args.identity.normalizedIssueUrl,
      );
      const existing =
        existingIndex >= 0 ? store.mappings[existingIndex] : undefined;
      const mapping: GithubIssueWorkspaceMapping = {
        ...args.identity,
        workspaceId: args.workspaceId,
        branch: args.branch,
        createdAt: existing?.createdAt ?? timestamp,
        updatedAt: timestamp,
      };

      if (existingIndex >= 0) {
        store.mappings[existingIndex] = mapping;
      } else {
        store.mappings.push(mapping);
      }

      await this.writeStore(store);
      return mapping;
    });

    this.writeQueue = write.then(
      () => undefined,
      () => undefined,
    );
    return write;
  }

  private async readStore(): Promise<StoreFile> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as Partial<StoreFile>;
      if (parsed.version !== 1 || !Array.isArray(parsed.mappings)) {
        return emptyStore();
      }
      return {
        version: 1,
        mappings: parsed.mappings.filter(isMapping),
      };
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return emptyStore();
      }
      throw error;
    }
  }

  private async writeStore(store: StoreFile): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const tmpPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmpPath, `${JSON.stringify(store, null, 2)}\n`, "utf8");
    await rename(tmpPath, this.filePath);
  }
}

export function defaultStorePath(): string {
  return join(process.cwd(), "data", "github-issue-workspaces.json");
}

function emptyStore(): StoreFile {
  return { version: 1, mappings: [] };
}

function isMapping(value: unknown): value is GithubIssueWorkspaceMapping {
  if (!value || typeof value !== "object") return false;
  const mapping = value as Record<string, unknown>;
  return (
    typeof mapping.owner === "string" &&
    typeof mapping.repo === "string" &&
    typeof mapping.number === "number" &&
    Number.isInteger(mapping.number) &&
    typeof mapping.normalizedIssueUrl === "string" &&
    typeof mapping.workspaceId === "string" &&
    typeof mapping.branch === "string" &&
    typeof mapping.createdAt === "string" &&
    typeof mapping.updatedAt === "string"
  );
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
