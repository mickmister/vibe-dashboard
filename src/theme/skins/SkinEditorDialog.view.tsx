import { SkinRoot } from "./SkinRoot";
import {
  VDAction,
  VDBadge,
  VDCard,
  VDHeading,
  VDRow,
  VDText,
} from "./primitives.view";
import type { SkinEditorDialogViewProps } from "./SkinEditorDialog.contracts";
import styles from "./SkinEditorDialog.module.css";

export function SkinEditorDialogView({
  actions,
  model,
}: SkinEditorDialogViewProps) {
  return (
    <SkinRoot className={styles.root} state={model.previewState}>
      <section
        aria-label="Skin editor"
        className={`${styles.surface} flex h-full min-h-[42rem] flex-col gap-4 p-6`}
        data-vd-surface="skin-editor"
      >
        <header
          className="flex items-start justify-between gap-4"
          data-vd-slot="skin-editor-header"
        >
          <div>
            <VDHeading className="text-2xl font-bold" level={1}>
              Skin Editor
            </VDHeading>
            <VDText as="p" className="mt-1 max-w-3xl text-sm" tone="muted">
              Customize the global app skin with safe tokens, preview changes,
              and import/export skin packages without raw CSS injection.
            </VDText>
          </div>
          <VDAction
            aria-label="Close skin editor"
            className="border px-3 py-1 text-sm"
            onClick={actions.close}
            tone="quiet"
          >
            Close
          </VDAction>
        </header>

        <div className="grid flex-1 grid-cols-[minmax(12rem,18rem)_minmax(0,1fr)_minmax(16rem,24rem)] gap-4">
          <VDCard
            className="flex min-h-0 flex-col border p-4"
            data-vd-slot="skin-editor-library"
          >
            <div className="mb-3 flex items-center justify-between gap-2">
              <VDHeading className="text-base font-semibold" level={2}>
                Library
              </VDHeading>
              <VDBadge className="border px-2 py-0.5 text-xs" status="accent">
                Global
              </VDBadge>
            </div>
            <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto">
              {model.skinOptions.map((skin) => (
                <VDRow
                  as="button"
                  aria-pressed={skin.isSelected}
                  className="rounded-lg border px-3 py-2 text-left"
                  key={skin.id}
                  onClick={() => actions.selectSkin(skin.id)}
                >
                  <span className="flex items-center justify-between gap-2">
                    <VDText className="font-medium">{skin.name}</VDText>
                    {skin.isActive && (
                      <VDBadge className="border px-2 py-0.5 text-xs" status="success">
                        Active
                      </VDBadge>
                    )}
                  </span>
                  <VDText as="span" className="mt-1 block text-xs" tone="muted">
                    {skin.isBuiltIn ? "Built-in" : "Custom"}
                  </VDText>
                </VDRow>
              ))}
            </div>
            <div className="mt-4 flex flex-col gap-2">
              <VDAction
                className="border px-3 py-2 text-sm"
                onClick={actions.forkSelectedSkin}
                tone="accent"
              >
                {model.selectedSkinIsBuiltIn
                  ? "Create editable copy"
                  : "Edit custom skin"}
              </VDAction>
              <VDAction
                className="border px-3 py-2 text-sm"
                disabled={model.isSaving || model.isDirty}
                onClick={actions.applySelectedSkin}
              >
                Apply selected
              </VDAction>
              <VDAction
                className="border px-3 py-2 text-sm"
                disabled={model.isSaving}
                onClick={actions.revertToDefaultSkin}
                tone="quiet"
              >
                Revert to default
              </VDAction>
            </div>
          </VDCard>

          <VDCard
            className="flex min-h-0 flex-col border p-4"
            data-vd-slot="skin-editor-editor"
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <VDHeading className="text-base font-semibold" level={2}>
                  Token editor
                </VDHeading>
                <VDText as="p" className="mt-1 text-xs" tone="muted">
                  {model.isEditingCustomSkin
                    ? "Editing a custom skin draft."
                    : "Create an editable copy before changing built-in skins."}
                </VDText>
              </div>
              {model.isDirty && (
                <VDBadge className="border px-2 py-0.5 text-xs" status="warning">
                  Unsaved
                </VDBadge>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1">
                <VDText className="text-xs font-medium" tone="secondary">
                  Name
                </VDText>
                <input
                  className={`${styles.field} px-3 py-2 text-sm`}
                  disabled={!model.draftSkin}
                  onChange={(event) => actions.updateDraftName(event.target.value)}
                  value={model.draftSkin?.name ?? model.selectedSkin.name}
                />
              </label>
              <label className="flex flex-col gap-1">
                <VDText className="text-xs font-medium" tone="secondary">
                  Author
                </VDText>
                <input
                  className={`${styles.field} px-3 py-2 text-sm`}
                  disabled={!model.draftSkin}
                  onChange={(event) => actions.updateDraftAuthor(event.target.value)}
                  value={model.draftSkin?.author ?? model.selectedSkin.author ?? ""}
                />
              </label>
            </div>

            <label className="mt-3 flex flex-col gap-1">
              <VDText className="text-xs font-medium" tone="secondary">
                Description
              </VDText>
              <textarea
                className={`${styles.field} min-h-20 px-3 py-2 text-sm`}
                disabled={!model.draftSkin}
                onChange={(event) =>
                  actions.updateDraftDescription(event.target.value)
                }
                value={
                  model.draftSkin?.description ??
                  model.selectedSkin.description ??
                  ""
                }
              />
            </label>

            <div className="mt-4 grid grid-cols-2 gap-3">
              {model.colorFields.map((field) => (
                <label className="flex flex-col gap-1" key={field.key}>
                  <VDText className="text-xs font-medium" tone="secondary">
                    {field.label}
                  </VDText>
                  <span className="flex gap-2">
                    <input
                      aria-label={`${field.label} swatch`}
                      className={`${styles.swatch} h-10 w-10 shrink-0 rounded-lg border`}
                      disabled={!model.draftSkin}
                      onChange={(event) =>
                        actions.updateColorToken(field.key, event.target.value)
                      }
                      type="color"
                      value={field.swatchValue}
                    />
                    <input
                      aria-label={`${field.label} color`}
                      className={`${styles.field} min-w-0 flex-1 px-3 py-2 font-mono text-sm`}
                      disabled={!model.draftSkin}
                      onChange={(event) =>
                        actions.updateColorToken(field.key, event.target.value)
                      }
                      value={field.value}
                    />
                  </span>
                </label>
              ))}
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <VDAction
                className="border px-4 py-2 text-sm font-medium"
                disabled={!model.draftSkin || model.isSaving}
                onClick={actions.saveDraftSkin}
                tone="accent"
              >
                Save and apply
              </VDAction>
              <VDAction
                className="border px-4 py-2 text-sm"
                onClick={actions.exportSelectedSkin}
              >
                Export selected
              </VDAction>
            </div>
          </VDCard>

          <div className="flex min-h-0 flex-col gap-4">
            <VDCard
              className="border p-4"
              data-vd-slot="skin-editor-preview"
            >
              <VDHeading className="text-base font-semibold" level={2}>
                Preview
              </VDHeading>
              <div className="mt-3 rounded-xl border p-4" data-vd-component="card">
                <VDText as="p" className="text-sm font-medium">
                  {model.draftSkin?.name ?? model.selectedSkin.name}
                </VDText>
                <VDText as="p" className="mt-1 text-xs" tone="muted">
                  Active preview uses the same global SkinRoot runtime as the
                  migrated SpacesOverview surface.
                </VDText>
                <div className="mt-3 flex gap-2">
                  <VDBadge className="border px-2 py-0.5 text-xs" status="success">
                    Success
                  </VDBadge>
                  <VDBadge className="border px-2 py-0.5 text-xs" status="warning">
                    Warning
                  </VDBadge>
                  <VDBadge className="border px-2 py-0.5 text-xs" status="danger">
                    Danger
                  </VDBadge>
                </div>
              </div>
            </VDCard>

            <VDCard
              className="flex min-h-0 flex-1 flex-col border p-4"
              data-vd-slot="skin-editor-import-export"
            >
              <VDHeading className="text-base font-semibold" level={2}>
                Import / export
              </VDHeading>
              <textarea
                aria-label="Skin package JSON"
                className={`${styles.field} mt-3 min-h-32 flex-1 px-3 py-2 font-mono text-xs`}
                onChange={(event) => actions.updateImportText(event.target.value)}
                placeholder="Paste a skin package JSON object"
                value={model.importText || model.exportText}
              />
              <div className="mt-3 flex gap-2">
                <VDAction
                  className="border px-3 py-2 text-sm"
                  disabled={model.isSaving}
                  onClick={actions.importPackage}
                  tone="accent"
                >
                  Import package
                </VDAction>
              </div>
            </VDCard>

            <VDCard
              className="border p-4"
              data-vd-slot="skin-editor-diagnostics"
            >
              <div className="flex items-center justify-between gap-2">
                <VDHeading className="text-base font-semibold" level={2}>
                  Diagnostics
                </VDHeading>
                <VDBadge
                  className="border px-2 py-0.5 text-xs"
                  status={model.diagnostics.length ? "danger" : "success"}
                >
                  {model.diagnostics.length ? "Needs attention" : "Valid"}
                </VDBadge>
              </div>
              <VDText as="p" className="mt-2 text-xs" tone="muted">
                Raw CSS is {model.rawCssStatus}; skins currently save safe token
                and recipe data only.
              </VDText>
              {model.statusMessage && (
                <VDText as="p" className="mt-2 text-xs" status="accent">
                  {model.statusMessage}
                </VDText>
              )}
              {model.diagnostics.length > 0 && (
                <ul className="mt-3 space-y-2">
                  {model.diagnostics.map((diagnostic, index) => (
                    <li key={`${diagnostic.code}-${index}`}>
                      <VDText as="span" className="text-xs" status="danger">
                        {diagnostic.path ? `${diagnostic.path}: ` : ""}
                        {diagnostic.message}
                      </VDText>
                    </li>
                  ))}
                </ul>
              )}
            </VDCard>
          </div>
        </div>
      </section>
    </SkinRoot>
  );
}
