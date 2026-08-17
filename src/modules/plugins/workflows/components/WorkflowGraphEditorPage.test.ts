import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  layoutWorkflowGraph,
  toFlowEdges,
  toFlowNodes,
  WorkflowOutlineNavigator,
} from "./WorkflowGraphEditorPage";
import type {
  WorkflowGraphEdgeModel,
  WorkflowGraphNodeModel,
} from "./graph/workflowGraphModel";

describe("WorkflowGraphEditorPage graph appearance", () => {
  it("uses dark-mode state node styles and distinguishes initial and terminal states", () => {
    const nodes = toFlowNodes([
      node({ id: "dev", label: "Dev", initial: true }),
      node({ id: "done", label: "Done", terminal: true }),
    ]);

    expect(nodes[0]).toMatchObject({
      id: "dev",
      className: expect.stringContaining("workflow-state-node"),
      style: expect.objectContaining({
        background: "#0f172a",
        color: "#e2e8f0",
        border: expect.stringContaining("#2563eb"),
      }),
    });
    expect(String(nodes[0]?.className)).toContain("workflow-initial-node");
    expect(nodes[1]).toMatchObject({
      id: "done",
      className: expect.stringContaining("workflow-terminal-node"),
      style: expect.objectContaining({
        background: "#052e2b",
        color: "#d1fae5",
        border: expect.stringContaining("#10b981"),
      }),
    });
  });

  it("uses readable dark edge labels and a distinct loop treatment", () => {
    const edges = toFlowEdges([
      edge({
        id: "dev:ready",
        source: "dev",
        target: "review",
        actionId: "ready",
        label: "Ready",
      }),
      edge({
        id: "dev:continue",
        source: "dev",
        target: "dev",
        actionId: "continue",
        label: "Keep working",
      }),
    ]);

    expect(edges[0]).toMatchObject({
      className: "workflow-graph-edge",
      type: "workflowAction",
      interactionWidth: 28,
      zIndex: 15,
      style: { stroke: "#38bdf8", strokeWidth: 2.25 },
      data: expect.objectContaining({
        label: "Ready",
        actionId: "ready",
        labelOffset: 0,
      }),
    });
    expect(edges[1]).toMatchObject({
      animated: true,
      className: "workflow-graph-edge workflow-loop-edge",
      style: { stroke: "#f59e0b", strokeWidth: 2.5 },
    });
  });

  it("does not render the workflow graph minimap preview", () => {
    const source = readFileSync(
      join(
        process.cwd(),
        "src/modules/plugins/workflows/components/WorkflowGraphEditorPage.tsx",
      ),
      "utf8",
    );
    const css = readFileSync(
      join(
        process.cwd(),
        "src/modules/plugins/workflows/components/WorkflowGraphEditorPage.css",
      ),
      "utf8",
    );

    expect(source).not.toContain("MiniMap");
    expect(source).not.toContain("<MiniMap");
    expect(source).toContain("<Controls />");
    expect(css).not.toContain("react-flow__minimap");
  });

  it("defines dark readable CSS for custom EdgeLabelRenderer action labels", () => {
    const css = readFileSync(
      join(
        process.cwd(),
        "src/modules/plugins/workflows/components/WorkflowGraphEditorPage.css",
      ),
      "utf8",
    );

    expect(css).toContain(".workflow-action-edge-label");
    expect(css).toContain("background: rgba(15, 23, 42, 0.96)");
    expect(css).toContain("border: 1px solid #0e7490");
    expect(css).toContain("pointer-events: all");
    expect(css).toContain("overflow-wrap: anywhere");
    expect(css).toContain(".workflow-action-edge-label--selected");
    expect(css).toContain(".workflow-action-edge-label__action");
    expect(css).toContain(".workflow-action-edge-label__id");
  });

  it("lays out cyclic review workflows with horizontal spacing and reverse edge labels", () => {
    const nodes = [
      node({ id: "dev", label: "Dev", initial: true }),
      node({ id: "review", label: "Review" }),
      node({ id: "tester", label: "Tester" }),
      node({ id: "done", label: "Done", terminal: true }),
    ];
    const graphEdges = [
      edge({ id: "dev:ready", source: "dev", target: "review" }),
      edge({ id: "review:approved", source: "review", target: "tester" }),
      edge({
        id: "review:changes",
        source: "review",
        target: "dev",
        actionId: "changes",
        label: "Request changes",
      }),
      edge({ id: "tester:approved", source: "tester", target: "done" }),
      edge({ id: "tester:bug", source: "tester", target: "dev" }),
    ];

    const positions = layoutWorkflowGraph(nodes, graphEdges);
    expect(positions.dev).toEqual({ x: 0, y: 0 });
    expect(positions.review?.x).toBeGreaterThan(positions.dev!.x);
    expect(positions.tester?.x).toBeGreaterThan(positions.review!.x);
    expect(positions.done?.x).toBeGreaterThan(positions.tester!.x);

    const reverseEdge = toFlowEdges(graphEdges, undefined, nodes).find(
      (candidate) => candidate.id === "review:changes",
    );
    expect(reverseEdge).toMatchObject({
      className: "workflow-graph-edge workflow-reverse-edge",
      style: { stroke: "#a78bfa", strokeWidth: 2.25 },
      data: expect.objectContaining({
        reverse: true,
        label: "Request changes",
      }),
    });
  });
});

