import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { WorkflowLibraryView } from "./WorkflowLibraryPage";

describe("WorkflowLibraryView", () => {
  it("TEST_CASE_70LD_1A renders global workflow library sections without showing create forms by default", () => {
    const html = renderToStaticMarkup(
      React.createElement(WorkflowLibraryView, {
        assets: {
          prompts: [
            { kind: "prompt", id: "prompt.review.security", version: 2, name: "Security review v2", description: "Review behavior", source: "user", preview: "Review auth and data exposure v2.", bodyMarkdown: "Review auth and data exposure v2." },
            { kind: "prompt", id: "prompt.review.security", version: 1, name: "Security review", description: "Review behavior", source: "user", preview: "Review auth and data exposure.", bodyMarkdown: "Review auth and data exposure." },
          ],
          skills: [
            { kind: "skill", id: "skill.testing.focused", version: 2, name: "Focused testing", description: "Markdown only", source: "user", preview: "Write focused tests.", bodyMarkdown: "Write focused tests." },
            { kind: "skill", id: "skill.testing.focused", version: 1, name: "Focused testing v1", description: "Markdown only", source: "user", preview: "Write focused tests v1.", bodyMarkdown: "Write focused tests v1." },
          ],
          roleTemplates: [{ id: "role.review.security", version: 3, name: "Security reviewer", description: "Second review agent type", source: "user", promptPreview: "Review for security risk.", promptRefs: [{ kind: "prompt", id: "prompt.review.security", versionMode: "latest" }], skillRefs: [{ kind: "skill", id: "skill.testing.focused", version: 2, versionMode: "pinned" }], executorPreference: { executorType: "CODEX", model: "gpt-5-codex", mode: "preferred" }, active: true }],
        },
      }),
    );

    expect(html).toContain("Workflow library");
    expect(html).toContain("Role templates");
    expect(html).toContain("Prompt assets");
    expect(html).toContain("Skill snippets");
    expect(html).toContain("Published versions are immutable");
    expect(html).toContain("New Role Template");
    expect(html).toContain("New Prompt");
    expect(html).toContain("New Skill");
    expect(html).toContain("Edit latest as new version");
    expect(html).toContain("Version history");
    expect(html).toContain("Use latest follows the newest published version when a new run snapshot is created. Pinned references keep the selected version.");
    expect(html).toContain("Role template links can use latest for future runs or pin an exact version for deterministic published workflows.");
    expect(html).toContain("Copy from v1");
    expect(html).toContain("Copy from v2");
    expect(html).toContain("Security reviewer");
    expect(html).toContain("Prompts: prompt.review.security (latest)");
    expect(html).toContain("Skills: skill.testing.focused (v2)");
    expect(html).toContain("Default executor: CODEX · gpt-5-codex");
    expect(html).not.toContain("Publish prompt asset");
    expect(html).not.toContain("Publish skill snippet");
    expect(html).not.toContain("Publish role template");
    expect(html).not.toContain("git-backed");
    expect(html).not.toContain("/Users/");
    expect(html).not.toContain("webhook");
    expect(html).not.toContain("queue item");
  });

  it("TEST_CASE_9TU7_1B renders empty and error states without implying git-backed sync", () => {
    const html = renderToStaticMarkup(
      React.createElement(WorkflowLibraryView, {
        assets: { prompts: [], skills: [], roleTemplates: [] },
        error: "Provider unavailable at /Users/person/project with webhook queue item details",
      }),
    );

    expect(html).toContain("No reusable role templates yet.");
    expect(html).toContain("No prompt assets yet.");
    expect(html).toContain("No markdown skill snippets yet.");
    expect(html).not.toContain("git-backed");
    expect(html).not.toContain("/Users/");
    expect(html).not.toContain("webhook");
    expect(html).not.toContain("queue item");
  });
  it("TEST_CASE_9TU7_1C renders role-template asset pickers, selected lists, latest/pinned modes, and executor defaults", () => {
    const html = renderToStaticMarkup(
      React.createElement(WorkflowLibraryView, {
        initialMode: { kind: "role", source: { id: "role.review.security", version: 1, name: "Security reviewer", description: null, source: "user", promptPreview: "Review for security.", promptMarkdown: "Review for security in depth.", promptRefs: [{ kind: "prompt", id: "prompt.review.security", version: 1, versionMode: "pinned" }], skillRefs: [{ kind: "skill", id: "skill.testing.focused", version: 2, versionMode: "pinned" }], executorPreference: { executorType: "CODEX", model: "gpt-5-codex", mode: "preferred" }, active: true } },
        assets: {
          prompts: [
            { kind: "prompt", id: "prompt.review.security", version: 2, name: "Security review v2", description: "Review behavior", source: "user", preview: "Review auth and data exposure v2.", bodyMarkdown: "Review auth and data exposure v2." },
            { kind: "prompt", id: "prompt.review.security", version: 1, name: "Security review", description: "Review behavior", source: "user", preview: "Review auth and data exposure.", bodyMarkdown: "Review auth and data exposure." },
          ],
          skills: [
            { kind: "skill", id: "skill.testing.focused", version: 2, name: "Focused testing", description: "Markdown only", source: "user", preview: "Write focused tests.", bodyMarkdown: "Write focused tests." },
            { kind: "skill", id: "skill.testing.focused", version: 1, name: "Focused testing v1", description: "Markdown only", source: "user", preview: "Write focused tests v1.", bodyMarkdown: "Write focused tests v1." },
          ],
          roleTemplates: [],
        },
      }),
    );

    expect(html).toContain("Edit role template as new version");
    expect(html).toContain("Prompt assets picker");
    expect(html).toContain("Skill snippets picker");
    expect(html).toContain("Selected Prompt assets");
    expect(html).toContain("Selected Skill snippets");
    expect(html).toContain("Use latest");
    expect(html).toContain("Pinned v2");
    expect(html).toContain('aria-label="prompt.review.security pinned version"');
    expect(html).toContain('value="1"');
    expect(html).toContain('value="2"');
    expect(html).toContain("Remove");
    expect(html).toContain("Default executor");
    expect(html).toContain("Default model");
    expect(html).toContain("Review for security in depth.");
  });


  it("TEST_CASE_OXU5_1A groups version history and exposes copy-from-version affordances", () => {
    const html = renderToStaticMarkup(
      React.createElement(WorkflowLibraryView, {
        assets: {
          prompts: [
            { kind: "prompt", id: "prompt.review.product", version: 2, name: "Product review", description: "Newer", source: "user", preview: "Review product clarity v2.", bodyMarkdown: "Review product clarity v2." },
            { kind: "prompt", id: "prompt.review.product", version: 1, name: "Product review", description: "Older", source: "user", preview: "Review product clarity v1.", bodyMarkdown: "Review product clarity v1." },
          ],
          skills: [
            { kind: "skill", id: "skill.forms", version: 2, name: "Forms", description: null, source: "user", preview: "Use form conventions v2.", bodyMarkdown: "Use form conventions v2." },
            { kind: "skill", id: "skill.forms", version: 1, name: "Forms", description: null, source: "user", preview: "Use form conventions v1.", bodyMarkdown: "Use form conventions v1." },
          ],
          roleTemplates: [
            { id: "role.review.product", version: 2, name: "Product reviewer", description: null, source: "user", promptPreview: "Review UX v2.", promptMarkdown: "Review UX v2.", promptRefs: [{ kind: "prompt", id: "prompt.review.product", versionMode: "latest" }], skillRefs: [], executorPreference: null, active: true },
            { id: "role.review.product", version: 1, name: "Product reviewer", description: null, source: "user", promptPreview: "Review UX v1.", promptMarkdown: "Review UX v1.", promptRefs: [{ kind: "prompt", id: "prompt.review.product", version: 1, versionMode: "pinned" }], skillRefs: [], executorPreference: null, active: true },
          ],
        },
      }),
    );

    expect(html).toContain("Latest v2");
    expect(html).toContain("Version history (2)");
    expect(html).toContain("Copy from v1");
    expect(html).toContain("Copy from v2");
    expect(html).toContain("Use latest follows the newest published version when a new run snapshot is created. Pinned references keep the selected version.");
    expect(html).toContain("Role template links can use latest for future runs or pin an exact version for deterministic published workflows.");
    expect(html).not.toContain("/Users/");
    expect(html).not.toContain("/tmp/");
    expect(html).not.toContain("queue item");
  });

});
