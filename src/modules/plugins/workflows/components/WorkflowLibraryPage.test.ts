import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { WorkflowLibraryView } from "./WorkflowLibraryPage";

describe("WorkflowLibraryView", () => {
  it("TEST_CASE_70LD_1A renders global workflow library sections without showing create forms by default", () => {
    const html = renderToStaticMarkup(
      React.createElement(WorkflowLibraryView, {
        assets: {
          prompts: [{ kind: "prompt", id: "prompt.review.security", version: 1, name: "Security review", description: "Review behavior", source: "user", preview: "Review auth and data exposure.", bodyMarkdown: "Review auth and data exposure." }],
          skills: [{ kind: "skill", id: "skill.testing.focused", version: 2, name: "Focused testing", description: "Markdown only", source: "user", preview: "Write focused tests.", bodyMarkdown: "Write focused tests." }],
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
    expect(html).toContain("Edit as new version");
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
        initialMode: { kind: "role", source: { id: "role.review.security", version: 1, name: "Security reviewer", description: null, source: "user", promptPreview: "Review for security.", promptMarkdown: "Review for security in depth.", promptRefs: [{ kind: "prompt", id: "prompt.review.security", versionMode: "latest" }], skillRefs: [{ kind: "skill", id: "skill.testing.focused", version: 2, versionMode: "pinned" }], executorPreference: { executorType: "CODEX", model: "gpt-5-codex", mode: "preferred" }, active: true } },
        assets: {
          prompts: [{ kind: "prompt", id: "prompt.review.security", version: 1, name: "Security review", description: "Review behavior", source: "user", preview: "Review auth and data exposure.", bodyMarkdown: "Review auth and data exposure." }],
          skills: [{ kind: "skill", id: "skill.testing.focused", version: 2, name: "Focused testing", description: "Markdown only", source: "user", preview: "Write focused tests.", bodyMarkdown: "Write focused tests." }],
          roleTemplates: [],
        },
      }),
    );

    expect(html).toContain("Edit role template as new version");
    expect(html).toContain("Prompt assets picker");
    expect(html).toContain("Skill snippets picker");
    expect(html).toContain("Selected Prompt assets");
    expect(html).toContain("Selected Skill snippets");
    expect(html).toContain("Use latest version");
    expect(html).toContain("Pinned v2");
    expect(html).toContain("Remove");
    expect(html).toContain("Default executor");
    expect(html).toContain("Default model");
    expect(html).toContain("Review for security in depth.");
  });

});