function edge(patch: Partial<WorkflowGraphEdgeModel>): WorkflowGraphEdgeModel {
  return {
    id: "state:action",
    source: "state",
    target: "done",
    actionId: "action",
    label: "Action",
    description: null,
    resultFields: [],
    handoffPrompt: null,
    waitFor: null,
    ...patch,
  };
}

function node(patch: Partial<WorkflowGraphNodeModel>): WorkflowGraphNodeModel {
  return {
    id: "state",
    label: "State",
    ownerRoleId: null,
    ownerLabel: null,
    initial: false,
    terminal: false,
    steps: [],
    ...patch,
  };
}

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { renderEditorPromptPreview, WorkflowGraphEditorView } from "./WorkflowGraphEditorPage";
import { workflowDefinitionToGraph } from "./graph/workflowGraphModel";
import type { AgentWorkflowDefinitionV1 } from "@vibe-dashboard/workflow-core";

describe("WorkflowGraphEditorView prompt and skill picker", () => {
  it("TEST_CASE_M108_1A-E renders picker assets, selected refs, missing refs, and view-only JSON diagnostics", () => {
    const html = renderToStaticMarkup(
      React.createElement(WorkflowGraphEditorView, {
        editor: {
          designId: "design-a",
          name: "Workflow A",
          description: null,
          draftId: "draft-a",
          version: 1,
          readonly: false,
          definition: promptDefinition(),
          validationStatus: "valid",
          validationIssues: [],
        },
        definition: promptDefinition(),
        assets: {
          prompts: [
            {
              kind: "prompt",
              id: "prompt.dev.instructions",
              version: 1,
              name: "Dev instructions",
              description: "Implementation prompt",
              source: "built_in",
              preview: "Implement carefully.",
            },
          ],
          skills: [
            {
              kind: "skill",
              id: "skill.testing.notes",
              version: 2,
              name: "Testing notes",
              description: "Markdown only",
              source: "user",
              preview: "Write focused tests.",
            },
          ],
        },
        onDefinitionChange: () => {},
        onSave: () => {},
        onPublish: () => {},
      }),
    );

    const compactHtml = html.replace(/\s+/g, " ");
    expect(compactHtml).toContain("Workflow outline");
    expect(compactHtml).toContain("Roles → states → transitions");
    expect(compactHtml).toContain("+ Add Role");
    expect(compactHtml).toContain("dev · 1 state");
    expect(compactHtml).toContain("Executor CODEX · Model gpt-5-codex");
    expect(compactHtml).toContain("done: dev → done");
    expect(html).toContain("Prompt authoring");
    expect(html).toContain("Role: Dev · State: dev · Step: decide");
    expect(html).toContain("Step prompt");
    expect(html).toContain("Final prompt preview");
    expect(html).toContain("XML contract generated");
    expect(html).toContain("Expected XML response spec:");
    expect(html).toContain("action=&quot;done&quot;");
    expect(html).toContain("The XML response spec is generated by the workflow actions.");
    expect(html).toContain("Prompt and skill snippets");
    expect(html).toContain("Dev instructions");
    expect(html).toContain("v1 · Built-in");
    expect(html).toContain("Testing notes");
    expect(html).toContain("v2 · User");
    expect(html).toContain(
      "Skills are markdown instruction snippets, not executable tools.",
    );
    expect(html).toContain(
      "Selected: prompt:prompt.dev.instructions@1, skill:skill.missing@1",
    );
    expect(html).toContain(
      "Missing prompt or skill refs: skill:skill.missing@1",
    );
    expect(html).toContain("JSON diagnostics");
    expect(html).toContain("Selected state");
    expect(html).toContain("Transitions / actions");
    expect(html).toContain("Executor preference");
    expect(html).toContain("Codex");
    expect(html).toContain("Model preference");
    expect(html).toContain("gpt-5-codex");
    expect(html).toContain('aria-readonly="true"');
    expect(html).not.toContain("prompt refs</span><input");
    expect(html).not.toContain("webhook");
    expect(html).not.toContain("queue item");
  });

  it("TEST_CASE_I7XF previews composed prompts with snippets and generated XML guidance", () => {
    const preview = renderEditorPromptPreview({
      definition: promptDefinition(),
      stateId: "dev",
      stepId: "decide",
      assets: {
        prompts: [{ kind: "prompt", id: "prompt.dev.instructions", version: 1, name: "Dev instructions", description: "Implementation prompt", source: "built_in", preview: "Implement carefully." }],
        skills: [{ kind: "skill", id: "skill.testing.notes", version: 2, name: "Testing notes", description: "Markdown only", source: "user", preview: "Write focused tests." }],
      },
    });

    expect(preview.text).toContain("Prompt: Dev instructions");
    expect(preview.text).toContain("Implement carefully.");
    expect(preview.text).toContain("Do work");
    expect(preview.text).toContain("Expected XML response spec:");
    expect(preview.text).toContain('action="done"');
    expect(preview.text).toContain("<summary>...</summary>: required markdown");
    expect(preview.missingRefs).toEqual(["skill:skill.missing@1"]);
    expect(preview.text).not.toContain("webhook");
    expect(preview.text).not.toContain("queue item");
  });

  it("TEST_CASE_8ABA navigates role to state to action in the outline wizard", () => {
    const definition = wizardDefinition();
    const graph = workflowDefinitionToGraph(definition);
    const html = renderToStaticMarkup(
      React.createElement(WorkflowOutlineNavigator, {
        definition,
        nodes: graph.nodes,
        edges: graph.edges,
        selectedRoleId: "review",
        selectedNodeId: "review",
        selectedEdgeId: "review:changes_requested",
        onSelectRole: () => {},
        onSelectState: () => {},
        onSelectEdge: () => {},
        onAddRole: () => {},
      }),
    );

    const compactHtml = html.replace(/\s+/g, " ");
    expect(compactHtml).toContain("Workflow outline");
    expect(compactHtml).toContain("Dev");
    expect(compactHtml).toContain("dev · 1 state");
    expect(compactHtml).toContain("Review");
    expect(compactHtml).toContain("review · 1 state");
    expect(compactHtml).toContain("Selected state");
    expect(compactHtml).toContain("review · owned by Review");
    expect(compactHtml).toContain("Transitions / actions");
    expect(compactHtml).toContain("Request changes");
    expect(compactHtml).toContain("changes_requested: review → dev");
    expect(compactHtml).toContain("Approved");
    expect(compactHtml).toContain("approved: review → done");
    expect(compactHtml).toContain("+ Add Role");
  });
});

