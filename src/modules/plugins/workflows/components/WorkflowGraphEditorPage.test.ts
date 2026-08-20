import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildWorkflowGraphFocusContext,
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

  it("builds contextual graph focus for role, state, and action drill-in", () => {
    const graph = workflowDefinitionToGraph(wizardDefinition());

    const roleFocus = buildWorkflowGraphFocusContext({
      nodes: graph.nodes,
      edges: graph.edges,
      selectedRoleId: "review",
    });
    expect(roleFocus.title).toBe("Role review");
    expect(roleFocus.nodes.map((node) => node.id)).toEqual(
      expect.arrayContaining(["dev", "review", "done"]),
    );
    expect(roleFocus.edges.map((edge) => edge.actionId)).toEqual(
      expect.arrayContaining(["ready", "changes_requested", "approved"]),
    );

    const stateFocus = buildWorkflowGraphFocusContext({
      nodes: graph.nodes,
      edges: graph.edges,
      selectedNodeId: "review",
    });
    expect(stateFocus.title).toBe("State Review");
    expect(stateFocus.description).toContain("Selected state");
    expect(stateFocus.edges.map((edge) => edge.actionId)).toEqual(
      expect.arrayContaining(["ready", "changes_requested", "approved"]),
    );

    const changes = graph.edges.find((edge) => edge.actionId === "changes_requested");
    if (!changes) throw new Error("changes edge fixture missing");
    const actionFocus = buildWorkflowGraphFocusContext({
      nodes: graph.nodes,
      edges: graph.edges,
      selectedEdgeId: changes.id,
    });
    expect(actionFocus.title).toBe("Action Request changes");
    expect(actionFocus.nodes.map((node) => node.id).sort()).toEqual(["dev", "review"]);
    expect(actionFocus.edges).toEqual([changes]);
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
import { buildSelectedPromptPreviewContext, buildWorkflowEditorGraphFocusContext, removeWorkflowActionDraft, removeWorkflowRoleDraft, removeWorkflowStateDraft, renderEditorPromptPreview, renderEditorResponseXsd, WorkflowGraphEditorView } from "./WorkflowGraphEditorPage";
import { workflowDefinitionToGraph } from "./graph/workflowGraphModel";
import type { AgentWorkflowDefinitionV1 } from "@vibe-dashboard/workflow-core";

describe("WorkflowGraphEditorView prompt and skill picker", () => {
  it("TEST_CASE_NQGV_1C renders true empty invalid drafts without crashing and allows save", () => {
    const definition = {
      schemaVersion: 1,
      name: "Blank workflow",
      description: "Empty draft",
      inputs: {},
      roles: {},
      initialState: "",
      states: {},
    } as AgentWorkflowDefinitionV1;
    const html = renderToStaticMarkup(
      React.createElement(WorkflowGraphEditorView, {
        editor: {
          designId: "design-blank",
          name: "Blank workflow",
          description: "Empty draft",
          draftId: "draft-blank",
          version: null,
          readonly: false,
          definition,
          validationStatus: "invalid",
          validationIssues: [],
        },
        definition,
        assets: { prompts: [], skills: [] },
        onDefinitionChange: () => {},
        onSave: () => {},
        onPublish: () => {},
      }),
    );

    expect(html).toContain("Workflow details");
    expect(html).toContain("Roles");
    expect(html).toContain("+ Add Role");
    expect(html).toContain("Context graph");
    expect(html).toContain("Save draft");
    expect(html).toContain("Publish");
    expect(html).toContain("disabled=\"\"");
    expect(html).not.toContain("Cannot read");
    expect(html).not.toContain("raw JSON");
    expect(html).not.toContain("queue item");
  });

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
    expect(compactHtml).toContain("Context graph");
    expect(compactHtml).toContain("workflow-react-flow-canvas");
    expect(compactHtml).not.toContain("Graph preview is collapsed.");
    expect(compactHtml).not.toContain("Show graph");
    expect(compactHtml).not.toContain("Hide graph");
    expect(compactHtml).toContain("Workflow wizard");
    expect(compactHtml).toContain("Workflow details");
    expect(compactHtml).toContain("Roles");
    expect(compactHtml).not.toContain("Roles → states → transitions");
    expect(compactHtml).toContain("+ Add Role");
    expect(compactHtml).toContain("dev · 1 state");
    expect(compactHtml).toContain("Executor CODEX · Model gpt-5-codex");
    expect(compactHtml).not.toContain("Choose a role, then inspect its states and outgoing actions.");
    expect(html).toContain("Edit workflow details");
    expect(html).not.toContain("Selected role");
    expect(html).not.toContain("Edit role");
    expect(html).toContain("JSON diagnostics");
    expect(html).toContain('aria-readonly="true"');
    expect(html).not.toContain("Prompt authoring");
    expect(html).not.toContain("Step prompt");
    expect(html).not.toContain("Prompt and skill snippets");
    expect(html).not.toContain("Executor preference");
    expect(html).not.toContain("Model preference");
    expect(html).not.toContain("<input");
    expect(html).not.toContain("<textarea");
    expect(html).not.toContain("<select");
    expect(html).not.toContain("webhook");
    expect(html).not.toContain("queue item");
  });

  it("TEST_CASE_ZJCB_8 shows prompt and skill authoring only after editing the selected state", () => {
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
        initialSelection: { roleId: "dev", stateId: "dev" },
        initialEditTarget: { kind: "state", id: "dev" },
        onDefinitionChange: () => {},
        onSave: () => {},
        onPublish: () => {},
      }),
    );

    expect(html).toContain("Prompt authoring");
    expect(html).toContain("Role: Dev · State: dev · Step: decide");
    expect(html).toContain("Step prompt");
    expect(html).toContain("Final prompt preview");
    expect(html).toContain("XML contract generated");
    expect(html).toContain("Expected XML Schema (XSD):");
    expect(html).toContain("fixed=&quot;done&quot;");
    expect(html).toContain("The XML response spec is generated by the workflow actions.");
    expect(html).toContain("Prompt and skill snippets");
    expect(html).toContain("Dev instructions");
    expect(html).toContain("v1 · Built-in");
    expect(html).toContain("Testing notes");
    expect(html).toContain("v2 · User");
    expect(html).toContain(
      "Selected: prompt:prompt.dev.instructions@1, skill:skill.missing@1",
    );
    expect(html).toContain(
      "Missing prompt or skill refs: skill:skill.missing@1",
    );
    expect(html).not.toContain("webhook");
    expect(html).not.toContain("queue item");
  });

  it("TEST_CASE_I7XF previews composed prompts with snippets and generated XML guidance", () => {
    const preview = renderEditorPromptPreview({
      definition: promptDefinition(),
      stateId: "dev",
      stepId: "decide",
      assets: {
        prompts: [{ kind: "prompt", id: "prompt.dev.instructions", version: 1, name: "Dev instructions", description: "Implementation prompt", source: "built_in", preview: "Implement carefully.", bodyMarkdown: "Implement carefully from the saved prompt body." }],
        skills: [{ kind: "skill", id: "skill.missing", version: 1, name: "Testing notes", description: "Markdown only", source: "user", preview: "Write tests.", bodyMarkdown: "Write focused tests from the saved skill body." }],
      },
    });

    expect(preview.text).toContain("Implement carefully from the saved prompt body.");
    expect(preview.text).toContain("Write focused tests from the saved skill body.");
    expect(preview.text).toContain("Do work");
    expect(preview.text).not.toContain("prompt:prompt.dev.instructions@1");
    expect(preview.text).not.toContain("skill:skill.testing.notes@2");
    expect(preview.text).not.toContain("Built-in");
    expect(preview.text).not.toContain("contentHash");
    expect(preview.text).toContain("## Task context (sample bead context for preview)");
    expect(preview.text).toContain("vibe-kanban-vscode-web-example: Example workflow task");
    expect(preview.text).toContain("Expected XML Schema (XSD):");
    expect(preview.text).toContain('fixed="done"');
    expect(preview.text).toContain('<xs:element name="summary" type="xs:string" minOccurs="1" maxOccurs="1"/>');
    expect(preview.missingRefs).toEqual([]);
    expect(preview.text).not.toContain("webhook");
    expect(preview.text).not.toContain("queue item");
    expect(preview.text).not.toContain("(No step prompt written yet.)");
  });

  it("TEST_CASE_2YLE_1C composes final prompt previews with selected-step bead context parity", () => {
    const preview = renderEditorPromptPreview({
      definition: promptDefinition(),
      stateId: "dev",
      stepId: "decide",
      assets: { prompts: [], skills: [] },
      beadContext: { beadIds: ["vibe-kanban-vscode-web-2yle"], beads: [{ beadId: "vibe-kanban-vscode-web-2yle", title: "Carry bead context", status: "open" }] },
    });

    expect(preview.text).toContain("Do work");
    expect(preview.text).toContain("vibe-kanban-vscode-web-2yle: Carry bead context (open)");
    expect(preview.text.indexOf("## Task context")).toBeLessThan(preview.text.indexOf("Expected XML Schema (XSD):"));
    expect(preview.text).not.toContain("(No step prompt written yet.)");
  });

  it("TEST_CASE_2YLE_1D exposes a visible final prompt preview step selector and changes preview by step", () => {
    const definition = multiStepPromptDefinition();
    const html = renderToStaticMarkup(
      React.createElement(WorkflowGraphEditorView, {
        editor: null,
        definition,
        assets: { prompts: [], skills: [] },
        initialSelection: { roleId: "dev", stateId: "dev" },
        onDefinitionChange: () => {},
        onSave: () => {},
        onPublish: () => {},
      }),
    );

    expect(html).toContain("Preview step");
    expect(html).toContain("Select final prompt preview step");
    expect(html).toContain("implement · non_decision");
    expect(html).toContain("decide · decision");

    const defaultPreview = buildSelectedPromptPreviewContext({
      definition,
      assets: { prompts: [], skills: [] },
      selectedStateId: "dev",
    });
    const implementPreview = buildSelectedPromptPreviewContext({
      definition,
      assets: { prompts: [], skills: [] },
      selectedStateId: "dev",
      selectedStepId: "implement",
    });

    expect(defaultPreview.stepId).toBe("decide");
    expect(defaultPreview.preview?.text).toContain("Decide next action");
    expect(implementPreview.stepId).toBe("implement");
    expect(implementPreview.preview?.text).toContain("Implement the task");
    expect(implementPreview.preview?.text).not.toContain("Decide next action");
  });


  it("TEST_CASE_NZEK_1A shows read-only generated XSD diagnostics for selected decision state", () => {
    const html = renderToStaticMarkup(
      React.createElement(WorkflowGraphEditorView, {
        editor: null,
        definition: promptDefinition(),
        assets: { prompts: [], skills: [] },
        initialSelection: { roleId: "dev", stateId: "dev" },
        onDefinitionChange: () => {},
        onSave: () => {},
        onPublish: () => {},
      }),
    );

    expect(html).toContain("Generated response XSD diagnostics");
    expect(html).toContain("State dev · decision step decide");
    expect(html).toContain("Read-only generated XSD");
    expect(html).toContain("readonly");
    expect(html).toContain("Generated workflow response XSD");
    expect(html).toContain("&lt;xs:schema");
    expect(html).toContain("&lt;xs:enumeration value=&quot;done&quot;/&gt;");
    expect(html).toContain("&lt;xs:element name=&quot;summary&quot; type=&quot;xs:string&quot; minOccurs=&quot;1&quot; maxOccurs=&quot;1&quot;/&gt;");
    expect(html).not.toContain("Expected XML Schema (XSD):&lt;/textarea");
  });

  it("TEST_CASE_NZEK_1B shows beads-form provider XSD for create-form workflow diagnostics", () => {
    const html = renderToStaticMarkup(
      React.createElement(WorkflowGraphEditorView, {
        editor: null,
        definition: createFormDefinition(),
        assets: { prompts: [], skills: [] },
        initialSelection: { roleId: "form_author", stateId: "create_form" },
        onDefinitionChange: () => {},
        onSave: () => {},
        onPublish: () => {},
      }),
    );

    expect(html).toContain("State create_form · decision step draft_form");
    expect(html).toContain("&lt;xs:element name=&quot;formSchema&quot; minOccurs=&quot;1&quot; maxOccurs=&quot;1&quot;&gt;");
    expect(html).toContain("&lt;xs:complexType name=&quot;BeadsFormType&quot;&gt;");
    expect(html).toContain("&lt;xs:element name=&quot;pros&quot; type=&quot;xs:string&quot; minOccurs=&quot;0&quot; maxOccurs=&quot;1&quot;/&gt;");
    expect(html).toContain("&lt;xs:element name=&quot;recommendedReason&quot; type=&quot;xs:string&quot; minOccurs=&quot;0&quot; maxOccurs=&quot;1&quot;/&gt;");
    expect(html).not.toContain("&lt;xs:element name=&quot;formSchema&quot; type=&quot;xs:string&quot;");
  });

  it("TEST_CASE_NZEK_1C updates generated XSD with state selection and reports non-decision unavailable", () => {
    const review = renderEditorResponseXsd(wizardDefinition(), "review");
    expect(review.xsd).toContain('<xs:enumeration value="changes_requested"/>');
    expect(review.xsd).toContain('<xs:element name="requestedChanges" type="xs:string" minOccurs="1" maxOccurs="1"/>');
    expect(review.xsd).not.toContain('<xs:enumeration value="ready"/>');

    const dev = renderEditorResponseXsd(wizardDefinition(), "dev");
    expect(dev.xsd).toContain('<xs:enumeration value="ready"/>');
    expect(dev.xsd).not.toContain('<xs:enumeration value="changes_requested"/>');

    const nonDecision = renderEditorResponseXsd(nonDecisionDefinition(), "dev", "implement");
    expect(nonDecision.xsd).toBeNull();
    expect(nonDecision.message).toContain("available only for decision agent turns");
  });

  it("TEST_CASE_NZEK_1D uses the same XSD in editor diagnostics and final prompt preview", () => {
    const diagnostics = renderEditorResponseXsd(promptDefinition(), "dev", "decide");
    const preview = renderEditorPromptPreview({
      definition: promptDefinition(),
      stateId: "dev",
      stepId: "decide",
      assets: { prompts: [], skills: [] },
    });

    expect(diagnostics.xsd).toBeTruthy();
    expect(preview.xmlSpec).toContain(diagnostics.xsd!);
  });

  it("TEST_CASE_ZJCB_9 shows and edits linked shared role templates", () => {
    const definition = promptDefinition();
    definition.roles.dev = {
      ...definition.roles.dev,
      templateRef: { templateId: "role.dev.implementer", version: 1 },
    };
    const html = renderToStaticMarkup(
      React.createElement(WorkflowGraphEditorView, {
        editor: null,
        definition,
        assets: {
          prompts: [],
          skills: [],
          roleTemplates: [
            {
              id: "role.dev.implementer",
              version: 1,
              name: "Implementer",
              description: "Reusable implementation role",
              source: "user",
              promptPreview: "Shared implementer instructions.",
              skillRefs: [{ kind: "skill", id: "skill.testing.notes", version: 1 }],
              executorPreference: { executorType: "CODEX", model: "gpt-5-codex", mode: "preferred" },
              active: true,
            },
          ],
        },
        initialSelection: { roleId: "dev" },
        initialEditTarget: { kind: "role", id: "dev" },
        onDefinitionChange: () => {},
        onSave: () => {},
        onPublish: () => {},
      }),
    );

    expect(html).toContain("Shared role template");
    expect(html).toContain("Implementer v1");
    expect(html).toContain("Shared implementer instructions.");
    expect(html).toContain("Skills: skill:skill.testing.notes@1");
    expect(html).toContain("Template changes publish as new versions");
  });

  it("TEST_CASE_ZJCB_8 keeps role preferences read-only until the selected role is edited", () => {
    const html = renderToStaticMarkup(
      React.createElement(WorkflowGraphEditorView, {
        editor: null,
        definition: promptDefinition(),
        assets: { prompts: [], skills: [] },
        initialSelection: { roleId: "dev" },
        initialEditTarget: { kind: "role", id: "dev" },
        onDefinitionChange: () => {},
        onSave: () => {},
        onPublish: () => {},
      }),
    );

    expect(html).toContain("Editing role");
    expect(html).toContain("dev label");
    expect(html).toContain("Executor preference");
    expect(html).toContain("Model preference");
    expect(html).toContain("gpt-5-codex");
  });

  it("TEST_CASE_ZJCB_8 focuses a newly added role in edit mode shape", () => {
    const definition = {
      ...promptDefinition(),
      roles: {
        ...promptDefinition().roles,
        role_2: { label: "New role" },
      },
    };
    const html = renderToStaticMarkup(
      React.createElement(WorkflowGraphEditorView, {
        editor: null,
        definition,
        assets: { prompts: [], skills: [] },
        initialSelection: { roleId: "role_2" },
        initialEditTarget: { kind: "role", id: "role_2" },
        onDefinitionChange: () => {},
        onSave: () => {},
        onPublish: () => {},
      }),
    );

    expect(html).toContain("Editing role");
    expect(html).toContain("role_2 label");
    expect(html).toContain('value="New role"');
    expect(html).toContain("No states are assigned to this role yet.");
  });

  it("TEST_CASE_ZJCB_8 shows action inputs only in action edit mode", () => {
    const definition = wizardDefinition();
    const graph = workflowDefinitionToGraph(definition);
    const readyEdge = graph.edges.find((edge) => edge.actionId === "ready");
    if (!readyEdge) throw new Error("ready edge fixture missing");

    const inspectHtml = renderToStaticMarkup(
      React.createElement(WorkflowGraphEditorView, {
        editor: null,
        definition,
        assets: { prompts: [], skills: [] },
        initialSelection: { roleId: "dev", stateId: "dev", edgeId: readyEdge.id },
        onDefinitionChange: () => {},
        onSave: () => {},
        onPublish: () => {},
      }),
    );
    expect(inspectHtml).toContain("Edit action");
    expect(inspectHtml).not.toContain("Action label</span><input");
    expect(inspectHtml).not.toContain("Target state</span><select");

    const editHtml = renderToStaticMarkup(
      React.createElement(WorkflowGraphEditorView, {
        editor: null,
        definition,
        assets: { prompts: [], skills: [] },
        initialSelection: { roleId: "dev", stateId: "dev", edgeId: readyEdge.id },
        initialEditTarget: { kind: "action", id: readyEdge.id },
        onDefinitionChange: () => {},
        onSave: () => {},
        onPublish: () => {},
      }),
    );
    expect(editHtml).toContain("Action label");
    expect(editHtml).toContain("Target state");
    expect(editHtml).toContain("Handoff prompt");
  });

  it("TEST_CASE_ZJCB_10 expands a compact graph synchronized to selected state/action", () => {
    const definition = wizardDefinition();
    const graph = workflowDefinitionToGraph(definition);
    const changes = graph.edges.find((edge) => edge.actionId === "changes_requested");
    if (!changes) throw new Error("changes edge fixture missing");
    const html = renderToStaticMarkup(
      React.createElement(WorkflowGraphEditorView, {
        editor: null,
        definition,
        assets: { prompts: [], skills: [] },
        initialGraphOpen: true,
        initialSelection: { roleId: "review", stateId: "review", edgeId: changes.id },
        onDefinitionChange: () => {},
        onSave: () => {},
        onPublish: () => {},
      }),
    );

    expect(html).toContain("Context graph");
    expect(html).toContain("Action Request changes");
    expect(html).toContain("review → dev");
    expect(html).not.toContain("Hide graph");
    expect(html).not.toContain("Show graph");
    expect(html).toContain("workflow-react-flow-canvas");
    expect(html).toContain("Action selected");
    expect(html).toContain("Edit action changes_requested");
  });


  it("TEST_CASE_XJNZ_1A renders role/state/action wizard levels without noisy copy", () => {
    const roleHtml = renderToStaticMarkup(
      React.createElement(WorkflowGraphEditorView, {
        editor: null,
        definition: wizardDefinition(),
        assets: { prompts: [], skills: [] },
        initialSelection: { roleId: "review" },
        onDefinitionChange: () => {},
        onSave: () => {},
        onPublish: () => {},
      }),
    );
    expect(roleHtml).toContain("Role selected");
    expect(roleHtml).toContain("States for this role");
    expect(roleHtml).toContain('aria-label="Back"');
    expect(roleHtml).not.toContain("Roles → states → transitions");

    const stateHtml = renderToStaticMarkup(
      React.createElement(WorkflowGraphEditorView, {
        editor: null,
        definition: wizardDefinition(),
        assets: { prompts: [], skills: [] },
        initialSelection: { roleId: "review", stateId: "review" },
        onDefinitionChange: () => {},
        onSave: () => {},
        onPublish: () => {},
      }),
    );
    expect(stateHtml).toContain("State selected");
    expect(stateHtml).toContain("Transitions / actions");
    expect(stateHtml).not.toContain("Press Edit action to change");

    const graph = workflowDefinitionToGraph(wizardDefinition());
    const changes = graph.edges.find((edge) => edge.actionId === "changes_requested");
    if (!changes) throw new Error("changes edge fixture missing");
    const actionHtml = renderToStaticMarkup(
      React.createElement(WorkflowGraphEditorView, {
        editor: null,
        definition: wizardDefinition(),
        assets: { prompts: [], skills: [] },
        initialSelection: { roleId: "review", stateId: "review", edgeId: changes.id },
        onDefinitionChange: () => {},
        onSave: () => {},
        onPublish: () => {},
      }),
    );
    expect(actionHtml).toContain("Action selected");
    expect(actionHtml).toContain("Request changes · review → dev");
    expect(actionHtml).not.toContain("Press Edit action to change");
  });

  it("TEST_CASE_XJNZ_1B filters graph structurally by wizard level", () => {
    const definition = wizardDefinition();
    const graph = workflowDefinitionToGraph(definition);
    const landing = buildWorkflowEditorGraphFocusContext({ definition, nodes: graph.nodes, edges: graph.edges, wizardLevel: "landing" });
    expect(landing.nodes.map((node) => node.id)).toEqual(expect.arrayContaining(["role:dev", "role:review", "terminal:done"]));
    expect(landing.nodes.map((node) => node.id)).not.toContain("dev");

    const role = buildWorkflowEditorGraphFocusContext({ definition, nodes: graph.nodes, edges: graph.edges, wizardLevel: "role", selectedRoleId: "review" });
    expect(role.nodes.map((node) => node.id)).toEqual(["review"]);

    const state = buildWorkflowEditorGraphFocusContext({ definition, nodes: graph.nodes, edges: graph.edges, wizardLevel: "state", selectedNodeId: "review" });
    expect(state.nodes.map((node) => node.id)).toEqual(expect.arrayContaining(["review", "dev", "done"]));
    expect(state.edges.map((edge) => edge.actionId)).toEqual(expect.arrayContaining(["changes_requested", "approved"]));

    const changes = graph.edges.find((edge) => edge.actionId === "changes_requested")!;
    const action = buildWorkflowEditorGraphFocusContext({ definition, nodes: graph.nodes, edges: graph.edges, wizardLevel: "action", selectedEdgeId: changes.id });
    expect(action.nodes.map((node) => node.id).sort()).toEqual(["dev", "review"]);
    expect(action.edges).toEqual([changes]);
  });

  it("TEST_CASE_XJNZ_1C keeps workflow details compact until explicit edit and wires graph clicks to wizard selection", () => {
    const inspectHtml = renderToStaticMarkup(
      React.createElement(WorkflowGraphEditorView, {
        editor: null,
        definition: wizardDefinition(),
        assets: { prompts: [], skills: [] },
        onDefinitionChange: () => {},
        onSave: () => {},
        onPublish: () => {},
      }),
    );
    expect(inspectHtml).toContain("Workflow details");
    expect(inspectHtml).toContain("Edit workflow details");
    expect(inspectHtml).not.toContain("Edit workflow details</h2>");
    expect(inspectHtml).not.toContain("Workflow name</span><input");
    expect(inspectHtml).not.toContain("Description</span><textarea");

    const editHtml = renderToStaticMarkup(
      React.createElement(WorkflowGraphEditorView, {
        editor: null,
        definition: wizardDefinition(),
        assets: { prompts: [], skills: [] },
        initialEditTarget: { kind: "design", id: "design" },
        onDefinitionChange: () => {},
        onSave: () => {},
        onPublish: () => {},
      }),
    );
    expect(editHtml).toContain("Edit workflow details</h2>");
    expect(editHtml).toContain("Workflow name");
    expect(editHtml).toContain("Description");

    const source = readFileSync(
      join(
        process.cwd(),
        "src/modules/plugins/workflows/components/WorkflowGraphEditorPage.tsx",
      ),
      "utf8",
    );
    expect(source).toContain('if (node.id.startsWith("role:")) selectRole');
    expect(source).toContain('else if (!node.id.startsWith("terminal:")) selectState');
    expect(source).toContain("candidate.id === edge.id)) selectEdge(edge.id)");
  });

  it("TEST_CASE_FUH7_1 shows workflow identity instead of source template identity", () => {
    const definition = {
      ...promptDefinition(),
      name: "Copied customer review workflow",
      description: "Workflow-specific draft description",
    };
    const html = renderToStaticMarkup(
      React.createElement(WorkflowGraphEditorView, {
        editor: {
          designId: "design-from-template",
          name: "Built-in Dev Review Tester template",
          description: "Template description should not be prominent",
          draftId: "draft-template",
          version: 1,
          readonly: false,
          definition,
          validationStatus: "valid",
          validationIssues: [],
        },
        definition,
        assets: { prompts: [], skills: [] },
        onDefinitionChange: () => {},
        onSave: () => {},
        onPublish: () => {},
      }),
    );

    expect(html).toContain("Copied customer review workflow");
    expect(html).toContain("Workflow-specific draft description");
    expect(html).not.toContain("Built-in Dev Review Tester template");
    expect(html).not.toContain("Template description should not be prominent");
  });

  it("TEST_CASE_FUH7_3 renders final prompt preview near the graph rather than inside prompt authoring", () => {
    const html = renderToStaticMarkup(
      React.createElement(WorkflowGraphEditorView, {
        editor: null,
        definition: promptDefinition(),
        assets: { prompts: [], skills: [] },
        initialSelection: { roleId: "dev", stateId: "dev" },
        initialEditTarget: { kind: "state", id: "dev" },
        onDefinitionChange: () => {},
        onSave: () => {},
        onPublish: () => {},
      }),
    );
    const graphIndex = html.indexOf("workflow-react-flow-canvas");
    const previewIndex = html.indexOf("Selected final prompt preview");
    expect(graphIndex).toBeGreaterThan(-1);
    expect(previewIndex).toBeGreaterThan(graphIndex);
    expect(html).toContain("Final prompt preview");
    expect(html).toContain("State dev · Step decide");
    expect(html).toContain("XML contract generated");
    expect(html).toContain("Prompt authoring");
  });

  it("TEST_CASE_FUH7_4 safely removes draft roles, states, and actions while blocking unsafe deletes", () => {
    const definition = removableDefinition();

    const roleBlocked = removeWorkflowRoleDraft(definition, "dev");
    expect(roleBlocked.ok).toBe(false);
    expect(roleBlocked.message).toContain("owns 1 state");

    const roleRemoved = removeWorkflowRoleDraft(definition, "unused");
    expect(roleRemoved.ok).toBe(true);
    if (!roleRemoved.ok) throw new Error("role should remove");
    expect(roleRemoved.definition.roles.unused).toBeUndefined();

    const initialBlocked = removeWorkflowStateDraft(definition, "dev");
    expect(initialBlocked.ok).toBe(false);
    expect(initialBlocked.message).toContain("initial state");

    const targetBlocked = removeWorkflowStateDraft(definition, "done");
    expect(targetBlocked.ok).toBe(false);
    expect(targetBlocked.message).toContain("targeted");

    const stateRemoved = removeWorkflowStateDraft(definition, "orphan");
    expect(stateRemoved.ok).toBe(true);
    if (!stateRemoved.ok) throw new Error("state should remove");
    expect(stateRemoved.definition.states.orphan).toBeUndefined();

    const actionRemoved = removeWorkflowActionDraft(definition, "dev", "ready");
    expect(actionRemoved.ok).toBe(true);
    if (!actionRemoved.ok) throw new Error("action should remove");
    expect((actionRemoved.definition.states.dev as any).actions.ready).toBeUndefined();
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


function createFormDefinition(): AgentWorkflowDefinitionV1 {
  return {
    schemaVersion: 1,
    name: "Create form from agent",
    inputs: { formRequest: { type: "markdown", required: true } },
    roles: { form_author: { label: "Form author" } },
    initialState: "create_form",
    states: {
      create_form: {
        owner: "form_author",
        steps: [{ id: "draft_form", type: "agent_turn", turnType: "decision", prompt: { template: "Create a form" }, response: decisionResponse() }],
        actions: {
          form_created: {
            label: "Form created",
            targetState: "done",
            result: {
              fields: {
                formSchema: { type: "markdown" },
                artifactRef: { type: "string" },
                summary: { type: "markdown" },
              },
              required: ["formSchema"],
              unknownFields: "reject",
            },
          },
        },
      },
      done: { terminal: true },
    },
  };
}

function nonDecisionDefinition(): AgentWorkflowDefinitionV1 {
  const definition = promptDefinition();
  definition.states.dev = {
    owner: "dev",
    steps: [
      { id: "implement", type: "agent_turn", turnType: "non_decision", prompt: { template: "Implement" } },
      ...((definition.states.dev as any).steps),
    ],
    actions: (definition.states.dev as any).actions,
  } as any;
  return definition;
}

function decisionResponse() {
  return {
    format: "xml" as const,
    schema: { format: "xsd" as const, source: "state_actions" as const },
    invalidXmlRetry: {
      maxAttempts: 1,
      prompt: "engine_default_with_validation_errors" as const,
      onExhausted: "blocked" as const,
    },
    storeRawXml: true,
    storeParsedFields: true,
    unknownFields: "reject_unless_allowed_by_result_contract" as const,
  };
}

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

function multiStepPromptDefinition(): AgentWorkflowDefinitionV1 {
  const definition = promptDefinition();
  const dev = definition.states.dev;
  if (dev && !("terminal" in dev)) {
    const decisionStep = dev.steps[0]!;
    dev.steps = [
      { id: "implement", type: "agent_turn", turnType: "non_decision", prompt: { template: "Implement the task" } } as any,
      {
        ...decisionStep,
        prompt: { ...(decisionStep as any).prompt, template: "Decide next action" } as any,
      } as any,
    ];
  }
  return definition;
}

function removableDefinition(): AgentWorkflowDefinitionV1 {
  return {
    ...wizardDefinition(),
    roles: {
      ...wizardDefinition().roles,
      unused: { label: "Unused" },
    },
    states: {
      ...wizardDefinition().states,
      orphan: { terminal: true },
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
