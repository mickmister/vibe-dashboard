import type { WorkflowTemplateCatalogEntry } from '../server/workflowDesignStore';

export const BUILT_IN_WORKFLOW_TEMPLATES: WorkflowTemplateCatalogEntry[] = [
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
              response: {
                format: 'xml',
                schema: { format: 'xsd', source: 'state_actions' },
                invalidXmlRetry: {
                  maxAttempts: 1,
                  prompt: 'engine_default_with_validation_errors',
                  onExhausted: 'blocked',
                },
                storeRawXml: true,
                rawXmlMaxChars: 20000,
                storeParsedFields: true,
                unknownFields: 'reject_unless_allowed_by_result_contract',
              },
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
