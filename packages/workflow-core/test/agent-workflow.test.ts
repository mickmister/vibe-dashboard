import { describe, expect, it } from "vitest";
import {
  WorkflowDefinitionError,
  advanceWorkflow,
  createInitialWorkflowSnapshot,
  normalizeWorkflowDefinitionV1,
  planNextWorkflowEffect,
  renderExpectedXmlResponseSpec,
  type AgentWorkflowDefinitionV1,
  type AgentWorkflowStepV1,
  type DecisionResponseValidator,
  type NormalizedWorkflowState,
  type WorkflowRuntimeSnapshot,
} from "../src/index";

function activeAuthoredState(
  definition: AgentWorkflowDefinitionV1,
  stateId: string,
) {
  const state = definition.states[stateId];
  if (!state || "terminal" in state) {
    throw new Error(`Expected active authored state ${stateId}`);
  }
  return state;
}

function activeNormalizedState(
  state: NormalizedWorkflowState | undefined,
): Extract<NormalizedWorkflowState, { terminal: false }> {
  if (!state || state.terminal) {
    throw new Error("Expected active normalized state");
  }
  return state;
}

function decisionResponse(
  definition: AgentWorkflowDefinitionV1,
  stateId = "devImplementing",
) {
  const step = activeAuthoredState(definition, stateId).steps.find(
    (candidate): candidate is AgentWorkflowStepV1 =>
      candidate.type === "agent_turn" && candidate.turnType === "decision",
  );
  if (!step?.response) {
    throw new Error(`Expected decision response policy for ${stateId}`);
  }
  return step.response;
}

function makeDefinition(): AgentWorkflowDefinitionV1 {
  return {
    schemaVersion: 1,
    name: "dev-review-test-loop",
    inputs: {
      featureRequest: { type: "markdown", required: true },
    },
    roles: {
      dev: { label: "Dev", description: "Implementation role" },
      review: { label: "Review" },
    },
    initialState: "devImplementing",
    states: {
      devImplementing: {
        owner: "dev",
        steps: [
          {
            id: "implement",
            type: "agent_turn",
            turnType: "non_decision",
            prompt: {
              template:
                "Implement {{inputs.featureRequest}} {{transition.handoffText}}",
            },
          },
          {
            id: "selfReview",
            type: "agent_turn",
            turnType: "decision",
            prompt: { template: "Choose next action" },
            response: {
              format: "xml",
              schema: { format: "xsd", source: "state_actions" },
              invalidXmlRetry: {
                maxAttempts: 2,
                prompt: "engine_default_with_validation_errors",
                onExhausted: "blocked",
              },
              storeRawXml: true,
              rawXmlMaxChars: 20,
              storeParsedFields: true,
              unknownFields: "reject_unless_allowed_by_result_contract",
            },
          },
        ],
        actions: {
          readyForReview: {
            label: "Ready for review",
            targetState: "reviewing",
            result: {
              fields: {
                summary: { type: "markdown" },
                concerns: { type: "markdown", multiple: true },
              },
              required: ["summary"],
              unknownFields: "reject",
            },
            handoff: {
              prompt: {
                template: "Dev handoff: {{transition.parsed.summary}}",
              },
            },
          },
          continueEditing: {
            targetState: "devImplementing",
            result: {
              fields: { reason: { type: "markdown" } },
              required: ["reason"],
            },
          },
        },
      },
      reviewing: {
        owner: "review",
        steps: [
          {
            id: "reviewDecision",
            type: "agent_turn",
            turnType: "decision",
            prompt: { template: "Review handoff {{transition.handoffText}}" },
            response: {
              format: "xml",
              schema: { format: "xsd", source: "state_actions" },
              invalidXmlRetry: {
                maxAttempts: 1,
                prompt: "engine_default_with_validation_errors",
                onExhausted: "blocked",
              },
              storeRawXml: true,
              rawXmlMaxChars: 20,
              storeParsedFields: true,
              unknownFields: "reject_unless_allowed_by_result_contract",
            },
          },
        ],
        actions: {
          approved: { targetState: "done" },
          changesRequested: {
            targetState: "devImplementing",
            result: {
              fields: { requiredChanges: { type: "markdown" } },
              required: ["requiredChanges"],
            },
            handoff: {
              prompt: {
                template: "Review says {{transition.parsed.requiredChanges}}",
              },
            },
          },
        },
      },
      done: { terminal: true },
    },
  };
}

function makeHumanFormDefinition(): AgentWorkflowDefinitionV1 {
  return {
    schemaVersion: 1,
    name: "human-form-core",
    roles: { dev: { label: "Dev" } },
    initialState: "approval",
    states: {
      approval: {
        owner: "dev",
        steps: [
          {
            id: "approval",
            type: "human_form",
            title: "Approve plan",
            form: {
              providerType: "beads_form",
              formSchema: { fields: { approved: { required: true } } },
            },
          },
          {
            id: "decide",
            type: "agent_turn",
            turnType: "decision",
            prompt: { template: "Approved: {{human.approval.approved}}" },
            response: decisionPolicy(),
          },
        ],
        actions: { done: { targetState: "done" } },
      },
      done: { terminal: true },
    },
  };
}

function decisionPolicy() {
  return {
    format: "xml" as const,
    schema: { format: "xsd" as const, source: "state_actions" as const },
    invalidXmlRetry: {
      maxAttempts: 1,
      prompt: "engine_default_with_validation_errors" as const,
      onExhausted: "blocked" as const,
    },
    storeRawXml: true,
    rawXmlMaxChars: 20,
    storeParsedFields: true,
    unknownFields: "reject_unless_allowed_by_result_contract" as const,
  };
}

function expectDefinitionError(fn: () => unknown, code: string, path: string) {
  expect(fn).toThrow(WorkflowDefinitionError);
  try {
    fn();
  } catch (error) {
    const issue = (error as WorkflowDefinitionError).issues.find(
      (candidate) => candidate.code === code && candidate.path === path,
    );
    expect(issue).toBeTruthy();
    return;
  }
  throw new Error("Expected WorkflowDefinitionError");
}

function ids(...values: string[]) {
  let index = 0;
  return () => values[index++] ?? `generated_${index}`;
}

function clock(...values: number[]) {
  let index = 0;
  return () => values[index++] ?? values.at(-1) ?? 0;
}

const validator: DecisionResponseValidator = {
  validate({ responseText }) {
    if (responseText === "malformed") {
      return {
        valid: false,
        errors: [
          {
            code: "WORKFLOW_DECISION_VALIDATION_FAILED",
            path: "$",
            message: "Malformed XML",
          },
        ],
      };
    }
    if (responseText === "unknown-action") {
      return {
        valid: true,
        action: "invented",
        rawXml: '<decision action="invented" />',
        parsed: {},
      };
    }
    if (responseText === "missing-required") {
      return {
        valid: true,
        action: "readyForReview",
        rawXml: '<decision action="readyForReview" />',
        parsed: {},
      };
    }
    if (responseText === "same-state") {
      return {
        valid: true,
        action: "continueEditing",
        rawXml:
          '<decision action="continueEditing"><reason>More work</reason></decision>',
        parsed: { reason: "More work" },
      };
    }
    return {
      valid: true,
      action: "readyForReview",
      rawXml:
        '<decision action="readyForReview"><summary>Implemented long summary</summary></decision>',
      parsed: { summary: "Implemented long summary" },
    };
  },
};

