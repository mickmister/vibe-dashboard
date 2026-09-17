export const migration = `
-- runId is covered by the WorkflowRun primary key and WorkflowRunEvent has
-- UNIQUE(runId, eventIndex); these indexes cover read API filters and refs.
CREATE INDEX IF NOT EXISTS idx_workflow_run_workflow_status_started
  ON WorkflowRun(workflowId, status, startedAt DESC);

CREATE INDEX IF NOT EXISTS idx_workflow_run_trigger_started
  ON WorkflowRun(trigger, startedAt DESC);

CREATE INDEX IF NOT EXISTS idx_workflow_run_vk_workspace_started
  ON WorkflowRun(vkWorkspaceId, startedAt DESC);

CREATE INDEX IF NOT EXISTS idx_workflow_run_vk_session_started
  ON WorkflowRun(vkSessionId, startedAt DESC);

CREATE INDEX IF NOT EXISTS idx_workflow_run_vk_queue_item_started
  ON WorkflowRun(vkQueueItemId, startedAt DESC);

CREATE INDEX IF NOT EXISTS idx_workflow_run_vk_execution_process_started
  ON WorkflowRun(vkExecutionProcessId, startedAt DESC);

CREATE INDEX IF NOT EXISTS idx_workflow_run_event_type_run_index
  ON WorkflowRunEvent(eventType, runId, eventIndex);
`;
