import type { CSSProperties } from "react";
import { BUILT_IN_VD_SKINS, defaultDarkSkin } from "./builtin";
import { migrateSkinState } from "./schema";
import type {
  VDSkinDiagnostic,
  VDSkinManifestV1,
  VDSkinPrimitiveTokens,
  VDSkinResolution,
  VDSkinState,
  VDSkinStyleRecipe,
} from "./types";

export type VDSkinCSSVariableName = `--vd-${string}`;
export type VDSkinStyleVariables = CSSProperties &
  Partial<Record<VDSkinCSSVariableName, string | number>>;

export interface VDSkinRuntimeOptions {
  state?: unknown;
  fallbackSkin?: VDSkinManifestV1;
}

export interface VDSkinRuntimeState extends VDSkinResolution {
  densityScale: NonNullable<VDSkinPrimitiveTokens["density"]["scale"]>;
  style: VDSkinStyleVariables;
  rawCss: "";
  rawCssStatus: "deferred";
}

const RECIPE_KEYS = [
  "background",
  "foreground",
  "muted",
  "accent",
  "border",
  "radius",
  "shadow",
  "padding",
  "gap",
  "variant",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function readRequestedSkinId(value: unknown, migrated: VDSkinState): string {
  if (isRecord(value) && typeof value.activeGlobalSkinId === "string") {
    return value.activeGlobalSkinId.trim() || migrated.activeGlobalSkinId;
  }
  return migrated.activeGlobalSkinId;
}

function missingSkinDiagnostic(requestedSkinId: string): VDSkinDiagnostic {
  return {
    severity: "warning",
    code: "missing-global-skin",
    message: `Global skin "${requestedSkinId}" is missing; falling back to the built-in default.`,
    path: "activeGlobalSkinId",
  };
}

function setVariable(
  style: VDSkinStyleVariables,
  name: VDSkinCSSVariableName,
  value: number | string | undefined,
): void {
  if (value == null || value === "") return;
  style[name] = value;
}

function projectTokenMap(
  style: VDSkinStyleVariables,
  prefix: VDSkinCSSVariableName,
  values: Record<string, string> | undefined,
): void {
  if (!values) return;
  for (const [key, value] of Object.entries(values)) {
    setVariable(style, `${prefix}-${key}` as VDSkinCSSVariableName, value);
  }
}

function projectRecipe(
  style: VDSkinStyleVariables,
  prefix: VDSkinCSSVariableName,
  recipe: VDSkinStyleRecipe | undefined,
): void {
  if (!recipe) return;
  for (const key of RECIPE_KEYS) {
    setVariable(style, `${prefix}-${key}` as VDSkinCSSVariableName, recipe[key]);
  }
}

function projectRecipes(
  style: VDSkinStyleVariables,
  prefix: "component" | "slot" | "surface",
  recipes: Partial<Record<string, VDSkinStyleRecipe>>,
): void {
  for (const [id, recipe] of Object.entries(recipes)) {
    projectRecipe(style, `--vd-${prefix}-${id}` as VDSkinCSSVariableName, recipe);
  }
}

function buildSkinStyleVariables(skin: VDSkinManifestV1): VDSkinStyleVariables {
  const style: VDSkinStyleVariables = {};
  const colors = {
    ...defaultDarkSkin.tokens.colors,
    ...skin.tokens.colors,
  };
  const typography = {
    ...defaultDarkSkin.tokens.typography,
    ...skin.tokens.typography,
  };
  const density = {
    ...defaultDarkSkin.tokens.density,
    ...skin.tokens.density,
  };

  setVariable(style, "--vd-color-background", colors.background);
  setVariable(style, "--vd-color-foreground", colors.foreground);
  setVariable(style, "--vd-color-panel", colors.panel);
  setVariable(style, "--vd-color-muted", colors.muted);
  setVariable(style, "--vd-color-accent", colors.accent);
  setVariable(style, "--vd-color-border", colors.border);
  setVariable(style, "--vd-color-danger", colors.danger);
  setVariable(style, "--vd-color-success", colors.success);
  setVariable(style, "--vd-color-warning", colors.warning);

  setVariable(style, "--vd-font-family", typography.fontFamily);
  setVariable(style, "--vd-mono-font-family", typography.monoFontFamily);
  setVariable(style, "--vd-font-size-base", typography.baseSize);
  setVariable(style, "--vd-font-weight-heading", typography.headingWeight);
  setVariable(style, "--vd-font-weight-body", typography.bodyWeight);
  setVariable(style, "--vd-letter-spacing", typography.letterSpacing);

  setVariable(style, "--vd-density-scale", density.scale);
  setVariable(style, "--vd-space-unit", density.spaceUnit);
  setVariable(style, "--vd-control-height", density.controlHeight);
  setVariable(style, "--vd-row-height", density.rowHeight);

  projectTokenMap(style, "--vd-spacing", skin.tokens.spacing);
  projectTokenMap(style, "--vd-radius", skin.tokens.radii);
  projectTokenMap(style, "--vd-shadow", skin.tokens.shadows);
  projectRecipes(style, "surface", skin.surfaces);
  projectRecipes(style, "component", skin.components);
  projectRecipes(style, "slot", skin.slots);

  return style;
}

export function getSkinRuntimeState({
  state,
  fallbackSkin = defaultDarkSkin,
}: VDSkinRuntimeOptions = {}): VDSkinRuntimeState {
  const migrated = migrateSkinState(state);
  const requestedSkinId = readRequestedSkinId(state, migrated);
  const availableSkins = new Map([
    ...BUILT_IN_VD_SKINS.map((skin) => [skin.id, skin] as const),
    ...migrated.userSkins.map((skin) => [skin.id, skin] as const),
  ]);
  const skin = availableSkins.get(requestedSkinId);
  const resolution: VDSkinResolution = skin
    ? {
        skin,
        requestedSkinId,
        source: "global",
        diagnostics: [],
      }
    : {
        skin: fallbackSkin,
        requestedSkinId,
        source: "default",
        diagnostics: [missingSkinDiagnostic(requestedSkinId)],
      };

  const densityScale =
    resolution.skin.tokens.density.scale ??
    defaultDarkSkin.tokens.density.scale ??
    "comfortable";

  return {
    ...resolution,
    densityScale,
    style: buildSkinStyleVariables(resolution.skin),
    rawCss: "",
    rawCssStatus: "deferred",
  };
}
