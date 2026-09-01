import type { VDSkinManifestV1 } from "./types";

export const DEFAULT_VD_SKIN_ID = "vd-default-dark";
export const AGENT_EDITABLE_SKIN_PACKAGE_DIR = ".vibe-dashboard/skins";

export const defaultDarkSkin: VDSkinManifestV1 = {
  schemaVersion: 1,
  id: DEFAULT_VD_SKIN_ID,
  name: "VD Default Dark",
  description: "Compatibility skin matching the existing dark VD shell.",
  author: "Vibe Dashboard",
  tokens: {
    colors: {
      background: "#09090b",
      foreground: "#f4f4f5",
      panel: "#18181b",
      muted: "#a1a1aa",
      accent: "#60a5fa",
      border: "#27272a",
      danger: "#f87171",
      success: "#4ade80",
      warning: "#fbbf24",
    },
    typography: {
      fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
      monoFontFamily:
        "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
      baseSize: "14px",
      headingWeight: 650,
      bodyWeight: 400,
    },
    density: {
      scale: "comfortable",
      spaceUnit: "0.75rem",
      controlHeight: "2.25rem",
      rowHeight: "3rem",
    },
    spacing: {
      xs: "0.25rem",
      sm: "0.5rem",
      md: "0.75rem",
      lg: "1rem",
      xl: "1.5rem",
    },
    radii: {
      sm: "0.375rem",
      md: "0.75rem",
      lg: "1rem",
      pill: "999px",
    },
    shadows: {
      panel: "0 18px 45px rgb(0 0 0 / 0.35)",
    },
  },
  surfaces: {
    "app-shell": {
      background: "#09090b",
      foreground: "#f4f4f5",
      border: "#27272a",
    },
    "spaces-overview": {
      background: "#09090b",
      foreground: "#f4f4f5",
      border: "#27272a",
      accent: "#60a5fa",
    },
    modal: {
      background: "#18181b",
      foreground: "#f4f4f5",
      border: "#3f3f46",
      radius: "1rem",
      shadow: "0 24px 80px rgb(0 0 0 / 0.55)",
    },
    "skin-editor": {
      background: "#09090b",
      foreground: "#f4f4f5",
      border: "#3f3f46",
      radius: "1rem",
      shadow: "0 24px 80px rgb(0 0 0 / 0.35)",
      accent: "#60a5fa",
    },
  },
  components: {
    button: {
      background: "#27272a",
      foreground: "#f4f4f5",
      border: "#3f3f46",
      radius: "0.5rem",
    },
    card: {
      background: "#18181b",
      foreground: "#f4f4f5",
      border: "#27272a",
      radius: "0.75rem",
    },
    row: {
      background: "#18181b",
      foreground: "#f4f4f5",
      border: "#27272a",
      radius: "0.75rem",
      gap: "0.75rem",
    },
    badge: {
      background: "#27272a",
      foreground: "#d4d4d8",
      border: "#3f3f46",
      radius: "999px",
    },
  },
  slots: {
    "workspace-row": {
      background: "#18181b",
      foreground: "#f4f4f5",
      border: "#27272a",
      radius: "0.75rem",
    },
    "workspace-list": {
      gap: "0.25rem",
    },
  },
  assets: [],
  rawCss: [],
};

