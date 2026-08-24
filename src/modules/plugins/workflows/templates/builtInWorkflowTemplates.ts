import type { WorkflowTemplateCatalogEntry } from '../server/workflowDesignStore';

const decisionResponse = {
  format: 'xml' as const,
  schema: { format: 'xsd' as const, source: 'state_actions' as const },
  invalidXmlRetry: {
    maxAttempts: 1,
    prompt: 'engine_default_with_validation_errors' as const,
    onExhausted: 'blocked' as const,
  },
  storeRawXml: true,
  rawXmlMaxChars: 20000,
  storeParsedFields: true,
  unknownFields: 'reject_unless_allowed_by_result_contract' as const,
};

export const BUILT_IN_WORKFLOW_TEMPLATES: WorkflowTemplateCatalogEntry[] = [

  {
    templateId: 'built-in/ask-teammate',
    name: 'Ask teammate',
    description: 'Generic one-role workflow for requesting one teammate response through workflow coordination.',
    promptAssets: [
      {
        promptAssetId: 'prompt.ask-teammate.request',
        version: 1,
        source: 'built_in',
        name: 'Ask teammate request prompt',
        bodyMarkdown: 'Respond as the requested teammate role: {{inputs.role}}. Request: {{inputs.request}}. Success criteria: {{inputs.successCriteria}}. Urgency: {{inputs.urgency}}. Return a concise workflow decision XML response with your response summary and any follow-up needed.',
      },
    ],
    skillAssets: [
      { skillAssetId: 'skill.workflow.xml-decision', version: 1, source: 'built_in', name: 'Workflow XML decision skill', bodyMarkdown: 'Return your final workflow decision as XML matching the current state actions. Markdown content belongs inside child elements or CDATA.' },
    ],
    definition: {
      schemaVersion: 1,
      name: 'Ask teammate',
      description: 'Ask one teammate for a response, then finish with the response captured in the workflow result.',
      inputs: {
        role: { type: 'string', required: true, description: 'Teammate role to respond as, such as review, tester, ux, or engine.' },
        request: { type: 'markdown', required: true, description: 'What the teammate should respond to.' },
        successCriteria: { type: 'markdown', required: false, description: 'Optional criteria for a useful response.' },
        urgency: { type: 'string', required: false, description: 'Optional urgency label such as normal or high.' },
      },
      roles: {
        teammate: { label: 'Teammate', description: 'Responds to the request as the requested teammate role.' },
      },
      initialState: 'ask_teammate',
      states: {
        ask_teammate: {
          owner: 'teammate',
          steps: [{ id: 'respond', type: 'agent_turn', turnType: 'decision', prompt: { refs: [{ kind: 'prompt', id: 'prompt.ask-teammate.request', version: 1 }, { kind: 'skill', id: 'skill.workflow.xml-decision', version: 1 }] }, response: decisionResponse }],
          actions: {
            responded: {
              label: 'Responded',
              targetState: 'done',
              result: {
                fields: {
                  summary: { type: 'markdown', description: 'Short summary of the teammate response.' },
                  response: { type: 'markdown', description: 'Full teammate response.' },
                  followUp: { type: 'markdown', description: 'Optional follow-up or next action.' },
                },
                required: ['summary', 'response'],
                unknownFields: 'reject',
              },
            },
          },
        },
        done: { terminal: true },
      },
    },
  },
  {
    templateId: 'built-in/dev-review-tester',
    name: 'Dev / Review / Tester',
    description: 'Generic three-role feature workflow with Dev implementation plus self-review, Review approval/change loop, and Tester acceptance loop.',
    promptAssets: [
      { promptAssetId: 'prompt.drt.dev.implement', version: 1, source: 'built_in', name: 'Dev implementation prompt', bodyMarkdown: 'Implement the requested feature from {{inputs.featureRequest}}. Keep notes on tests and risks.' },
      { promptAssetId: 'prompt.drt.dev.self-review', version: 1, source: 'built_in', name: 'Dev self-review prompt', bodyMarkdown: 'Review your own changes without making code changes during this self-review step. Return only the workflow decision XML: choose ready_for_review when the work is ready, or needs_more_work when you found concerns that need another implementation pass. If you choose needs_more_work, include markdown concerns and an actionable fix plan. After returning the decision XML, wait for the next workflow instruction before making fixes.' },
      { promptAssetId: 'prompt.drt.review', version: 1, source: 'built_in', name: 'Reviewer prompt', bodyMarkdown: 'Review the implementation and Dev self-review concerns. Approve or request changes with clear markdown remarks.' },
      { promptAssetId: 'prompt.drt.tester', version: 1, source: 'built_in', name: 'Tester prompt', bodyMarkdown: 'Test the feature against the request and review approval. Approve, report a bug, or explain why the work is not testable.' },
    ],
    skillAssets: [
      { skillAssetId: 'skill.workflow.xml-decision', version: 1, source: 'built_in', name: 'Workflow XML decision skill', bodyMarkdown: 'Return your final workflow decision as XML matching the current state actions. Markdown content belongs inside child elements or CDATA.' },
    ],
    definition: {
      schemaVersion: 1,
      name: 'Dev / Review / Tester',
      description: 'Implement, self-review, review, and test feature work with loops back to Dev.',
      inputs: { featureRequest: { type: 'markdown', required: true, description: 'Feature request or task to implement.' } },
      roles: {
        dev: { label: 'Dev', description: 'Implements changes and performs required self-review.' },
        review: { label: 'Review', description: 'Reviews the code and either approves or requests changes.' },
        tester: { label: 'Tester', description: 'Tests the reviewed implementation and approves or sends failures back.' },
      },
      initialState: 'dev',
      states: {
        dev: {
          owner: 'dev',
          steps: [
            { id: 'implement', type: 'agent_turn', turnType: 'non_decision', prompt: { refs: [{ kind: 'prompt', id: 'prompt.drt.dev.implement', version: 1 }] } },
            { id: 'self_review', type: 'agent_turn', turnType: 'decision', prompt: { refs: [{ kind: 'prompt', id: 'prompt.drt.dev.self-review', version: 1 }, { kind: 'skill', id: 'skill.workflow.xml-decision', version: 1 }] }, response: decisionResponse },
          ],
          actions: {
            ready_for_review: {
              label: 'Ready for review',
              targetState: 'review',
              result: { fields: { summary: { type: 'markdown' }, concerns: { type: 'markdown' } }, required: ['summary'], unknownFields: 'reject' },
            },
            needs_more_work: {
              label: 'Needs more work',
              targetState: 'dev',
              result: { fields: { concerns: { type: 'markdown' }, fixPlan: { type: 'markdown' } }, required: ['concerns', 'fixPlan'], unknownFields: 'reject' },
            },
          },
        },
        review: {
          owner: 'review',
          steps: [{ id: 'review', type: 'agent_turn', turnType: 'decision', prompt: { refs: [{ kind: 'prompt', id: 'prompt.drt.review', version: 1 }, { kind: 'skill', id: 'skill.workflow.xml-decision', version: 1 }] }, response: decisionResponse }],
          actions: {
            approved: { label: 'Approved', targetState: 'tester', result: { fields: { remarks: { type: 'markdown' } }, unknownFields: 'reject' } },
            changes_requested: { label: 'Request changes', targetState: 'dev', result: { fields: { concerns: { type: 'markdown' }, requestedChanges: { type: 'markdown' } }, required: ['requestedChanges'], unknownFields: 'reject' } },
          },
        },
        tester: {
          owner: 'tester',
          steps: [{ id: 'test', type: 'agent_turn', turnType: 'decision', prompt: { refs: [{ kind: 'prompt', id: 'prompt.drt.tester', version: 1 }, { kind: 'skill', id: 'skill.workflow.xml-decision', version: 1 }] }, response: decisionResponse }],
          actions: {
            approved: { label: 'Approved', targetState: 'done', result: { fields: { testSummary: { type: 'markdown' } }, required: ['testSummary'], unknownFields: 'reject' } },
            bug_found: { label: 'Bug found', targetState: 'dev', result: { fields: { bugReport: { type: 'markdown' } }, required: ['bugReport'], unknownFields: 'reject' } },
            not_testable: { label: 'Not testable', targetState: 'dev', result: { fields: { advice: { type: 'markdown' } }, required: ['advice'], unknownFields: 'reject' } },
          },
        },
        done: { terminal: true },
      },
    },
  },
  {
    templateId: 'built-in/create-form-from-agent',
    name: 'Create form from agent',
    description: 'Small workflow that asks an agent to draft a beads-form-compatible form schema from a request.',
    promptAssets: [
      { promptAssetId: 'prompt.create-form.agent', version: 1, source: 'built_in', name: 'Create form prompt', bodyMarkdown: 'Create a beads-form XML schema for {{inputs.formRequest}}. Return a workflow decision XML response with <formSchema><beadsForm>...</beadsForm></formSchema>, artifactRef, and summary fields. Use markdown child elements or CDATA for descriptions/pros/cons; do not encode formSchema as JSON.' },
    ],
    skillAssets: [
      { skillAssetId: 'skill.beads-form.schema', version: 1, source: 'built_in', name: 'Beads-form schema skill', bodyMarkdown: 'Represent forms as beads-form XML: <beadsForm id="..."><title>...</title><description><![CDATA[markdown]]></description><question id="..." type="choices|text|textarea" required="true|false"><title>...</title><description><![CDATA[markdown]]></description><choice id="..."><label>...</label><pros><![CDATA[markdown]]></pros><cons><![CDATA[markdown]]></cons></choice></question></beadsForm>. Use child text or CDATA for markdown, not JSON.' },
      { skillAssetId: 'skill.workflow.xml-decision', version: 1, source: 'built_in', name: 'Workflow XML decision skill', bodyMarkdown: 'Return your final workflow decision as XML matching the current state actions. Markdown content belongs inside child elements or CDATA.' },
    ],
    definition: {
      schemaVersion: 1,
      name: 'Create form from agent',
      description: 'Produce a supported form schema/artifact ref from an agent response.',
      inputs: { formRequest: { type: 'markdown', required: true, description: 'What form should the agent create?' } },
      roles: { form_author: { label: 'Form author', description: 'Creates a form schema/artifact for review.' } },
      initialState: 'create_form',
      states: {
        create_form: {
          owner: 'form_author',
          steps: [{ id: 'draft_form', type: 'agent_turn', turnType: 'decision', prompt: { refs: [{ kind: 'prompt', id: 'prompt.create-form.agent', version: 1 }, { kind: 'skill', id: 'skill.beads-form.schema', version: 1 }, { kind: 'skill', id: 'skill.workflow.xml-decision', version: 1 }] }, response: decisionResponse }],
          actions: {
            form_created: {
              label: 'Form created',
              targetState: 'done',
              result: {
                fields: {
                  formSchema: { type: 'markdown', description: 'The supported beads-form provider XML using a nested <beadsForm> schema.' },
                  artifactRef: { type: 'string', description: 'Durable form artifact/reference if available.' },
                  summary: { type: 'markdown' },
                },
                required: ['formSchema'],
                unknownFields: 'reject',
              },
            },
          },
        },
        done: { terminal: true },
      },
    },
  },
  {
    templateId: 'built-in/simple-agent-decision',
    name: 'Simple Agent Decision',
    description: 'Small M91 catalog fixture that materializes into a workflow design draft when used.',
    promptAssets: [
      {
        promptAssetId: 'prompt.simple-agent.instructions',
        version: 1,
        source: 'built_in',
        name: 'Simple agent instructions',
        bodyMarkdown: 'Handle {{inputs.featureRequest}} and explain the result.',
      },
    ],
    skillAssets: [
      {
        skillAssetId: 'skill.workflow.markdown-response',
        version: 1,
        source: 'built_in',
        name: 'Markdown response skill',
        bodyMarkdown: 'Use concise Markdown for summaries and concerns.',
      },
    ],
    definition: {
      schemaVersion: 1,
      name: 'simple-agent-decision',
      inputs: {
        featureRequest: { type: 'markdown', required: true },
      },
      roles: {
        implementer: { label: 'Implementer' },
      },
      initialState: 'implementing',
      states: {
        implementing: {
          owner: 'implementer',
          steps: [
            {
              id: 'decide',
              type: 'agent_turn',
              turnType: 'decision',
              prompt: {
                refs: [
                  { kind: 'prompt', id: 'prompt.simple-agent.instructions', version: 1 },
                  { kind: 'skill', id: 'skill.workflow.markdown-response', version: 1 },
                ],
                template: 'Return workflow XML for the selected action.',
              },
              response: decisionResponse,
            },
          ],
          actions: {
            complete: {
              label: 'Complete',
              targetState: 'done',
              result: {
                fields: {
                  summary: { type: 'markdown' },
                },
                required: ['summary'],
                unknownFields: 'reject',
              },
            },
          },
        },
        done: { terminal: true },
      },
    },
  },
];
