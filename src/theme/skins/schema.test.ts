import { describe, expect, it } from "vitest";
import {
  BUILT_IN_VD_SKINS,
  DEFAULT_VD_SKIN_ID,
  createDefaultSkinState,
  exportSkinPackage,
  importSkinPackage,
  migrateSkinState,
  resolveGlobalSkin,
  setGlobalSkin,
  validateSkinManifest,
  type VDSkinManifestV1,
} from ".";

function completeSkin(overrides: Partial<VDSkinManifestV1> = {}): VDSkinManifestV1 {
  return {
    schemaVersion: 1,
    id: "vd-user-calm-graphite",
    name: "Calm Graphite",
    description: "Quiet dense graphite skin.",
    author: "VD tests",
    tokens: {
      colors: {
        background: "#101014",
        foreground: "#f1f5f9",
        panel: "#18181f",
        muted: "#94a3b8",
        accent: "#8b5cf6",
        border: "#2f3037",
        danger: "#fb7185",
        success: "#34d399",
        warning: "#facc15",
      },
      typography: {
        fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
        monoFontFamily: "IBM Plex Mono, ui-monospace, monospace",
        baseSize: "14px",
        headingWeight: 650,
        bodyWeight: 430,
        letterSpacing: "0.01em",
      },
      density: {
        scale: "compact",
        spaceUnit: "0.5rem",
        controlHeight: "2rem",
        rowHeight: "2.5rem",
      },
      spacing: {
        row: "0.5rem",
        panel: "1rem",
      },
      radii: {
        row: "0.5rem",
        panel: "0.75rem",
      },
      shadows: {
        panel: "0 20px 60px rgb(0 0 0 / 0.35)",
      },
    },
    surfaces: {
      "spaces-overview": {
        background: "#101014",
        foreground: "#f1f5f9",
        border: "#2f3037",
        accent: "#8b5cf6",
        radius: "0.75rem",
      },
      "app-shell": {
        background: "#0b0b0f",
        foreground: "#f1f5f9",
        border: "#2f3037",
      },
    },
    components: {
      row: {
        background: "#18181f",
        foreground: "#f1f5f9",
        border: "#2f3037",
        radius: "0.5rem",
        gap: "0.5rem",
      },
      badge: {
        background: "#242432",
        foreground: "#c4b5fd",
        border: "#4c1d95",
        radius: "999px",
      },
    },
    slots: {
      "workspace-list": {
        gap: "0.25rem",
      },
      "workspace-row": {
        background: "#18181f",
        foreground: "#f1f5f9",
        border: "#2f3037",
        radius: "0.5rem",
      },
    },
    assets: [
      {
        id: "graphite-texture",
        kind: "image",
        path: "assets/graphite.webp",
        description: "Subtle panel texture.",
      },
      {
        id: "display-font",
        kind: "font",
        path: "fonts/display.woff2",
      },
    ],
    rawCss: [],
    ...overrides,
  };
}

