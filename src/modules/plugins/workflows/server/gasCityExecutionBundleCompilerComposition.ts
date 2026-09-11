import { readFile } from "node:fs/promises";
import {
  compileGasCityExecutionBundle,
  type CompiledGasCityExecutionBundle,
  type GasCityExecutionBundleCompileInput,
} from "./gasCityExecutionBundleCompiler";
import {
  PinnedGasCityFormulaCompilerAdapter,
  type PinnedGasCityCompilerPolicy,
} from "./pinnedGasCityFormulaCompilerAdapter";

const DEFAULT_MANIFEST = "/usr/local/share/vd/gas-city-runtime.json";

export interface GasCityExecutionBundleCompilerService {
  compile(input: GasCityExecutionBundleCompileInput | unknown): Promise<CompiledGasCityExecutionBundle>;
}

/** Production composition boundary. Configuration is server-owned and never request supplied. */
export function createProductionGasCityExecutionBundleCompiler(
  manifestPath = process.env.VD_GAS_CITY_RUNTIME_MANIFEST || DEFAULT_MANIFEST,
): GasCityExecutionBundleCompilerService {
  let adapter: Promise<PinnedGasCityFormulaCompilerAdapter> | undefined;
  return {
    async compile(input) {
      adapter ??= loadPackagedAdapter(manifestPath);
      return compileGasCityExecutionBundle(input, await adapter);
    },
  };
}

async function loadPackagedAdapter(manifestPath: string): Promise<PinnedGasCityFormulaCompilerAdapter> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch {
    throw new Error("Verified packaged Gas City compiler runtime is unavailable.");
  }
  const policy = parseManifest(parsed);
  return PinnedGasCityFormulaCompilerAdapter.create(policy);
}

function parseManifest(value: unknown): PinnedGasCityCompilerPolicy {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Packaged Gas City compiler manifest is invalid.");
  const item = value as Record<string, unknown>;
  const exactKeys = [
    "schemaVersion", "gasCityExecutable", "gasCityExecutableSha256", "gasCityArchiveSha256",
    "gasCityVersion", "gasCityBuild", "beadsExecutable", "beadsExecutableSha256",
    "beadsArchiveSha256", "beadsVersion", "compilerIdentity", "invocationContract",
  ];
  if (Object.keys(item).sort().join("|") !== [...exactKeys].sort().join("|") || item.schemaVersion !== "vd.gas-city-runtime.v1") {
    throw new Error("Packaged Gas City compiler manifest is invalid.");
  }
  if (exactKeys.slice(1).some((key) => typeof item[key] !== "string" || !(item[key] as string).trim())) {
    throw new Error("Packaged Gas City compiler manifest is invalid.");
  }
  return { mode: "production_packaged", ...Object.fromEntries(exactKeys.slice(1).map((key) => [key, item[key]])) } as PinnedGasCityCompilerPolicy;
}