describe("agent workflow V1 normalization", () => {
  it("TEST_CASE_M83_1A normalizes map-key IDs without mutating authored JSON and rejects stable invalid paths", () => {
    const definition = makeDefinition();
    const before = structuredClone(definition);

    const model = normalizeWorkflowDefinitionV1(definition, {
      workflowId: "workflow/dev-review",
    });

    expect(definition).toEqual(before);
    expect(model.workflowId).toBe("workflow/dev-review");
    expect(Object.keys(model.roles)).toEqual(["dev", "review"]);
    expect(model.roles.dev).toMatchObject({ id: "dev", label: "Dev" });
    expect(activeNormalizedState(model.states.devImplementing)).toMatchObject({
      id: "devImplementing",
      owner: "dev",
    });
    expect(activeNormalizedState(model.states.devImplementing).terminal).toBe(
      false,
    );
    expect(
      activeNormalizedState(model.states.devImplementing).actions
        .readyForReview,
    ).toMatchObject({
      id: "readyForReview",
      targetState: "reviewing",
    });
    expect(model.states.done).toEqual({
      id: "done",
      terminal: true,
      steps: [],
      actions: {},
    });

    expectDefinitionError(
      () =>
        normalizeWorkflowDefinitionV1({
          ...makeDefinition(),
          initialState: undefined,
        } as unknown),
      "WORKFLOW_CONFIG_REQUIRED_FIELD",
      "initialState",
    );
    expectDefinitionError(
      () =>
        normalizeWorkflowDefinitionV1({
          ...makeDefinition(),
          initialState: "missing",
        }),
      "WORKFLOW_CONFIG_INVALID_REFERENCE",
      "initialState",
    );
    expectDefinitionError(
      () =>
        normalizeWorkflowDefinitionV1({
          ...makeDefinition(),
          states: {
            ...makeDefinition().states,
            devImplementing: {
              ...makeDefinition().states.devImplementing,
              owner: "missing",
            },
          },
        }),
      "WORKFLOW_CONFIG_INVALID_REFERENCE",
      "states.devImplementing.owner",
    );
    expectDefinitionError(
      () => {
        const def = makeDefinition();
        activeAuthoredState(
          def,
          "devImplementing",
        ).actions.readyForReview!.targetState = "missing";
        return normalizeWorkflowDefinitionV1(def);
      },
      "WORKFLOW_CONFIG_INVALID_REFERENCE",
      "states.devImplementing.actions.readyForReview.targetState",
    );
    expectDefinitionError(
      () =>
        normalizeWorkflowDefinitionV1({
          ...makeDefinition(),
          states: {
            ...makeDefinition().states,
            done: { terminal: true, owner: "dev" } as never,
          },
        }),
      "WORKFLOW_CONFIG_INVALID_TERMINAL_STATE",
      "states.done.owner",
    );
    expectDefinitionError(
      () =>
        normalizeWorkflowDefinitionV1({
          ...makeDefinition(),
          surprise: true,
        } as never),
      "WORKFLOW_CONFIG_UNKNOWN_FIELD",
      "surprise",
    );
    expectDefinitionError(
      () =>
        normalizeWorkflowDefinitionV1({
          ...makeDefinition(),
          future: { workflowCall: true },
        } as never),
      "WORKFLOW_CONFIG_UNKNOWN_FIELD",
      "future",
    );
  });

  it("TEST_CASE_SEBL_1A preserves role executor/model preferences and validates shape", () => {
    const definition = makeDefinition();
    definition.roles.dev = {
      ...definition.roles.dev,
      executorPreference: {
        executorType: "CODEX",
        model: "recommended",
        mode: "preferred",
      },
    };

    const model = normalizeWorkflowDefinitionV1(definition);

    expect(model.roles.dev!.executorPreference).toEqual({
      executorType: "CODEX",
      model: "recommended",
      mode: "preferred",
    });
    expect(model.roles.review!.executorPreference).toBeUndefined();

    expectDefinitionError(
      () => {
        const invalid: any = makeDefinition();
        invalid.roles.dev = {
          ...invalid.roles.dev,
          executorPreference: { executorType: "", mode: "hard_required" },
        };
        return normalizeWorkflowDefinitionV1(invalid);
      },
      "WORKFLOW_CONFIG_INVALID_ACTIVE_STATE",
      "roles.dev.executorPreference.executorType",
    );
    expectDefinitionError(
      () => {
        const invalid: any = makeDefinition();
        invalid.roles.dev = {
          ...invalid.roles.dev,
          executorPreference: {
            executorType: "CODEX",
            model: "not-a-known-model",
          },
        };
        return normalizeWorkflowDefinitionV1(invalid);
      },
      "WORKFLOW_CONFIG_INVALID_ACTIVE_STATE",
      "roles.dev.executorPreference.model",
    );
  });

  it("TEST_CASE_ZJCB_9 preserves role template version refs and validates shape", () => {
    const definition = makeDefinition();
    definition.roles.dev = {
      ...definition.roles.dev,
      templateRef: { templateId: "role.dev.implementer", version: 1 },
    };

    const model = normalizeWorkflowDefinitionV1(definition);

    expect(model.roles.dev!.templateRef).toEqual({
      templateId: "role.dev.implementer",
      version: 1,
    });

    expectDefinitionError(
      () => {
        const invalid: any = makeDefinition();
        invalid.roles.dev = {
          ...invalid.roles.dev,
          templateRef: { templateId: "", version: 0 },
        };
        return normalizeWorkflowDefinitionV1(invalid);
      },
      "WORKFLOW_CONFIG_INVALID_ACTIVE_STATE",
      "roles.dev.templateRef.templateId",
    );
  });


  it("TEST_CASE_S7OW_1A renders real XSD for decision response actions and result fields", () => {
    const definition = makeDefinition();
    activeAuthoredState(definition, "devImplementing").actions.continueEditing!.result = {
      fields: { reason: { type: "markdown" } },
      required: ["reason"],
      unknownFields: "preserve",
    };
    const model = normalizeWorkflowDefinitionV1(definition);
    const snapshot = createInitialWorkflowSnapshot(model, {
      instanceId: "instance-xsd",
      inputs: { featureRequest: "Build XSD prompts" },
      now: clock(1_000),
      createId: ids("visit-xsd"),
    });
    const state = activeNormalizedState(model.states.devImplementing);
    const step = state.steps.find((candidate): candidate is AgentWorkflowStepV1 => candidate.type === "agent_turn" && candidate.turnType === "decision")!;
    const spec = renderExpectedXmlResponseSpec(model, snapshot, step);

    expect(spec).toContain("Expected XML Schema (XSD):");
    expect(spec).toContain('<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"');
    expect(spec).toContain('<xs:element name="decision">');
    expect(spec).toContain('<xs:alternative test="@action=&apos;readyForReview&apos;" type="Action1_readyForReviewDecisionType"/>');
    expect(spec).toContain('<xs:alternative test="@action=&apos;continueEditing&apos;" type="Action2_continueEditingDecisionType"/>');
    expect(spec).toContain('<xs:enumeration value="readyForReview"/>');
    expect(spec).toContain('<xs:enumeration value="continueEditing"/>');
    expect(spec).toContain('<xs:element name="summary" type="xs:string" minOccurs="1" maxOccurs="1"/>');
    expect(spec).toContain('<xs:element name="concerns" type="xs:string" minOccurs="0" maxOccurs="unbounded"/>');
    expect(spec).toContain('<xs:openContent mode="interleave">');
    expect(spec).not.toContain("Allowed action names and result fields");
    expect(spec).not.toContain("- Root tag");
  });

  it("TEST_CASE_Z7R1_1A renders beads-form provider XML schema for formSchema result fields", () => {
    const definition = makeDefinition();
    activeAuthoredState(definition, "devImplementing").actions.readyForReview!.result = {
      fields: {
        formSchema: { type: "markdown" },
        summary: { type: "markdown" },
      },
      required: ["formSchema"],
      unknownFields: "reject",
    };
    const model = normalizeWorkflowDefinitionV1(definition);
    const snapshot = createInitialWorkflowSnapshot(model, {
      instanceId: "instance-form-xsd",
      inputs: { featureRequest: "Build form XML" },
      now: clock(1_000),
      createId: ids("visit-form-xsd"),
    });
    const state = activeNormalizedState(model.states.devImplementing);
    const step = state.steps.find((candidate): candidate is AgentWorkflowStepV1 => candidate.type === "agent_turn" && candidate.turnType === "decision")!;
    const spec = renderExpectedXmlResponseSpec(model, snapshot, step);

    expect(spec).toContain('<xs:element name="formSchema" minOccurs="1" maxOccurs="1">');
    expect(spec).toContain('<xs:element name="beadsForm" type="BeadsFormType" minOccurs="1" maxOccurs="1"/>');
    expect(spec).toContain('<xs:complexType name="BeadsFormType">');
    expect(spec).toContain('<xs:element name="question" type="BeadsFormQuestionType" minOccurs="1" maxOccurs="unbounded"/>');
    expect(spec).toContain('<xs:element name="pros" type="xs:string" minOccurs="0" maxOccurs="1"/>');
    expect(spec).toContain('<xs:element name="cons" type="xs:string" minOccurs="0" maxOccurs="1"/>');
    expect(spec).toContain('<xs:element name="recommendedReason" type="xs:string" minOccurs="0" maxOccurs="1"/>');
    expect(spec).toContain('<xs:attribute name="id" type="BeadsFormIdentifier" use="required"/>');
    expect(spec).toContain('<xs:pattern value="[A-Za-z][A-Za-z0-9_-]*"/>');
    expect(spec).toContain('<xs:enumeration value="choices"/>');
    expect(spec).not.toContain('<xs:element name="formSchema" type="xs:string"');
  });


  it("TEST_CASE_9NL3_1A renders beads-form provider XML schema for generic action result fields", () => {
    const definition = makeDefinition();
    activeAuthoredState(definition, "devImplementing").actions.readyForReview!.result = {
      fields: {
        summary: { type: "markdown" },
        requestedChangesForm: {
          type: "markdown",
          provider: "beads_form",
          providerSchema: "requested_changes_form",
          description: "Each requested change is a choices question; each solution choice description includes Markdown Pros and Cons sections.",
        },
      },
      required: ["summary", "requestedChangesForm"],
      unknownFields: "reject",
    };
    const model = normalizeWorkflowDefinitionV1(definition);
    const snapshot = createInitialWorkflowSnapshot(model, {
      instanceId: "instance-requested-changes-form-xsd",
      inputs: { featureRequest: "Build form XML" },
      now: clock(1_000),
      createId: ids("visit-requested-changes-form-xsd"),
    });
    const state = activeNormalizedState(model.states.devImplementing);
    const step = state.steps.find((candidate): candidate is AgentWorkflowStepV1 => candidate.type === "agent_turn" && candidate.turnType === "decision")!;
    const spec = renderExpectedXmlResponseSpec(model, snapshot, step);

    expect(spec).toContain('<xs:element name="requestedChangesForm" minOccurs="1" maxOccurs="1">');
    expect(spec).toContain("Each requested change is a choices question");
    expect(spec).toContain('<xs:element name="beadsForm" type="BeadsFormRequestedChangesType" minOccurs="1" maxOccurs="1"/>');
    expect(spec).toContain('<xs:complexType name="BeadsFormRequestedChangesType">');
    expect(spec).toContain('<xs:attribute name="type" use="required" fixed="choices"/>');
    expect(spec).not.toContain('<xs:element name="requestedChangesForm" type="xs:string"');
  });

  it("TEST_CASE_S7OW_1B rejects XML-unsafe response identifiers before XSD generation", () => {
    expectDefinitionError(
      () => {
        const invalid = makeDefinition();
        activeAuthoredState(invalid, "devImplementing").actions["bad action"] = {
          targetState: "reviewing",
        };
        return normalizeWorkflowDefinitionV1(invalid);
      },
      "WORKFLOW_CONFIG_INVALID_ACTIVE_STATE",
      "states.devImplementing.actions.bad action",
    );

    expectDefinitionError(
      () => {
        const invalid = makeDefinition();
        activeAuthoredState(invalid, "devImplementing").actions.readyForReview!.result = {
          fields: { "bad field": { type: "markdown" } },
          required: ["bad field"],
          unknownFields: "reject",
        };
        return normalizeWorkflowDefinitionV1(invalid);
      },
      "WORKFLOW_CONFIG_INVALID_ACTIVE_STATE",
      "states.devImplementing.actions.readyForReview.result.fields.bad field",
    );

    expectDefinitionError(
      () => {
        const invalid = makeDefinition();
        activeAuthoredState(invalid, "devImplementing").actions.readyForReview!.waitFor = {
          provider: "github_ci",
          runIdField: "ci:run",
        };
        return normalizeWorkflowDefinitionV1(invalid);
      },
      "WORKFLOW_CONFIG_INVALID_ACTIVE_STATE",
      "states.devImplementing.actions.readyForReview.waitFor.runIdField",
    );
  });


  it("TEST_CASE_M99_1A normalizes and advances blocking workflow_call steps", () => {
    const def = makeDefinition();
    activeAuthoredState(def, "devImplementing").steps = [
      {
        id: "call_child",
        type: "workflow_call",
        mode: "blocking",
        workflow: { designId: "child.design", version: 2 },
        args: {
          featureRequest: "{{inputs.featureRequest}}",
          nested: { handoff: "{{transition.handoffText}}" },
        },
      },
      activeAuthoredState(def, "devImplementing").steps[1]!,
    ];
    const model = normalizeWorkflowDefinitionV1(def);
    const initial = createInitialWorkflowSnapshot(model, {
      instanceId: "parent-run",
      inputs: { featureRequest: "Build child" },
      now: clock(1_000),
      createId: ids("visit-parent"),
    });

    const planned = planNextWorkflowEffect(model, initial, {
      now: clock(2_000),
      createId: ids("call-turn"),
      validator,
    });

    expect(planned.effect).toMatchObject({
      kind: "start_workflow_call",
      stepId: "call_child",
      turnId: "call-turn",
      childRunId: "parent-run-call-turn",
      workflow: { designId: "child.design", version: 2 },
      args: { featureRequest: "Build child", nested: { handoff: "" } },
    });

    const staleChild = advanceWorkflow(
      model,
      planned.snapshot,
      {
        kind: "workflow_call_completed",
        turnId: "call-turn",
        childRunId: "wrong-child-run",
        responseRef: "wrong-child-run",
        childStatus: "completed",
        outputRef: "workflow-run://wrong-child-run/output",
      },
      {
        now: clock(2_500),
        createId: ids("ignored-call"),
        validator,
      },
    );
    expect(staleChild).toMatchObject({
      effect: { kind: "none" },
      ignored: {
        code: "WORKFLOW_STALE_OBSERVATION",
        path: "observation.childRunId",
      },
    });
    expect(staleChild.snapshot).toBe(planned.snapshot);

    const advanced = advanceWorkflow(
      model,
      planned.snapshot,
      {
        kind: "workflow_call_completed",
        turnId: "call-turn",
        childRunId: "parent-run-call-turn",
        responseRef: "parent-run-call-turn",
        childStatus: "completed",
        outputRef: "workflow-run://parent-run-call-turn/output",
      },
      {
        now: clock(3_000),
        createId: ids("after-call"),
        validator,
      },
    );

    expect(advanced.effect).toMatchObject({
      kind: "send_agent_turn",
      stepId: "selfReview",
    });
    expect(
      advanced.effect.kind === "send_agent_turn" ? advanced.effect.prompt : "",
    ).toContain("Choose next action");
    expect(
      advanced.effect.kind === "send_agent_turn" ? advanced.effect.prompt : "",
    ).toContain("Expected XML Schema (XSD):");
    expect(
      advanced.effect.kind === "send_agent_turn" ? advanced.effect.prompt : "",
    ).toContain('fixed="readyForReview"');
    expect(advanced.snapshot.history).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "workflow_call_completed",
          childRunId: "parent-run-call-turn",
          outputRef: "workflow-run://parent-run-call-turn/output",
        }),
      ]),
    );

    expectDefinitionError(
      () => {
        const invalid = makeDefinition();
        activeAuthoredState(invalid, "devImplementing").steps = [
          {
            id: "call_child",
            type: "workflow_call",
            mode: "fire_and_forget",
            workflow: { designId: "child.design" },
          } as never,
          activeAuthoredState(invalid, "devImplementing").steps[1]!,
        ];
        return normalizeWorkflowDefinitionV1(invalid);
      },
      "WORKFLOW_CONFIG_INVALID_STEP",
      "states.devImplementing.steps.0.mode",
    );
  });

  it("TEST_CASE_M96_1A plans and resumes human_form steps before the final decision turn", () => {
    const model = normalizeWorkflowDefinitionV1(makeHumanFormDefinition());
    const snapshot = createInitialWorkflowSnapshot(model, {
      instanceId: "instance_human",
      inputs: {},
      now: clock(1_000),
      createId: ids("id-1"),
    });
    const planned = planNextWorkflowEffect(model, snapshot, {
      now: clock(2_000),
      createId: ids("turn-1"),
      validator,
    });
    expect(planned.effect).toMatchObject({
      kind: "create_human_form",
      stepId: "approval",
      title: "Approve plan",
    });

    const advanced = advanceWorkflow(
      model,
      planned.snapshot,
      {
        kind: "human_form_completed",
        turnId:
          planned.effect.kind === "create_human_form"
            ? planned.effect.turnId
            : "missing",
        responseRef: "attention-1",
        submission: { approved: true },
      },
      {
        now: clock(3_000),
        createId: ids("after-1"),
        validator,
      },
    );

    expect(advanced.effect).toMatchObject({
      kind: "send_agent_turn",
      stepId: "decide",
    });
    expect(
      advanced.effect.kind === "send_agent_turn" && advanced.effect.prompt,
    ).toEqual(expect.stringContaining("Approved: true"));
    expect(
      advanced.effect.kind === "send_agent_turn" && advanced.effect.prompt,
    ).toEqual(expect.stringContaining("Expected XML Schema (XSD):"));
    expect(
      advanced.effect.kind === "send_agent_turn" && advanced.effect.prompt,
    ).toEqual(expect.stringContaining('fixed="done"'));
    expect(advanced.snapshot.history).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "human_form_completed",
          submission: { approved: true },
        }),
      ]),
    );
  });

  it("TEST_CASE_M111_1A-D waits for GitHub CI after an enabled action and resumes idempotently", () => {
    const def = makeDefinition();
    activeAuthoredState(def, "devImplementing").steps = [
      activeAuthoredState(def, "devImplementing").steps[1]!,
    ];
    activeAuthoredState(def, "devImplementing").actions.readyForReview = {
      label: "Wait for CI",
      targetState: "reviewing",
      result: {
        fields: {
          summary: { type: "markdown" },
          ciRunId: { type: "string" },
          repo: { type: "string" },
        },
        required: ["summary", "ciRunId"],
      },
      waitFor: {
        provider: "github_ci",
        runIdField: "ciRunId",
        repoField: "repo",
      },
    };
    const model = normalizeWorkflowDefinitionV1(def);
    const initial = createInitialWorkflowSnapshot(model, {
      instanceId: "ci-run",
      inputs: {},
      now: clock(1_000),
      createId: ids("visit-ci"),
    });
    const plannedAgent = planNextWorkflowEffect(model, initial, {
      now: clock(2_000),
      createId: ids("agent-turn"),
      validator,
    });
    const waitingForCi = advanceWorkflow(
      model,
      plannedAgent.snapshot,
      {
        kind: "agent_turn_completed",
        turnId: "agent-turn",
        responseRef: "response-ci-request",
        finalResponseText: "ci",
      },
      {
        now: clock(3_000),
        createId: ids("ci-watch-turn"),
        validator: {
          validate: () => ({
            valid: true,
            action: "readyForReview",
            rawXml:
              '<decision action="readyForReview"><summary>Pushed</summary><ciRunId>12345</ciRunId><repo>acme/repo</repo></decision>',
            parsed: { summary: "Pushed", ciRunId: "12345", repo: "acme/repo" },
          }),
        },
      },
    );

    expect(waitingForCi.effect).toMatchObject({
      kind: "start_github_ci_watch",
      turnId: "ci-watch-turn",
      ciRunId: "12345",
      repo: "acme/repo",
    });
    expect(waitingForCi.snapshot.waitingFor).toMatchObject({
      kind: "github_ci",
      turnId: "ci-watch-turn",
      action: "readyForReview",
    });
    expect(waitingForCi.snapshot.currentState).toBe("devImplementing");

    const stale = advanceWorkflow(
      model,
      waitingForCi.snapshot,
      {
        kind: "github_ci_completed",
        turnId: "wrong-watch",
        responseRef: "github-ci:wrong",
        status: "success",
      },
      {
        now: clock(3_500),
        createId: ids("unused"),
        validator,
      },
    );
    expect(stale).toMatchObject({
      effect: { kind: "none" },
      ignored: { code: "WORKFLOW_STALE_OBSERVATION" },
    });
    expect(stale.snapshot).toBe(waitingForCi.snapshot);

    const completed = advanceWorkflow(
      model,
      waitingForCi.snapshot,
      {
        kind: "github_ci_completed",
        turnId: "ci-watch-turn",
        responseRef: "github-ci:ci-watch-turn",
        status: "success",
        statusSummary: "All checks passed",
        detailsUrl: "https://github.example/checks/12345",
      },
      {
        now: clock(4_000),
        createId: ids("review-visit", "review-turn"),
        validator,
      },
    );
    expect(completed.snapshot.currentState).toBe("reviewing");
    expect(completed.effect).toMatchObject({
      kind: "send_agent_turn",
      role: "review",
    });
    expect(completed.snapshot.history).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "github_ci_wait_completed",
          status: "success",
          statusSummary: "All checks passed",
        }),
      ]),
    );
  });

  it("TEST_CASE_M111_1C blocks when GitHub CI fails", () => {
    const def = makeDefinition();
    activeAuthoredState(def, "devImplementing").steps = [
      activeAuthoredState(def, "devImplementing").steps[1]!,
    ];
    activeAuthoredState(def, "devImplementing").actions.readyForReview = {
      targetState: "reviewing",
      result: {
        fields: { ciRunId: { type: "string" } },
        required: ["ciRunId"],
      },
      waitFor: { provider: "github_ci" },
    };
    const model = normalizeWorkflowDefinitionV1(def);
    const initial = createInitialWorkflowSnapshot(model, {
      instanceId: "ci-fail",
      inputs: {},
      now: clock(1),
      createId: ids("visit"),
    });
    const plannedAgent = planNextWorkflowEffect(model, initial, {
      now: clock(2),
      createId: ids("agent"),
      validator,
    });
    const waitingForCi = advanceWorkflow(
      model,
      plannedAgent.snapshot,
      {
        kind: "agent_turn_completed",
        turnId: "agent",
        responseRef: "response-ci",
        finalResponseText: "ci",
      },
      {
        now: clock(3),
        createId: ids("ci-turn"),
        validator: {
          validate: () => ({
            valid: true,
            action: "readyForReview",
            parsed: { ciRunId: "9" },
          }),
        },
      },
    );
    const failed = advanceWorkflow(
      model,
      waitingForCi.snapshot,
      {
        kind: "github_ci_completed",
        turnId: "ci-turn",
        responseRef: "github-ci:ci-turn",
        status: "failure",
        statusSummary: "Unit tests failed",
      },
      {
        now: clock(4),
        createId: ids("unused"),
        validator,
      },
    );
    expect(failed.snapshot.status).toBe("blocked");
    expect(failed.snapshot.blockedReason).toMatchObject({
      code: "WORKFLOW_GITHUB_CI_FAILED",
      message: "GitHub CI failure: Unit tests failed",
    });
  });

  it("TEST_CASE_M83_1B enforces strict active-state decision invariants", () => {
    const invalidState = (state: unknown, path: string) => {
      expectDefinitionError(
        () =>
          normalizeWorkflowDefinitionV1({
            ...makeDefinition(),
            states: {
              ...makeDefinition().states,
              devImplementing: state as never,
            },
          }),
        "WORKFLOW_CONFIG_INVALID_ACTIVE_STATE",
        path,
      );
    };

    const validState = activeAuthoredState(makeDefinition(), "devImplementing");
    invalidState(
      { ...validState, owner: undefined },
      "states.devImplementing.owner",
    );
    invalidState({ ...validState, steps: [] }, "states.devImplementing.steps");
    invalidState(
      { ...validState, actions: {} },
      "states.devImplementing.actions",
    );
    invalidState(
      { ...validState, steps: [validState.steps[0]] },
      "states.devImplementing.steps",
    );
    invalidState(
      { ...validState, steps: [validState.steps[1], validState.steps[0]] },
      "states.devImplementing.steps.0",
    );
    invalidState(
      {
        ...validState,
        steps: [
          validState.steps[1],
          { ...validState.steps[1], id: "secondDecision" },
        ],
      },
      "states.devImplementing.steps",
    );

    const model = normalizeWorkflowDefinitionV1(makeDefinition());
    expect(
      activeNormalizedState(model.states.devImplementing)
        .steps.filter((step) => step.type === "agent_turn")
        .map((step) => step.turnType),
    ).toEqual(["non_decision", "decision"]);
  });

  it("rejects invalid V1 decision response and result policy values with stable paths", () => {
    const invalidDecisionPolicy = (
      mutate: (def: AgentWorkflowDefinitionV1) => void,
      path: string,
    ) => {
      expectDefinitionError(
        () => {
          const def = makeDefinition();
          mutate(def);
          return normalizeWorkflowDefinitionV1(def);
        },
        "WORKFLOW_CONFIG_INVALID_STEP",
        path,
      );
    };
    invalidDecisionPolicy((def) => {
      decisionResponse(def).schema.format = "json" as never;
    }, "states.devImplementing.steps.1.response.schema.format");
    invalidDecisionPolicy((def) => {
      decisionResponse(def).schema.source = "current_state_actions" as never;
    }, "states.devImplementing.steps.1.response.schema.source");
    invalidDecisionPolicy((def) => {
      decisionResponse(def).invalidXmlRetry.maxAttempts = -1;
    }, "states.devImplementing.steps.1.response.invalidXmlRetry.maxAttempts");
    invalidDecisionPolicy((def) => {
      decisionResponse(def).invalidXmlRetry.prompt = "custom" as never;
    }, "states.devImplementing.steps.1.response.invalidXmlRetry.prompt");
    invalidDecisionPolicy((def) => {
      decisionResponse(def).invalidXmlRetry.onExhausted = "failed" as never;
    }, "states.devImplementing.steps.1.response.invalidXmlRetry.onExhausted");
    invalidDecisionPolicy((def) => {
      decisionResponse(def).storeRawXml = "yes" as never;
    }, "states.devImplementing.steps.1.response.storeRawXml");
    invalidDecisionPolicy((def) => {
      decisionResponse(def).storeParsedFields = "yes" as never;
    }, "states.devImplementing.steps.1.response.storeParsedFields");
    invalidDecisionPolicy((def) => {
      decisionResponse(def).unknownFields = "preserve" as never;
    }, "states.devImplementing.steps.1.response.unknownFields");

    const invalidResultPolicy = (
      mutate: (
        result: NonNullable<
          ReturnType<typeof activeAuthoredState>["actions"]["readyForReview"]
        >["result"],
      ) => void,
      code: string,
      path: string,
    ) => {
      expectDefinitionError(
        () => {
          const def = makeDefinition();
          const result = activeAuthoredState(def, "devImplementing").actions
            .readyForReview!.result;
          mutate(result);
          return normalizeWorkflowDefinitionV1(def);
        },
        code,
        path,
      );
    };
    invalidResultPolicy(
      (result) => {
        result!.unknownFields = "keep" as never;
      },
      "WORKFLOW_CONFIG_INVALID_ACTIVE_STATE",
      "states.devImplementing.actions.readyForReview.result.unknownFields",
    );
    invalidResultPolicy(
      (result) => {
        result!.fields.summary!.type = "object" as never;
      },
      "WORKFLOW_CONFIG_INVALID_ACTIVE_STATE",
      "states.devImplementing.actions.readyForReview.result.fields.summary.type",
    );
    invalidResultPolicy(
      (result) => {
        result!.fields.summary!.multiple = "yes" as never;
      },
      "WORKFLOW_CONFIG_INVALID_ACTIVE_STATE",
      "states.devImplementing.actions.readyForReview.result.fields.summary.multiple",
    );
    invalidResultPolicy(
      (result) => {
        result!.required = ["missing"];
      },
      "WORKFLOW_CONFIG_INVALID_REFERENCE",
      "states.devImplementing.actions.readyForReview.result.required.0",
    );
  });
});