describe("VD global skin schema", () => {
  it("accepts a complete surfaces/components/slots skin manifest", () => {
    const result = validateSkinManifest(completeSkin());

    expect(result.ok).toBe(true);
    expect(result.value).toMatchObject({
      schemaVersion: 1,
      id: "vd-user-calm-graphite",
      surfaces: {
        "spaces-overview": {
          background: "#101014",
          accent: "#8b5cf6",
        },
      },
      components: {
        row: {
          radius: "0.5rem",
        },
      },
      slots: {
        "workspace-row": {
          border: "#2f3037",
        },
      },
      assets: [
        {
          id: "graphite-texture",
          kind: "image",
          path: "assets/graphite.webp",
        },
        {
          id: "display-font",
          kind: "font",
          path: "fonts/display.woff2",
        },
      ],
    });
  });

  it("rejects invalid manifests with actionable diagnostics", () => {
    const result = validateSkinManifest({
      ...completeSkin(),
      schemaVersion: 2,
      id: "../bad",
      tokens: {
        colors: {
          background: "black",
        },
        typography: {
          fontFamily: "Inter; color: red",
        },
        density: {
          scale: "huge",
          rowHeight: "calc(100vh)",
        },
      },
      surfaces: {
        dashboard: {
          background: "#fff",
        },
      },
      components: {
        "workspace-row": {
          border: "red",
        },
      },
      slots: {
        "made-up-slot": {},
      },
      assets: [
        {
          id: "remote",
          kind: "image",
          path: "https://example.test/a.png",
        },
        {
          id: "traversal",
          kind: "font",
          path: "../font.woff2",
        },
      ],
    });

    expect(result.ok).toBe(false);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(
      expect.arrayContaining([
        "unsupported-version",
        "invalid-id",
        "invalid-color",
        "invalid-font",
        "invalid-density-scale",
        "invalid-length",
        "invalid-surface-id",
        "invalid-component-id",
        "invalid-slot-id",
        "invalid-asset-path",
      ]),
    );
  });

  it("rejects duplicate package assets and duplicate raw CSS block ids", () => {
    const result = validateSkinManifest({
      ...completeSkin(),
      assets: [
        { id: "dupe", kind: "image", path: "assets/a.png" },
        { id: "dupe", kind: "image", path: "assets/b.png" },
      ],
      rawCss: [
        { id: "dupe-css", css: "" },
        { id: "dupe-css", css: "" },
      ],
    });

    expect(result.ok).toBe(false);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(
      expect.arrayContaining(["duplicate-asset-id", "duplicate-raw-css-id"]),
    );
  });

  it("rejects non-empty raw CSS until the sanitizer/runtime milestone lands", () => {
    const result = validateSkinManifest({
      ...completeSkin(),
      rawCss: [
        {
          id: "expert-css",
          css: "[data-vd-skin-root] [data-vd-slot='workspace-row'] { opacity: 0.98; }",
        },
      ],
    });

    expect(result.ok).toBe(false);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "raw-css-deferred",
    );
  });

  it("defaults and migrates global-only skin state without byVoyageId", () => {
    expect(createDefaultSkinState()).toEqual({
      version: 1,
      userSkins: [],
      activeGlobalSkinId: DEFAULT_VD_SKIN_ID,
    });

    const migrated = migrateSkinState({
      version: 1,
      userSkins: [completeSkin(), BUILT_IN_VD_SKINS[0]],
      activeGlobalSkinId: "vd-user-calm-graphite",
      byVoyageId: {
        old: "vd-user-calm-graphite",
      },
    });

    expect(migrated).toEqual({
      version: 1,
      userSkins: [completeSkin()],
      activeGlobalSkinId: "vd-user-calm-graphite",
    });
    expect("byVoyageId" in migrated).toBe(false);
  });

  it("resolves the active global skin and falls back to default", () => {
    const custom = completeSkin();
    expect(
      resolveGlobalSkin({
        version: 1,
        userSkins: [custom],
        activeGlobalSkinId: custom.id,
      }).skin.name,
    ).toBe("Calm Graphite");

    const fallback = resolveGlobalSkin({
      version: 1,
      userSkins: [custom],
      activeGlobalSkinId: "missing",
    });

    expect(fallback.skin.id).toBe(DEFAULT_VD_SKIN_ID);
  });

  it("imports and exports portable skin packages with global active skin state", () => {
    const custom = completeSkin();
    const imported = importSkinPackage({
      packageVersion: 1,
      skins: [custom],
      activeGlobalSkinId: custom.id,
    });

    expect(imported.ok).toBe(true);
    expect(imported.value).toEqual({
      version: 1,
      userSkins: [custom],
      activeGlobalSkinId: custom.id,
    });
    expect(exportSkinPackage(imported.value!)).toEqual({
      packageVersion: 1,
      skins: [custom],
      activeGlobalSkinId: custom.id,
    });
  });

  it("allows imported packages to keep a built-in skin as the active global skin", () => {
    const imported = importSkinPackage({
      packageVersion: 1,
      skins: [completeSkin()],
      activeGlobalSkinId: "vd-light-studio",
    });

    expect(imported.value?.activeGlobalSkinId).toBe("vd-light-studio");
  });

  it("rejects package duplicates and reserved built-in skin ids", () => {
    const duplicateResult = importSkinPackage({
      packageVersion: 1,
      skins: [completeSkin(), completeSkin()],
    });
    expect(duplicateResult.ok).toBe(false);
    expect(duplicateResult.diagnostics[0]?.code).toBe("duplicate-skin-id");

    const reservedResult = importSkinPackage({
      packageVersion: 1,
      skins: [BUILT_IN_VD_SKINS[0]],
    });
    expect(reservedResult.ok).toBe(false);
    expect(reservedResult.diagnostics[0]?.code).toBe("reserved-skin-id");
  });

  it("updates the active global skin only when the skin exists", () => {
    const custom = completeSkin();
    const state = {
      version: 1 as const,
      userSkins: [custom],
      activeGlobalSkinId: DEFAULT_VD_SKIN_ID,
    };

    expect(setGlobalSkin({ state, skinId: custom.id }).value).toEqual({
      ...state,
      activeGlobalSkinId: custom.id,
    });
    expect(setGlobalSkin({ state, skinId: "missing" }).ok).toBe(false);
  });
});
