import type { ColumnType, Generated } from 'kysely';

export type NullableNumber = ColumnType<number | null, number | null | undefined, number | null | undefined>;
export type NullableString = ColumnType<string | null, string | null | undefined, string | null | undefined>;

export type WorkflowWebhookProvisioningStatus = 'pending' | 'provisioned' | 'retrying' | 'failed';

export interface WorkflowWebhookProvisioningState {
  stateKey: string;
  secret: string;
  vkSubscriptionId: NullableString;
  upsertKey: string;
  targetUrl: string;
  status: WorkflowWebhookProvisioningStatus;
  attemptCount: number;
  lastAttemptAt: NullableNumber;
  lastSuccessAt: NullableNumber;
  lastErrorJson: NullableString;
  createdAt: number;
  updatedAt: number;
}

export type WorkflowWebhookInboxStatus = 'received' | 'processed' | 'failed';

export interface WorkflowWebhookInbox {
  inboxId: string;
  source: string;
  deliveryId: NullableString;
  dedupeKey: string;
  eventType: string;
  eventStatus: NullableString;
  workspaceId: NullableString;
  sessionId: NullableString;
  executionProcessId: NullableString;
  queueItemId: NullableString;
  payloadJson: string;
  payloadHash: string;
  signatureHeader: NullableString;
  timestampHeader: NullableString;
  receivedAt: number;
  duplicateOfInboxId: NullableString;
  processedAt: NullableNumber;
  status: WorkflowWebhookInboxStatus;
  errorJson: NullableString;
  createdAt: number;
  updatedAt: number;
}

export interface Migration {
  id: Generated<number>;
  name: string;
  createdAt: Generated<string>;
}

export type DeclarativeWorkflowDefinitionStatus = 'active' | 'disabled';

export interface DeclarativeWorkflowDefinitionRow {
  definitionId: string;
  version: number;
  status: DeclarativeWorkflowDefinitionStatus;
  name: string;
  description: NullableString;
  trigger: string;
  definitionJson: string;
  definitionHash: string;
  createdAt: number;
  updatedAt: number;
  activatedAt: NullableNumber;
  disabledAt: NullableNumber;
}

export interface WorkflowRun {
  runId: string;
  workflowId: string;
  trigger: string;
  status: 'running' | 'completed' | 'failed';
  startedAt: number;
  completedAt: NullableNumber;
  durationMs: NullableNumber;
  inputJson: string;
  outputJson: NullableString;
  errorJson: NullableString;
  vkWorkspaceId: NullableString;
  vkSessionId: NullableString;
  vkQueueItemId: NullableString;
  vkExecutionProcessId: NullableString;
  createdAt: Generated<string>;
  updatedAt: Generated<string>;
}

export interface WorkflowRunEvent {
  id: Generated<number>;
  runId: string;
  eventIndex: number;
  eventType: 'run_started' | 'step_log' | 'truncated' | 'run_completed';
  stepId: NullableString;
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  timestamp: number;
  dataJson: NullableString;
  createdAt: Generated<string>;
}

export type WorkflowInstanceStatus = 'created' | 'running' | 'waiting' | 'paused' | 'completed' | 'failed' | 'cancelled';
export type WorkflowStepStateStatus = 'pending' | 'running' | 'waiting' | 'blocked' | 'completed' | 'failed' | 'cancelled';
export type WorkflowScopedTriggerStatus = 'active' | 'satisfied' | 'expired' | 'cancelled';
export type WorkflowScopedTriggerType = 'session_response';
export type WorkflowScopedTriggerMode = 'exact_execution' | 'next_completion_after_cursor';

export interface WorkflowInstance {
  instanceId: string;
  workflowId: string;
  templateId: NullableString;
  templateVersion: NullableNumber;
  teamId: NullableString;
  laneId: NullableString;
  status: WorkflowInstanceStatus;
  trigger: string;
  inputJson: string;
  stateJson: string;
  currentStepId: NullableString;
  latestRunId: NullableString;
  pauseRequestedAt: NullableNumber;
  cancelRequestedAt: NullableNumber;
  version: number;
  leaseOwner: NullableString;
  leaseExpiresAt: NullableNumber;
  errorJson: NullableString;
  createdAt: number;
  updatedAt: number;
}

