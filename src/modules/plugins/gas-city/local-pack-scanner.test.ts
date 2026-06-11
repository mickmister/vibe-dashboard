import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { scanGasCityLocalPack } from "./local-pack-scanner";

async function makePack(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "gc-pack-"));
  await writeFile(
    join(dir, "pack.toml"),
    `[pack]\nname = "Review Tools"\nschema = 2\n`,
    "utf8",
  );
  await mkdir(join(dir, "agents", "reviewer"), { recursive: true });
  await writeFile(join(dir, "agents", "reviewer", "prompt.template.md"), "review", "utf8");
  await mkdir(join(dir, "formulas"));
  await writeFile(join(dir, "formulas", "triage.md"), "triage", "utf8");
  await mkdir(join(dir, "orders"));
  await writeFile(join(dir, "orders", "daily.toml"), "interval = \"1h\"", "utf8");
  await mkdir(join(dir, "commands", "ship"), { recursive: true });
  await writeFile(join(dir, "commands", "ship", "run.sh"), "#!/bin/sh\necho ship", "utf8");
  await mkdir(join(dir, "doctor"));
  await writeFile(join(dir, "doctor", "check.sh"), "#!/bin/sh\nexit 0", "utf8");
  await mkdir(join(dir, "assets"));
  await writeFile(join(dir, "assets", "README.md"), "asset", "utf8");
  return dir;
}

describe("scanGasCityLocalPack", () => {
  it("discovers conventional pack capabilities without executing scripts", async () => {
    const dir = await makePack();
    const result = await scanGasCityLocalPack({ packRefId: "pack-1", sourcePath: dir });

    expect(result.errors).toEqual([]);
    expect(result.packName).toBe("Review Tools");
    expect(result.bindingSuggestion).toBe("review-tools");
    expect(result.capabilities.map((capability) => [
      capability.kind,
      capability.name,
      capability.safetyTier,
      capability.executesLocalCode,
    ])).toEqual([
      ["agent", "reviewer", "authored_text", false],
      ["command", "ship", "executable_or_provider", true],
      ["doctor", "check", "executable_or_provider", true],
      ["formula", "triage", "authored_text", false],
      ["order", "daily", "safe_structured_control", false],
      ["asset", "README", "read_only", false],
    ]);
  });

  it("returns validation errors for non-absolute paths and missing pack.toml", async () => {
    const relative = await scanGasCityLocalPack({ packRefId: "bad", sourcePath: "relative/pack" });
    expect(relative.errors).toContain("Local pack path must be absolute.");

    const dir = await mkdtemp(join(tmpdir(), "gc-empty-pack-"));
    const missing = await scanGasCityLocalPack({ packRefId: "missing", sourcePath: dir });
    expect(missing.errors.some((error) => error.includes("pack.toml"))).toBe(true);
  });
});