function promptDefinition(): AgentWorkflowDefinitionV1 {
  return {
    schemaVersion: 1,
    name: "Workflow A",
    inputs: { featureRequest: { type: "markdown", required: true } },
    roles: {
      dev: {
        label: "Dev",
        executorPreference: {
          executorType: "CODEX",
          model: "gpt-5-codex",
          mode: "preferred",
        },
      },
    },
    initialState: "dev",
    states: {
      dev: {
        owner: "dev",
        steps: [
          {
            id: "decide",
            type: "agent_turn",
            turnType: "decision",
            prompt: {
              template: "Do work",
              refs: [
                { kind: "prompt", id: "prompt.dev.instructions", version: 1 },
                { kind: "skill", id: "skill.missing", version: 1 },
              ],
            } as any,
            response: {
              format: "xml",
              schema: { format: "xsd", source: "state_actions" },
              invalidXmlRetry: {
                maxAttempts: 1,
                prompt: "engine_default_with_validation_errors",
                onExhausted: "blocked",
              },
              storeRawXml: true,
              storeParsedFields: true,
              unknownFields: "reject_unless_allowed_by_result_contract",
            },
          },
        ],
        actions: {
          done: {
            label: "Done",
            targetState: "done",
            result: {
              fields: { summary: { type: "markdown" } },
              required: ["summary"],
              unknownFields: "reject",
            },
          },
        },
      },
      done: { terminal: true },
    },
  };
}

function wizardDefinition(): AgentWorkflowDefinitionV1 {
  return {
    schemaVersion: 1,
    name: "Wizard workflow",
    inputs: { featureRequest: { type: "markdown", required: true } },
    roles: { dev: { label: "Dev" }, review: { label: "Review" } },
    initialState: "dev",
    states: {
      dev: {
        owner: "dev",
        steps: [
          {
            id: "self_review",
            type: "agent_turn",
            turnType: "decision",
            prompt: { template: "Dev decide" },
            response: {
              format: "xml",
              schema: { format: "xsd", source: "state_actions" },
              invalidXmlRetry: {
                maxAttempts: 1,
                prompt: "engine_default_with_validation_errors",
                onExhausted: "blocked",
              },
              storeRawXml: true,
              storeParsedFields: true,
              unknownFields: "reject_unless_allowed_by_result_contract",
            },
          },
        ],
        actions: { ready: { label: "Ready", targetState: "review" } },
      },
      review: {
        owner: "review",
        steps: [
          {
            id: "review",
            type: "agent_turn",
            turnType: "decision",
            prompt: { template: "Review decide" },
            response: {
              format: "xml",
              schema: { format: "xsd", source: "state_actions" },
              invalidXmlRetry: {
                maxAttempts: 1,
                prompt: "engine_default_with_validation_errors",
                onExhausted: "blocked",
              },
              storeRawXml: true,
              storeParsedFields: true,
              unknownFields: "reject_unless_allowed_by_result_contract",
            },
          },
        ],
        actions: {
          changes_requested: {
            label: "Request changes",
            targetState: "dev",
            result: {
              fields: { requestedChanges: { type: "markdown" } },
              required: ["requestedChanges"],
              unknownFields: "reject",
            },
          },
          approved: { label: "Approved", targetState: "done" },
        },
      },
      done: { terminal: true },
    },
  };
}
