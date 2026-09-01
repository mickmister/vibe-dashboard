import { describe, expect, it } from "vitest";
import {
  DEFAULT_VD_SKIN_ID,
  buildSingleSkinExportPackage,
  createDefaultSkinState,
  createEditableSkinFromBase,
  createSkinEditorPreviewState,
  importSkinPackage,
  lightStudioSkin,
  mergeImportedSkinState,
  normalizeSkinEditorColorSwatchValue,
  upsertUserSkinAndSetGlobal,
  validateSkinEditorDraft,
} from "./index";
import type { VDSkinManifestV1 } from "./types";

function editableSkin(id = "vd-user-neon-flight"): VDSkinManifestV1 {
  return {
    ...lightStudioSkin,
    id,
    name: "Neon Flight",
    author: "Test",
    tokens: {
      ...lightStudioSkin.tokens,
      colors: {
        ...lightStudioSkin.tokens.colors,
        background: "#101827",
        foreground: "#f8fafc",
        accent: "#22d3ee",
      },
    },
    rawCss: [],
  };
}

describe("skin editor state model", () => {
  it("previews a draft without mutating stored global skin state", () => {
    const stored = createDefaultSkinState();
    const draft = createEditableSkinFromBase({
      baseSkin: lightStudioSkin,
      name: "Neon Flight",
      existingIds: [DEFAULT_VD_SKIN_ID, lightStudioSkin.id],
    });
    draft.tokens.colors.accent = "#22d3ee";

    const previewState = createSkinEditorPreviewState(stored, draft);

    expect(stored.userSkins).toEqual([]);
    expect(stored.activeGlobalSkinId).toBe(DEFAULT_VD_SKIN_ID);
    expect(previewState.userSkins).toHaveLength(1);
    expect(previewState.activeGlobalSkinId).toBe(draft.id);
  });

  it("blocks saving built-in ids or raw CSS while preserving diagnostics", () => {
    const reserved = validateSkinEditorDraft(lightStudioSkin);
    const unsafe = validateSkinEditorDraft({
      ...editableSkin(),
      rawCss: [{ id: "unsafe", css: "[data-vd-skin-root] * { color: #fff; }" }],
    });

    expect(reserved.ok).toBe(false);
    expect(reserved.diagnostics.map((entry) => entry.code)).toContain(
      "reserved-skin-id",
    );
    expect(unsafe.ok).toBe(false);
    expect(unsafe.diagnostics.map((entry) => entry.code)).toContain(
      "raw-css-deferred",
    );
  });

  it("upserts a user skin and sets it as the active global skin", () => {
    const stored = createDefaultSkinState();
    const skin = editableSkin();

    const saved = upsertUserSkinAndSetGlobal({ state: stored, skin });

    expect(saved.ok).toBe(true);
    expect(saved.value?.userSkins.map((entry) => entry.id)).toEqual([skin.id]);
    expect(saved.value?.activeGlobalSkinId).toBe(skin.id);
  });

  it("exports and reimports a single user skin package", () => {
    const skin = editableSkin();
    const exported = buildSingleSkinExportPackage(skin);
    const parsed = importSkinPackage(JSON.parse(JSON.stringify(exported)));

    expect(exported).toMatchObject({
      packageVersion: 1,
      activeGlobalSkinId: skin.id,
    });
    expect(exported.skins).toEqual([skin]);
    expect(parsed.ok).toBe(true);
    expect(parsed.value?.userSkins[0]?.id).toBe(skin.id);
    expect(parsed.value?.activeGlobalSkinId).toBe(skin.id);
  });

  it("merges imported skins into the current state without dropping existing custom skins", () => {
    const existing = editableSkin("vd-user-existing");
    const imported = editableSkin("vd-user-imported");
    const current = {
      version: 1 as const,
      userSkins: [existing],
      activeGlobalSkinId: existing.id,
    };
    const importedState = importSkinPackage({
      packageVersion: 1,
      skins: [imported],
      activeGlobalSkinId: imported.id,
    }).value!;

    const merged = mergeImportedSkinState(current, importedState);

    expect(merged.userSkins.map((skin) => skin.id)).toEqual([
      existing.id,
      imported.id,
    ]);
    expect(merged.activeGlobalSkinId).toBe(imported.id);
  });

  it("normalizes schema-valid colors for native color swatch display only", () => {
    expect(normalizeSkinEditorColorSwatchValue("#abc")).toBe("#aabbcc");
    expect(normalizeSkinEditorColorSwatchValue("#A1B2C3")).toBe("#a1b2c3");
    expect(normalizeSkinEditorColorSwatchValue("#a1b2c3dd")).toBe("#a1b2c3");
    expect(normalizeSkinEditorColorSwatchValue("not-a-color")).toBe("#000000");
    expect(normalizeSkinEditorColorSwatchValue("")).toBe("#000000");
  });
});
