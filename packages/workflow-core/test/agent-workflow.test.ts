import { describe, expect, it } from 'vitest';
import {
  WorkflowDefinitionError,
  advanceWorkflow,
  createInitialWorkflowSnapshot,
  normalizeWorkflowDefinitionV1,
  planNextWorkflowEffect,
  type AgentWorkflowDefinitionV1,
  type DecisionResponseValidator,
  type NormalizedWorkflowState,
  type WorkflowRuntimeSnapshot,
} from '../src/index';


function activeAuthoredState(definition: AgentWorkflowDefinitionV1, stateId: string) {
  const state = definition.states[stateId];
  if (!state || 'terminal' in state) {
    throw new Error(`Expected active authored state ${stateId}`);
  }
  return state;
}

function activeNormalizedState(
  state: NormalizedWorkflowState | undefined,
): Extract<NormalizedWorkflowState, { terminal: false }> {
  if (!state || state.terminal) {
    throw new Error('Expected active normalized state');
  }
  return state;
}

function decisionResponse(definition: AgentWorkflowDefinitionV1, stateId = 'devImplementing') {
  const step = activeAuthoredState(definition, stateId).steps.find(
    (candidate) => candidate.turnType === 'decision',
  );
  if (!step?.response) {
    throw new Error(`Expected decision response policy for ${stateId}`);
  }
  return step.response;
}

function makeDefinition(): AgentWorkflowDefinitionV1 {
  return {
    schemaVersion: 1,
    name: 'dev-review-test-loop',
    inputs: {
      featureRequest: { type: 'markdown', required: true },
    },
    roles: {
      dev: { label: 'Dev', description: 'Implementation role' },
      review: { label: 'Review' },
    },
    initialState: 'devImplementing',
    states: {
      devImplementing: {
        owner: 'dev',
        steps: [
          {
            id: 'implement',
            type: 'agent_turn',
            turnType: 'non_decision',
            prompt: {
              template: 'Implement {{inputs.featureRequest}} {{transition.handoffText}}',
            },
          },
          {
            id: 'selfReview',
            type: 'agent_turn',
            turnType: 'decision',
            prompt: { template: 'Choose next action' },
            response: {
              format: 'xml',
              schema: { format: 'xsd', source: 'state_actions' },
              invalidXmlRetry: {
                maxAttempts: 2,
                prompt: 'engine_default_with_validation_errors',
                onExhausted: 'blocked',
              },
              storeRawXml: true,
              rawXmlMaxChars: 20,
              storeParsedFields: true,
              unknownFields: 'reject_unless_allowed_by_result_contract',
            },
          },
        ],
        actions: {
          readyForReview: {
            label: 'Ready for review',
            targetState: 'reviewing',
            result: {
              fields: {
                summary: { type: 'markdown' },
                concerns: { type: 'markdown', multiple: true },
              },
              required: ['summary'],
              unknownFields: 'reject',
            },
            handoff: {
              prompt: { template: 'Dev handoff: {{transition.parsed.summary}}' },
            },
          },
          continueEditing: {
            targetState: 'devImplementing',
            result: {
              fields: { reason: { type: 'markdown' } },
              required: ['reason'],
            },
          },
        },
      },
      reviewing: {
        owner: 'review',
        steps: [
          {
            id: 'reviewDecision',
            type: 'agent_turn',
            turnType: 'decision',
            prompt: { template: 'Review handoff {{transition.handoffText}}' },
            response: {
              format: 'xml',
              schema: { format: 'xsd', source: 'state_actions' },
              invalidXmlRetry: {
                maxAttempts: 1,
                prompt: 'engine_default_with_validation_errors',
                onExhausted: 'blocked',
              },
              storeRawXml: true,
              rawXmlMaxChars: 20,
              storeParsedFields: true,
              unknownFields: 'reject_unless_allowed_by_result_contract',
            },
          },
        ],
        actions: {
          approved: { targetState: 'done' },
          changesRequested: {
            targetState: 'devImplementing',
            result: {
              fields: { requiredChanges: { type: 'markdown' } },
              required: ['requiredChanges'],
            },
            handoff: { prompt: { template: 'Review says {{transition.parsed.requiredChanges}}' } },
          },
        },
      },
      done: { terminal: true },
    },
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
  throw new Error('Expected WorkflowDefinitionError');
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
    if (responseText === 'malformed') {
      return {
        valid: false,
        errors: [{ code: 'WORKFLOW_DECISION_VALIDATION_FAILED', path: '$', message: 'Malformed XML' }],
      };
    }
    if (responseText === 'unknown-action') {
      return {
        valid: true,
        action: 'invented',
        rawXml: '<decision action="invented" />',
        parsed: {},
      };
    }
    if (responseText === 'missing-required') {
      return {
        valid: true,
        action: 'readyForReview',
        rawXml: '<decision action="readyForReview" />',
        parsed: {},
      };
    }
    if (responseText === 'same-state') {
      return {
        valid: true,
        action: 'continueEditing',
        rawXml: '<decision action="continueEditing"><reason>More work</reason></decision>',
        parsed: { reason: 'More work' },
      };
    }
    return {
      valid: true,
      action: 'readyForReview',
      rawXml: '<decision action="readyForReview"><summary>Implemented long summary</summary></decision>',
      parsed: { summary: 'Implemented long summary' },
    };
  },
};

