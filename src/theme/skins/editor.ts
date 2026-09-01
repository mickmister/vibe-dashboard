import { BUILT_IN_VD_SKINS, DEFAULT_VD_SKIN_ID } from "./builtin";
import {
  createDefaultSkinState,
  migrateSkinState,
  setGlobalSkin,
  validateSkinManifest,
} from "./schema";
import type {
  VDSkinDiagnostic,
  VDSkinImportExportPackage,
  VDSkinManifestV1,
  VDSkinState,
  VDSkinValidationResult,
} from "./types";

export const EDITABLE_COLOR_TOKEN_KEYS = [
  "background",
  "foreground",
  "panel",
  "muted",
  "accent",
  "border",
  "danger",
  "success",
  "warning",
] as const;

export type EditableColorTokenKey = (typeof EDITABLE_COLOR_TOKEN_KEYS)[number];

const BUILT_IN_SKIN_IDS = new Set(BUILT_IN_VD_SKINS.map((skin) => skin.id));

function diagnostic(
  code: string,
  message: string,
  path?: string,
  severity: VDSkinDiagnostic["severity"] = "error",
): VDSkinDiagnostic {
  return { severity, code, message, path };
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

function deepCloneSkin(skin: VDSkinManifestV1): VDSkinManifestV1 {
  return JSON.parse(JSON.stringify(skin)) as VDSkinManifestV1;
}

export function createUserSkinId(
  name: string,
  existingIds: Iterable<string> = [],
): string {
  const existing = new Set(existingIds);
  const slug =
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 44) || "custom-skin";
  let id = `vd-user-${slug}`;
  let suffix = 2;

  while (existing.has(id) || BUILT_IN_SKIN_IDS.has(id)) {
    id = `vd-user-${slug}-${suffix}`;
    suffix += 1;
  }

  return id;
}

export function createEditableSkinFromBase({
  baseSkin,
  name,
  existingIds = [],
}: {
  baseSkin: VDSkinManifestV1;
  name?: string;
  existingIds?: Iterable<string>;
}): VDSkinManifestV1 {
  const skin = deepCloneSkin(baseSkin);
  const nextName = name?.trim() || `${baseSkin.name} Custom`;

  return {
    ...skin,
    id: createUserSkinId(nextName, existingIds),
    name: nextName,
    author: skin.author || "VD skin editor",
    rawCss: [],
  };
}

export function validateSkinEditorDraft(
  draftSkin: unknown,
): VDSkinValidationResult<VDSkinManifestV1> {
  const result = validateSkinManifest(draftSkin);
  if (!result.ok || !result.value) return result;
  if (BUILT_IN_SKIN_IDS.has(result.value.id)) {
    return fail([
      ...result.diagnostics,
      diagnostic(
        "reserved-skin-id",
        `Skin id "${result.value.id}" is reserved for a built-in skin.`,
        "id",
      ),
    ]);
  }

  return result;
}

export function createSkinEditorPreviewState(
  currentState: unknown,
  draftSkin: VDSkinManifestV1,
): VDSkinState {
  const state = migrateSkinState(currentState || createDefaultSkinState());
  const userSkins = [
    ...state.userSkins.filter((skin) => skin.id !== draftSkin.id),
    draftSkin,
  ];

  return {
    version: 1,
    userSkins,
    activeGlobalSkinId: draftSkin.id,
  };
}

export function upsertUserSkinAndSetGlobal({
  state,
  skin,
}: {
  state: unknown;
  skin: unknown;
}): VDSkinValidationResult<VDSkinState> {
  const draft = validateSkinEditorDraft(skin);
  if (!draft.ok || !draft.value) return fail(draft.diagnostics);

  const current = migrateSkinState(state || createDefaultSkinState());
  const nextState: VDSkinState = {
    version: 1,
    userSkins: [
      ...current.userSkins.filter((entry) => entry.id !== draft.value!.id),
      draft.value,
    ],
    activeGlobalSkinId: draft.value.id,
  };

  return ok(nextState, draft.diagnostics);
}

export function buildSingleSkinExportPackage(
  skin: VDSkinManifestV1,
): VDSkinImportExportPackage {
  return {
    packageVersion: 1,
    skins: [skin],
    activeGlobalSkinId: skin.id,
  };
}

export function mergeImportedSkinState(
  currentState: unknown,
  importedState: VDSkinState,
): VDSkinState {
  const current = migrateSkinState(currentState || createDefaultSkinState());
  const importedIds = new Set(importedState.userSkins.map((skin) => skin.id));
  const userSkins = [
    ...current.userSkins.filter((skin) => !importedIds.has(skin.id)),
    ...importedState.userSkins,
  ];
  const validIds = new Set([
    ...BUILT_IN_VD_SKINS.map((skin) => skin.id),
    ...userSkins.map((skin) => skin.id),
  ]);

  return {
    version: 1,
    userSkins,
    activeGlobalSkinId: validIds.has(importedState.activeGlobalSkinId)
      ? importedState.activeGlobalSkinId
      : current.activeGlobalSkinId,
  };
}

export function setActiveGlobalSkinFromEditor({
  state,
  skinId,
}: {
  state: unknown;
  skinId: string;
}): VDSkinValidationResult<VDSkinState> {
  return setGlobalSkin({ state, skinId });
}
