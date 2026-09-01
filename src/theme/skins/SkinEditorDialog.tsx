import { useMemo, useState } from "react";
import {
  BUILT_IN_VD_SKINS,
  DEFAULT_VD_SKIN_ID,
} from "./builtin";
import {
  EDITABLE_COLOR_TOKEN_KEYS,
  createEditableSkinFromBase,
  createSkinEditorPreviewState,
  mergeImportedSkinState,
  normalizeSkinEditorColorSwatchValue,
  upsertUserSkinAndSetGlobal,
  validateSkinEditorDraft,
  type EditableColorTokenKey,
} from "./editor";
import {
  createDefaultSkinState,
  importSkinPackage,
  setGlobalSkin,
} from "./schema";
import type {
  VDSkinDiagnostic,
  VDSkinManifestV1,
  VDSkinState,
} from "./types";
import type {
  SkinEditorActions,
  SkinEditorColorField,
  SkinEditorViewModel,
} from "./SkinEditorDialog.contracts";
import { SkinEditorDialogView } from "./SkinEditorDialog.view";

export interface SkinEditorDialogProps {
  actions: SkinEditorActions;
  onClose: () => void;
  open: boolean;
  skinState?: VDSkinState;
}

const COLOR_LABELS: Record<EditableColorTokenKey, string> = {
  accent: "Accent",
  background: "Background",
  border: "Border",
  danger: "Danger",
  foreground: "Foreground",
  muted: "Muted",
  panel: "Panel",
  success: "Success",
  warning: "Warning",
};

const BUILT_IN_IDS = new Set(BUILT_IN_VD_SKINS.map((skin) => skin.id));

function cloneSkin(skin: VDSkinManifestV1): VDSkinManifestV1 {
  return JSON.parse(JSON.stringify(skin)) as VDSkinManifestV1;
}

function formatPackageJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function diagnostic(
  code: string,
  message: string,
  path?: string,
): VDSkinDiagnostic {
  return { severity: "error", code, message, path };
}

function getSavedSkinState(skinState: VDSkinState | undefined): VDSkinState {
  return skinState ?? createDefaultSkinState();
}