export const lightStudioSkin: VDSkinManifestV1 = {
  ...defaultDarkSkin,
  id: "vd-light-studio",
  name: "VD Light Studio",
  description: "Bright starter skin for checking shell contrast beyond dark mode.",
  tokens: {
    ...defaultDarkSkin.tokens,
    colors: {
      background: "#f8fafc",
      foreground: "#0f172a",
      panel: "#ffffff",
      muted: "#64748b",
      accent: "#2563eb",
      border: "#cbd5e1",
      danger: "#dc2626",
      success: "#16a34a",
      warning: "#ca8a04",
    },
  },
  surfaces: {
    ...defaultDarkSkin.surfaces,
    "app-shell": {
      background: "#f8fafc",
      foreground: "#0f172a",
      border: "#cbd5e1",
    },
    "spaces-overview": {
      background: "#f8fafc",
      foreground: "#0f172a",
      border: "#cbd5e1",
      accent: "#2563eb",
    },
    modal: {
      background: "#ffffff",
      foreground: "#0f172a",
      border: "#cbd5e1",
      radius: "1rem",
      shadow: "0 24px 80px rgb(15 23 42 / 0.18)",
    },
    "skin-editor": {
      background: "#f8fafc",
      foreground: "#0f172a",
      border: "#cbd5e1",
      radius: "1rem",
      shadow: "0 24px 80px rgb(15 23 42 / 0.14)",
      accent: "#2563eb",
    },
  },
  components: {
    ...defaultDarkSkin.components,
    button: {
      background: "#e0e7ff",
      foreground: "#111827",
      border: "#c7d2fe",
      radius: "0.5rem",
    },
    card: {
      background: "#ffffff",
      foreground: "#0f172a",
      border: "#dbe4ef",
      radius: "0.75rem",
    },
    row: {
      background: "#ffffff",
      foreground: "#0f172a",
      border: "#dbe4ef",
      radius: "0.75rem",
      gap: "0.75rem",
    },
  },
  slots: {
    ...defaultDarkSkin.slots,
    "workspace-row": {
      background: "#ffffff",
      foreground: "#0f172a",
      border: "#dbe4ef",
      radius: "0.75rem",
    },
  },
};

export const highContrastTerminalSkin: VDSkinManifestV1 = {
  ...defaultDarkSkin,
  id: "vd-high-contrast-terminal",
  name: "VD High Contrast Terminal",
  description: "High-contrast starter skin for dense agent/operator workflows.",
  tokens: {
    ...defaultDarkSkin.tokens,
    colors: {
      background: "#000000",
      foreground: "#faff00",
      panel: "#050505",
      muted: "#a3ff12",
      accent: "#00ffff",
      border: "#faff00",
      danger: "#ff4d4d",
      success: "#00ff7f",
      warning: "#faff00",
    },
    typography: {
      ...defaultDarkSkin.tokens.typography,
      headingWeight: 800,
      bodyWeight: 600,
      letterSpacing: "0.02em",
    },
    density: {
      scale: "compact",
      spaceUnit: "0.5rem",
      controlHeight: "2rem",
      rowHeight: "2.5rem",
    },
  },
  surfaces: {
    "app-shell": {
      background: "#000000",
      foreground: "#faff00",
      border: "#faff00",
    },
    "spaces-overview": {
      background: "#000000",
      foreground: "#faff00",
      border: "#faff00",
      accent: "#00ffff",
      radius: "0px",
    },
    modal: {
      background: "#050505",
      foreground: "#faff00",
      border: "#faff00",
      radius: "0px",
      shadow: "0 0 0 2px #00ffff",
    },
  },
  components: {
    button: {
      background: "#000000",
      foreground: "#faff00",
      border: "#faff00",
      radius: "0px",
    },
    card: {
      background: "#050505",
      foreground: "#faff00",
      border: "#faff00",
      radius: "0px",
    },
    row: {
      background: "#050505",
      foreground: "#faff00",
      border: "#faff00",
      radius: "0px",
      gap: "0.5rem",
    },
    badge: {
      background: "#000000",
      foreground: "#00ffff",
      border: "#00ffff",
      radius: "0px",
    },
  },
  slots: {
    "workspace-row": {
      background: "#050505",
      foreground: "#faff00",
      border: "#faff00",
      radius: "0px",
    },
    "workspace-list": {
      gap: "0px",
    },
  },
};

export const BUILT_IN_VD_SKINS = [
  defaultDarkSkin,
  lightStudioSkin,
  highContrastTerminalSkin,
] as const;
