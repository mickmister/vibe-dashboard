import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const projectRoot = process.cwd();
const scriptPath = join(projectRoot, "scripts/check-ui-customization-boundaries.mjs");

function writeFixture(root: string, overrides: Record<string, string> = {}) {
  const files: Record<string, string> = {
    "src/components/SpacesOverview.tsx":
      '<SkinRoot className="h-full w-full" state={skinState}>',
    "src/components/spaces-overview/DefaultSpacesOverview.view.tsx": `
      import { VDHeading, VDText } from "../../theme/skins";
      export function DefaultSpacesOverviewLayout() {
        return <div data-vd-surface="spaces-overview" data-vd-view-pack="default">
          <div data-vd-slot="page-header"><VDHeading level={1}>Dashboard</VDHeading></div>
          <div data-vd-slot="workspace-list"><VDText tone="secondary">Workspaces</VDText></div>
        </div>;
      }
    `,
    "src/components/spaces-overview/DenseWorkspaceListSection.view.tsx":
      '<div data-vd-slot="workspace-list"><span data-vd-text="primary">Dense</span></div>',
    "src/components/spaces-overview/RunningDevServersSection.view.tsx":
      '<div data-vd-slot="running-dev-servers"><span data-vd-status="success">Running</span></div>',
    "src/components/spaces-overview/SpacePickerModal.view.tsx":
      '<div data-vd-slot="space-picker-modal"><button data-vd-component="button">Open</button></div>',
    "src/components/spaces-overview/craftSections.view.tsx": `
      <div data-vd-slot="recent-sessions"></div>
      <div data-vd-slot="spaces-list"></div>
    `,
    "src/components/spaces-overview/workspaceList.view.tsx": `
      import { VDAction, VDRow } from "../../theme/skins";
      <VDRow><span data-vd-text="primary">Workspace</span></VDRow>
      <VDAction>Open</VDAction>
    `,
    "src/theme/skins/SkinEditorDialog.view.tsx": `
      import { VDAction, VDCard, VDHeading, VDText } from "./primitives.view";
      export function SkinEditorDialogView() {
        return <section data-vd-surface="skin-editor">
          <VDCard data-vd-slot="skin-editor-library"><VDHeading level={2}>Library</VDHeading></VDCard>
          <VDCard data-vd-slot="skin-editor-editor"><VDText>Editor</VDText></VDCard>
          <VDCard data-vd-slot="skin-editor-preview"><VDText>Preview</VDText></VDCard>
          <VDCard data-vd-slot="skin-editor-import-export"><VDAction>Import</VDAction></VDCard>
          <VDCard data-vd-slot="skin-editor-diagnostics"><VDText status="success">Valid</VDText></VDCard>
        </section>;
      }
    `,
    "src/components/spaces-overview/SpacesOverview.skin.module.css": `
      .surface :global([data-vd-text="primary"]) { color: var(--vd-surface-spaces-overview-foreground); }
      .surface :global([data-vd-text="secondary"]) { color: var(--vd-color-muted); }
      .surface :global([data-vd-muted="true"]) { color: var(--vd-color-muted); }
      .surface :global([data-vd-status="success"]) { color: var(--vd-color-success); }
      .surface :global([data-vd-status="warning"]) { color: var(--vd-color-warning); }
      .surface :global([data-vd-status="danger"]) { color: var(--vd-color-danger); }
      .surface :global([data-vd-status="accent"]) { color: var(--vd-color-accent); }
    `,
    ...overrides,
  };

  for (const [relativePath, source] of Object.entries(files)) {
    const path = join(root, relativePath);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, source);
  }
}

