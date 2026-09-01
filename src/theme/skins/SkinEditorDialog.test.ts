// @vitest-environment jsdom
import React from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_VD_SKIN_ID,
  SkinEditorDialog,
  type SkinEditorActions,
  SkinEditorDialogView,
  createDefaultSkinState,
  lightStudioSkin,
  type SkinEditorDialogViewProps,
  type VDSkinImportExportPackage,
  type VDSkinState,
} from "./index";

afterEach(() => {
  cleanup();
});

function renderEditor({
  onSave = vi.fn<SkinEditorActions["saveSkinState"]>(async () => ({ ok: true })),
  skinState = createDefaultSkinState(),
}: {
  onSave?: ReturnType<typeof vi.fn<SkinEditorActions["saveSkinState"]>>;
  skinState?: VDSkinState;
} = {}) {
  render(
    React.createElement(SkinEditorDialog, {
      actions: { saveSkinState: onSave },
      onClose: vi.fn(),
      open: true,
      skinState,
    }),
  );

  return { onSave };
}

describe("SkinEditorDialog controller", () => {
  it("renders the migrated skin editor surface with stable semantic slots", () => {
    renderEditor();

    expect(
      screen
        .getByRole("region", { name: "Skin editor" })
        .getAttribute("data-vd-surface"),
    ).toBe("skin-editor");
    expect(
      document.querySelector('[data-vd-slot="skin-editor-library"]'),
    ).toBeTruthy();
    expect(
      document.querySelector('[data-vd-slot="skin-editor-editor"]'),
    ).toBeTruthy();
    expect(
      document.querySelector('[data-vd-slot="skin-editor-preview"]'),
    ).toBeTruthy();
    expect(
      document.querySelector('[data-vd-slot="skin-editor-import-export"]'),
    ).toBeTruthy();
    expect(
      document.querySelector('[data-vd-slot="skin-editor-diagnostics"]'),
    ).toBeTruthy();
  });

  it("previews, validates, saves, and applies an editable skin copy", async () => {
    const { onSave } = renderEditor();

    fireEvent.click(screen.getByRole("button", { name: "Create editable copy" }));
    fireEvent.change(screen.getByDisplayValue("VD Default Dark Custom"), {
      target: { value: "Neon Flight" },
    });
    fireEvent.change(screen.getByLabelText("Accent color"), {
      target: { value: "#22d3ee" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save and apply" }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const savedState = onSave.mock.calls[0]![0].state as VDSkinState;
    expect(savedState.activeGlobalSkinId).toMatch(/^vd-user-/);
    expect(savedState.userSkins[0]).toMatchObject({
      name: "Neon Flight",
      tokens: {
        colors: expect.objectContaining({
          accent: "#22d3ee",
        }),
      },
    });
  });

  it("shows import diagnostics without saving invalid JSON", () => {
    const { onSave } = renderEditor();

    fireEvent.change(screen.getByLabelText("Skin package JSON"), {
      target: { value: "{not json" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Import package" }));

    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText("Skin package JSON could not be parsed.")).toBeTruthy();
  });

  it("imports a valid global skin package and preserves existing custom skins", async () => {
    const existingSkin = {
      ...lightStudioSkin,
      id: "vd-user-existing",
      name: "Existing Skin",
      rawCss: [],
    };
    const importedSkin = {
      ...lightStudioSkin,
      id: "vd-user-imported",
      name: "Imported Skin",
      rawCss: [],
    };
    const state: VDSkinState = {
      version: 1,
      activeGlobalSkinId: existingSkin.id,
      userSkins: [existingSkin],
    };
    const skinPackage: VDSkinImportExportPackage = {
      packageVersion: 1,
      activeGlobalSkinId: importedSkin.id,
      skins: [importedSkin],
    };
    const { onSave } = renderEditor({ skinState: state });

    fireEvent.change(screen.getByLabelText("Skin package JSON"), {
      target: { value: JSON.stringify(skinPackage) },
    });
    fireEvent.click(screen.getByRole("button", { name: "Import package" }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const savedState = onSave.mock.calls[0]![0].state as VDSkinState;
    expect(savedState.userSkins.map((skin) => skin.id)).toEqual([
      existingSkin.id,
      importedSkin.id,
    ]);
    expect(savedState.activeGlobalSkinId).toBe(importedSkin.id);
  });

  it("reverts to the default global skin while keeping saved custom skins", async () => {
    const existingSkin = {
      ...lightStudioSkin,
      id: "vd-user-existing",
      name: "Existing Skin",
      rawCss: [],
    };
    const { onSave } = renderEditor({
      skinState: {
        version: 1,
        activeGlobalSkinId: existingSkin.id,
        userSkins: [existingSkin],
      },
    });

    fireEvent.click(screen.getByRole("button", { name: "Revert to default" }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const savedState = onSave.mock.calls[0]![0].state as VDSkinState;
    expect(savedState.activeGlobalSkinId).toBe(DEFAULT_VD_SKIN_ID);
    expect(savedState.userSkins.map((skin) => skin.id)).toEqual([existingSkin.id]);
  });
});

describe("SkinEditorDialog view", () => {
  it("uses SkinRoot preview state and skin-aware primitives", () => {
    const props: SkinEditorDialogViewProps = {
      actions: {
        applySelectedSkin: vi.fn(),
        close: vi.fn(),
        exportSelectedSkin: vi.fn(),
        forkSelectedSkin: vi.fn(),
        importPackage: vi.fn(),
        revertToDefaultSkin: vi.fn(),
        saveDraftSkin: vi.fn(),
        selectSkin: vi.fn(),
        updateColorToken: vi.fn(),
        updateDraftAuthor: vi.fn(),
        updateDraftDescription: vi.fn(),
        updateDraftName: vi.fn(),
        updateImportText: vi.fn(),
      },
      model: {
        activeGlobalSkinId: lightStudioSkin.id,
        colorFields: [
          { key: "accent", label: "Accent", value: "#22d3ee" },
        ],
        diagnostics: [],
        draftSkin: null,
        exportText: "",
        importText: "",
        isDirty: false,
        isEditingCustomSkin: false,
        isSaving: false,
        previewState: {
          version: 1,
          activeGlobalSkinId: lightStudioSkin.id,
          userSkins: [],
        },
        rawCssStatus: "deferred",
        selectedSkin: lightStudioSkin,
        selectedSkinIsBuiltIn: true,
        skinOptions: [
          {
            id: lightStudioSkin.id,
            isActive: true,
            isBuiltIn: true,
            isSelected: true,
            name: lightStudioSkin.name,
          },
        ],
        statusMessage: null,
      },
    };

    const html = renderToStaticMarkup(
      React.createElement(SkinEditorDialogView, props),
    );

    expect(html).toContain("data-vd-skin-root=\"true\"");
    expect(html).toContain("data-vd-skin-id=\"vd-light-studio\"");
    expect(html).toContain("data-vd-surface=\"skin-editor\"");
    expect(html).toContain("data-vd-component=\"button\"");
    expect(html).toContain("data-vd-text=\"primary\"");
  });
});
