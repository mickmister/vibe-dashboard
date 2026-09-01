import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_VD_SKIN_ID,
  SkinRoot,
  defaultDarkSkin,
  getSkinRuntimeState,
  lightStudioSkin,
  type VDSkinManifestV1,
} from ".";

function completeSkin(overrides: Partial<VDSkinManifestV1> = {}): VDSkinManifestV1 {
  return {
    schemaVersion: 1,
    id: "vd-user-calm-graphite",
    name: "Calm Graphite",
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
      },
      radii: {
        row: "0.5rem",
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
    },
    components: {
      row: {
        background: "#18181f",
        foreground: "#f1f5f9",
        border: "#2f3037",
        radius: "0.5rem",
        gap: "0.5rem",
      },
    },
    slots: {
      "workspace-row": {
        background: "#18181f",
        foreground: "#f1f5f9",
        border: "#2f3037",
        radius: "0.5rem",
      },
    },
    assets: [],
    rawCss: [],
    ...overrides,
  };
}

describe("VD global skin runtime", () => {
  it("projects primitive, surface, component, and slot tokens into CSS variables", () => {
    const custom = completeSkin();
    const runtime = getSkinRuntimeState({
      state: {
        version: 1,
        userSkins: [custom],
        activeGlobalSkinId: custom.id,
      },
    });

    expect(runtime.skin.id).toBe(custom.id);
    expect(runtime.source).toBe("global");
    expect(runtime.style["--vd-color-background"]).toBe("#101014");
    expect(runtime.style["--vd-font-family"]).toBe(
      "Inter, ui-sans-serif, system-ui, sans-serif",
    );
    expect(runtime.style["--vd-density-scale"]).toBe("compact");
    expect(runtime.style["--vd-spacing-row"]).toBe("0.5rem");
    expect(runtime.style["--vd-radius-row"]).toBe("0.5rem");
    expect(runtime.style["--vd-shadow-panel"]).toBe(
      "0 20px 60px rgb(0 0 0 / 0.35)",
    );
    expect(runtime.style["--vd-surface-spaces-overview-background"]).toBe(
      "#101014",
    );
    expect(runtime.style["--vd-component-row-gap"]).toBe("0.5rem");
    expect(runtime.style["--vd-slot-workspace-row-radius"]).toBe("0.5rem");
  });

  it("resolves active built-in skins through the same global runtime path", () => {
    const runtime = getSkinRuntimeState({
      state: {
        version: 1,
        userSkins: [],
        activeGlobalSkinId: lightStudioSkin.id,
      },
    });

    expect(runtime.skin.id).toBe(lightStudioSkin.id);
    expect(runtime.style["--vd-color-background"]).toBe("#f8fafc");
    expect(runtime.style["--vd-surface-app-shell-background"]).toBe("#f8fafc");
  });

  it("falls back to the built-in default when the active global skin is unavailable", () => {
    const runtime = getSkinRuntimeState({
      state: {
        version: 1,
        userSkins: [completeSkin()],
        activeGlobalSkinId: "missing-skin",
      },
    });

    expect(runtime.skin.id).toBe(DEFAULT_VD_SKIN_ID);
    expect(runtime.requestedSkinId).toBe("missing-skin");
    expect(runtime.source).toBe("default");
    expect(runtime.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "missing-global-skin",
    );
    expect(runtime.style["--vd-color-background"]).toBe(
      defaultDarkSkin.tokens.colors.background,
    );
  });

  it("renders SkinRoot attributes and variables without injecting raw CSS", () => {
    const html = renderToStaticMarkup(
      React.createElement(
        SkinRoot,
        {
          state: {
            version: 1,
            userSkins: [],
            activeGlobalSkinId: DEFAULT_VD_SKIN_ID,
          },
          className: "app",
        },
        "Dashboard",
      ),
    );

    expect(html).toContain("data-vd-skin-root=\"true\"");
    expect(html).toContain(`data-vd-skin-id="${DEFAULT_VD_SKIN_ID}"`);
    expect(html).toContain("--vd-color-background:#09090b");
    expect(html).not.toContain("<style");
    expect(html).not.toContain("rawCss");
  });
});
