import { BUILT_IN_VD_SKINS, DEFAULT_VD_SKIN_ID } from "./builtin";
import {
  VD_SKIN_MANIFEST_VERSION,
  VD_SKIN_STATE_VERSION,
  type VDSkinAssetKind,
  type VDSkinComponentId,
  type VDSkinComponentRecipes,
  type VDSkinDiagnostic,
  type VDSkinImportExportPackage,
  type VDSkinManifestV1,
  type VDSkinPrimitiveTokens,
  type VDSkinResolution,
  type VDSkinSlotId,
  type VDSkinSlotRecipes,
  type VDSkinState,
  type VDSkinStyleRecipe,
  type VDSkinSurfaceId,
  type VDSkinSurfaceRecipes,
  type VDSkinValidationResult,
} from "./types";

const SURFACE_IDS: VDSkinSurfaceId[] = [
  "app-shell",
  "sidebar",
  "voyage-bar",
  "spaces-overview",
  "workspace-content",
  "modal",
  "menu",
  "skin-editor",
];

const COMPONENT_IDS: VDSkinComponentId[] = [
  "button",
  "input",
  "field",
  "dialog",
  "card",
  "row",
  "badge",
  "tab",
  "toolbar",
  "section",
  "list",
  "empty-state",
  "loading-state",
  "error-state",
];

const SLOT_IDS: VDSkinSlotId[] = [
  "page-header",
  "recent-sessions",
  "starred-craft",
  "running-dev-servers",
  "recently-visited-craft",
  "recently-created-craft",
  "workspace-list",
  "workspace-row",
  "spaces-list",
  "space-picker-modal",
  "skin-editor-header",
  "skin-editor-library",
  "skin-editor-editor",
  "skin-editor-preview",
  "skin-editor-import-export",
  "skin-editor-diagnostics",
];

const SURFACE_ID_SET = new Set<string>(SURFACE_IDS);
const COMPONENT_ID_SET = new Set<string>(COMPONENT_IDS);
const SLOT_ID_SET = new Set<string>(SLOT_IDS);
const BUILT_IN_SKIN_IDS = new Set(BUILT_IN_VD_SKINS.map((skin) => skin.id));
const ID_PATTERN = /^[a-z0-9][a-z0-9._-]{1,63}$/;
const TOKEN_KEY_PATTERN = /^[a-z][a-z0-9-]{0,40}$/;
const SAFE_VARIANT_PATTERN = /^[a-z][a-z0-9-]{0,40}$/;
const HEX_COLOR_PATTERN = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const LENGTH_PATTERN =
  /^(?:0|-?(?:\d+|\d*\.\d+)(?:px|rem|em|%|vh|vw|ch|lh))$/;