export interface WorkflowStepState {
  id: string;
  instanceId: string;
  stepKey: string;
  status: WorkflowStepStateStatus;
  attemptCount: number;
  lastRunId: NullableString;
  blockedReason: NullableString;
  waitingTriggerId: NullableString;
  inputJson: NullableString;
  outputJson: NullableString;
  errorJson: NullableString;
  startedAt: NullableNumber;
  completedAt: NullableNumber;
  createdAt: number;
  updatedAt: number;
}

export interface WorkflowScopedTrigger {
  triggerId: string;
  instanceId: string;
  stepStateId: NullableString;
  stepKey: NullableString;
  type: WorkflowScopedTriggerType;
  status: WorkflowScopedTriggerStatus;
  roleId: NullableString;
  laneId: NullableString;
  workspaceId: NullableString;
  sessionId: NullableString;
  mode: WorkflowScopedTriggerMode;
  cursorCompletedAt: NullableNumber;
  cursorExecutionProcessId: NullableString;
  sourceExecutionProcessId: NullableString;
  expectedQueueItemId: NullableString;
  timeoutAt: NullableNumber;
  satisfiedByExecutionProcessId: NullableString;
  satisfiedByJson: NullableString;
  createdAt: number;
  updatedAt: number;
  satisfiedAt: NullableNumber;
  expiredAt: NullableNumber;
  cancelledAt: NullableNumber;
}

export type WorkflowAttentionItemStatus = 'active' | 'resolved' | 'cancelled';
export type WorkflowAttentionItemKind = 'human_turn';

export interface WorkflowAttentionItem {
  attentionItemId: string;
  instanceId: string;
  stepStateId: NullableString;
  workflowId: string;
  teamId: NullableString;
  laneId: NullableString;
  status: WorkflowAttentionItemStatus;
  kind: WorkflowAttentionItemKind;
  title: string;
  description: NullableString;
  stateId: NullableString;
  stepId: string;
  stateVisitId: string;
  idempotencyKey: string;
  presentationUrl: NullableString;
  formRef: NullableString;
  formSchemaJson: NullableString;
  resolutionJson: NullableString;
  createdAt: number;
  updatedAt: number;
  resolvedAt: NullableNumber;
  cancelledAt: NullableNumber;
}

export type WorkflowExternalWaitKind = 'callback' | 'ci';
export type WorkflowExternalWaitStatus = 'active' | 'resolved' | 'cancelled';

export interface WorkflowExternalWait {
  waitId: string;
  instanceId: NullableString;
  stepStateId: NullableString;
  roleId: NullableString;
  laneId: NullableString;
  workspaceId: string;
  sessionId: string;
  kind: WorkflowExternalWaitKind;
  status: WorkflowExternalWaitStatus;
  externalRef: NullableString;
  sourceExecutionProcessId: NullableString;
  metadataJson: NullableString;
  createdAt: number;
  updatedAt: number;
  resolvedAt: NullableNumber;
  cancelledAt: NullableNumber;
}



export type WorkflowFactoryWorkItemStatus = 'pending' | 'reserved' | 'queued' | 'completed' | 'failed' | 'cancelled';
export type WorkflowFactoryWorkItemSource = 'workflow' | 'agent' | 'system';

export interface WorkflowFactoryWorkItem {
  itemId: string;
  factoryId: NullableString;
  workflowInstanceId: NullableString;
  workflowRunId: NullableString;
  teamId: NullableString;
  laneId: NullableString;
  roleId: NullableString;
  workspaceId: string;
  status: WorkflowFactoryWorkItemStatus;
  priority: number;
  prompt: string;
  promptHash: string;
  promptLength: number;
  source: WorkflowFactoryWorkItemSource;
  reservedSessionId: NullableString;
  reservedBindingId: NullableString;
  queueItemId: NullableString;
  attemptCount: number;
  lastErrorJson: NullableString;
  metadataJson: NullableString;
  createdAt: number;
  updatedAt: number;
  reservedAt: NullableNumber;
  queuedAt: NullableNumber;
  completedAt: NullableNumber;
  cancelledAt: NullableNumber;
}

