import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createProductionGasCityExecutionBundleCompiler } from "./gasCityExecutionBundleCompilerComposition";

describe("production Gas City execution bundle compiler composition", () => {
  it("fails closed when packaged runtime evidence is unavailable", async () => {
    const service = createProductionGasCityExecutionBundleCompiler("/definitely/missing/runtime.json");
    await expect(service.compile({})).rejects.toThrow("Verified packaged Gas City compiler runtime is unavailable.");
  });

  it("rejects malformed or extensible runtime manifests before compiler use", async () => {
    const root = await mkdtemp(join(tmpdir(), "vd-gc-composition-test-"));
    const manifest = join(root, "runtime.json");
    await writeFile(manifest, JSON.stringify({ schemaVersion: "vd.gas-city-runtime.v1", unexpected: true }));
    const service = createProductionGasCityExecutionBundleCompiler(manifest);
    await expect(service.compile({})).rejects.toThrow("Packaged Gas City compiler manifest is invalid.");
  });
});
