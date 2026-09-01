#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const projectRoot = resolve(process.argv[2] ?? process.cwd());

const skinnedViewFiles = [
  "src/components/spaces-overview/DefaultSpacesOverview.view.tsx",
  "src/components/spaces-overview/DenseWorkspaceListSection.view.tsx",
  "src/components/spaces-overview/RunningDevServersSection.view.tsx",
  "src/components/spaces-overview/SpacePickerModal.view.tsx",
  "src/components/spaces-overview/craftSections.view.tsx",
  "src/components/spaces-overview/workspaceList.view.tsx",
  "src/theme/skins/SkinEditorDialog.view.tsx",
];

const hardcodedTextColorUtility =
  /\b(?:hover:|group-hover:|disabled:hover:)?text-(?:white|black|zinc|slate|gray|neutral|stone|red|green|amber|yellow|blue|cyan|indigo|violet|purple|pink|primary)-[^\s"`']+/g;

const requiredHooks = [
  {
    filePath: "src/components/spaces-overview/DefaultSpacesOverview.view.tsx",
    hook: 'data-vd-surface=',
    rationale: "SpacesOverview needs a stable surface hook for global skin targeting.",
  },
  {
    filePath: "src/components/spaces-overview/DefaultSpacesOverview.view.tsx",
    hook: 'data-vd-view-pack=',
    rationale: "View-pack variants need a stable identifier for proofs and targeted styling.",
  },
  {
    filePath: "src/components/spaces-overview/DefaultSpacesOverview.view.tsx",
    hook: 'data-vd-slot="page-header"',
    rationale: "The page header is part of the stable SpacesOverview skin contract.",
  },
  {
    filePath: "src/components/spaces-overview/DefaultSpacesOverview.view.tsx",
    hook: 'data-vd-slot="workspace-list"',
    rationale: "The workspace list is part of the stable SpacesOverview skin contract.",
  },
  {
    filePath: "src/components/spaces-overview/craftSections.view.tsx",
    hook: 'data-vd-slot="recent-sessions"',
    rationale: "Recent sessions are part of the stable SpacesOverview skin contract.",
  },
  {
    filePath: "src/components/spaces-overview/craftSections.view.tsx",
    hook: 'data-vd-slot="spaces-list"',
    rationale: "Spaces list is part of the stable SpacesOverview skin contract.",
  },
  {
    filePath: "src/theme/skins/SkinEditorDialog.view.tsx",
    hook: 'data-vd-surface="skin-editor"',
    rationale: "Skin Editor needs a stable surface hook for global skin targeting.",
  },
  {
    filePath: "src/theme/skins/SkinEditorDialog.view.tsx",
    hook: 'data-vd-slot="skin-editor-library"',
    rationale: "Skin Editor library is part of the stable Skin Editor skin contract.",
  },
  {
    filePath: "src/theme/skins/SkinEditorDialog.view.tsx",
    hook: 'data-vd-slot="skin-editor-editor"',
    rationale: "Skin Editor token editor is part of the stable Skin Editor skin contract.",
  },
  {
    filePath: "src/theme/skins/SkinEditorDialog.view.tsx",
    hook: 'data-vd-slot="skin-editor-preview"',
    rationale: "Skin Editor preview is part of the stable Skin Editor skin contract.",
  },
  {
    filePath: "src/theme/skins/SkinEditorDialog.view.tsx",
    hook: 'data-vd-slot="skin-editor-import-export"',
    rationale: "Skin Editor import/export is part of the stable Skin Editor skin contract.",
  },
  {
    filePath: "src/theme/skins/SkinEditorDialog.view.tsx",
    hook: 'data-vd-slot="skin-editor-diagnostics"',
    rationale: "Skin Editor diagnostics are part of the stable Skin Editor skin contract.",
  },
];

const requiredSkinSelectors = [
  {
    filePath: "src/components/spaces-overview/SpacesOverview.skin.module.css",
    hook: '[data-vd-text="primary"]',
    rationale: "Primary text must resolve through skin-controlled foreground tokens.",
  },
  {
    filePath: "src/components/spaces-overview/SpacesOverview.skin.module.css",
    hook: '[data-vd-text="secondary"]',
    rationale: "Secondary text must resolve through skin-controlled foreground tokens.",
  },
  {
    filePath: "src/components/spaces-overview/SpacesOverview.skin.module.css",
    hook: '[data-vd-muted',
    rationale: "Muted text must resolve through skin-controlled foreground tokens.",
  },
  {
    filePath: "src/components/spaces-overview/SpacesOverview.skin.module.css",
    hook: '[data-vd-status="success"]',
    rationale: "Status foreground colors must remain skin-controlled.",
  },
  {
    filePath: "src/components/spaces-overview/SpacesOverview.skin.module.css",
    hook: '[data-vd-status="warning"]',
    rationale: "Status foreground colors must remain skin-controlled.",
  },
  {
    filePath: "src/components/spaces-overview/SpacesOverview.skin.module.css",
    hook: '[data-vd-status="danger"]',
    rationale: "Status foreground colors must remain skin-controlled.",
  },
  {
    filePath: "src/components/spaces-overview/SpacesOverview.skin.module.css",
    hook: '[data-vd-status="accent"]',
    rationale: "Accent foreground colors must remain skin-controlled.",
  },
];

const representativePrimitiveFiles = [
  "src/components/spaces-overview/DefaultSpacesOverview.view.tsx",
  "src/components/spaces-overview/workspaceList.view.tsx",
  "src/theme/skins/SkinEditorDialog.view.tsx",
];

const findings = [];

for (const filePath of skinnedViewFiles) {
  const source = readProjectFile(filePath);
  if (source === null) continue;

  for (const match of source.matchAll(hardcodedTextColorUtility)) {
    findings.push({
      filePath,
      message: `Hardcoded foreground utility "${match[0]}" found in a migrated skinned view.`,
      guidance:
        "Use skin primitives, semantic data-vd-* hooks, or inherited surface color instead of hardcoded foreground color classes.",
    });
  }
}

for (const requirement of [...requiredHooks, ...requiredSkinSelectors]) {
  const source = readProjectFile(requirement.filePath);
  if (source === null) continue;

  if (!source.includes(requirement.hook)) {
    findings.push({
      filePath: requirement.filePath,
      message: `Missing semantic hook "${requirement.hook}".`,
      guidance: requirement.rationale,
    });
  }
}

for (const filePath of representativePrimitiveFiles) {
  const source = readProjectFile(filePath);
  if (source === null) continue;

  if (!/from\s+["'](?:\.\.\/\.\.\/theme\/skins|\.\/primitives\.view)["']/.test(source)) {
    findings.push({
      filePath,
      message: "Missing shared skin primitive import.",
      guidance:
        "Use framework-first skin-aware primitives where they fit; do not rely only on manual data-vd attribute sprinkling.",
    });
  }
}

const skinRootSource = readProjectFile("src/components/SpacesOverview.tsx");
if (skinRootSource !== null && !/<SkinRoot[^>]*className="h-full w-full"/.test(skinRootSource)) {
  findings.push({
    filePath: "src/components/SpacesOverview.tsx",
    message: "SpacesOverview SkinRoot must preserve the full-height/full-width wrapper.",
    guidance:
      'Keep className="h-full w-full" at the SpacesOverview SkinRoot usage unless layout ownership changes intentionally.',
  });
}

if (findings.length > 0) {
  console.log("UI customization boundary check failed:");
  for (const finding of findings) {
    console.log(`- ${finding.filePath}: ${finding.message}`);
    console.log(`  ${finding.guidance}`);
  }
  process.exit(1);
}

console.log("UI customization boundary check passed.");

function readProjectFile(filePath) {
  const absolutePath = resolve(projectRoot, filePath);
  if (!existsSync(absolutePath)) {
    findings.push({
      filePath,
      message: "Expected migrated UI customization target is missing.",
      guidance:
        "Update scripts/check-ui-customization-boundaries.mjs when migrated skin targets are intentionally renamed or moved.",
    });
    return null;
  }

  return readFileSync(absolutePath, "utf8");
}
