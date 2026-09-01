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
  getSkinRuntimeState,
  type VDSkinCSSVariableName,
  type VDSkinRuntimeOptions,
  type VDSkinRuntimeState,
  type VDSkinStyleVariables,
} from "./runtime";
export * from "./types";