describe('agent workflow V1 normalization', () => {
  it('TEST_CASE_M83_1A normalizes map-key IDs without mutating authored JSON and rejects stable invalid paths', () => {
    const definition = makeDefinition();
    const before = structuredClone(definition);

    const model = normalizeWorkflowDefinitionV1(definition, { workflowId: 'workflow/dev-review' });

    expect(definition).toEqual(before);
    expect(model.workflowId).toBe('workflow/dev-review');
    expect(Object.keys(model.roles)).toEqual(['dev', 'review']);
    expect(model.roles.dev).toMatchObject({ id: 'dev', label: 'Dev' });
    expect(activeNormalizedState(model.states.devImplementing)).toMatchObject({ id: 'devImplementing', owner: 'dev' });
    expect(activeNormalizedState(model.states.devImplementing).terminal).toBe(false);
    expect(activeNormalizedState(model.states.devImplementing).actions.readyForReview).toMatchObject({
      id: 'readyForReview',
      targetState: 'reviewing',
    });
    expect(model.states.done).toEqual({ id: 'done', terminal: true, steps: [], actions: {} });

    expectDefinitionError(
      () => normalizeWorkflowDefinitionV1({ ...makeDefinition(), initialState: undefined } as unknown),
      'WORKFLOW_CONFIG_REQUIRED_FIELD',
      'initialState',
    );
    expectDefinitionError(
      () => normalizeWorkflowDefinitionV1({ ...makeDefinition(), initialState: 'missing' }),
      'WORKFLOW_CONFIG_INVALID_REFERENCE',
      'initialState',
    );
    expectDefinitionError(
      () =>
        normalizeWorkflowDefinitionV1({
          ...makeDefinition(),
          states: {
            ...makeDefinition().states,
            devImplementing: { ...makeDefinition().states.devImplementing, owner: 'missing' },
          },
        }),
      'WORKFLOW_CONFIG_INVALID_REFERENCE',
      'states.devImplementing.owner',
    );
    expectDefinitionError(
      () => {
        const def = makeDefinition();
        activeAuthoredState(def, 'devImplementing').actions.readyForReview!.targetState = 'missing';
        return normalizeWorkflowDefinitionV1(def);
      },
      'WORKFLOW_CONFIG_INVALID_REFERENCE',
      'states.devImplementing.actions.readyForReview.targetState',
    );
    expectDefinitionError(
      () =>
        normalizeWorkflowDefinitionV1({
          ...makeDefinition(),
          states: { ...makeDefinition().states, done: { terminal: true, owner: 'dev' } as never },
        }),
      'WORKFLOW_CONFIG_INVALID_TERMINAL_STATE',
      'states.done.owner',
    );
    expectDefinitionError(
      () => normalizeWorkflowDefinitionV1({ ...makeDefinition(), surprise: true } as never),
      'WORKFLOW_CONFIG_UNKNOWN_FIELD',
      'surprise',
    );
  });

  it('TEST_CASE_M83_1B enforces strict active-state decision invariants', () => {
    const invalidState = (state: unknown, path: string) => {
      expectDefinitionError(
        () =>
          normalizeWorkflowDefinitionV1({
            ...makeDefinition(),
            states: { ...makeDefinition().states, devImplementing: state as never },
          }),
        'WORKFLOW_CONFIG_INVALID_ACTIVE_STATE',
        path,
      );
    };

    const validState = activeAuthoredState(makeDefinition(), 'devImplementing');
    invalidState({ ...validState, owner: undefined }, 'states.devImplementing.owner');
    invalidState({ ...validState, steps: [] }, 'states.devImplementing.steps');
    invalidState({ ...validState, actions: {} }, 'states.devImplementing.actions');
    invalidState(
      { ...validState, steps: [validState.steps[0]] },
      'states.devImplementing.steps',
    );
    invalidState(
      { ...validState, steps: [validState.steps[1], validState.steps[0]] },
      'states.devImplementing.steps.0',
    );
    invalidState(
      { ...validState, steps: [validState.steps[1], { ...validState.steps[1], id: 'secondDecision' }] },
      'states.devImplementing.steps',
    );

    const model = normalizeWorkflowDefinitionV1(makeDefinition());
    expect(activeNormalizedState(model.states.devImplementing).steps.map((step) => step.turnType)).toEqual([
      'non_decision',
      'decision',
    ]);
  });

  it('rejects invalid V1 decision response and result policy values with stable paths', () => {
    const invalidDecisionPolicy = (mutate: (def: AgentWorkflowDefinitionV1) => void, path: string) => {
      expectDefinitionError(
        () => {
          const def = makeDefinition();
          mutate(def);
          return normalizeWorkflowDefinitionV1(def);
        },
        'WORKFLOW_CONFIG_INVALID_STEP',
        path,
      );
    };
    invalidDecisionPolicy(
      (def) => { decisionResponse(def).schema.format = 'json' as never; },
      'states.devImplementing.steps.1.response.schema.format',
    );
    invalidDecisionPolicy(
      (def) => { decisionResponse(def).schema.source = 'current_state_actions' as never; },
      'states.devImplementing.steps.1.response.schema.source',
    );
    invalidDecisionPolicy(
      (def) => { decisionResponse(def).invalidXmlRetry.maxAttempts = -1; },
      'states.devImplementing.steps.1.response.invalidXmlRetry.maxAttempts',
    );
    invalidDecisionPolicy(
      (def) => { decisionResponse(def).invalidXmlRetry.prompt = 'custom' as never; },
      'states.devImplementing.steps.1.response.invalidXmlRetry.prompt',
    );
    invalidDecisionPolicy(
      (def) => { decisionResponse(def).invalidXmlRetry.onExhausted = 'failed' as never; },
      'states.devImplementing.steps.1.response.invalidXmlRetry.onExhausted',
    );
    invalidDecisionPolicy(
      (def) => { decisionResponse(def).storeRawXml = 'yes' as never; },
      'states.devImplementing.steps.1.response.storeRawXml',
    );
    invalidDecisionPolicy(
      (def) => { decisionResponse(def).storeParsedFields = 'yes' as never; },
      'states.devImplementing.steps.1.response.storeParsedFields',
    );
    invalidDecisionPolicy(
      (def) => { decisionResponse(def).unknownFields = 'preserve' as never; },
      'states.devImplementing.steps.1.response.unknownFields',
    );

    const invalidResultPolicy = (
      mutate: (result: NonNullable<ReturnType<typeof activeAuthoredState>['actions']['readyForReview']>['result']) => void,
      code: string,
      path: string,
    ) => {
      expectDefinitionError(
        () => {
          const def = makeDefinition();
          const result = activeAuthoredState(def, 'devImplementing').actions.readyForReview!.result;
          mutate(result);
          return normalizeWorkflowDefinitionV1(def);
        },
        code,
        path,
      );
    };
    invalidResultPolicy(
      (result) => { result!.unknownFields = 'keep' as never; },
      'WORKFLOW_CONFIG_INVALID_ACTIVE_STATE',
      'states.devImplementing.actions.readyForReview.result.unknownFields',
    );
    invalidResultPolicy(
      (result) => { result!.fields.summary!.type = 'object' as never; },
      'WORKFLOW_CONFIG_INVALID_ACTIVE_STATE',
      'states.devImplementing.actions.readyForReview.result.fields.summary.type',
    );
    invalidResultPolicy(
      (result) => { result!.fields.summary!.multiple = 'yes' as never; },
      'WORKFLOW_CONFIG_INVALID_ACTIVE_STATE',
      'states.devImplementing.actions.readyForReview.result.fields.summary.multiple',
    );
    invalidResultPolicy(
      (result) => { result!.required = ['missing']; },
      'WORKFLOW_CONFIG_INVALID_REFERENCE',
      'states.devImplementing.actions.readyForReview.result.required.0',
    );
  });
});