export type ResponseCollectionMode = 'manual' | 'all_at_once' | 'as_completed';
export type ResponseCollectionStatus = 'collecting' | 'ready' | 'completed' | 'failed' | 'cancelled';

export interface ResponseCollection {
  collectionId: string;
  workflowInstanceId: NullableString;
  workflowRunId: NullableString;
  triggerId: NullableString;
  mode: ResponseCollectionMode;
  status: ResponseCollectionStatus;
  expectedCount: NullableNumber;
  receivedCount: number;
  metadataJson: NullableString;
  createdAt: number;
  updatedAt: number;
  completedAt: NullableNumber;
}

export type ResponsePipeDeliveryStatus = 'planned' | 'rendered' | 'queued' | 'failed' | 'cancelled' | 'skipped';

export interface ResponsePipeDelivery {
  deliveryId: string;
  collectionId: NullableString;
  workflowInstanceId: NullableString;
  workflowRunId: NullableString;
  triggerId: NullableString;
  sourceWorkspaceId: string;
  sourceSessionId: string;
  sourceExecutionProcessId: string;
  sourceCompletedAt: NullableNumber;
  sourceRoleId: NullableString;
  sourceLaneId: NullableString;
  targetWorkspaceId: string;
  targetSessionId: string;
  targetRoleId: NullableString;
  targetLaneId: NullableString;
  templateId: string;
  templateVersion: NullableNumber;
  templateHash: string;
  renderedPromptHash: NullableString;
  renderedPromptLength: NullableNumber;
  dedupeKey: string;
  status: ResponsePipeDeliveryStatus;
  attemptCount: number;
  queueItemId: NullableString;
  errorJson: NullableString;
  metadataJson: NullableString;
  createdAt: number;
  updatedAt: number;
  queuedAt: NullableNumber;
  completedAt: NullableNumber;
}

export type WorkflowRoleSessionBindingSource = 'user_selected' | 'auto_reused' | 'auto_created' | 'team_config' | 'imported';

export interface WorkflowRoleSessionBinding {
  bindingId: string;
  teamId: NullableString;
  workflowId: NullableString;
  instanceId: NullableString;
  laneId: NullableString;
  roleId: string;
  roleName: string;
  workspaceId: string;
  sessionId: string;
  executor: NullableString;
  source: WorkflowRoleSessionBindingSource;
  valid: number;
  version: number;
  createdAt: number;
  updatedAt: number;
}


export type WorkflowLibraryRecordSource = 'built_in' | 'user' | 'plugin';
export type WorkflowDesignDraftValidationStatus = 'unknown' | 'valid' | 'invalid';

export interface WorkflowDesign {
  designId: string;
  source: WorkflowLibraryRecordSource;
  name: string;
  description: NullableString;
  currentDraftId: NullableString;
  latestPublishedVersion: NullableNumber;
  createdAt: number;
  updatedAt: number;
}

export interface WorkflowDesignDraft {
  draftId: string;
  designId: string;
  baseVersion: NullableNumber;
  definitionJson: string;
  validationStatus: WorkflowDesignDraftValidationStatus;
  validationIssuesJson: string;
  createdAt: number;
  updatedAt: number;
}

export interface WorkflowDesignVersion {
  designId: string;
  version: number;
  sourceDraftId: NullableString;
  definitionJson: string;
  resolvedDefinitionJson: string;
  resolvedPromptSnapshotJson: string;
  definitionHash: string;
  publishedAt: number;
  createdAt: number;
}

export interface WorkflowPromptAsset {
  promptAssetId: string;
  version: number;
  source: WorkflowLibraryRecordSource;
  name: string;
  description: NullableString;
  bodyMarkdown: string;
  inputSchemaJson: NullableString;
  contentHash: string;
  createdAt: number;
  updatedAt: number;
}

export interface WorkflowSkillAsset {
  skillAssetId: string;
  version: number;
  source: WorkflowLibraryRecordSource;
  name: string;
  description: NullableString;
  bodyMarkdown: string;
  contentHash: string;
  createdAt: number;
  updatedAt: number;
}