describe("agent workflow V1 advancement", () => {
  it("TEST_CASE_M83_2A advances non-decision and decision turns deterministically, including same-state loops", () => {
    const model = normalizeWorkflowDefinitionV1(makeDefinition(), {
      workflowId: "workflow/dev-review",
    });
    const initial = createInitialWorkflowSnapshot(model, {
      instanceId: "instance_1",
      inputs: { featureRequest: "Build feature" },
      now: clock(1000),
      createId: ids("visit_1"),
    });

    const firstPlan = planNextWorkflowEffect(model, initial, {
      now: clock(1001),
      createId: ids("turn_1"),
    });

    expect(firstPlan.effect).toMatchObject({
      kind: "send_agent_turn",
      role: "dev",
      state: "devImplementing",
      stepId: "implement",
      turnId: "turn_1",
      prompt: "Implement Build feature ",
    });
    expect(firstPlan.snapshot.waitingFor?.turnId).toBe("turn_1");

    const afterNonDecision = advanceWorkflow(
      model,
      firstPlan.snapshot,
      {
        kind: "agent_turn_completed",
        turnId: "turn_1",
        responseRef: "response_1",
      },
      { now: clock(1002), createId: ids("turn_2"), validator },
    );

    expect(afterNonDecision.effect).toMatchObject({
      kind: "send_agent_turn",
      stepId: "selfReview",
      turnId: "turn_2",
    });
    expect(
      afterNonDecision.effect.kind === "send_agent_turn" &&
        afterNonDecision.effect.prompt,
    ).toEqual(expect.stringContaining("Expected XML Schema (XSD):"));
    expect(
      afterNonDecision.effect.kind === "send_agent_turn" &&
        afterNonDecision.effect.prompt,
    ).toEqual(expect.stringContaining('fixed="readyForReview"'));
    expect(
      afterNonDecision.effect.kind === "send_agent_turn" &&
        afterNonDecision.effect.prompt,
    ).toEqual(expect.stringContaining('<xs:element name="summary" type="xs:string" minOccurs="1" maxOccurs="1"/>'));
    expect(afterNonDecision.snapshot.currentStepIndex).toBe(1);
    expect(afterNonDecision.snapshot.history).toContainEqual(
      expect.objectContaining({
        kind: "agent_turn_completed",
        responseRef: "response_1",
      }),
    );

    const afterDecision = advanceWorkflow(
      model,
      afterNonDecision.snapshot,
      {
        kind: "agent_turn_completed",
        turnId: "turn_2",
        responseRef: "response_2",
        finalResponseText: "ready",
      },
      { now: clock(1003), createId: ids("visit_2", "turn_3"), validator },
    );

    expect(afterDecision.snapshot.currentState).toBe("reviewing");
    expect(afterDecision.snapshot.visitId).toBe("visit_2");
    expect(afterDecision.snapshot.latestTransition).toMatchObject({
      visitId: "visit_1",
      fromState: "devImplementing",
      toState: "reviewing",
      action: "readyForReview",
      responseRef: "response_2",
      parsed: { summary: "Implemented long summary" },
      rawXmlTruncated: true,
      rawXmlOriginalChars: 88,
      rawXml: '<decision action="re',
      handoffText: "Dev handoff: Implemented long summary",
    });
    expect(afterDecision.effect).toMatchObject({
      kind: "send_agent_turn",
      role: "review",
      stepId: "reviewDecision",
    });
    expect(
      afterDecision.effect.kind === "send_agent_turn" &&
        afterDecision.effect.prompt,
    ).toEqual(
      expect.stringContaining(
        "Review handoff Dev handoff: Implemented long summary",
      ),
    );
    expect(
      afterDecision.effect.kind === "send_agent_turn" &&
        afterDecision.effect.prompt,
    ).toEqual(expect.stringContaining("Expected XML Schema (XSD):"));
    expect(
      afterDecision.effect.kind === "send_agent_turn" &&
        afterDecision.effect.prompt,
    ).toEqual(expect.stringContaining('fixed="changesRequested"'));
    expect(
      afterDecision.effect.kind === "send_agent_turn" &&
        afterDecision.effect.prompt,
    ).toEqual(expect.stringContaining('<xs:element name="requiredChanges" type="xs:string" minOccurs="1" maxOccurs="1"/>'));

    const stale = advanceWorkflow(
      model,
      afterDecision.snapshot,
      {
        kind: "agent_turn_completed",
        turnId: "old_turn",
        responseRef: "response_old",
      },
      { now: clock(1004), createId: ids("unused"), validator },
    );
    expect(stale.effect).toEqual({ kind: "none" });
    expect(stale.snapshot).toEqual(afterDecision.snapshot);
    expect(stale.ignored).toMatchObject({ code: "WORKFLOW_STALE_OBSERVATION" });

    const loopStart = createInitialWorkflowSnapshot(model, {
      instanceId: "loop_1",
      inputs: { featureRequest: "Loop feature" },
      now: clock(2000),
      createId: ids("loop_visit_1"),
    });
    const loopFirst = planNextWorkflowEffect(model, loopStart, {
      now: clock(2001),
      createId: ids("loop_turn_1"),
    });
    const loopDecisionPlan = advanceWorkflow(
      model,
      loopFirst.snapshot,
      {
        kind: "agent_turn_completed",
        turnId: "loop_turn_1",
        responseRef: "loop_response_1",
      },
      { now: clock(2002), createId: ids("loop_turn_2"), validator },
    );
    const looped = advanceWorkflow(
      model,
      loopDecisionPlan.snapshot,
      {
        kind: "agent_turn_completed",
        turnId: "loop_turn_2",
        responseRef: "loop_response_2",
        finalResponseText: "same-state",
      },
      {
        now: clock(2003),
        createId: ids("loop_visit_2", "loop_turn_3"),
        validator,
      },
    );

    expect(looped.snapshot.currentState).toBe("devImplementing");
    expect(looped.snapshot.visitId).toBe("loop_visit_2");
    expect(looped.snapshot.latestTransition?.visitId).toBe("loop_visit_1");
    expect(looped.effect).toMatchObject({
      stepId: "implement",
      turnId: "loop_turn_3",
    });

    const terminal: WorkflowRuntimeSnapshot = {
      ...afterDecision.snapshot,
      status: "completed",
    };
    expect(
      planNextWorkflowEffect(model, terminal, {
        now: clock(1),
        createId: ids("unused"),
      }),
    ).toEqual({
      snapshot: terminal,
      effect: { kind: "none" },
    });
  });

  it("TEST_CASE_M83_2B retries invalid decision XML then blocks with needs-attention status", () => {
    const model = normalizeWorkflowDefinitionV1(makeDefinition());
    const initial = createInitialWorkflowSnapshot(model, {
      instanceId: "instance_retry",
      inputs: { featureRequest: "Build feature" },
      now: clock(3000),
      createId: ids("visit_retry"),
    });
    const firstPlan = planNextWorkflowEffect(model, initial, {
      now: clock(3001),
      createId: ids("retry_turn_1"),
    });
    const decisionPlan = advanceWorkflow(
      model,
      firstPlan.snapshot,
      {
        kind: "agent_turn_completed",
        turnId: "retry_turn_1",
        responseRef: "retry_response_1",
      },
      { now: clock(3002), createId: ids("retry_turn_2"), validator },
    );

    const firstInvalid = advanceWorkflow(
      model,
      decisionPlan.snapshot,
      {
        kind: "agent_turn_completed",
        turnId: "retry_turn_2",
        responseRef: "retry_response_2",
        finalResponseText: "malformed",
      },
      { now: clock(3003), createId: ids("retry_turn_3"), validator },
    );
    expect(firstInvalid.snapshot.status).toBe("running");
    expect(firstInvalid.snapshot.currentState).toBe("devImplementing");
    expect(firstInvalid.snapshot.currentStepIndex).toBe(1);
    expect(firstInvalid.effect).toMatchObject({
      kind: "send_agent_turn",
      role: "dev",
      stepId: "selfReview",
      turnId: "retry_turn_3",
    });
    expect(
      firstInvalid.effect.kind === "send_agent_turn" &&
        firstInvalid.effect.prompt,
    ).toContain("Malformed XML");
    expect(
      firstInvalid.effect.kind === "send_agent_turn" &&
        firstInvalid.effect.prompt,
    ).toContain("Expected XML Schema (XSD):");
    expect(
      firstInvalid.effect.kind === "send_agent_turn" &&
        firstInvalid.effect.prompt,
    ).toContain('fixed="continueEditing"');

    const secondInvalid = advanceWorkflow(
      model,
      firstInvalid.snapshot,
      {
        kind: "agent_turn_completed",
        turnId: "retry_turn_3",
        responseRef: "retry_response_3",
        finalResponseText: "malformed",
      },
      { now: clock(3004), createId: ids("retry_turn_4"), validator },
    );
    expect(secondInvalid.snapshot.status).toBe("running");
    expect(secondInvalid.effect).toMatchObject({
      kind: "send_agent_turn",
      turnId: "retry_turn_4",
    });

    const exhausted = advanceWorkflow(
      model,
      secondInvalid.snapshot,
      {
        kind: "agent_turn_completed",
        turnId: "retry_turn_4",
        responseRef: "retry_response_4",
        finalResponseText: "malformed",
      },
      { now: clock(3005), createId: ids("unused"), validator },
    );
    expect(exhausted.snapshot.status).toBe("blocked");
    expect(exhausted.effect).toEqual({ kind: "none" });
    expect(exhausted.snapshot.blockedReason).toMatchObject({
      code: "WORKFLOW_DECISION_RETRY_EXHAUSTED",
    });
    expect(exhausted.snapshot.latestTransition).toBeUndefined();

    const unknownAction = advanceWorkflow(
      model,
      decisionPlan.snapshot,
      {
        kind: "agent_turn_completed",
        turnId: "retry_turn_2",
        responseRef: "retry_response_unknown",
        finalResponseText: "unknown-action",
      },
      { now: clock(4000), createId: ids("unknown_retry"), validator },
    );
    expect(unknownAction.snapshot.currentState).toBe("devImplementing");
    expect(unknownAction.snapshot.latestTransition).toBeUndefined();
    expect(
      unknownAction.effect.kind === "send_agent_turn" &&
        unknownAction.effect.prompt,
    ).toContain("WORKFLOW_DECISION_UNKNOWN_ACTION");

    const missingRequired = advanceWorkflow(
      model,
      decisionPlan.snapshot,
      {
        kind: "agent_turn_completed",
        turnId: "retry_turn_2",
        responseRef: "retry_response_missing",
        finalResponseText: "missing-required",
      },
      { now: clock(5000), createId: ids("missing_retry"), validator },
    );
    expect(missingRequired.snapshot.currentState).toBe("devImplementing");
    expect(
      missingRequired.effect.kind === "send_agent_turn" &&
        missingRequired.effect.prompt,
    ).toContain("WORKFLOW_DECISION_MISSING_REQUIRED_FIELD");
  });

  it("validates per-action result contracts for absent result, unknown fields, types, and multiple arrays", () => {
    const makeWaitingReviewSnapshot = (
      model: ReturnType<typeof normalizeWorkflowDefinitionV1>,
    ): WorkflowRuntimeSnapshot => ({
      instanceId: "result_contracts",
      workflowId: model.workflowId,
      status: "running",
      currentState: "reviewing",
      currentStepIndex: 0,
      visitId: "review_visit",
      inputs: {},
      waitingFor: {
        kind: "agent_turn",
        state: "reviewing",
        stepId: "reviewDecision",
        turnId: "review_turn",
      },
      history: [],
      createdAt: 1,
      updatedAt: 1,
    });

    const baseModel = normalizeWorkflowDefinitionV1(makeDefinition());
    const extraWithoutResult = advanceWorkflow(
      baseModel,
      makeWaitingReviewSnapshot(baseModel),
      {
        kind: "agent_turn_completed",
        turnId: "review_turn",
        responseRef: "response_extra",
        finalResponseText: "extra",
      },
      {
        now: clock(10),
        createId: ids("retry_extra"),
        validator: {
          validate: () => ({
            valid: true,
            action: "approved",
            parsed: { extra: "not declared" },
          }),
        },
      },
    );
    expect(
      extraWithoutResult.effect.kind === "send_agent_turn" &&
        extraWithoutResult.effect.prompt,
    ).toContain("WORKFLOW_DECISION_UNKNOWN_FIELD");

    const rejectKnownResultModel =
      normalizeWorkflowDefinitionV1(makeDefinition());
    const extraWithRejectResult = advanceWorkflow(
      rejectKnownResultModel,
      {
        ...makeWaitingReviewSnapshot(rejectKnownResultModel),
        currentState: "devImplementing",
        currentStepIndex: 1,
        waitingFor: {
          kind: "agent_turn",
          state: "devImplementing",
          stepId: "selfReview",
          turnId: "self_review_turn",
        },
      },
      {
        kind: "agent_turn_completed",
        turnId: "self_review_turn",
        responseRef: "response_extra_known_result",
        finalResponseText: "extra-known-result",
      },
      {
        now: clock(15),
        createId: ids("retry_extra_known"),
        validator: {
          validate: () => ({
            valid: true,
            action: "readyForReview",
            parsed: { summary: "ok", extra: "not declared" },
          }),
        },
      },
    );
    expect(
      extraWithRejectResult.effect.kind === "send_agent_turn" &&
        extraWithRejectResult.effect.prompt,
    ).toContain("WORKFLOW_DECISION_UNKNOWN_FIELD");

    const preserveDefinition = makeDefinition();
    activeAuthoredState(
      preserveDefinition,
      "reviewing",
    ).actions.approved!.result = {
      fields: {},
      unknownFields: "preserve",
    };
    const preserveModel = normalizeWorkflowDefinitionV1(preserveDefinition);
    const preserved = advanceWorkflow(
      preserveModel,
      makeWaitingReviewSnapshot(preserveModel),
      {
        kind: "agent_turn_completed",
        turnId: "review_turn",
        responseRef: "response_preserve",
        finalResponseText: "extra",
      },
      {
        now: clock(20),
        createId: ids("unused"),
        validator: {
          validate: () => ({
            valid: true,
            action: "approved",
            parsed: { extra: "preserved" },
          }),
        },
      },
    );
    expect(preserved.snapshot.status).toBe("completed");
    expect(preserved.snapshot.latestTransition?.parsed).toEqual({
      extra: "preserved",
    });

    const typedDefinition = makeDefinition();
    activeAuthoredState(typedDefinition, "reviewing").actions.approved!.result =
      {
        fields: {
          title: { type: "string" },
          notes: { type: "markdown", multiple: true },
          count: { type: "number" },
          ok: { type: "boolean" },
        },
        required: ["title", "notes", "count", "ok"],
      };
    const typedModel = normalizeWorkflowDefinitionV1(typedDefinition);
    const wrongType = advanceWorkflow(
      typedModel,
      makeWaitingReviewSnapshot(typedModel),
      {
        kind: "agent_turn_completed",
        turnId: "review_turn",
        responseRef: "response_wrong_type",
        finalResponseText: "wrong-type",
      },
      {
        now: clock(30),
        createId: ids("retry_type"),
        validator: {
          validate: () => ({
            valid: true,
            action: "approved",
            parsed: { title: "ok", notes: ["a"], count: "1", ok: true },
          }),
        },
      },
    );
    expect(
      wrongType.effect.kind === "send_agent_turn" && wrongType.effect.prompt,
    ).toContain("WORKFLOW_DECISION_FIELD_TYPE_MISMATCH");

    const wrongMultiple = advanceWorkflow(
      typedModel,
      makeWaitingReviewSnapshot(typedModel),
      {
        kind: "agent_turn_completed",
        turnId: "review_turn",
        responseRef: "response_wrong_multiple",
        finalResponseText: "wrong-multiple",
      },
      {
        now: clock(40),
        createId: ids("retry_multiple"),
        validator: {
          validate: () => ({
            valid: true,
            action: "approved",
            parsed: { title: "ok", notes: "not an array", count: 1, ok: true },
          }),
        },
      },
    );
    expect(
      wrongMultiple.effect.kind === "send_agent_turn" &&
        wrongMultiple.effect.prompt,
    ).toContain("WORKFLOW_DECISION_FIELD_TYPE_MISMATCH");

    const validTyped = advanceWorkflow(
      typedModel,
      makeWaitingReviewSnapshot(typedModel),
      {
        kind: "agent_turn_completed",
        turnId: "review_turn",
        responseRef: "response_valid_typed",
        finalResponseText: "valid-typed",
      },
      {
        now: clock(50),
        createId: ids("unused"),
        validator: {
          validate: () => ({
            valid: true,
            action: "approved",
            parsed: { title: "ok", notes: ["a", "b"], count: 1, ok: true },
          }),
        },
      },
    );
    expect(validTyped.snapshot.status).toBe("completed");
  });
});

