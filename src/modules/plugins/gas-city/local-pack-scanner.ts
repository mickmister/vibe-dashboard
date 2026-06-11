import type {
  GasCityDiscoveredCapability,
  GasCityPackValidationCache,
  GasCityPackSafetyTier,
} from "./types";

type NodeFsPromises = typeof import("node:fs/promises");
type NodePath = typeof import("node:path");

export interface ScanGasCityLocalPackArgs {
  packRefId: string;
  sourcePath: string;
  checkedAt?: string;
}

export async function scanGasCityLocalPack(
  args: ScanGasCityLocalPackArgs,
): Promise<GasCityPackValidationCache> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  return scanGasCityLocalPackWithDeps(args, fs, path);
}

export async function scanGasCityLocalPackWithDeps(
  args: ScanGasCityLocalPackArgs,
  fs: NodeFsPromises,
  path: NodePath,
): Promise<GasCityPackValidationCache> {
  const sourcePath = args.sourcePath.trim();
  const errors: string[] = [];
  const warnings: string[] = [];
  const capabilities: GasCityDiscoveredCapability[] = [];

  if (!path.isAbsolute(sourcePath)) {
    errors.push("Local pack path must be absolute.");
  }

  let packToml = "";
  if (errors.length === 0) {
    try {
      const stats = await fs.stat(sourcePath);
      if (!stats.isDirectory()) {
        errors.push("Local pack path must be a directory.");
      }
    } catch (error) {
      errors.push(`Local pack path is not readable: ${formatError(error)}`);
    }
  }

  if (errors.length === 0) {
    try {
      packToml = await fs.readFile(path.join(sourcePath, "pack.toml"), "utf8");
    } catch (error) {
      errors.push(`Local pack is missing readable pack.toml: ${formatError(error)}`);
    }
  }

  if (errors.length === 0) {
    const unknownEntries = await findUnknownTopLevelEntries(fs, path, sourcePath);
    for (const entry of unknownEntries) {
      warnings.push(
        `Unknown top-level pack entry "${entry}" will be ignored by the scanner.`,
      );
    }

    capabilities.push(
      ...(await discoverDirectoryCapabilities(
        fs,
        path,
        sourcePath,
        "agents",
        "agent",
        "authored_text",
        false,
      )),
      ...(await discoverDirectoryCapabilities(
        fs,
        path,
        sourcePath,
        "commands",
        "command",
        "executable_or_provider",
        true,
      )),
      ...(await discoverDirectoryCapabilities(
        fs,
        path,
        sourcePath,
        "doctor",
        "doctor",
        "executable_or_provider",
        true,
      )),
      ...(await discoverDirectoryCapabilities(
        fs,
        path,
        sourcePath,
        "formulas",
        "formula",
        "authored_text",
        false,
      )),
      ...(await discoverDirectoryCapabilities(
        fs,
        path,
        sourcePath,
        "orders",
        "order",
        "safe_structured_control",
        false,
      )),
      ...(await discoverDirectoryCapabilities(
        fs,
        path,
        sourcePath,
        "overlays",
        "overlay",
        "authored_text",
        false,
      )),
      ...(await discoverDirectoryCapabilities(
        fs,
        path,
        sourcePath,
        "template-fragments",
        "template_fragment",
        "authored_text",
        false,
      )),
      ...(await discoverDirectoryCapabilities(
        fs,
        path,
        sourcePath,
        "assets",
        "asset",
        "read_only",
        false,
      )),
    );
  }

  const packName = parsePackName(packToml);
  return {
    packRefId: args.packRefId,
    sourcePath,
    checkedAt: args.checkedAt ?? new Date().toISOString(),
    packName,
    bindingSuggestion: suggestBinding(packName, path.basename(sourcePath)),
    capabilities,
    warnings,
    errors,
  };
}

async function findUnknownTopLevelEntries(
  fs: NodeFsPromises,
  path: NodePath,
  sourcePath: string,
): Promise<string[]> {
  const knownEntries = new Set([
    "agents",
    "assets",
    "commands",
    "doctor",
    "formulas",
    "orders",
    "overlays",
    "pack.toml",
    "template-fragments",
  ]);
  const entries = await fs.readdir(sourcePath, { withFileTypes: true });
  return entries
    .map((entry) => entry.name)
    .filter((name) => !name.startsWith("."))
    .filter((name) => !knownEntries.has(name))
    .filter((name) => path.basename(name) === name)
    .sort((left, right) => left.localeCompare(right));
}

async function discoverDirectoryCapabilities(
  fs: NodeFsPromises,
  path: NodePath,
  sourcePath: string,
  relativeDirectory: string,
  kind: GasCityDiscoveredCapability["kind"],
  safetyTier: GasCityPackSafetyTier,
  executesLocalCode: boolean,
): Promise<GasCityDiscoveredCapability[]> {
  const directoryPath = path.join(sourcePath, relativeDirectory);
  let entries: Array<{
    name: string;
    isDirectory: () => boolean;
    isFile: () => boolean;
  }>;
  try {
    entries = await fs.readdir(directoryPath, { withFileTypes: true });
  } catch (error) {
    if (isNotFound(error)) {
      return [];
    }
    return [
      {
        id: `${kind}:${relativeDirectory}`,
        kind,
        name: relativeDirectory,
        title: null,
        safetyTier,
        sourcePath: directoryPath,
        executesLocalCode,
      },
    ];
  }

  return entries
    .filter((entry) => !entry.name.startsWith("."))
    .filter((entry) => entry.isDirectory() || entry.isFile())
    .map((entry) => {
      const name = capabilityNameFromEntry(entry.name);
      return {
        id: `${kind}:${name}`,
        kind,
        name,
        title: null,
        safetyTier,
        sourcePath: path.join(directoryPath, entry.name),
        executesLocalCode,
      };
    })
    .sort((left, right) => left.id.localeCompare(right.id));
}

function parsePackName(packToml: string): string | null {
  const packSectionMatch = /(?:^|\n)\s*\[pack\]\s*\n([\s\S]*?)(?=\n\s*\[|$)/.exec(
    packToml,
  );
  const searchText = packSectionMatch?.[1] ?? packToml;
  const nameMatch = /(?:^|\n)\s*name\s*=\s*"([^"]+)"/.exec(searchText);
  return nameMatch?.[1]?.trim() || null;
}

function suggestBinding(packName: string | null, fallbackName: string): string | null {
  const raw = packName?.trim() || fallbackName.trim();
  const binding = raw
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return binding || null;
}

function capabilityNameFromEntry(entryName: string): string {
  return entryName.replace(/\.[^.]+$/, "");
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
