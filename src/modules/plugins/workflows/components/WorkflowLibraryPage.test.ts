import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { WorkflowLibraryView } from "./WorkflowLibraryPage";

describe("WorkflowLibraryView", () => {
  it("TEST_CASE_70LD_1A renders global workflow library sections and immutable version guidance", () => {
    const html = renderToStaticMarkup(
      React.createElement(WorkflowLibraryView, {
        assets: {
          prompts: [{ kind: "prompt", id: "prompt.review.security", version: 1, name: "Security review", description: "Review behavior", source: "user", preview: "Review auth and data exposure.", bodyMarkdown: "Review auth and data exposure." }],
          skills: [{ kind: "skill", id: "skill.testing.focused", version: 2, name: "Focused testing", description: "Markdown only", source: "user", preview: "Write focused tests.", bodyMarkdown: "Write focused tests." }],
          roleTemplates: [{ id: "role.review.security", version: 3, name: "Security reviewer", description: "Second review agent type", source: "user", promptPreview: "Review for security risk.", skillRefs: [{ kind: "skill", id: "skill.testing.focused", version: 2 }], executorPreference: { executorType: "CODEX", model: "gpt-5-codex", mode: "preferred" }, active: true }],
        },
      }),
    );

    expect(html).toContain("Workflow library");
    expect(html).toContain("Role templates");
    expect(html).toContain("Prompt assets");
    expect(html).toContain("Skill snippets");
    expect(html).toContain("Published versions are immutable");
    expect(html).toContain("Security reviewer");
    expect(html).toContain("Second review agent type");
    expect(html).toContain("Skill snippet · User");
    expect(html).toContain("Publish prompt asset");
    expect(html).toContain("Publish skill snippet");
    expect(html).toContain("Publish role template");
    expect(html).toContain("Skill refs");
    expect(html).not.toContain("/Users/");
    expect(html).not.toContain("webhook");
    expect(html).not.toContain("queue item");
  });

  it("TEST_CASE_70LD_1B renders empty and error states without implying git-backed sync", () => {
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
});