export interface WorkflowRoleTemplate {
  roleTemplateId: string;
  version: number;
  source: WorkflowLibraryRecordSource;
  name: string;
  description: NullableString;
  promptMarkdown: string;
  skillRefsJson: string;
  executorPreferenceJson: NullableString;
  active: number;
  contentHash: string;
  createdAt: number;
  updatedAt: number;
}

export interface WorkflowDesignRunSnapshot {
  runSnapshotId: string;
  designId: string;
  designVersion: number;
  workspaceId: string;
  runInputJson: string;
  roleBindingsJson: string;
  additionalInstructions: NullableString;
  resolvedDefinitionJson: string;
  resolvedPromptSnapshotJson: string;
  createdAt: number;
}



export type WorkflowBatchStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
export type WorkflowBatchItemStatus = 'pending' | 'running' | 'completed' | 'blocked' | 'failed' | 'cancelled';

export interface WorkflowBatch {
  batchId: string;
  designId: string;
  designVersion: number;
  workspaceId: string;
  status: WorkflowBatchStatus;
  createdAt: number;
  updatedAt: number;
}

export interface WorkflowBatchItem {
  batchItemId: string;
  batchId: string;
  itemIndex: number;
  status: WorkflowBatchItemStatus;
  runId: NullableString;
  runSnapshotId: NullableString;
  inputJson: string;
  additionalInstructions: NullableString;
  roleBindingsJson: string;
  errorJson: NullableString;
  createdAt: number;
  updatedAt: number;
  startedAt: NullableNumber;
  completedAt: NullableNumber;
}



export type WorkflowMetaRunStatus = 'pending' | 'running' | 'paused' | 'blocked' | 'completed' | 'failed' | 'cancelled';
export type WorkflowMetaRunItemStatus = 'pending' | 'running' | 'paused' | 'completed' | 'blocked' | 'failed' | 'skipped';

export interface WorkflowMetaRun {
  metaRunId: string;
  parentWorkspaceId: string;
  laneId: NullableString;
  status: WorkflowMetaRunStatus;
  currentIndex: number;
  childWorkflowDesignId: NullableString;
  childWorkflowDesignVersion: NullableNumber;
  childRoleBindingsJson: string;
  title: string;
  summary: NullableString;
  pauseRequested: number;
  blockedReasonJson: NullableString;
  resultSummaryJson: string;
  provenanceJson: string;
  createdAt: number;
  updatedAt: number;
  startedAt: NullableNumber;
  completedAt: NullableNumber;
}

export interface WorkflowMetaRunItem {
  itemId: string;
  metaRunId: string;
  beadId: string;
  itemIndex: number;
  title: string;
  beadStatus: string;
  status: WorkflowMetaRunItemStatus;
  childRunId: NullableString;
  resultJson: NullableString;
  noteRef: NullableString;
  errorJson: NullableString;
  provenanceJson: string;
  createdAt: number;
  updatedAt: number;
  startedAt: NullableNumber;
  completedAt: NullableNumber;
}

export interface WorkflowMetaRunEvent {
  eventId: string;
  metaRunId: string;
  itemId: NullableString;
  kind: string;
  message: string;
  dataJson: string;
  createdAt: number;
}

export type WorkflowPersistedRunStatus = 'running' | 'completed' | 'blocked' | 'failed' | 'cancelled';

export interface WorkflowPersistedRun {
  runId: string;
  runSnapshotId: string;
  designId: string;
  designVersion: number;
  workspaceId: string;
  status: WorkflowPersistedRunStatus;
  coreModelJson: string;
  coreSnapshotJson: string;
  roleBindingsJson: string;
  pendingEffectJson: NullableString;
  queuedTurnsJson: string;
  eventsJson: string;
  errorJson: NullableString;
  createdAt: number;
  updatedAt: number;
}


