import { describe, expect, it } from "vitest";
import {
  composeWorkflowAgentPrompt,
  extractWorkflowBeadIds,
  resolveWorkflowBeadPromptContext,
  withWorkflowBeadContextInput,
} from "./workflowPromptContext";

describe("workflowPromptContext", () => {
  it("TEST_CASE_2YLE_1A extracts direct launch bead context and preserves existing workflow context", () => {
    expect(extractWorkflowBeadIds({ beadIds: ["bead-a", "bead-b", "bead-a"], workflowContext: { beadId: "bead-c" } })).toEqual([
      "bead-a",
      "bead-b",
      "bead-c",
    ]);

    expect(withWorkflowBeadContextInput({ featureRequest: "Build it", workflowContext: { source: "launch" } }, ["bead-a", "bead-b"])).toEqual({
      featureRequest: "Build it",
      workflowContext: { source: "launch", beadIds: ["bead-a", "bead-b"] },
    });
  });

  it("TEST_CASE_2YLE_1A resolves latest product-safe bead summaries for each prompt composition", async () => {
    let readCount = 0;
    const provider = {
      async readBeads(beadIds: string[]) {
        readCount += 1;
        return beadIds.map((beadId) => ({
          beadId,
          title: readCount === 1 ? "Initial title /Users/mick/secret" : "Updated title bd show hidden",
          status: "open",
          accessible: true,
          labels: ["workflow", "queue item 123"],
        }));
      },
    };

    const first = await resolveWorkflowBeadPromptContext({ inputs: { workflowContext: { beadIds: ["vibe-kanban-vscode-web-2yle"] } }, provider });
    const second = await resolveWorkflowBeadPromptContext({ inputs: { workflowContext: { beadIds: ["vibe-kanban-vscode-web-2yle"] } }, provider });

    expect(first?.beads[0]?.title).toContain("Initial title");
    expect(first?.beads[0]?.title).not.toContain("/Users/");
    expect(second?.beads[0]?.title).toContain("Updated title bead detail command");
    expect(second?.beads[0]?.labels).toContain("workflow item 123");
    expect(readCount).toBe(2);
  });

  it("TEST_CASE_2YLE_1A inserts task context before generated XSD without changing deterministic prompt markers", () => {
    const prompt = composeWorkflowAgentPrompt({
      basePrompt: "LV2K_STEP:implement\n\nDo work.\n\nExpected XML Schema (XSD):\n<xs:schema/>",
      beadContext: { beadIds: ["bead-a"], beads: [{ beadId: "bead-a", title: "Always include the title", status: "open" }] },
    });

    expect(prompt).toContain("LV2K_STEP:implement");
    expect(prompt).toContain("## Task context");
    expect(prompt).toContain("bead-a: Always include the title (open)");
    expect(prompt).toContain("Use the task context above and any explicitly available typed bead tools");
    expect(prompt).not.toContain("beads CLI");
    expect(prompt.indexOf("## Task context")).toBeLessThan(prompt.indexOf("Expected XML Schema (XSD):"));
  });
});
