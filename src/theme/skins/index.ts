export {
  AGENT_EDITABLE_SKIN_PACKAGE_DIR,
  BUILT_IN_VD_SKINS,
  DEFAULT_VD_SKIN_ID,
  defaultDarkSkin,
  highContrastTerminalSkin,
  lightStudioSkin,
} from "./builtin";
export {
  createDefaultSkinState,
  exportSkinPackage,
  importSkinPackage,
  migrateSkinState,
  resolveGlobalSkin,
  setGlobalSkin,
  validateSkinManifest,
} from "./schema";
export { SkinRoot, type SkinRootProps } from "./SkinRoot";
export { SkinRootView, type SkinRootViewProps } from "./SkinRoot.view";
export {
  SkinEditorDialog,
  type SkinEditorDialogProps,
} from "./SkinEditorDialog";
export type {
  SkinEditorActions,
  SkinEditorColorField,
  SkinEditorDialogViewProps,
  SkinEditorSaveResult,
  SkinEditorSkinOption,
  SkinEditorViewActions,
  SkinEditorViewModel,
} from "./SkinEditorDialog.contracts";
export {
  SkinEditorDialogView,
} from "./SkinEditorDialog.view";
export {
  VDAction,
  VDBadge,
  VDCard,
  VDHeading,
  VDIcon,
  VDRow,
  VDText,
  type VDActionTone,
  type VDIconName,
  type VDSemanticStatus,
  type VDSemanticTextTone,
} from "./primitives.view";
export {
  EDITABLE_COLOR_TOKEN_KEYS,
  buildSingleSkinExportPackage,
  createEditableSkinFromBase,
  createSkinEditorPreviewState,
  createUserSkinId,
  mergeImportedSkinState,
  normalizeSkinEditorColorSwatchValue,
  setActiveGlobalSkinFromEditor,
  upsertUserSkinAndSetGlobal,
  validateSkinEditorDraft,
  type EditableColorTokenKey,
} from "./editor";
export {
  getSkinRuntimeState,
  type VDSkinCSSVariableName,
  type VDSkinRuntimeOptions,
  type VDSkinRuntimeState,
  type VDSkinStyleVariables,
} from "./runtime";
export * from "./types";