describe("M117 command workflow steps", () => {
  it("TEST_CASE_M117_1A plans command effects and exposes typed command result context", () => {
    const model = normalizeWorkflowDefinitionV1(makeCommandDefinition(), {
      workflowId: "command-workflow",
    });
    const snapshot = createInitialWorkflowSnapshot(model, {
      instanceId: "run-command",
      inputs: {},
      now: () => 1,
      createId: () => "visit-1",
    });
    const planned = planNextWorkflowEffect(model, snapshot, {
      now: () => 2,
      createId: () => "turn-command",
    });

    expect(planned.effect).toMatchObject({
      kind: "start_command",
      provider: "first_party.command",
      command: "workspace_status",
      args: { includeDiffSummary: true },
    });
    expect(planned.snapshot.waitingFor).toMatchObject({
      kind: "command",
      turnId: "turn-command",
    });

    const advanced = advanceWorkflow(
      model,
      planned.snapshot,
      {
        kind: "command_completed",
        turnId: "turn-command",
        responseRef: "command-result-1",
        provider: "first_party.command",
        command: "workspace_status",
        result: {
          summary: "Workspace clean",
          clean: true,
          changedFiles: 0,
        },
        summary: "Workspace clean",
      },
      { now: () => 3, createId: () => "turn-decision" },
    );

    expect(advanced.effect).toMatchObject({
      kind: "send_agent_turn",
      prompt: expect.stringContaining("Workspace clean"),
    });
    expect(advanced.snapshot.history).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "command_step_completed",
          result: expect.objectContaining({ clean: true }),
        }),
      ]),
    );
  });

  it("TEST_CASE_M117_1B rejects unsafe command config before runtime", () => {
    const definition = makeCommandDefinition();
    const state = activeAuthoredState(definition, "inspect");
    const step = state.steps[0] as any;
    step.policy = {
      access: "shell",
      cwd: { mode: "../../repo" },
      timeoutMs: 999_999,
      output: { combinedMaxChars: 999_999 },
    };

    expectDefinitionError(
      () => normalizeWorkflowDefinitionV1(definition, { workflowId: "bad" }),
      "WORKFLOW_CONFIG_INVALID_STEP",
      "states.inspect.steps.0.policy.access",
    );
  });
});

function makeCommandDefinition(): AgentWorkflowDefinitionV1 {
  return {
    schemaVersion: 1,
    name: "command-core",
    roles: { dev: { label: "Dev" } },
    initialState: "inspect",
    states: {
      inspect: {
        owner: "dev",
        steps: [
          {
            id: "collect_status",
            type: "command",
            provider: "first_party.command",
            command: "workspace_status",
            args: { includeDiffSummary: true },
            policy: {
              access: "read",
              cwd: { mode: "workspace_root" },
              timeoutMs: 10_000,
              output: { combinedMaxChars: 4_096 },
            },
            result: {
              fields: {
                summary: { type: "markdown" },
                clean: { type: "boolean" },
                changedFiles: { type: "number" },
              },
              required: ["summary", "clean"],
              unknownFields: "preserve",
            },
          },
          {
            id: "decide",
            type: "agent_turn",
            turnType: "decision",
            prompt: { template: "Status: {{command.collect_status.summary}}" },
            response: decisionPolicy(),
          },
        ],
        actions: { done: { targetState: "done" } },
      },
      done: { terminal: true },
    },
  } as AgentWorkflowDefinitionV1;
}
