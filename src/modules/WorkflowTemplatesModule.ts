import springboard, { type ModuleAPI } from 'springboard';
import {
  addWorkflowTemplate,
  createBuiltInWorkflowTemplates,
  createDefaultWorkflowTemplateState,
  deleteWorkflowTemplate,
  duplicateWorkflowTemplate,
  migrateWorkflowTemplateState,
  selectWorkflowTemplate,
  updateWorkflowTemplate,
  type CreateWorkflowTemplateInput,
  type UpdateWorkflowTemplateInput,
  type WorkflowTemplateState,
} from '../templates/workflowTemplates';

export type WorkflowTemplatesModuleReturnValue = Awaited<ReturnType<typeof createWorkflowTemplatesModule>>;

springboard.registerModule('workflowTemplates', { rpcMode: 'remote' }, async (moduleAPI): Promise<WorkflowTemplatesModuleReturnValue> => {
  return createWorkflowTemplatesModule(moduleAPI);
});

export async function createWorkflowTemplatesModule(moduleAPI: ModuleAPI) {
  const templateState = await moduleAPI.statesAPI.createPersistentState<WorkflowTemplateState>(
    'workflow-templates',
    createDefaultWorkflowTemplateState(),
  );

  const actions = moduleAPI.createActions({
    createTemplate: async (input: CreateWorkflowTemplateInput) => {
      return templateState.setState((state) => addWorkflowTemplate(state, input));
    },
    updateTemplate: async (args: { templateId: string; patch: UpdateWorkflowTemplateInput }) => {
      return templateState.setState((state) => updateWorkflowTemplate(state, args.templateId, args.patch));
    },
    deleteTemplate: async (args: { templateId: string }) => {
      return templateState.setState((state) => deleteWorkflowTemplate(state, args.templateId));
    },
    duplicateTemplate: async (args: { templateId: string }) => {
      return templateState.setState((state) => duplicateWorkflowTemplate(state, args.templateId));
    },
    selectTemplate: async (args: { templateId: string | null }) => {
      return templateState.setState((state) => selectWorkflowTemplate(state, args.templateId));
    },
    resetBuiltInExample: async () => {
      return templateState.setState((state) => {
        const current = migrateWorkflowTemplateState(state);
        const builtIns = createBuiltInWorkflowTemplates();
        return {
          ...current,
          templates: [...current.templates, ...builtIns],
          selectedTemplateId: current.selectedTemplateId ?? builtIns[0]?.id ?? null,
        };
      });
    },
  });

  return {
    states: {
      templates: templateState,
    },
    actions,
  };
}

declare module 'springboard/module_registry/module_registry' {
  interface AllModules {
    workflowTemplates: WorkflowTemplatesModuleReturnValue;
  }
}
