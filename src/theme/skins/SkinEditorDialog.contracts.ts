import type {
  VDSkinDiagnostic,
  VDSkinManifestV1,
  VDSkinState,
} from "./types";

export interface SkinEditorSaveResult {
  diagnostics?: VDSkinDiagnostic[];
  ok: boolean;
}

export interface SkinEditorActions {
  saveSkinState: (args: { state: VDSkinState }) => Promise<SkinEditorSaveResult>;
}

export interface SkinEditorColorField {
  key: string;
  label: string;
  swatchValue: string;
  value: string;
}

export interface SkinEditorSkinOption {
  id: string;
  isActive: boolean;
  isBuiltIn: boolean;
  isSelected: boolean;
  name: string;
}

export interface SkinEditorViewModel {
  activeGlobalSkinId: string;
  colorFields: SkinEditorColorField[];
  diagnostics: VDSkinDiagnostic[];
  draftSkin: VDSkinManifestV1 | null;
  exportText: string;
  importText: string;
  isDirty: boolean;
  isEditingCustomSkin: boolean;
  isSaving: boolean;
  previewState: VDSkinState;
  rawCssStatus: "deferred";
  selectedSkin: VDSkinManifestV1;
  selectedSkinIsBuiltIn: boolean;
  skinOptions: SkinEditorSkinOption[];
  statusMessage: string | null;
}

export interface SkinEditorViewActions {
  applySelectedSkin: () => void;
  close: () => void;
  exportSelectedSkin: () => void;
  forkSelectedSkin: () => void;
  importPackage: () => void;
  revertToDefaultSkin: () => void;
  saveDraftSkin: () => void;
  selectSkin: (skinId: string) => void;
  updateColorToken: (key: string, value: string) => void;
  updateDraftAuthor: (value: string) => void;
  updateDraftDescription: (value: string) => void;
  updateDraftName: (value: string) => void;
  updateImportText: (value: string) => void;
}

export interface SkinEditorDialogViewProps {
  actions: SkinEditorViewActions;
  model: SkinEditorViewModel;
}