const SAFE_FONT_PATTERN = /^[a-zA-Z0-9\s'",.-]+$/;
const UNSAFE_CSS_FRAGMENT_PATTERN =
  /[;{}]|\burl\s*\(|@import\b|\bexpression\s*\(|[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/i;
const SHADOW_LENGTH_PATTERN =
  /^(?:0|-?(?:\d+|\d*\.\d+)(?:px|rem|em|ch))$/;
const SHADOW_HEX_COLOR_PATTERN = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const SHADOW_RGB_COLOR_PATTERN =
  /^rgb\(\s*(?:\d|[1-9]\d|1\d\d|2[0-4]\d|25[0-5])\s+(?:\d|[1-9]\d|1\d\d|2[0-4]\d|25[0-5])\s+(?:\d|[1-9]\d|1\d\d|2[0-4]\d|25[0-5])(?:\s*\/\s*(?:0|1|0?\.\d+))?\s*\)$/i;
const ALLOWED_ASSET_EXTENSIONS: Record<VDSkinAssetKind, Set<string>> = {
  image: new Set(["png", "jpg", "jpeg", "webp", "gif", "svg"]),
  icon: new Set(["png", "jpg", "jpeg", "webp", "gif", "svg"]),
  font: new Set(["woff", "woff2"]),
};

function error(code: string, message: string, path?: string): VDSkinDiagnostic {
  return { severity: "error", code, message, path };
}

function warning(
  code: string,
  message: string,
  path?: string,
): VDSkinDiagnostic {
  return { severity: "warning", code, message, path };
}

function ok<T>(
  value: T,
  diagnostics: VDSkinDiagnostic[] = [],
): VDSkinValidationResult<T> {
  return { ok: true, value, diagnostics };
}

function fail<T>(diagnostics: VDSkinDiagnostic[]): VDSkinValidationResult<T> {
  return { ok: false, diagnostics };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value.trim() : undefined;
}

function hasUnsafeCssFragment(value: string): boolean {
  return UNSAFE_CSS_FRAGMENT_PATTERN.test(value);
}

function rejectUnsafeCssFragment(
  value: string,
  diagnostics: VDSkinDiagnostic[],
  path: string,
): boolean {
  if (!hasUnsafeCssFragment(value)) return false;
  diagnostics.push(
    error(
      "unsafe-css-value",
      "CSS variable values cannot contain raw CSS escape hatches.",
      path,
    ),
  );
  return true;
}

function normalizeColor(
  value: unknown,
  diagnostics: VDSkinDiagnostic[],
  path: string,
): string | undefined {
  const candidate = asString(value);
  if (!candidate) return undefined;
  if (!HEX_COLOR_PATTERN.test(candidate)) {
    diagnostics.push(error("invalid-color", "Color tokens must be hex colors.", path));
    return undefined;
  }
  return candidate.toLowerCase();
}

function normalizeLength(
  value: unknown,
  diagnostics: VDSkinDiagnostic[],
  path: string,
): string | undefined {
  if (value == null) return undefined;
  if (typeof value !== "string") {
    diagnostics.push(
      error("invalid-length", "Length values must use safe CSS length units.", path),
    );
    return undefined;
  }
  const candidate = asString(value);
  if (!candidate) return undefined;
  if (rejectUnsafeCssFragment(candidate, diagnostics, path)) return undefined;
  if (!LENGTH_PATTERN.test(candidate)) {
    diagnostics.push(
      error("invalid-length", "Length values must use safe CSS length units.", path),
    );
    return undefined;
  }
  return candidate;
}

function normalizeTokenMapValues(
  value: unknown,
  diagnostics: VDSkinDiagnostic[],
  path: string,
  normalizeValue: (
    value: unknown,
    diagnostics: VDSkinDiagnostic[],
    path: string,
  ) => string | undefined,
): Record<string, string> | undefined {
  if (value == null) return undefined;
  if (!isRecord(value)) {
    diagnostics.push(error("invalid-token-map", "Token map must be an object.", path));
    return undefined;
  }
  const normalized: Record<string, string> = {};
  for (const [key, rawValue] of Object.entries(value)) {
    if (!TOKEN_KEY_PATTERN.test(key)) {
      diagnostics.push(
        error("invalid-token-key", `Invalid token key "${key}".`, `${path}.${key}`),
      );
      continue;
    }
    const stringValue = normalizeValue(rawValue, diagnostics, `${path}.${key}`);
    if (!stringValue) continue;
    normalized[key] = stringValue;
  }
  return normalized;
}

function normalizeShadow(
  value: unknown,
  diagnostics: VDSkinDiagnostic[],
  path: string,
): string | undefined {
  const candidate = asString(value);
  if (!candidate) {
    diagnostics.push(error("invalid-shadow", "Shadow values must be strings.", path));
    return undefined;
  }
  if (rejectUnsafeCssFragment(candidate, diagnostics, path)) return undefined;
  if (!isSafeShadow(candidate)) {
    diagnostics.push(
      error(
        "invalid-shadow",
        "Shadow values must use the conservative box-shadow whitelist.",
        path,
      ),
    );
    return undefined;
  }
  return candidate;
}

function isSafeShadow(value: string): boolean {
  if (value === "none") return true;

  const layers = splitShadowLayers(value);
  return Boolean(layers.length) && layers.every(isSafeShadowLayer);
}

function splitShadowLayers(value: string): string[] {
  const layers: string[] = [];
  let depth = 0;
  let start = 0;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (depth < 0) return [];
    if (char === "," && depth === 0) {
      const layer = value.slice(start, index).trim();
      if (!layer) return [];
      layers.push(layer);
      start = index + 1;
    }
  }

  if (depth !== 0) return [];
  const finalLayer = value.slice(start).trim();
  if (!finalLayer) return [];
  layers.push(finalLayer);
  return layers;
}

function isSafeShadowLayer(value: string): boolean {
  const tokens = value.match(/rgb\([^)]+\)|#[0-9a-f]{3,8}|[^\s]+/gi) ?? [];
  if (!tokens.length) return false;

  const remaining = [...tokens];
  if (remaining[0]?.toLowerCase() === "inset") {
    remaining.shift();
  }

  const colors = remaining.filter(isSafeShadowColor);
  if (colors.length > 1) return false;
  for (const color of colors) {
    remaining.splice(remaining.indexOf(color), 1);
  }

  return (
    remaining.length >= 2 &&
    remaining.length <= 4 &&
    remaining.every((token) => SHADOW_LENGTH_PATTERN.test(token))
  );
}

function isSafeShadowColor(value: string): boolean {
  return (
    SHADOW_HEX_COLOR_PATTERN.test(value) ||
    SHADOW_RGB_COLOR_PATTERN.test(value)
  );
}

function normalizeFont(
  value: unknown,
  diagnostics: VDSkinDiagnostic[],
  path: string,
): string | undefined {
  const candidate = asString(value);
  if (!candidate) return undefined;
  if (!SAFE_FONT_PATTERN.test(candidate)) {
    diagnostics.push(
      error("invalid-font", "Font family values contain unsupported characters.", path),
    );
    return undefined;
  }
  return candidate;
}

function validateAssetPath(
  path: string,
  kind: VDSkinAssetKind,
): boolean {
  if (
    path.startsWith("/") ||
    path.includes("\\") ||
    path.split("/").includes("..") ||
    /^[a-z][a-z0-9+.-]*:/i.test(path)
  ) {
    return false;
  }
  const extension = path.split(".").pop()?.toLowerCase();
  return Boolean(extension && ALLOWED_ASSET_EXTENSIONS[kind].has(extension));
}

function normalizeAssets(
  value: unknown,
  diagnostics: VDSkinDiagnostic[],
): VDSkinManifestV1["assets"] {
  if (value == null) return [];
  if (!Array.isArray(value)) {
    diagnostics.push(error("invalid-assets", "assets must be an array.", "assets"));
    return [];
  }

  const seen = new Set<string>();
  return value.flatMap((asset, index) => {
    if (!isRecord(asset)) {
      diagnostics.push(
        error("invalid-asset", "Asset entries must be objects.", `assets.${index}`),
      );
      return [];
    }

    const id = asString(asset.id);
    const kind = asString(asset.kind) as VDSkinAssetKind | undefined;
    const path = asString(asset.path);
    if (!id || !ID_PATTERN.test(id)) {
      diagnostics.push(
        error("invalid-asset-id", "Asset id must be a stable package id.", `assets.${index}.id`),
      );
      return [];
    }
    if (seen.has(id)) {
      diagnostics.push(
        error("duplicate-asset-id", `Duplicate asset id "${id}".`, `assets.${index}.id`),
      );
      return [];
    }
    if (!(kind === "image" || kind === "font" || kind === "icon")) {
      diagnostics.push(
        error("invalid-asset-kind", "Asset kind must be image, font, or icon.", `assets.${index}.kind`),
      );
      return [];
    }
    if (!path || !validateAssetPath(path, kind)) {
      diagnostics.push(
        error(
          "invalid-asset-path",
          "Asset path must be package-relative with a safe extension.",
          `assets.${index}.path`,
        ),
      );
      return [];
    }

    seen.add(id);
    return [
      {
        id,
        kind,
        path,
        ...(asString(asset.description)
          ? { description: asString(asset.description) }
          : {}),
      },
    ];
  });
}

function normalizeRawCss(
  value: unknown,
  diagnostics: VDSkinDiagnostic[],
): VDSkinManifestV1["rawCss"] {
  if (value == null) return [];
  if (!Array.isArray(value)) {
    diagnostics.push(error("invalid-raw-css", "rawCss must be an array.", "rawCss"));
    return [];
  }

  const seen = new Set<string>();
  return value.flatMap((block, index) => {
    if (!isRecord(block)) {
      diagnostics.push(
        error("invalid-raw-css-block", "Raw CSS blocks must be objects.", `rawCss.${index}`),
      );
      return [];
    }
    const id = asString(block.id);
    if (!id || !ID_PATTERN.test(id)) {
      diagnostics.push(
        error("invalid-raw-css-id", "Raw CSS block id must be a stable package id.", `rawCss.${index}.id`),
      );
      return [];
    }
    if (seen.has(id)) {
      diagnostics.push(
        error("duplicate-raw-css-id", `Duplicate raw CSS block id "${id}".`, `rawCss.${index}.id`),
      );
      return [];
    }
    if (typeof block.css !== "string") {
      diagnostics.push(
        error("invalid-raw-css-body", "Raw CSS block body must be a string.", `rawCss.${index}.css`),
      );
      return [];
    }
    if (block.css.trim()) {
      diagnostics.push(
        error(
          "raw-css-deferred",
          "Raw CSS is reserved for a later sanitizer/runtime milestone and cannot be activated yet.",
          `rawCss.${index}.css`,
        ),
      );
      return [];
    }
    seen.add(id);
    return [{ id, css: block.css }];
  });
}

function normalizeRecipe(
  value: unknown,
  diagnostics: VDSkinDiagnostic[],
  path: string,
): VDSkinStyleRecipe {
  const source = isRecord(value) ? value : {};
  if (value != null && !isRecord(value)) {
    diagnostics.push(error("invalid-style-recipe", "Style recipe must be an object.", path));
  }

  const variant = asString(source.variant);
  if (variant && !SAFE_VARIANT_PATTERN.test(variant)) {
    diagnostics.push(
      error("invalid-style-variant", "Variant ids must be lowercase package ids.", `${path}.variant`),
    );
  }

  const background = normalizeColor(source.background, diagnostics, `${path}.background`);
  const foreground = normalizeColor(source.foreground, diagnostics, `${path}.foreground`);
  const muted = normalizeColor(source.muted, diagnostics, `${path}.muted`);
  const accent = normalizeColor(source.accent, diagnostics, `${path}.accent`);
  const border = normalizeColor(source.border, diagnostics, `${path}.border`);
  const radius = normalizeLength(source.radius, diagnostics, `${path}.radius`);
  const padding = normalizeLength(source.padding, diagnostics, `${path}.padding`);
  const gap = normalizeLength(source.gap, diagnostics, `${path}.gap`);
  const shadow =
    source.shadow == null
      ? undefined
      : normalizeShadow(source.shadow, diagnostics, `${path}.shadow`);

  return {
    ...(background ? { background } : {}),
    ...(foreground ? { foreground } : {}),
    ...(muted ? { muted } : {}),
    ...(accent ? { accent } : {}),
    ...(border ? { border } : {}),
    ...(radius ? { radius } : {}),
    ...(shadow ? { shadow } : {}),
    ...(padding ? { padding } : {}),
    ...(gap ? { gap } : {}),
    ...(variant && SAFE_VARIANT_PATTERN.test(variant) ? { variant } : {}),
  };
}

function normalizeRecipeRecord<K extends string>(
  value: unknown,
  allowedIds: Set<string>,
  diagnostics: VDSkinDiagnostic[],
  path: string,
  invalidCode: string,
): Partial<Record<K, VDSkinStyleRecipe>> {
  if (value == null) return {};
  if (!isRecord(value)) {
    diagnostics.push(error(`invalid-${path}`, `${path} must be an object.`, path));
    return {};
  }

  const normalized: Partial<Record<K, VDSkinStyleRecipe>> = {};
  for (const [id, recipe] of Object.entries(value)) {
    if (!allowedIds.has(id)) {
      diagnostics.push(error(invalidCode, `Unsupported ${path} id "${id}".`, `${path}.${id}`));
      continue;
    }
    normalized[id as K] = normalizeRecipe(recipe, diagnostics, `${path}.${id}`);
  }
  return normalized;
}

function normalizeTokens(
  value: unknown,
  diagnostics: VDSkinDiagnostic[],
): VDSkinPrimitiveTokens {
  const source = isRecord(value) ? value : {};
  if (!isRecord(value)) {
    diagnostics.push(error("invalid-tokens", "tokens must be an object.", "tokens"));
  }
  const colors = isRecord(source.colors) ? source.colors : {};
  if (!isRecord(source.colors)) {
    diagnostics.push(error("invalid-colors", "tokens.colors must be an object.", "tokens.colors"));
  }
  const typography = isRecord(source.typography) ? source.typography : {};
  if (!isRecord(source.typography)) {
    diagnostics.push(
      error("invalid-typography", "tokens.typography must be an object.", "tokens.typography"),
    );
  }
  const density = isRecord(source.density) ? source.density : {};
  if (!isRecord(source.density)) {
    diagnostics.push(error("invalid-density", "tokens.density must be an object.", "tokens.density"));
  }
  const scale =
    density.scale === "compact" ||
    density.scale === "comfortable" ||
    density.scale === "spacious"
      ? density.scale
      : undefined;
  if (density.scale != null && !scale) {
    diagnostics.push(
      error("invalid-density-scale", "Density scale must be compact, comfortable, or spacious.", "tokens.density.scale"),
    );
  }

  const background = normalizeColor(colors.background, diagnostics, "tokens.colors.background");
  const foreground = normalizeColor(colors.foreground, diagnostics, "tokens.colors.foreground");
  const panel = normalizeColor(colors.panel, diagnostics, "tokens.colors.panel");
  const muted = normalizeColor(colors.muted, diagnostics, "tokens.colors.muted");
  const accent = normalizeColor(colors.accent, diagnostics, "tokens.colors.accent");
  const border = normalizeColor(colors.border, diagnostics, "tokens.colors.border");
  const danger = normalizeColor(colors.danger, diagnostics, "tokens.colors.danger");
  const success = normalizeColor(colors.success, diagnostics, "tokens.colors.success");
  const warning = normalizeColor(colors.warning, diagnostics, "tokens.colors.warning");
  const fontFamily = normalizeFont(
    typography.fontFamily,
    diagnostics,
    "tokens.typography.fontFamily",
  );
  const monoFontFamily = normalizeFont(
    typography.monoFontFamily,
    diagnostics,
    "tokens.typography.monoFontFamily",
  );
  const baseSize = normalizeLength(
    typography.baseSize,
    diagnostics,
    "tokens.typography.baseSize",
  );
  const spaceUnit = normalizeLength(
    density.spaceUnit,
    diagnostics,
    "tokens.density.spaceUnit",
  );
  const controlHeight = normalizeLength(
    density.controlHeight,
    diagnostics,
    "tokens.density.controlHeight",
  );
  const rowHeight = normalizeLength(
    density.rowHeight,
    diagnostics,
    "tokens.density.rowHeight",
  );
  const letterSpacing = normalizeLength(
    typography.letterSpacing,
    diagnostics,
    "tokens.typography.letterSpacing",
  );
  const spacing = normalizeTokenMapValues(
    source.spacing,
    diagnostics,
    "tokens.spacing",
    normalizeLength,
  );
  const radii = normalizeTokenMapValues(
    source.radii,
    diagnostics,
    "tokens.radii",
    normalizeLength,
  );
  const shadows = normalizeTokenMapValues(
    source.shadows,
    diagnostics,
    "tokens.shadows",
    normalizeShadow,
  );

  return {
    colors: {
      ...(background ? { background } : {}),
      ...(foreground ? { foreground } : {}),
      ...(panel ? { panel } : {}),
      ...(muted ? { muted } : {}),
      ...(accent ? { accent } : {}),
      ...(border ? { border } : {}),
      ...(danger ? { danger } : {}),
      ...(success ? { success } : {}),
      ...(warning ? { warning } : {}),
    },
    typography: {
      ...(fontFamily ? { fontFamily } : {}),
      ...(monoFontFamily ? { monoFontFamily } : {}),
      ...(baseSize ? { baseSize } : {}),
      ...(typeof typography.headingWeight === "number"
        ? { headingWeight: typography.headingWeight }
        : {}),
      ...(typeof typography.bodyWeight === "number"
        ? { bodyWeight: typography.bodyWeight }
        : {}),
      ...(letterSpacing ? { letterSpacing } : {}),
    },
    density: {
      ...(scale ? { scale } : {}),
      ...(spaceUnit ? { spaceUnit } : {}),
      ...(controlHeight ? { controlHeight } : {}),
      ...(rowHeight ? { rowHeight } : {}),
    },
    ...(spacing ? { spacing } : {}),
    ...(radii ? { radii } : {}),
    ...(shadows ? { shadows } : {}),
  };
}

export function validateSkinManifest(
  value: unknown,
): VDSkinValidationResult<VDSkinManifestV1> {
  const diagnostics: VDSkinDiagnostic[] = [];
  if (!isRecord(value)) {
    return fail([error("invalid-manifest", "Skin manifest must be an object.")]);
  }
  if (value.schemaVersion !== VD_SKIN_MANIFEST_VERSION) {
    diagnostics.push(
      error("unsupported-version", "Skin manifest schemaVersion must be 1.", "schemaVersion"),
    );
  }
  const id = asString(value.id);
  const name = asString(value.name);
  if (!id || !ID_PATTERN.test(id)) {
    diagnostics.push(error("invalid-id", "Skin id must be a stable lowercase package id.", "id"));
  }
  if (!name) diagnostics.push(error("invalid-name", "Skin name is required.", "name"));

  const manifest: VDSkinManifestV1 = {
    schemaVersion: 1,
    id: id || "invalid",
    name: name || "Invalid skin",
    ...(asString(value.description)
      ? { description: asString(value.description) }
      : {}),
    ...(asString(value.author) ? { author: asString(value.author) } : {}),
    tokens: normalizeTokens(value.tokens, diagnostics),
    surfaces: normalizeRecipeRecord<VDSkinSurfaceId>(
      value.surfaces,
      SURFACE_ID_SET,
      diagnostics,
      "surfaces",
      "invalid-surface-id",
    ) as VDSkinSurfaceRecipes,
    components: normalizeRecipeRecord<VDSkinComponentId>(
      value.components,
      COMPONENT_ID_SET,
      diagnostics,
      "components",
      "invalid-component-id",
    ) as VDSkinComponentRecipes,
    slots: normalizeRecipeRecord<VDSkinSlotId>(
      value.slots,
      SLOT_ID_SET,
      diagnostics,
      "slots",
      "invalid-slot-id",
    ) as VDSkinSlotRecipes,
    assets: normalizeAssets(value.assets, diagnostics),
    rawCss: normalizeRawCss(value.rawCss, diagnostics),
  };

  if (diagnostics.some((entry) => entry.severity === "error")) {
    return fail(diagnostics);
  }
  return ok(manifest, diagnostics);
}

export function createDefaultSkinState(): VDSkinState {
  return {
    version: VD_SKIN_STATE_VERSION,
    userSkins: [],
    activeGlobalSkinId: DEFAULT_VD_SKIN_ID,
  };
}

export function migrateSkinState(value: unknown): VDSkinState {
  if (!isRecord(value) || value.version !== VD_SKIN_STATE_VERSION) {
    return createDefaultSkinState();
  }

  const userSkins = Array.isArray(value.userSkins)
    ? value.userSkins
        .map(validateSkinManifest)
        .filter(
          (
            result,
          ): result is VDSkinValidationResult<VDSkinManifestV1> & {
            value: VDSkinManifestV1;
          } => result.ok && Boolean(result.value),
        )
        .map((result) => result.value)
        .filter((skin) => !BUILT_IN_SKIN_IDS.has(skin.id))
    : [];
  const availableSkinIds = new Set([
    ...BUILT_IN_VD_SKINS.map((skin) => skin.id),
    ...userSkins.map((skin) => skin.id),
  ]);
  const activeGlobalSkinId = asString(value.activeGlobalSkinId);

  return {
    version: 1,
    userSkins,
    activeGlobalSkinId:
      activeGlobalSkinId && availableSkinIds.has(activeGlobalSkinId)
        ? activeGlobalSkinId
        : DEFAULT_VD_SKIN_ID,
  };
}

export function resolveGlobalSkin(state: VDSkinState): VDSkinResolution {
  const migrated = migrateSkinState(state);
  const availableSkins = new Map([
    ...BUILT_IN_VD_SKINS.map((skin) => [skin.id, skin] as const),
    ...migrated.userSkins.map((skin) => [skin.id, skin] as const),
  ]);
  const requestedSkinId = migrated.activeGlobalSkinId;
  const skin = availableSkins.get(requestedSkinId);
  if (skin) {
    return {
      skin,
      requestedSkinId,
      source: "global",
      diagnostics: [],
    };
  }

  return {
    skin: BUILT_IN_VD_SKINS[0],
    requestedSkinId,
    source: "default",
    diagnostics: [
      warning(
        "missing-global-skin",
        `Global skin "${requestedSkinId}" is missing; falling back to the built-in default.`,
        "activeGlobalSkinId",
      ),
    ],
  };
}

export function importSkinPackage(
  value: unknown,
): VDSkinValidationResult<VDSkinState> {
  if (!isRecord(value) || value.packageVersion !== 1 || !Array.isArray(value.skins)) {
    return fail([
      error(
        "invalid-package",
        "Skin package must be versioned JSON with a skins array.",
      ),
    ]);
  }

  const diagnostics: VDSkinDiagnostic[] = [];
  const normalizedSkins = value.skins.map(validateSkinManifest);
  diagnostics.push(...normalizedSkins.flatMap((result) => result.diagnostics));
  if (diagnostics.some((entry) => entry.severity === "error")) {
    return fail(diagnostics);
  }

  const userSkins = normalizedSkins.map((result) => result.value!);
  const duplicateId = userSkins
    .map((skin) => skin.id)
    .find((id, index, ids) => ids.indexOf(id) !== index);
  if (duplicateId) {
    return fail([
      error("duplicate-skin-id", `Duplicate skin id "${duplicateId}".`, "skins"),
    ]);
  }
  const reservedId = userSkins.find((skin) => BUILT_IN_SKIN_IDS.has(skin.id))?.id;
  if (reservedId) {
    return fail([
      error("reserved-skin-id", `Skin id "${reservedId}" is reserved for a built-in skin.`, "skins"),
    ]);
  }

  const importedSkinIds = new Set(userSkins.map((skin) => skin.id));
  const validActiveSkinIds = new Set([
    ...BUILT_IN_VD_SKINS.map((skin) => skin.id),
    ...importedSkinIds,
  ]);
  const activeGlobalSkinId = asString(value.activeGlobalSkinId);

  return ok(
    {
      version: 1,
      userSkins,
      activeGlobalSkinId:
        activeGlobalSkinId && validActiveSkinIds.has(activeGlobalSkinId)
          ? activeGlobalSkinId
          : DEFAULT_VD_SKIN_ID,
    },
    diagnostics,
  );
}

export function exportSkinPackage(state: VDSkinState): VDSkinImportExportPackage {
  const migrated = migrateSkinState(state);
  return {
    packageVersion: 1,
    skins: migrated.userSkins,
    activeGlobalSkinId: migrated.activeGlobalSkinId,
  };
}

export function setGlobalSkin({
  state,
  skinId,
}: {
  state: unknown;
  skinId: string;
}): VDSkinValidationResult<VDSkinState> {
  const current = migrateSkinState(state);
  const validSkinIds = new Set([
    ...BUILT_IN_VD_SKINS.map((skin) => skin.id),
    ...current.userSkins.map((skin) => skin.id),
  ]);
  if (!validSkinIds.has(skinId)) {
    return fail([error("unknown-skin-id", `Skin id "${skinId}" is not available.`, "skinId")]);
  }

  return ok({
    ...current,
    activeGlobalSkinId: skinId,
  });
}