describe('agent workflow V1 advancement', () => {
  it('TEST_CASE_M83_2A advances non-decision and decision turns deterministically, including same-state loops', () => {
    const model = normalizeWorkflowDefinitionV1(makeDefinition(), { workflowId: 'workflow/dev-review' });
    const initial = createInitialWorkflowSnapshot(model, {
      instanceId: 'instance_1',
      inputs: { featureRequest: 'Build feature' },
      now: clock(1000),
      createId: ids('visit_1'),
    });

    const firstPlan = planNextWorkflowEffect(model, initial, {
      now: clock(1001),
      createId: ids('turn_1'),
    });

    expect(firstPlan.effect).toMatchObject({
      kind: 'send_agent_turn',
      role: 'dev',
      state: 'devImplementing',
      stepId: 'implement',
      turnId: 'turn_1',
      prompt: 'Implement Build feature ',
    });
    expect(firstPlan.snapshot.waitingFor?.turnId).toBe('turn_1');

    const afterNonDecision = advanceWorkflow(
      model,
      firstPlan.snapshot,
      { kind: 'agent_turn_completed', turnId: 'turn_1', responseRef: 'response_1' },
      { now: clock(1002), createId: ids('turn_2'), validator },
    );

    expect(afterNonDecision.effect).toMatchObject({
      kind: 'send_agent_turn',
      stepId: 'selfReview',
      turnId: 'turn_2',
    });
    expect(afterNonDecision.snapshot.currentStepIndex).toBe(1);
    expect(afterNonDecision.snapshot.history).toContainEqual(
      expect.objectContaining({ kind: 'agent_turn_completed', responseRef: 'response_1' }),
    );

    const afterDecision = advanceWorkflow(
      model,
      afterNonDecision.snapshot,
      {
        kind: 'agent_turn_completed',
        turnId: 'turn_2',
        responseRef: 'response_2',
        finalResponseText: 'ready',
      },
      { now: clock(1003), createId: ids('visit_2', 'turn_3'), validator },
    );

    expect(afterDecision.snapshot.currentState).toBe('reviewing');
    expect(afterDecision.snapshot.visitId).toBe('visit_2');
    expect(afterDecision.snapshot.latestTransition).toMatchObject({
      visitId: 'visit_1',
      fromState: 'devImplementing',
      toState: 'reviewing',
      action: 'readyForReview',
      responseRef: 'response_2',
      parsed: { summary: 'Implemented long summary' },
      rawXmlTruncated: true,
      rawXmlOriginalChars: 88,
      rawXml: '<decision action="re',
      handoffText: 'Dev handoff: Implemented long summary',
    });
    expect(afterDecision.effect).toMatchObject({
      kind: 'send_agent_turn',
      role: 'review',
      stepId: 'reviewDecision',
      prompt: 'Review handoff Dev handoff: Implemented long summary',
    });

    const stale = advanceWorkflow(
      model,
      afterDecision.snapshot,
      { kind: 'agent_turn_completed', turnId: 'old_turn', responseRef: 'response_old' },
      { now: clock(1004), createId: ids('unused'), validator },
    );
    expect(stale.effect).toEqual({ kind: 'none' });
    expect(stale.snapshot).toEqual(afterDecision.snapshot);
    expect(stale.ignored).toMatchObject({ code: 'WORKFLOW_STALE_OBSERVATION' });

    const loopStart = createInitialWorkflowSnapshot(model, {
      instanceId: 'loop_1',
      inputs: { featureRequest: 'Loop feature' },
      now: clock(2000),
      createId: ids('loop_visit_1'),
    });
    const loopFirst = planNextWorkflowEffect(model, loopStart, {
      now: clock(2001),
      createId: ids('loop_turn_1'),
    });
    const loopDecisionPlan = advanceWorkflow(
      model,
      loopFirst.snapshot,
      { kind: 'agent_turn_completed', turnId: 'loop_turn_1', responseRef: 'loop_response_1' },
      { now: clock(2002), createId: ids('loop_turn_2'), validator },
    );
    const looped = advanceWorkflow(
      model,
      loopDecisionPlan.snapshot,
      {
        kind: 'agent_turn_completed',
        turnId: 'loop_turn_2',
        responseRef: 'loop_response_2',
        finalResponseText: 'same-state',
      },
      { now: clock(2003), createId: ids('loop_visit_2', 'loop_turn_3'), validator },
    );

    expect(looped.snapshot.currentState).toBe('devImplementing');
    expect(looped.snapshot.visitId).toBe('loop_visit_2');
    expect(looped.snapshot.latestTransition?.visitId).toBe('loop_visit_1');
    expect(looped.effect).toMatchObject({ stepId: 'implement', turnId: 'loop_turn_3' });

    const terminal: WorkflowRuntimeSnapshot = { ...afterDecision.snapshot, status: 'completed' };
    expect(planNextWorkflowEffect(model, terminal, { now: clock(1), createId: ids('unused') })).toEqual({
      snapshot: terminal,
      effect: { kind: 'none' },
    });
  });

  it('TEST_CASE_M83_2B retries invalid decision XML then blocks with needs-attention status', () => {
    const model = normalizeWorkflowDefinitionV1(makeDefinition());
    const initial = createInitialWorkflowSnapshot(model, {
      instanceId: 'instance_retry',
      inputs: { featureRequest: 'Build feature' },
      now: clock(3000),
      createId: ids('visit_retry'),
    });
    const firstPlan = planNextWorkflowEffect(model, initial, {
      now: clock(3001),
      createId: ids('retry_turn_1'),
    });
    const decisionPlan = advanceWorkflow(
      model,
      firstPlan.snapshot,
      { kind: 'agent_turn_completed', turnId: 'retry_turn_1', responseRef: 'retry_response_1' },
      { now: clock(3002), createId: ids('retry_turn_2'), validator },
    );

    const firstInvalid = advanceWorkflow(
      model,
      decisionPlan.snapshot,
      {
        kind: 'agent_turn_completed',
        turnId: 'retry_turn_2',
        responseRef: 'retry_response_2',
        finalResponseText: 'malformed',
      },
      { now: clock(3003), createId: ids('retry_turn_3'), validator },
    );
    expect(firstInvalid.snapshot.status).toBe('running');
    expect(firstInvalid.snapshot.currentState).toBe('devImplementing');
    expect(firstInvalid.snapshot.currentStepIndex).toBe(1);
    expect(firstInvalid.effect).toMatchObject({
      kind: 'send_agent_turn',
      role: 'dev',
      stepId: 'selfReview',
      turnId: 'retry_turn_3',
    });
    expect(firstInvalid.effect.kind === 'send_agent_turn' && firstInvalid.effect.prompt).toContain(
      'Malformed XML',
    );

    const secondInvalid = advanceWorkflow(
      model,
      firstInvalid.snapshot,
      {
        kind: 'agent_turn_completed',
        turnId: 'retry_turn_3',
        responseRef: 'retry_response_3',
        finalResponseText: 'malformed',
      },
      { now: clock(3004), createId: ids('retry_turn_4'), validator },
    );
    expect(secondInvalid.snapshot.status).toBe('running');
    expect(secondInvalid.effect).toMatchObject({ kind: 'send_agent_turn', turnId: 'retry_turn_4' });

    const exhausted = advanceWorkflow(
      model,
      secondInvalid.snapshot,
      {
        kind: 'agent_turn_completed',
        turnId: 'retry_turn_4',
        responseRef: 'retry_response_4',
        finalResponseText: 'malformed',
      },
      { now: clock(3005), createId: ids('unused'), validator },
    );
    expect(exhausted.snapshot.status).toBe('blocked');
    expect(exhausted.effect).toEqual({ kind: 'none' });
    expect(exhausted.snapshot.blockedReason).toMatchObject({ code: 'WORKFLOW_DECISION_RETRY_EXHAUSTED' });
    expect(exhausted.snapshot.latestTransition).toBeUndefined();

    const unknownAction = advanceWorkflow(
      model,
      decisionPlan.snapshot,
      {
        kind: 'agent_turn_completed',
        turnId: 'retry_turn_2',
        responseRef: 'retry_response_unknown',
        finalResponseText: 'unknown-action',
      },
      { now: clock(4000), createId: ids('unknown_retry'), validator },
    );
    expect(unknownAction.snapshot.currentState).toBe('devImplementing');
    expect(unknownAction.snapshot.latestTransition).toBeUndefined();
    expect(unknownAction.effect.kind === 'send_agent_turn' && unknownAction.effect.prompt).toContain(
      'WORKFLOW_DECISION_UNKNOWN_ACTION',
    );

    const missingRequired = advanceWorkflow(
      model,
      decisionPlan.snapshot,
      {
        kind: 'agent_turn_completed',
        turnId: 'retry_turn_2',
        responseRef: 'retry_response_missing',
        finalResponseText: 'missing-required',
      },
      { now: clock(5000), createId: ids('missing_retry'), validator },
    );
    expect(missingRequired.snapshot.currentState).toBe('devImplementing');
    expect(missingRequired.effect.kind === 'send_agent_turn' && missingRequired.effect.prompt).toContain(
      'WORKFLOW_DECISION_MISSING_REQUIRED_FIELD',
    );
  });

  it('validates per-action result contracts for absent result, unknown fields, types, and multiple arrays', () => {
    const makeWaitingReviewSnapshot = (model: ReturnType<typeof normalizeWorkflowDefinitionV1>): WorkflowRuntimeSnapshot => ({
      instanceId: 'result_contracts',
      workflowId: model.workflowId,
      status: 'running',
      currentState: 'reviewing',
      currentStepIndex: 0,
      visitId: 'review_visit',
      inputs: {},
      waitingFor: {
        kind: 'agent_turn',
        state: 'reviewing',
        stepId: 'reviewDecision',
        turnId: 'review_turn',
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
        kind: 'agent_turn_completed',
        turnId: 'review_turn',
        responseRef: 'response_extra',
        finalResponseText: 'extra',
      },
      {
        now: clock(10),
        createId: ids('retry_extra'),
        validator: { validate: () => ({ valid: true, action: 'approved', parsed: { extra: 'not declared' } }) },
      },
    );
    expect(extraWithoutResult.effect.kind === 'send_agent_turn' && extraWithoutResult.effect.prompt).toContain(
      'WORKFLOW_DECISION_UNKNOWN_FIELD',
    );

    const rejectKnownResultModel = normalizeWorkflowDefinitionV1(makeDefinition());
    const extraWithRejectResult = advanceWorkflow(
      rejectKnownResultModel,
      {
        ...makeWaitingReviewSnapshot(rejectKnownResultModel),
        currentState: 'devImplementing',
        currentStepIndex: 1,
        waitingFor: {
          kind: 'agent_turn',
          state: 'devImplementing',
          stepId: 'selfReview',
          turnId: 'self_review_turn',
        },
      },
      {
        kind: 'agent_turn_completed',
        turnId: 'self_review_turn',
        responseRef: 'response_extra_known_result',
        finalResponseText: 'extra-known-result',
      },
      {
        now: clock(15),
        createId: ids('retry_extra_known'),
        validator: {
          validate: () => ({
            valid: true,
            action: 'readyForReview',
            parsed: { summary: 'ok', extra: 'not declared' },
          }),
        },
      },
    );
    expect(
      extraWithRejectResult.effect.kind === 'send_agent_turn' && extraWithRejectResult.effect.prompt,
    ).toContain('WORKFLOW_DECISION_UNKNOWN_FIELD');

    const preserveDefinition = makeDefinition();
    activeAuthoredState(preserveDefinition, 'reviewing').actions.approved!.result = {
      fields: {},
      unknownFields: 'preserve',
    };
    const preserveModel = normalizeWorkflowDefinitionV1(preserveDefinition);
    const preserved = advanceWorkflow(
      preserveModel,
      makeWaitingReviewSnapshot(preserveModel),
      {
        kind: 'agent_turn_completed',
        turnId: 'review_turn',
        responseRef: 'response_preserve',
        finalResponseText: 'extra',
      },
      {
        now: clock(20),
        createId: ids('unused'),
        validator: { validate: () => ({ valid: true, action: 'approved', parsed: { extra: 'preserved' } }) },
      },
    );
    expect(preserved.snapshot.status).toBe('completed');
    expect(preserved.snapshot.latestTransition?.parsed).toEqual({ extra: 'preserved' });

    const typedDefinition = makeDefinition();
    activeAuthoredState(typedDefinition, 'reviewing').actions.approved!.result = {
      fields: {
        title: { type: 'string' },
        notes: { type: 'markdown', multiple: true },
        count: { type: 'number' },
        ok: { type: 'boolean' },
      },
      required: ['title', 'notes', 'count', 'ok'],
    };
    const typedModel = normalizeWorkflowDefinitionV1(typedDefinition);
    const wrongType = advanceWorkflow(
      typedModel,
      makeWaitingReviewSnapshot(typedModel),
      {
        kind: 'agent_turn_completed',
        turnId: 'review_turn',
        responseRef: 'response_wrong_type',
        finalResponseText: 'wrong-type',
      },
      {
        now: clock(30),
        createId: ids('retry_type'),
        validator: {
          validate: () => ({
            valid: true,
            action: 'approved',
            parsed: { title: 'ok', notes: ['a'], count: '1', ok: true },
          }),
        },
      },
    );
    expect(wrongType.effect.kind === 'send_agent_turn' && wrongType.effect.prompt).toContain(
      'WORKFLOW_DECISION_FIELD_TYPE_MISMATCH',
    );

    const wrongMultiple = advanceWorkflow(
      typedModel,
      makeWaitingReviewSnapshot(typedModel),
      {
        kind: 'agent_turn_completed',
        turnId: 'review_turn',
        responseRef: 'response_wrong_multiple',
        finalResponseText: 'wrong-multiple',
      },
      {
        now: clock(40),
        createId: ids('retry_multiple'),
        validator: {
          validate: () => ({
            valid: true,
            action: 'approved',
            parsed: { title: 'ok', notes: 'not an array', count: 1, ok: true },
          }),
        },
      },
    );
    expect(wrongMultiple.effect.kind === 'send_agent_turn' && wrongMultiple.effect.prompt).toContain(
      'WORKFLOW_DECISION_FIELD_TYPE_MISMATCH',
    );

    const validTyped = advanceWorkflow(
      typedModel,
      makeWaitingReviewSnapshot(typedModel),
      {
        kind: 'agent_turn_completed',
        turnId: 'review_turn',
        responseRef: 'response_valid_typed',
        finalResponseText: 'valid-typed',
      },
      {
        now: clock(50),
        createId: ids('unused'),
        validator: {
          validate: () => ({
            valid: true,
            action: 'approved',
            parsed: { title: 'ok', notes: ['a', 'b'], count: 1, ok: true },
          }),
        },
      },
    );
    expect(validTyped.snapshot.status).toBe('completed');
  });
});
