export const VD_SKIN_MANIFEST_VERSION = 1;
export const VD_SKIN_STATE_VERSION = 1;

export type VDSkinDiagnosticSeverity = "error" | "warning";

export type VDSkinSurfaceId =
  | "app-shell"
  | "sidebar"
  | "voyage-bar"
  | "spaces-overview"
  | "workspace-content"
  | "modal"
  | "menu"
  | "skin-editor";

export type VDSkinComponentId =
  | "button"
  | "input"
  | "field"
  | "dialog"
  | "card"
  | "row"
  | "badge"
  | "tab"
  | "toolbar"
  | "section"
  | "list"
  | "empty-state"
  | "loading-state"
  | "error-state";

export type VDSkinSlotId =
  | "page-header"
  | "recent-sessions"
  | "starred-craft"
  | "running-dev-servers"
  | "recently-visited-craft"
  | "recently-created-craft"
  | "workspace-list"
  | "workspace-row"
  | "spaces-list"
  | "space-picker-modal"
  | "skin-editor-header"
  | "skin-editor-library"
  | "skin-editor-editor"
  | "skin-editor-preview"
  | "skin-editor-import-export"
  | "skin-editor-diagnostics";

export type VDSkinAssetKind = "image" | "font" | "icon";

export interface VDSkinDiagnostic {
  severity: VDSkinDiagnosticSeverity;
  code: string;
  message: string;
  path?: string;
}

export interface VDSkinColorTokens {
  background?: string;
  foreground?: string;
  panel?: string;
  muted?: string;
  accent?: string;
  border?: string;
  danger?: string;
  success?: string;
  warning?: string;
}

export interface VDSkinTypographyTokens {
  fontFamily?: string;
  monoFontFamily?: string;
  baseSize?: string;
  headingWeight?: number;
  bodyWeight?: number;
  letterSpacing?: string;
}

export interface VDSkinDensityTokens {
  scale?: "compact" | "comfortable" | "spacious";
  spaceUnit?: string;
  controlHeight?: string;
  rowHeight?: string;
}

export interface VDSkinPrimitiveTokens {
  colors: VDSkinColorTokens;
  typography: VDSkinTypographyTokens;
  density: VDSkinDensityTokens;
  spacing?: Record<string, string>;
  radii?: Record<string, string>;
  shadows?: Record<string, string>;
}

export interface VDSkinStyleRecipe {
  background?: string;
  foreground?: string;
  muted?: string;
  accent?: string;
  border?: string;
  radius?: string;
  shadow?: string;
  padding?: string;
  gap?: string;
  variant?: string;
}

export type VDSkinSurfaceRecipes = Partial<
  Record<VDSkinSurfaceId, VDSkinStyleRecipe>
>;
export type VDSkinComponentRecipes = Partial<
  Record<VDSkinComponentId, VDSkinStyleRecipe>
>;
export type VDSkinSlotRecipes = Partial<Record<VDSkinSlotId, VDSkinStyleRecipe>>;

export interface VDSkinAssetRef {
  id: string;
  kind: VDSkinAssetKind;
  path: string;
  description?: string;
}

export interface VDSkinRawCssBlock {
  id: string;
  css: string;
}

export interface VDSkinManifestV1 {
  schemaVersion: 1;
  id: string;
  name: string;
  description?: string;
  author?: string;
  tokens: VDSkinPrimitiveTokens;
  surfaces: VDSkinSurfaceRecipes;
  components: VDSkinComponentRecipes;
  slots: VDSkinSlotRecipes;
  assets: VDSkinAssetRef[];
  rawCss: VDSkinRawCssBlock[];
}

export type VDSkinManifest = VDSkinManifestV1;

export interface VDSkinStateV1 {
  version: 1;
  userSkins: VDSkinManifestV1[];
  activeGlobalSkinId: string;
}

export type VDSkinState = VDSkinStateV1;

export interface VDSkinImportExportPackageV1 {
  packageVersion: 1;
  skins: VDSkinManifestV1[];
  activeGlobalSkinId?: string;
}

export type VDSkinImportExportPackage = VDSkinImportExportPackageV1;

export interface VDSkinValidationResult<T> {
  ok: boolean;
  value?: T;
  diagnostics: VDSkinDiagnostic[];
}

export interface VDSkinResolution {
  skin: VDSkinManifestV1;
  requestedSkinId: string;
  source: "global" | "default";
  diagnostics: VDSkinDiagnostic[];
}
