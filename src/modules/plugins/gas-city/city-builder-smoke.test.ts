import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { scanGasCityLocalPack } from "./local-pack-scanner";
import {
  previewGasCityGeneratedCityConfig,
  renderGasCityGeneratedCityConfig,
} from "./city-config-renderer";
import { createDefaultGasCityBuilderState } from "./types";
import { buildGasCitySlingFormulaCommand } from "./sling-command";

async function makeSmokePack(): Promise<string> {
  const packPath = await mkdtemp(join(tmpdir(), "gc-city-builder-pack-"));
  await writeFile(
    join(packPath, "pack.toml"),
    `[pack]\nname = "Smoke Pack"\nschema = 2\n`,
    "utf8",
  );
  await mkdir(join(packPath, "agents", "reviewer"), { recursive: true });
  await writeFile(
    join(packPath, "agents", "reviewer", "prompt.template.md"),
    "Review the generated smoke task.",
    "utf8",
  );
  await mkdir(join(packPath, "formulas"), { recursive: true });
  await writeFile(
    join(packPath, "formulas", "mol-review.formula.toml"),
    `formula = "mol-review"\n\n[[steps]]\nid = "review"\ntitle = "Review {{topic}}"\n`,
    "utf8",
  );
  await mkdir(join(packPath, "orders"), { recursive: true });
  await writeFile(
    join(packPath, "orders", "daily-review.toml"),
    `enabled = true\nformula = "mol-review"\ninterval = "24h"\n`,
    "utf8",
  );
  return packPath;
}

describe("local-pack City Builder smoke", () => {
  it("validates, imports, previews generated TOML, and prepares a formula sling", async () => {
    const packPath = await makeSmokePack();
    const validation = await scanGasCityLocalPack({
      packRefId: "smoke-pack",
      sourcePath: packPath,
      checkedAt: "2026-06-11T00:00:00.000Z",
    });

    expect(validation.errors).toEqual([]);
    expect(validation.capabilities.map((capability) => capability.kind)).toEqual([
      "agent",
      "formula",
      "order",
    ]);

    const builderState = createDefaultGasCityBuilderState();
    builderState.generatedCity = {
      cityId: "smoke",
      cityName: "Smoke City",
      runtimeRoot: "/tmp/vd-gc-smoke",
      cityTomlPath: "/tmp/vd-gc-smoke/city.toml",
      lastRenderedAt: null,
    };
    builderState.localPackRefs.push({
      id: "smoke-pack",
      binding: validation.bindingSuggestion ?? "smoke-pack",
      sourcePath: packPath,
      scope: "city",
      rigName: null,
      enabled: true,
      addedAt: "2026-06-11T00:00:00.000Z",
      lastValidatedAt: validation.checkedAt,
    });

    const rendered = renderGasCityGeneratedCityConfig(builderState);
    expect(rendered.cityToml).toContain("[imports.smoke-pack]");
    expect(rendered.cityToml).toContain(`source = "${packPath}"`);

    const preview = previewGasCityGeneratedCityConfig(builderState, {
      cityToml: null,
      packToml: null,
    });
    expect(preview.files.map((file) => [file.kind, file.status])).toEqual([
      ["city.toml", "created"],
      ["pack.toml", "created"],
    ]);

    expect(
      buildGasCitySlingFormulaCommand({
        target: "reviewer",
        formula: "mol-review",
        vars: { topic: "local-pack-city-builder" },
      }),
    ).toEqual([
      "sling",
      "reviewer",
      "mol-review",
      "--formula",
      "--var",
      "topic=local-pack-city-builder",
    ]);
  });
});