export type WorkspaceLaneStatus = 'planned' | 'ready' | 'active' | 'paused' | 'blocked' | 'completed' | 'archived';
export type WorkspaceLaneWorktreeStatus = 'pending' | 'clean' | 'dirty' | 'unknown';
export type WorkspaceLaneBindingType = 'workflow_run' | 'workflow_instance' | 'bead' | 'milestone';
export type WorkspaceLaneAccessMode = 'read' | 'write';
export type WorkspaceLaneCapacityLeaseStatus = 'active' | 'released' | 'stale' | 'reclaimed';

export interface WorkspaceLane {
  laneId: string;
  parentWorkspaceId: string;
  name: string;
  purpose: string;
  status: WorkspaceLaneStatus;
  sourceBranch: string;
  workingBranch: NullableString;
  worktreePath: NullableString;
  worktreeStatus: WorkspaceLaneWorktreeStatus;
  worktreeSummaryJson: NullableString;
  createdByJson: string;
  cleanupPolicyJson: string;
  createdAt: number;
  updatedAt: number;
  archivedAt: NullableNumber;
  lastActiveRunId: NullableString;
}

export interface WorkspaceLaneBinding {
  bindingId: string;
  laneId: string;
  parentWorkspaceId: string;
  bindingType: WorkspaceLaneBindingType;
  bindingKey: string;
  reason: NullableString;
  accessMode: WorkspaceLaneAccessMode;
  roleBindingsJson: string;
  createdAt: number;
  updatedAt: number;
}

export interface WorkspaceLaneCapacityLease {
  leaseId: string;
  laneId: string;
  parentWorkspaceId: string;
  mode: 'write';
  ownerId: string;
  status: WorkspaceLaneCapacityLeaseStatus;
  acquiredAt: number;
  expiresAt: NullableNumber;
  releasedAt: NullableNumber;
  releaseReason: NullableString;
  recoveryReason: NullableString;
  metadataJson: string;
  createdAt: number;
  updatedAt: number;
}

export interface WorkspaceLaneAuditEvent {
  auditId: string;
  laneId: string;
  parentWorkspaceId: string;
  eventType: string;
  actorId: NullableString;
  message: string;
  dataJson: string;
  createdAt: number;
}

export interface DB {
  WorkspaceLane: WorkspaceLane;
  WorkspaceLaneBinding: WorkspaceLaneBinding;
  WorkspaceLaneCapacityLease: WorkspaceLaneCapacityLease;
  WorkspaceLaneAuditEvent: WorkspaceLaneAuditEvent;
  WorkflowDesign: WorkflowDesign;
  WorkflowDesignDraft: WorkflowDesignDraft;
  WorkflowDesignVersion: WorkflowDesignVersion;
  WorkflowPromptAsset: WorkflowPromptAsset;
  WorkflowRoleTemplate: WorkflowRoleTemplate;
  WorkflowSkillAsset: WorkflowSkillAsset;
  WorkflowDesignRunSnapshot: WorkflowDesignRunSnapshot;
  WorkflowPersistedRun: WorkflowPersistedRun;
  WorkflowMetaRun: WorkflowMetaRun;
  WorkflowMetaRunItem: WorkflowMetaRunItem;
  WorkflowMetaRunEvent: WorkflowMetaRunEvent;
  WorkflowBatch: WorkflowBatch;
  WorkflowBatchItem: WorkflowBatchItem;
  DeclarativeWorkflowDefinition: DeclarativeWorkflowDefinitionRow;
  Migration: Migration;
  ResponseCollection: ResponseCollection;
  ResponsePipeDelivery: ResponsePipeDelivery;
  WorkflowFactoryWorkItem: WorkflowFactoryWorkItem;
  WorkflowRun: WorkflowRun;
  WorkflowRunEvent: WorkflowRunEvent;
  WorkflowInstance: WorkflowInstance;
  WorkflowAttentionItem: WorkflowAttentionItem;
  WorkflowStepState: WorkflowStepState;
  WorkflowScopedTrigger: WorkflowScopedTrigger;
  WorkflowRoleSessionBinding: WorkflowRoleSessionBinding;
  WorkflowExternalWait: WorkflowExternalWait;
  WorkflowWebhookInbox: WorkflowWebhookInbox;
  WorkflowWebhookProvisioningState: WorkflowWebhookProvisioningState;
}