describe("UI customization boundary check", () => {
  it("passes for migrated skinned views that use semantic hooks or shared primitives", () => {
    const root = mkdtempSync(join(tmpdir(), "ui-customization-pass-"));
    writeFixture(root);

    const output = execFileSync(process.execPath, [scriptPath, root], {
      encoding: "utf8",
    });

    expect(output).toContain("UI customization boundary check passed");
  });

  it("fails with actionable output for hardcoded foreground color utilities", () => {
    const root = mkdtempSync(join(tmpdir(), "ui-customization-fail-"));
    writeFixture(root, {
      "src/components/spaces-overview/workspaceList.view.tsx":
        '<div className="text-zinc-100"><span>Workspace</span></div>',
    });

    const result = spawnSync(process.execPath, [scriptPath, root], {
      encoding: "utf8",
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain(
      "Hardcoded foreground utility \"text-zinc-100\"",
    );
    expect(result.stdout).toContain(
      "Use skin primitives, semantic data-vd-* hooks, or inherited surface color",
    );
  });

  it("fails when major SpacesOverview skin hooks are missing", () => {
    const root = mkdtempSync(join(tmpdir(), "ui-customization-hooks-"));
    writeFixture(root, {
      "src/components/spaces-overview/DefaultSpacesOverview.view.tsx":
        "<div>No stable SpacesOverview surface hook</div>",
    });

    const result = spawnSync(process.execPath, [scriptPath, root], {
      encoding: "utf8",
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain('Missing semantic hook "data-vd-surface="');
    expect(result.stdout).toContain('Missing semantic hook "data-vd-slot="');
  });
});

describe("CI UI customization wiring", () => {
  it("commits the OpenLint policy used by UI customization checks", () => {
    const policy = readFileSync(".github/openlint/openlint.yaml", "utf8");

    expect(policy).toContain("tsx-view-boundary:");
    expect(policy).toContain("ui-customization-fences:");
    expect(policy).toContain("openlint/no-intrinsic-jsx-outside-view");
    expect(policy).toContain("openlint/no-hooks-in-view");
    expect(policy).toContain("jsx/attribute-ban(attribute=style)");
  });

  it("exposes one local npm command for OpenLint fences and skinability checks", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
      scripts: Record<string, string>;
    };

    expect(packageJson.scripts["lint:tsx-view-boundary:migrated"]).toContain(
      "OPENLINT_POLICY_DIR=.github/openlint",
    );
    expect(packageJson.scripts["lint:tsx-view-boundary:migrated"]).toContain(
      "src/theme/skins/SkinEditorDialog.view.tsx",
    );
    expect(packageJson.scripts["lint:ui-fences:migrated"]).toContain(
      "OPENLINT_POLICY_DIR=.github/openlint",
    );
    expect(packageJson.scripts["lint:ui-fences:migrated"]).toContain(
      "src/theme/skins/SkinEditorDialog.view.tsx",
    );
    expect(packageJson.scripts["lint:ui-customization"]).toContain(
      "lint:tsx-view-boundary:migrated",
    );
    expect(packageJson.scripts["lint:ui-customization"]).toContain(
      "lint:ui-fences:migrated",
    );
    expect(packageJson.scripts["lint:ui-customization"]).toContain(
      "lint:skinability",
    );
  });

  it("runs the UI customization boundary command in CI on pushes and pull requests", () => {
    const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
    const uiJobStart = workflow.indexOf("  ui-customization-boundaries:");
    const nextJobStart = workflow.indexOf("\n  test-workflow-core:", uiJobStart);
    const uiJob = workflow.slice(uiJobStart, nextJobStart);

    expect(workflow).toContain("pull_request:");
    expect(workflow).toMatch(/push:\s*\n\s*branches:\s*\n\s*-\s+main/);
    expect(uiJob).toContain("ui-customization-boundaries:");
    expect(uiJob).not.toContain("repository: vibe-dashboard/open-lint");
    expect(uiJob).not.toContain("dtolnay/rust-toolchain@stable");
    expect(uiJob).toContain(
      "npm install --global @mickmister/openlint@0.1.0",
    );
    expect(uiJob).toContain("OPENLINT_POLICY_DIR: .github/openlint");
    expect(uiJob).toContain("npm run lint:ui-customization");
    expect(workflow).toContain("- ui-customization-boundaries");
  });
});