export function SkinEditorDialog({
  actions,
  onClose,
  open,
  skinState,
}: SkinEditorDialogProps) {
  const savedState = getSavedSkinState(skinState);
  const [selectedSkinId, setSelectedSkinId] = useState(savedState.activeGlobalSkinId);
  const [draftSkin, setDraftSkin] = useState<VDSkinManifestV1 | null>(null);
  const [importText, setImportText] = useState("");
  const [exportText, setExportText] = useState("");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [diagnostics, setDiagnostics] = useState<VDSkinDiagnostic[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  const availableSkins = useMemo(
    () => [...BUILT_IN_VD_SKINS, ...savedState.userSkins],
    [savedState.userSkins],
  );
  const selectedSkin =
    draftSkin ??
    availableSkins.find((skin) => skin.id === selectedSkinId) ??
    availableSkins.find((skin) => skin.id === savedState.activeGlobalSkinId) ??
    BUILT_IN_VD_SKINS[0]!;
  const selectedSkinIsBuiltIn = BUILT_IN_IDS.has(selectedSkin.id);
  const draftValidation = draftSkin ? validateSkinEditorDraft(draftSkin) : null;
  const previewState =
    draftSkin && draftValidation?.ok
      ? createSkinEditorPreviewState(savedState, draftSkin)
      : {
          ...savedState,
          activeGlobalSkinId: selectedSkin.id,
        };

  const colorSource = draftSkin ?? selectedSkin;
  const colorFields: SkinEditorColorField[] = EDITABLE_COLOR_TOKEN_KEYS.map(
    (key) => ({
      key,
      label: COLOR_LABELS[key],
      swatchValue: normalizeSkinEditorColorSwatchValue(
        colorSource.tokens.colors[key],
      ),
      value: colorSource.tokens.colors[key] ?? "",
    }),
  );

  const model: SkinEditorViewModel = {
    activeGlobalSkinId: savedState.activeGlobalSkinId,
    colorFields,
    diagnostics: draftValidation && !draftValidation.ok
      ? [...diagnostics, ...draftValidation.diagnostics]
      : diagnostics,
    draftSkin,
    exportText,
    importText,
    isDirty: Boolean(draftSkin),
    isEditingCustomSkin: Boolean(draftSkin),
    isSaving,
    previewState,
    rawCssStatus: "deferred",
    selectedSkin,
    selectedSkinIsBuiltIn,
    skinOptions: availableSkins.map((skin) => ({
      id: skin.id,
      isActive: skin.id === savedState.activeGlobalSkinId,
      isBuiltIn: BUILT_IN_IDS.has(skin.id),
      isSelected: skin.id === selectedSkin.id,
      name: skin.name,
    })),
    statusMessage,
  };

  if (!open) return null;

  return (
    <SkinEditorDialogView
      actions={{
        applySelectedSkin: () => {
          void saveStateFromResult(
            setGlobalSkin({
              state: savedState,
              skinId: selectedSkin.id,
            }).value,
            `Applied ${selectedSkin.name}.`,
          );
        },
        close: onClose,
        exportSelectedSkin: () => {
          setExportText(
            formatPackageJson({
              packageVersion: 1,
              skins: [selectedSkin],
              activeGlobalSkinId: selectedSkin.id,
            }),
          );
          setImportText("");
          setStatusMessage(`Exported ${selectedSkin.name}.`);
          setDiagnostics([]);
        },
        forkSelectedSkin: () => {
          const editable = selectedSkinIsBuiltIn
            ? createEditableSkinFromBase({
                baseSkin: selectedSkin,
                existingIds: [
                  ...BUILT_IN_VD_SKINS.map((skin) => skin.id),
                  ...savedState.userSkins.map((skin) => skin.id),
                ],
              })
            : cloneSkin(selectedSkin);
          setDraftSkin(editable);
          setSelectedSkinId(editable.id);
          setStatusMessage(
            selectedSkinIsBuiltIn
              ? `Created editable copy of ${selectedSkin.name}.`
              : `Editing ${selectedSkin.name}.`,
          );
          setDiagnostics([]);
        },
        importPackage: () => {
          let parsed: unknown;
          try {
            parsed = JSON.parse(importText);
          } catch {
            setDiagnostics([
              diagnostic("invalid-json", "Skin package JSON could not be parsed."),
            ]);
            setStatusMessage(null);
            return;
          }

          const imported = importSkinPackage(parsed);
          if (!imported.ok || !imported.value) {
            setDiagnostics(imported.diagnostics);
            setStatusMessage(null);
            return;
          }

          const merged = mergeImportedSkinState(savedState, imported.value);
          void saveStateFromResult(merged, "Imported skin package.");
        },
        revertToDefaultSkin: () => {
          void saveStateFromResult(
            setGlobalSkin({
              state: savedState,
              skinId: DEFAULT_VD_SKIN_ID,
            }).value,
            "Reverted to default skin.",
          );
        },
        saveDraftSkin: () => {
          if (!draftSkin) return;
          const saved = upsertUserSkinAndSetGlobal({
            state: savedState,
            skin: draftSkin,
          });
          if (!saved.ok || !saved.value) {
            setDiagnostics(saved.diagnostics);
            setStatusMessage(null);
            return;
          }
          void saveStateFromResult(saved.value, `Saved ${draftSkin.name}.`, () => {
            setDraftSkin(null);
            setSelectedSkinId(draftSkin.id);
          });
        },
        selectSkin: (skinId) => {
          setSelectedSkinId(skinId);
          setDraftSkin(null);
          setDiagnostics([]);
          setStatusMessage(null);
        },
        updateColorToken: (key, value) => {
          updateDraft((skin) => {
            skin.tokens.colors = {
              ...skin.tokens.colors,
              [key]: value,
            };
          });
        },
        updateDraftAuthor: (value) => {
          updateDraft((skin) => {
            skin.author = value;
          });
        },
        updateDraftDescription: (value) => {
          updateDraft((skin) => {
            skin.description = value;
          });
        },
        updateDraftName: (value) => {
          updateDraft((skin) => {
            skin.name = value;
          });
        },
        updateImportText: (value) => {
          setImportText(value);
          setExportText("");
          setDiagnostics([]);
          setStatusMessage(null);
        },
      }}
      model={model}
    />
  );

  function updateDraft(mutator: (skin: VDSkinManifestV1) => void) {
    setDraftSkin((current) => {
      if (!current) return current;
      const next = cloneSkin(current);
      mutator(next);
      return next;
    });
  }

  async function saveStateFromResult(
    nextState: VDSkinState | undefined,
    successMessage: string,
    afterSave?: () => void,
  ) {
    if (!nextState) {
      setDiagnostics([
        diagnostic("invalid-skin-state", "Skin state could not be updated."),
      ]);
      return;
    }

    setIsSaving(true);
    try {
      const result = await actions.saveSkinState({ state: nextState });
      setDiagnostics(result.diagnostics ?? []);
      if (result.ok) {
        afterSave?.();
        setStatusMessage(successMessage);
      } else {
        setStatusMessage(null);
      }
    } catch (error) {
      setDiagnostics([
        diagnostic(
          "save-failed",
          `Skin state could not be saved. ${getErrorMessage(error)}`,
          "saveSkinState",
        ),
      ]);
      setStatusMessage(null);
    } finally {
      setIsSaving(false);
    }
  }
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  if (typeof error === "string" && error.trim()) return error.trim();
  return "Try again.";
}
