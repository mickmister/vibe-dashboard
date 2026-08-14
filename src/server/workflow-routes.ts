import { randomUUID } from "node:crypto";
import type { Hono } from "hono";
import type { Kysely } from "kysely";
import {
  WORKFLOW_EXECUTOR_MODEL_OPTIONS,
  WORKFLOW_EXECUTOR_TYPES,
  runWorkflow,
  WorkflowNotFoundError,
  type AgentWorkflowDefinitionV1,
  type RunWorkflowOptions,
  type WorkflowRecorder,
  type WorkflowRegistry,
} from "@vibe-dashboard/workflow-core";
import { verifyGitHubWebhookSignature } from "./github-signature";
import {
  parsePositiveInteger,
  parseWorkflowRunStatus,
  type WorkflowRunReader,
} from "./workflow-run-store";
import {
  parseWorkflowAttentionStatus,
  parseWorkflowInstanceStatus,
  parseWorkflowTriggerStatus,
  type DbWorkflowOrchestrationStore,
  type WorkflowAttentionItemReadModel,
} from "./workflow-orchestration-store";
import type { CachedRepoAlias } from "../workflows/github-ci";
import type {
  WorkflowActivityScanner,
  WorkflowSchedulerBudgetPolicy,
} from "./workflow-session-scanner";
import type { WorkflowRoleSessionResolver } from "./role-session-resolver";
import type { DeclarativeWorkflowRuntime } from "../workflows/declarative/runtime";
import type { Executor, VibeKanbanServerClient } from "./vk-client";
import { buildWorkflowPresentationModel } from "./workflow-presentation-read-model";
import {
  BUILT_IN_DECLARATIVE_WORKFLOW_DEFINITIONS,
  getBuiltInDeclarativeWorkflowDefinition,
} from "../workflows/declarative/builtins";
import type { DeclarativeWorkflowDefinition } from "../workflows/declarative/definitions";
import { normalizeDeclarativeWorkflowDefinition } from "../workflows/declarative/definitions";
import type { DbDeclarativeWorkflowDefinitionStore } from "./declarative-workflow-definition-store";
import type { DbWorkflowWebhookProvisioningStore } from "./workflow-webhook-provisioning-store";
import { buildWorkspaceWorkflowsHomeModel } from "../modules/plugins/workflows/server/workflowsHomeReadModel";
import { DbWorkflowDesignStore } from "../modules/plugins/workflows/server/workflowDesignStore";
import {
  PersistedWorkflowRuntimeService,
  type PersistedWorkflowRunReadModel,
} from "../modules/plugins/workflows/server/persistedWorkflowRuntime";
import { BUILT_IN_WORKFLOW_TEMPLATES } from "../modules/plugins/workflows/templates/builtInWorkflowTemplates";
import { buildPersistedWorkflowPresentationModel } from "../modules/plugins/workflows/server/persistedWorkflowPresentationReadModel";
import {
  DEFAULT_WORKFLOW_BATCH_CAPACITY,
  WorkflowBatchSchedulerService,
  type WorkflowBatchCapacitySnapshot,
  type WorkflowBatchReadModel,
} from "../modules/plugins/workflows/server/workflowBatchScheduler";
import { getVdDb } from "./database";
import type { DB } from "../store/kysely_types";
import {
  parseVkWorkflowWebhookPayload,
  verifyVkWebhookSignature,
  WorkflowWebhookPayloadError,
  WorkflowWebhookSignatureError,
  type DbWorkflowWebhookInboxStore,
  type WorkflowWebhookEventRefs,
  type WorkflowWebhookWakeup,
} from "./workflow-webhook-inbox";

export interface RegisterWorkflowRoutesOptions {
  registry: WorkflowRegistry;
  runOptions?: RunWorkflowOptions;
  workflowRunRecorder?: WorkflowRecorder;
  workflowRunReader?: WorkflowRunReader;
  workflowOrchestrationStore?: DbWorkflowOrchestrationStore;
  workflowActivityScanner?: WorkflowActivityScanner;
  roleSessionResolver?: WorkflowRoleSessionResolver;
  declarativeWorkflowRuntime?: DeclarativeWorkflowRuntime;
  declarativeWorkflowDefinitionStore?: DbDeclarativeWorkflowDefinitionStore;
  workflowWebhookInboxStore?: DbWorkflowWebhookInboxStore;
  workflowWebhookWakeup?: Pick<WorkflowWebhookWakeup, "trigger">;
  workflowWebhookProvisioningStore?: Pick<
    DbWorkflowWebhookProvisioningStore,
    "getSecret" | "getPublicState"
  >;
  workflowDesignStore?: DbWorkflowDesignStore;
  workflowHomeDb?: Kysely<DB>;
  persistedWorkflowRuntime?: Pick<
    PersistedWorkflowRuntimeService,
    "launch" | "completeHumanForm" | "completeAgentTurn" | "getRun"
  >;
  workflowBatchCapacity?: Partial<typeof DEFAULT_WORKFLOW_BATCH_CAPACITY>;
  vkClient?: Partial<
    Pick<
      VibeKanbanServerClient,
      | "getExecutionProcessFinalMessage"
      | "getExecutionProcessRepoStates"
      | "getSessions"
      | "getSession"
      | "createSession"
      | "queueFollowUp"
    >
  >;
  vkWorkflowWebhookSecret?: string;
  githubWebhookSecret?: string;
  repoAliasCache?: RepoAliasCache;
}

export interface RepoAliasCache {
  get: () => CachedRepoAlias[] | Promise<CachedRepoAlias[]>;
  set: (repos: CachedRepoAlias[]) => void | Promise<void>;
  refresh?: () => CachedRepoAlias[] | Promise<CachedRepoAlias[]>;
}

export function registerWorkflowRoutes(
  hono: Hono,
  options: RegisterWorkflowRoutesOptions,
): void {
  hono.get("/dashboard/api/workflows/health", (c) => c.json({ ok: true }));

  hono.get("/dashboard/api/workflows/home", async (c) => {
    const workspaceId = c.req.query("workspaceId")?.trim();
    if (!workspaceId)
      return c.json(
        { error: "workspace_id_required", message: "Workspace is required" },
        400,
      );
    const db = options.workflowHomeDb ?? (await getVdDb()).db;
    const home = await buildWorkspaceWorkflowsHomeModel({
      db,
      designStore: options.workflowDesignStore,
      orchestrationStore: options.workflowOrchestrationStore,
      workspaceId,
    });
    return c.json({ home });
  });

  hono.get("/dashboard/api/workflows/launch-options", async (c) => {
    const workspaceId = c.req.query("workspaceId")?.trim();
    const designId = c.req.query("designId")?.trim();
    if (!workspaceId)
      return c.json(
        { error: "workspace_id_required", message: "Workspace is required" },
        400,
      );
    if (!designId)
      return c.json(
        { error: "workflow_required", message: "Workflow is required" },
        400,
      );
    const db = options.workflowHomeDb ?? (await getVdDb()).db;
    const designStore =
      options.workflowDesignStore ??
      new DbWorkflowDesignStore({ db, templates: BUILT_IN_WORKFLOW_TEMPLATES });
    try {
      const workflow = await buildLaunchWorkflowSummary(
        designStore,
        designId,
        parsePositiveInteger(c.req.query("version") ?? null) ?? undefined,
      );
      if (!workflow.canRun)
        return c.json(
          {
            error: "workflow_unavailable",
            message:
              workflow.unavailableReason ?? "Workflow is not available to run",
          },
          400,
        );
      const sessions = await listLaunchSessions(options, workspaceId);
      return c.json({
        options: {
          workspaceId,
          workflow,
          sessions,
          executorOptions: listWorkflowExecutorOptions(),
        },
      });
    } catch (error) {
      return c.json(
        {
          error: "workflow_launch_options_failed",
          message: error instanceof Error ? error.message : String(error),
        },
        400,
      );
    }
  });

  hono.get("/dashboard/api/workflow-assets", async (c) => {
    const db = options.workflowHomeDb ?? (await getVdDb()).db;
    const designStore =
      options.workflowDesignStore ??
      new DbWorkflowDesignStore({ db, templates: BUILT_IN_WORKFLOW_TEMPLATES });
    const limit = parsePositiveInteger(c.req.query("limit") ?? null) ?? 100;
    const [prompts, skills] = await Promise.all([
      designStore.listPromptAssets(limit),
      designStore.listSkillAssets(limit),
    ]);
    return c.json({
      prompts: prompts.map((asset) => ({
        kind: "prompt",
        id: asset.promptAssetId,
        version: asset.version,
        name: asset.name,
        description: asset.description,
        source: asset.source,
        preview: asset.bodyMarkdown.slice(0, 240),
      })),
      skills: skills.map((asset) => ({
        kind: "skill",
        id: asset.skillAssetId,
        version: asset.version,
        name: asset.name,
        description: asset.description,
        source: asset.source,
        preview: asset.bodyMarkdown.slice(0, 240),
      })),
    });
  });

  hono.post("/dashboard/api/workflows/batches", async (c) => {
    const body = asRecord(await readJsonBody(c.req.raw));
    const parsed = parseWorkflowBatchLaunchRequest(body);
    if (!parsed.ok)
      return c.json(
        {
          error: parsed.error,
          message: parsed.message,
          fieldErrors: parsed.fieldErrors,
        },
        parsed.status,
      );
    const db = options.workflowHomeDb ?? (await getVdDb()).db;
    const designStore =
      options.workflowDesignStore ??
      new DbWorkflowDesignStore({ db, templates: BUILT_IN_WORKFLOW_TEMPLATES });
    try {
      const workflow = await buildLaunchWorkflowSummary(
        designStore,
        parsed.request.designId,
        parsed.request.version ?? undefined,
      );
      if (!workflow.canRun)
        return c.json(
          {
            error: "workflow_unavailable",
            message:
              workflow.unavailableReason ?? "Workflow is not available to run",
          },
          400,
        );
      const roleBindings = await resolveLaunchRoleBindings(
        options,
        parsed.request.workspaceId,
        workflow,
        parsed.request.roleBindings,
      );
      const items = parsed.request.items.map((item, index) => {
        const validationErrors = validateLaunchInputs(workflow, item.inputs);
        return {
          inputs: item.inputs,
          additionalInstructions: item.additionalInstructions,
          roleBindings,
          error:
            Object.keys(validationErrors).length > 0
              ? {
                  code: "workflow_launch_validation_failed",
                  message: `Batch item ${index + 1} is missing required workflow fields.`,
                  fieldErrors: validationErrors,
                }
              : null,
        };
      });
      const runtime = await resolvePersistedWorkflowRuntime(
        options,
        db,
        designStore,
      );
      if (!runtime)
        return c.json(
          {
            error: "workflow_runtime_not_configured",
            message: "Workflow launch is not configured.",
          },
          503,
        );
      const scheduler = new WorkflowBatchSchedulerService({
        db,
        designStore,
        runtime,
        capacity: options.workflowBatchCapacity,
      });
      const batch = await scheduler.enqueueBatch({
        batchId: `workflow-batch-${randomUUID()}`,
        designId: parsed.request.designId,
        version: workflow.version ?? undefined,
        workspaceId: parsed.request.workspaceId,
        items,
      });
      const home = await buildWorkspaceWorkflowsHomeModel({
        db,
        designStore,
        orchestrationStore: options.workflowOrchestrationStore,
        workspaceId: parsed.request.workspaceId,
      });
      return c.json(
        { batch: summarizeWorkflowBatch(batch, workflow.title), home },
        201,
      );
    } catch (error) {
      if (error instanceof WorkflowLaunchFieldError) {
        return c.json(
          {
            error: "workflow_launch_validation_failed",
            message: error.message,
            fieldErrors: error.fieldErrors,
          },
          400,
        );
      }
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: "workflow_batch_launch_failed", message }, 400);
    }
  });

  hono.get("/dashboard/api/workflows/batches/:batchId", async (c) => {
    const batchId = c.req.param("batchId")?.trim();
    if (!batchId)
      return c.json(
        { error: "workflow_batch_required", message: "Batch is required" },
        400,
      );
    const db = options.workflowHomeDb ?? (await getVdDb()).db;
    const designStore =
      options.workflowDesignStore ??
      new DbWorkflowDesignStore({ db, templates: BUILT_IN_WORKFLOW_TEMPLATES });
    const capacity = {
      ...DEFAULT_WORKFLOW_BATCH_CAPACITY,
      ...(options.workflowBatchCapacity ?? {}),
    };
    const scheduler = new WorkflowBatchSchedulerService({
      db,
      designStore,
      runtime: {
        async launch() {
          throw new Error("batch detail read model cannot launch runs");
        },
      },
      capacity,
    });
    const batch = await scheduler.getBatch(batchId);
    if (!batch)
      return c.json(
        {
          error: "workflow_batch_not_found",
          message: "Workflow batch not found",
        },
        404,
      );
    const design = await designStore.getDesign(batch.designId);
    const capacitySnapshot = await scheduler.getCapacitySnapshot(
      batch.workspaceId,
    );
    return c.json({
      batch: summarizeWorkflowBatchDetail(
        batch,
        design?.name ?? "Workflow batch",
        capacitySnapshot,
      ),
    });
  });

  hono.post("/dashboard/api/workflows/launch", async (c) => {
    const body = asRecord(await readJsonBody(c.req.raw));
    const parsed = parseWorkflowLaunchRequest(body);
    if (!parsed.ok)
      return c.json(
        {
          error: parsed.error,
          message: parsed.message,
          fieldErrors: parsed.fieldErrors,
        },
        parsed.status,
      );
    const db = options.workflowHomeDb ?? (await getVdDb()).db;
    const designStore =
      options.workflowDesignStore ??
      new DbWorkflowDesignStore({ db, templates: BUILT_IN_WORKFLOW_TEMPLATES });
    try {
      const workflow = await buildLaunchWorkflowSummary(
        designStore,
        parsed.request.designId,
        parsed.request.version ?? undefined,
      );
      if (!workflow.canRun)
        return c.json(
          {
            error: "workflow_unavailable",
            message:
              workflow.unavailableReason ?? "Workflow is not available to run",
          },
          400,
        );
      const validationErrors = validateLaunchInputs(
        workflow,
        parsed.request.inputs,
      );
      if (Object.keys(validationErrors).length > 0) {
        return c.json(
          {
            error: "workflow_launch_validation_failed",
            message: "Please fill out the required workflow fields.",
            fieldErrors: validationErrors,
          },
          400,
        );
      }
      const roleBindings = await resolveLaunchRoleBindings(
        options,
        parsed.request.workspaceId,
        workflow,
        parsed.request.roleBindings,
      );
      const runtime = await resolvePersistedWorkflowRuntime(
        options,
        db,
        designStore,
      );
      if (!runtime)
        return c.json(
          {
            error: "workflow_runtime_not_configured",
            message: "Workflow launch is not configured.",
          },
          503,
        );
      let run = await runtime.launch({
        runId: `workflow-run-${randomUUID()}`,
        runSnapshotId: `workflow-run-snapshot-${randomUUID()}`,
        designId: parsed.request.designId,
        version: workflow.version ?? undefined,
        workspaceId: parsed.request.workspaceId,
        inputs: parsed.request.inputs,
        additionalInstructions: parsed.request.additionalInstructions,
        roleBindings,
      });
      run = await catchUpPersistedWorkflowCompletedTurns(
        options,
        db,
        runtime,
        run.runId,
      );
      const home = await buildWorkspaceWorkflowsHomeModel({
        db,
        designStore,
        orchestrationStore: options.workflowOrchestrationStore,
        workspaceId: parsed.request.workspaceId,
      });
      return c.json({ run: summarizePersistedRun(run), home }, 201);
    } catch (error) {
      if (error instanceof WorkflowLaunchFieldError) {
        return c.json(
          {
            error: "workflow_launch_validation_failed",
            message: error.message,
            fieldErrors: error.fieldErrors,
          },
          400,
        );
      }
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: "workflow_launch_failed", message }, 400);
    }
  });

  hono.post("/dashboard/api/workflow-templates/:templateId/use", async (c) => {
    const templateId = decodeURIComponent(
      c.req.param("templateId") ?? "",
    ).trim();
    if (!templateId)
      return c.json(
        {
          error: "workflow_template_required",
          message: "Workflow template is required",
        },
        400,
      );
    const body = asRecord(await readJsonBody(c.req.raw));
    const db = options.workflowHomeDb ?? (await getVdDb()).db;
    const designStore =
      options.workflowDesignStore ??
      new DbWorkflowDesignStore({ db, templates: BUILT_IN_WORKFLOW_TEMPLATES });
    try {
      const designId =
        asString(body?.designId) ?? `workflow-design-${randomUUID()}`;
      const draftId =
        asString(body?.draftId) ?? `workflow-draft-${randomUUID()}`;
      const used = await designStore.useTemplate({
        templateId,
        designId,
        draftId,
        name: asString(body?.name) ?? undefined,
        description: asString(body?.description) ?? undefined,
      });
      const shouldPublish = body?.publish !== false;
      const version = shouldPublish
        ? await designStore.publishDraft(used.draft.draftId)
        : null;
      const home = asString(body?.workspaceId)
        ? await buildWorkspaceWorkflowsHomeModel({
            db,
            designStore,
            orchestrationStore: options.workflowOrchestrationStore,
            workspaceId: asString(body?.workspaceId)!,
          })
        : undefined;
      return c.json(
        {
          design: await designStore.getDesign(used.design.designId),
          draft: await designStore.getDraft(used.draft.draftId),
          version,
          home,
        },
        201,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: "workflow_template_use_failed", message }, 400);
    }
  });

  hono.post("/dashboard/api/workflow-designs", async (c) => {
    const body = asRecord(await readJsonBody(c.req.raw));
    const name = asString(body?.name)?.trim();
    const definition = body?.definition;
    const sourceDesignId = asString(body?.sourceDesignId)?.trim();
    const shouldPublish = body?.publish === true;
    if (!name)
      return c.json(
        {
          error: "workflow_name_required",
          message: "Workflow name is required",
        },
        400,
      );
    if (!sourceDesignId && (!definition || typeof definition !== "object"))
      return c.json(
        {
          error: "workflow_definition_required",
          message: "Workflow definition is required",
        },
        400,
      );
    const db = options.workflowHomeDb ?? (await getVdDb()).db;
    const designStore =
      options.workflowDesignStore ??
      new DbWorkflowDesignStore({ db, templates: BUILT_IN_WORKFLOW_TEMPLATES });
    try {
      const designId =
        asString(body?.designId) ?? `workflow-design-${randomUUID()}`;
      const draftId =
        asString(body?.draftId) ?? `workflow-draft-${randomUUID()}`;
      const description = asString(body?.description) ?? null;
      const created = sourceDesignId
        ? await designStore.duplicateDesign({
            sourceDesignId,
            designId,
            draftId,
            name,
            description,
          })
        : await designStore.createDesign({
            designId,
            draftId,
            name,
            description,
            definition,
            source: "user",
          });
      const version = shouldPublish
        ? await designStore.publishDraft(created.draft.draftId)
        : null;
      const editor = await buildWorkflowDesignEditorModel(
        designStore,
        created.design.designId,
      );
      const home = asString(body?.workspaceId)
        ? await buildWorkspaceWorkflowsHomeModel({
            db,
            designStore,
            orchestrationStore: options.workflowOrchestrationStore,
            workspaceId: asString(body?.workspaceId)!,
          })
        : undefined;
      return c.json(
        {
          design: await designStore.getDesign(created.design.designId),
          draft: await designStore.getDraft(created.draft.draftId),
          version,
          editor,
          home,
        },
        201,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: "workflow_design_create_failed", message }, 400);
    }
  });

  hono.post(
    "/dashboard/api/workflow-design-drafts/:draftId/publish",
    async (c) => {
      const draftId = c.req.param("draftId")?.trim();
      if (!draftId)
        return c.json(
          {
            error: "workflow_draft_required",
            message: "Workflow draft is required",
          },
          400,
        );
      const db = options.workflowHomeDb ?? (await getVdDb()).db;
      const designStore =
        options.workflowDesignStore ??
        new DbWorkflowDesignStore({
          db,
          templates: BUILT_IN_WORKFLOW_TEMPLATES,
        });
      try {
        const version = await designStore.publishDraft(draftId);
        const editor = await buildWorkflowDesignEditorModel(
          designStore,
          version.designId,
        );
        return c.json({ version, editor });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return c.json({ error: "workflow_publish_failed", message }, 400);
      }
    },
  );

  hono.get("/dashboard/api/workflow-designs/:designId/editor", async (c) => {
    const designId = c.req.param("designId")?.trim();
    if (!designId)
      return c.json(
        {
          error: "workflow_design_required",
          message: "Workflow design is required",
        },
        400,
      );
    const db = options.workflowHomeDb ?? (await getVdDb()).db;
    const designStore =
      options.workflowDesignStore ??
      new DbWorkflowDesignStore({ db, templates: BUILT_IN_WORKFLOW_TEMPLATES });
    try {
      const editor = await buildWorkflowDesignEditorModel(
        designStore,
        designId,
      );
      if (!editor)
        return c.json(
          {
            error: "workflow_design_not_found",
            message: "Workflow design was not found",
          },
          404,
        );
      return c.json({ editor });
    } catch (error) {
      return c.json(
        {
          error: "workflow_design_editor_failed",
          message: error instanceof Error ? error.message : String(error),
        },
        400,
      );
    }
  });

  hono.patch("/dashboard/api/workflow-design-drafts/:draftId", async (c) => {
    const draftId = c.req.param("draftId")?.trim();
    if (!draftId)
      return c.json(
        {
          error: "workflow_draft_required",
          message: "Workflow draft is required",
        },
        400,
      );
    const body = asRecord(await readJsonBody(c.req.raw));
    const definition = body?.definition;
    if (!definition || typeof definition !== "object")
      return c.json(
        {
          error: "workflow_definition_required",
          message: "Workflow definition is required",
        },
        400,
      );
    const db = options.workflowHomeDb ?? (await getVdDb()).db;
    const designStore =
      options.workflowDesignStore ??
      new DbWorkflowDesignStore({ db, templates: BUILT_IN_WORKFLOW_TEMPLATES });
    try {
      const draft = await designStore.updateDraft(draftId, definition);
      const editor = await buildWorkflowDesignEditorModel(
        designStore,
        draft.designId,
      );
      if (!editor)
        return c.json(
          {
            error: "workflow_design_not_found",
            message: "Workflow design was not found",
          },
          404,
        );
      return c.json({ editor });
    } catch (error) {
      return c.json(
        {
          error: "workflow_draft_update_failed",
          message: error instanceof Error ? error.message : String(error),
        },
        400,
      );
    }
  });

  hono.get("/dashboard/api/workflow-webhooks/inbox", async (c) => {
    const store = options.workflowWebhookInboxStore;
    if (!store)
      return c.json(
        { error: "workflow_webhook_inbox_store_not_configured" },
        503,
      );
    return c.json(
      await store.listEvents({
        limit: parsePositiveInteger(c.req.query("limit") ?? null),
        offset: parsePositiveInteger(c.req.query("offset") ?? null),
      }),
    );
  });

  hono.get("/dashboard/api/workflow-webhooks/provisioning", async (c) => {
    const store = options.workflowWebhookProvisioningStore;
    if (!store)
      return c.json(
        { error: "workflow_webhook_provisioning_store_not_configured" },
        503,
      );
    const state = await store.getPublicState();
    return c.json({ state });
  });

  hono.post("/dashboard/api/workflow-webhooks/vk", async (c) => {
    const store = options.workflowWebhookInboxStore;
    if (!store)
      return c.json(
        { error: "workflow_webhook_inbox_store_not_configured" },
        503,
      );
    const secret =
      options.vkWorkflowWebhookSecret ??
      process.env.VD_VK_WEBHOOK_SECRET ??
      (await options.workflowWebhookProvisioningStore?.getSecret());
    if (!secret)
      return c.json(
        {
          error: "vk_workflow_webhook_secret_not_configured",
          message:
            "VK workflow webhook HMAC secret is not configured. Wait for webhook provisioning or configure VD_VK_WEBHOOK_SECRET.",
        },
        503,
      );
    const rawBody = await c.req.raw.text();
    try {
      verifyVkWebhookSignature({
        secret,
        timestamp: c.req.header("X-VK-Webhook-Timestamp") ?? null,
        algorithm: c.req.header("X-VK-Webhook-Algorithm") ?? null,
        signature: c.req.header("X-VK-Webhook-Signature") ?? null,
        body: rawBody,
      });
      const event = parseVkWorkflowWebhookPayload(parseJsonBody(rawBody));
      const inserted = await store.insertEvent({
        event,
        signatureHeader: c.req.header("X-VK-Webhook-Signature") ?? null,
        timestampHeader: c.req.header("X-VK-Webhook-Timestamp") ?? null,
      });
      if (inserted.duplicate) {
        return c.json(
          { accepted: true, duplicate: true, inbox: inserted.inbox },
          202,
        );
      }
      try {
        const db = options.workflowHomeDb ?? (await getVdDb()).db;
        const designStore =
          options.workflowDesignStore ??
          new DbWorkflowDesignStore({
            db,
            templates: BUILT_IN_WORKFLOW_TEMPLATES,
          });
        const persistedWorkflow =
          await completePersistedWorkflowTurnFromVkWebhook(
            options,
            db,
            designStore,
            event,
          );
        const wakeup = await options.workflowWebhookWakeup?.trigger();
        const processed = await store.markProcessed(inserted.inbox.inboxId);
        return c.json(
          {
            accepted: true,
            duplicate: false,
            inbox: processed,
            persistedWorkflow,
            wakeup: {
              started: Boolean(wakeup?.started),
              queued: Boolean(wakeup?.queued),
              passes: wakeup?.passes ?? null,
            },
          },
          202,
        );
      } catch (error) {
        const failed = await store.markFailed(inserted.inbox.inboxId, error);
        return c.json(
          {
            accepted: true,
            duplicate: false,
            inbox: failed,
            wakeup: {
              started: true,
              error: error instanceof Error ? error.message : String(error),
            },
          },
          202,
        );
      }
    } catch (error) {
      if (error instanceof WorkflowWebhookSignatureError) {
        return c.json(
          {
            error: "invalid_vk_workflow_webhook_signature",
            message: error.message,
          },
          401,
        );
      }
      if (error instanceof WorkflowWebhookPayloadError) {
        return c.json(
          {
            error: "invalid_vk_workflow_webhook_payload",
            message: error.message,
          },
          400,
        );
      }
      return c.json(
        { error: error instanceof Error ? error.message : String(error) },
        400,
      );
    }
  });

  hono.get("/dashboard/api/declarative-workflow-definitions", async (c) => {
    const store = options.declarativeWorkflowDefinitionStore;
    const stored = store
      ? await store.listDefinitions({
          includeDisabled: c.req.query("includeDisabled") === "true",
        })
      : [];
    const storedKeys = new Set(
      stored.map((entry) => `${entry.definitionId}:${entry.version}`),
    );
    const builtIns = BUILT_IN_DECLARATIVE_WORKFLOW_DEFINITIONS.filter(
      (definition) => !storedKeys.has(`${definition.id}:${definition.version}`),
    ).map((definition) => ({
      source: "built_in",
      definitionId: definition.id,
      version: definition.version,
      status: "active",
      name: definition.name,
      description: definition.description ?? null,
      trigger: definition.trigger,
      definition,
    }));
    return c.json({
      definitions: [
        ...stored.map((definition) => ({ ...definition, source: "db" })),
        ...builtIns,
      ],
    });
  });

  hono.get(
    "/dashboard/api/declarative-workflow-definitions/:definitionId",
    async (c) => {
      const definition = await resolveDeclarativeDefinitionFromRegistry(
        c.req.param("definitionId"),
        undefined,
        options,
        { includeDisabled: c.req.query("includeDisabled") === "true" },
      );
      if (!definition)
        return c.json(
          { error: "declarative_workflow_definition_not_found" },
          404,
        );
      return c.json({ definition });
    },
  );

  hono.get(
    "/dashboard/api/declarative-workflow-definitions/:definitionId/versions/:version",
    async (c) => {
      const version = parsePositiveInteger(c.req.param("version"));
      if (!version) return c.json({ error: "invalid_definition_version" }, 400);
      const definition = await resolveDeclarativeDefinitionFromRegistry(
        c.req.param("definitionId"),
        version,
        options,
        { includeDisabled: c.req.query("includeDisabled") === "true" },
      );
      if (!definition)
        return c.json(
          { error: "declarative_workflow_definition_not_found" },
          404,
        );
      return c.json({ definition });
    },
  );

  hono.post("/dashboard/api/declarative-workflow-definitions", async (c) => {
    const store = options.declarativeWorkflowDefinitionStore;
    if (!store)
      return c.json(
        { error: "declarative_workflow_definition_store_not_configured" },
        503,
      );
    try {
      const body = asRecord(await readJsonBody(c.req.raw));
      const saved = await store.saveDefinition({
        definition: body?.definition,
        status: body?.status === "disabled" ? "disabled" : "active",
      });
      return c.json({ definition: saved }, 200);
    } catch (error) {
      return c.json(
        { error: error instanceof Error ? error.message : String(error) },
        400,
      );
    }
  });

  hono.delete(
    "/dashboard/api/declarative-workflow-definitions/:definitionId",
    async (c) => {
      const store = options.declarativeWorkflowDefinitionStore;
      if (!store)
        return c.json(
          { error: "declarative_workflow_definition_store_not_configured" },
          503,
        );
      const version = parsePositiveInteger(c.req.query("version") ?? null);
      const disabled = await store.disableDefinition(
        c.req.param("definitionId"),
        version,
      );
      if (!disabled)
        return c.json(
          { error: "declarative_workflow_definition_not_found" },
          404,
        );
      return c.json({ definition: disabled });
    },
  );

  hono.get("/dashboard/api/workflows", (c) => {
    return c.json({
      workflows: options.registry.list().map((workflow) => ({
        id: workflow.id,
        trigger: workflow.trigger,
      })),
    });
  });

  hono.get("/dashboard/api/workflow-runs", async (c) => {
    const reader = options.workflowRunReader;
    if (!reader)
      return c.json({ error: "workflow_run_reader_not_configured" }, 503);
    const result = await reader.listRuns({
      workflowId: c.req.query("workflowId") || undefined,
      status: parseWorkflowRunStatus(c.req.query("status") ?? null),
      vkWorkspaceId: c.req.query("vkWorkspaceId") || undefined,
      vkSessionId: c.req.query("vkSessionId") || undefined,
      vkQueueItemId: c.req.query("vkQueueItemId") || undefined,
      limit: parsePositiveInteger(c.req.query("limit") ?? null),
      offset: parsePositiveInteger(c.req.query("offset") ?? null),
    });
    return c.json(result);
  });

  hono.get("/dashboard/api/workflow-runs/:runId", async (c) => {
    const reader = options.workflowRunReader;
    if (!reader)
      return c.json({ error: "workflow_run_reader_not_configured" }, 503);
    const run = await reader.getRun(c.req.param("runId"));
    if (!run) return c.json({ error: "workflow_run_not_found" }, 404);
    return c.json({ run });
  });

  hono.get("/dashboard/api/workflow-runs/:runId/events", async (c) => {
    const reader = options.workflowRunReader;
    if (!reader)
      return c.json({ error: "workflow_run_reader_not_configured" }, 503);
    const result = await reader.listRunEvents(c.req.param("runId"), {
      limit: parsePositiveInteger(c.req.query("limit") ?? null),
      offset: parsePositiveInteger(c.req.query("offset") ?? null),
    });
    if (!result) return c.json({ error: "workflow_run_not_found" }, 404);
    return c.json(result);
  });

  hono.post("/dashboard/api/agent-team-session-mappings/resolve", async (c) => {
    const resolver = options.roleSessionResolver;
    if (!resolver)
      return c.json({ error: "role_session_resolver_not_configured" }, 503);
    try {
      const input = await readJsonBody(c.req.raw);
      const result = await resolver.resolve(
        parseRoleSessionResolveRequest(input),
      );
      const status = result.ok ? 200 : 400;
      return c.json(result, status);
    } catch (error) {
      return c.json(
        { error: error instanceof Error ? error.message : String(error) },
        400,
      );
    }
  });

  hono.get("/dashboard/api/workflow-activity", async (c) => {
    const scanner = options.workflowActivityScanner;
    if (!scanner)
      return c.json({ error: "workflow_activity_scanner_not_configured" }, 503);
    const scan = await scanner.scanOnce(
      parseWorkflowActivityPolicy(c.req.query()),
    );
    return c.json(scan);
  });

  hono.get("/dashboard/api/workflow-instances", async (c) => {
    const store = options.workflowOrchestrationStore;
    if (!store)
      return c.json(
        { error: "workflow_orchestration_store_not_configured" },
        503,
      );
    const result = await store.listInstances({
      workflowId: c.req.query("workflowId") || undefined,
      status: parseWorkflowInstanceStatus(c.req.query("status") ?? null),
      teamId: c.req.query("teamId") || undefined,
      laneId: c.req.query("laneId") || undefined,
      limit: parsePositiveInteger(c.req.query("limit") ?? null),
      offset: parsePositiveInteger(c.req.query("offset") ?? null),
    });
    return c.json(result);
  });

  hono.get("/dashboard/api/workflow-instances/:instanceId", async (c) => {
    const store = options.workflowOrchestrationStore;
    if (!store)
      return c.json(
        { error: "workflow_orchestration_store_not_configured" },
        503,
      );
    const instance = await store.getInstance(c.req.param("instanceId"));
    if (!instance) return c.json({ error: "workflow_instance_not_found" }, 404);
    return c.json({ instance });
  });

  hono.get(
    "/dashboard/api/workflow-instances/:instanceId/status",
    async (c) => {
      const store = options.workflowOrchestrationStore;
      if (!store)
        return c.json(
          { error: "workflow_orchestration_store_not_configured" },
          503,
        );
      const instance = await store.getInstance(c.req.param("instanceId"));
      if (!instance)
        return c.json({ error: "workflow_instance_not_found" }, 404);
      const steps = await store.listStepStates(instance.instanceId);
      const triggers = await store.listTriggers({
        instanceId: instance.instanceId,
        limit: 100,
      });
      return c.json({
        instance,
        steps,
        triggers: triggers.triggers,
        output: asRecord(instance.state)?.output ?? null,
      });
    },
  );

  hono.get(
    "/dashboard/api/workflow-instances/:instanceId/presentation",
    async (c) => {
      const instanceId = c.req.param("instanceId");
      const db = options.workflowHomeDb ?? (await getVdDb()).db;
      const persistedPresentation =
        await buildPersistedWorkflowPresentationModel({
          db,
          runId: instanceId,
        });
      if (persistedPresentation)
        return c.json({ presentation: persistedPresentation });

      const store = options.workflowOrchestrationStore;
      if (store) {
        const presentation = await buildWorkflowPresentationModel({
          store,
          vk: getPresentationVkClient(options),
          instanceId,
        });
        if (presentation) return c.json({ presentation });
      }
      return c.json(
        {
          error: "workflow_presentation_not_found",
          message: "Workflow not found",
        },
        404,
      );
    },
  );

  hono.get("/dashboard/api/workflow-attention-items", async (c) => {
    const store = options.workflowOrchestrationStore;
    if (!store)
      return c.json(
        { error: "workflow_orchestration_store_not_configured" },
        503,
      );
    const result = await store.listAttentionItems({
      status: parseWorkflowAttentionStatus(c.req.query("status") ?? null),
      teamId: c.req.query("teamId") || undefined,
      laneId: c.req.query("laneId") || undefined,
      instanceId: c.req.query("instanceId") || undefined,
      limit: parsePositiveInteger(c.req.query("limit") ?? null),
      offset: parsePositiveInteger(c.req.query("offset") ?? null),
    });
    return c.json(result);
  });

  hono.get(
    "/dashboard/api/workflow-attention-items/:attentionItemId",
    async (c) => {
      const store = options.workflowOrchestrationStore;
      if (!store)
        return c.json(
          { error: "workflow_orchestration_store_not_configured" },
          503,
        );
      const item = await store.getAttentionItem(c.req.param("attentionItemId"));
      if (!item)
        return c.json({ error: "workflow_attention_item_not_found" }, 404);
      return c.json({ item });
    },
  );

  hono.post(
    "/dashboard/api/workflow-attention-items/:attentionItemId/complete",
    async (c) => {
      const store = options.workflowOrchestrationStore;
      if (!store)
        return c.json(
          { error: "workflow_orchestration_store_not_configured" },
          503,
        );
      try {
        const body = asRecord(await readJsonBody(c.req.raw)) ?? {};
        const attention = await store.getAttentionItem(
          c.req.param("attentionItemId"),
        );
        if (!attention)
          return c.json({ error: "workflow_attention_item_not_found" }, 404);
        const db = options.workflowHomeDb ?? (await getVdDb()).db;
        const designStore =
          options.workflowDesignStore ??
          new DbWorkflowDesignStore({
            db,
            templates: BUILT_IN_WORKFLOW_TEMPLATES,
          });
        const persistedRun = await db
          .selectFrom("WorkflowPersistedRun")
          .select(["runId", "coreSnapshotJson"])
          .where("runId", "=", attention.instanceId)
          .executeTakeFirst();
        const runtime = persistedRun
          ? await resolvePersistedWorkflowRuntime(options, db, designStore)
          : null;
        if (persistedRun && !runtime) {
          return c.json(
            {
              error: "workflow_persisted_runtime_not_configured",
              message:
                "Workflow answer cannot be submitted because persisted workflow resume is not configured.",
            },
            503,
          );
        }
        const catchUp =
          persistedRun && runtime && attention.status === "resolved"
            ? persistedHumanFormCatchUp(
                attention,
                persistedRun.coreSnapshotJson,
              )
            : null;
        if (catchUp && runtime) {
          try {
            await runtime.completeHumanForm({
              runId: attention.instanceId,
              turnId: catchUp.turnId,
              responseRef: attention.attentionItemId,
              submission: catchUp.submission,
            });
            return c.json({
              result: {
                applied: true,
                reason: "applied",
                attention,
                instance: null,
                step: null,
                validationErrors: [],
              },
              recovered: true,
            });
          } catch (error) {
            return c.json(
              {
                error: "workflow_persisted_resume_failed",
                message:
                  error instanceof Error
                    ? error.message
                    : "Workflow answer was saved but workflow resume failed.",
              },
              500,
            );
          }
        }
        const result = await store.completeHumanAttention({
          attentionItemId: c.req.param("attentionItemId"),
          stateVisitId: asString(body.stateVisitId),
          submission: body.submission ?? {},
        });
        if (result.applied && persistedRun && runtime) {
          try {
            await runtime.completeHumanForm({
              runId: result.attention.instanceId,
              turnId: result.attention.attentionItemId.startsWith("attention-")
                ? result.attention.attentionItemId.slice("attention-".length)
                : result.attention.stepId,
              responseRef: result.attention.attentionItemId,
              submission: asRecord(body.submission) ?? {},
            });
          } catch (error) {
            return c.json(
              {
                error: "workflow_persisted_resume_failed",
                message:
                  error instanceof Error
                    ? error.message
                    : "Workflow answer was saved but workflow resume failed.",
                result,
              },
              500,
            );
          }
        }
        const status =
          result.reason === "invalid_submission" ||
          result.reason === "stale_state_visit"
            ? 400
            : 200;
        return c.json({ result }, status);
      } catch (error) {
        return c.json(
          { error: error instanceof Error ? error.message : String(error) },
          400,
        );
      }
    },
  );

  hono.post(
    "/dashboard/api/declarative-workflows/:workflowId/run",
    async (c) => {
      const runtime = options.declarativeWorkflowRuntime;
      if (!runtime)
        return c.json(
          { error: "declarative_workflow_runtime_not_configured" },
          503,
        );
      try {
        const workflowId = c.req.param("workflowId");
        const body = asRecord(await readJsonBody(c.req.raw));
        const definition = await resolveDeclarativeDefinition(
          workflowId,
          body?.definition,
          options,
        );
        if (!definition)
          return c.json({ error: "declarative_workflow_not_found" }, 404);
        const team = asRecord(body?.team);
        if (!team) return c.json({ error: "team is required" }, 400);
        const result = await runtime.start({
          definition,
          input: asRecord(body?.input) ?? {},
          team: team as never,
          instanceId: asString(body?.instanceId),
          trigger: asString(body?.trigger),
          teamId: asString(body?.teamId),
        });
        return c.json({ result }, 202);
      } catch (error) {
        return c.json(
          { error: error instanceof Error ? error.message : String(error) },
          400,
        );
      }
    },
  );

  hono.post(
    "/dashboard/api/declarative-workflows/:workflowId/run-once",
    async (c) => {
      const runtime = options.declarativeWorkflowRuntime;
      if (!runtime)
        return c.json(
          { error: "declarative_workflow_runtime_not_configured" },
          503,
        );
      try {
        const body = asRecord(await readJsonBody(c.req.raw));
        const definition = await resolveDeclarativeDefinition(
          c.req.param("workflowId"),
          body?.definition,
          options,
        );
        if (!definition)
          return c.json({ error: "declarative_workflow_not_found" }, 404);
        const result = await runtime.runOnce({ definition });
        return c.json({ result });
      } catch (error) {
        return c.json(
          { error: error instanceof Error ? error.message : String(error) },
          400,
        );
      }
    },
  );

  hono.get("/dashboard/api/workflow-scoped-triggers", async (c) => {
    const store = options.workflowOrchestrationStore;
    if (!store)
      return c.json(
        { error: "workflow_orchestration_store_not_configured" },
        503,
      );
    const result = await store.listTriggers({
      instanceId: c.req.query("instanceId") || undefined,
      status: parseWorkflowTriggerStatus(c.req.query("status") ?? null),
      workspaceId: c.req.query("workspaceId") || undefined,
      sessionId: c.req.query("sessionId") || undefined,
      limit: parsePositiveInteger(c.req.query("limit") ?? null),
      offset: parsePositiveInteger(c.req.query("offset") ?? null),
    });
    return c.json(result);
  });

  hono.get("/dashboard/api/workflow-scoped-triggers/:triggerId", async (c) => {
    const store = options.workflowOrchestrationStore;
    if (!store)
      return c.json(
        { error: "workflow_orchestration_store_not_configured" },
        503,
      );
    const trigger = await store.getTrigger(c.req.param("triggerId"));
    if (!trigger)
      return c.json({ error: "workflow_scoped_trigger_not_found" }, 404);
    return c.json({ trigger });
  });

  hono.post("/dashboard/api/webhooks/github", async (c) => {
    try {
      const event = c.req.header("X-GitHub-Event") || "";
      const rawBody = await c.req.raw.text();
      const signatureResult = verifyGitHubWebhookSignature({
        body: rawBody,
        secret:
          options.githubWebhookSecret ?? process.env.GITHUB_WEBHOOK_SECRET,
        signature: c.req.header("X-Hub-Signature-256"),
      });
      if (!signatureResult.ok) {
        return c.json({ error: signatureResult.error }, signatureResult.status);
      }
      const payload = parseJsonBody(rawBody);
      const delivery = c.req.header("X-GitHub-Delivery") || "";
      const payloadSummary = summarizeGitHubWebhookPayload(payload);
      console.info("GitHub webhook received", {
        delivery,
        event,
        ...payloadSummary,
      });
      const run = await runGitHubCiFailureWorkflow({
        event,
        payload,
        options,
        delivery,
      });
      const outcome = getRunOutcome(run.output);
      console.info("GitHub webhook workflow completed", {
        delivery,
        event,
        outcome,
        status: run.status,
        runId: run.runId,
      });
      const status = run.status === "failed" ? 500 : 200;
      return c.json({ outcome, run }, status);
    } catch (error) {
      if (error instanceof WorkflowNotFoundError) {
        return c.json({ error: error.message }, 404);
      }

      console.error("GitHub webhook workflow route failed", error);
      return c.json(
        { error: "Internal GitHub webhook workflow route error" },
        500,
      );
    }
  });

  hono.post("/dashboard/api/workflows/:workflowId/run", async (c) => {
    const { workflowId } = c.req.param();
    try {
      const input = await readJsonBody(c.req.raw);
      const run = await runWorkflow(
        options.registry,
        workflowId,
        input,
        getRunOptions(options),
      );
      const status = run.status === "failed" ? 500 : 200;
      return c.json({ run }, status);
    } catch (error) {
      if (error instanceof WorkflowNotFoundError) {
        return c.json({ error: error.message }, 404);
      }

      console.error("Workflow route failed", error);
      return c.json({ error: "Internal workflow route error" }, 500);
    }
  });
}

async function runGitHubCiFailureWorkflow(args: {
  event: string;
  payload: unknown;
  options: RegisterWorkflowRoutesOptions;
  delivery: string;
}) {
  const firstRun = await runWorkflow(
    args.options.registry,
    "github-ci-failure",
    {
      event: args.event,
      payload: args.payload,
      repoAliases: await getCachedRepoAliases(args.options.repoAliasCache),
    },
    getRunOptions(args.options),
  );

  if (getRunOutcome(firstRun.output) !== "no_matching_workspace") {
    return firstRun;
  }

  const refreshedRepoAliases = await refreshCachedRepoAliases(
    args.options.repoAliasCache,
  );
  if (!refreshedRepoAliases) {
    return firstRun;
  }

  console.info(
    "Retrying GitHub webhook workflow after refreshing repo aliases",
    {
      delivery: args.delivery,
      event: args.event,
    },
  );

  return runWorkflow(
    args.options.registry,
    "github-ci-failure",
    {
      event: args.event,
      payload: args.payload,
      repoAliases: refreshedRepoAliases,
    },
    getRunOptions(args.options),
  );
}

function getRunOptions(
  options: RegisterWorkflowRoutesOptions,
): RunWorkflowOptions | undefined {
  if (!options.workflowRunRecorder) return options.runOptions;
  return {
    ...options.runOptions,
    recorder: composeWorkflowRecorders(
      options.runOptions?.recorder,
      options.workflowRunRecorder,
    ),
  };
}

function composeWorkflowRecorders(
  first: WorkflowRecorder | undefined,
  second: WorkflowRecorder,
): WorkflowRecorder {
  if (!first) return second;
  return {
    onRunStarted: async (run) => {
      await first.onRunStarted?.(run);
      await second.onRunStarted?.(run);
    },
    onRunCompleted: async (run) => {
      await first.onRunCompleted?.(run);
      await second.onRunCompleted?.(run);
    },
  };
}

async function readJsonBody(request: Request): Promise<unknown> {
  return parseJsonBody(await request.text());
}

function parseJsonBody(raw: string): unknown {
  if (!raw.trim()) return {};
  return JSON.parse(raw) as unknown;
}

function getRunOutcome(output: unknown): unknown {
  if (output && typeof output === "object" && "outcome" in output) {
    return (output as { outcome: unknown }).outcome;
  }
  return undefined;
}

function summarizeGitHubWebhookPayload(
  payload: unknown,
): Record<string, unknown> {
  const record = asRecord(payload);
  const workflowRun = asRecord(record?.workflow_run);
  return {
    action: asString(record?.action),
    workflowRunStatus: asString(workflowRun?.status),
    workflowRunConclusion: asString(workflowRun?.conclusion),
    workflowRunHtmlUrl: asString(workflowRun?.html_url),
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

interface WorkflowLaunchRoleBindingRequest {
  mode: "existing" | "create_or_reuse";
  sessionId?: string;
  name?: string;
  executorType?: string;
  model?: string;
}

interface WorkflowLaunchRequest {
  workspaceId: string;
  designId: string;
  version: number | null;
  inputs: Record<string, unknown>;
  additionalInstructions: string | null;
  roleBindings: Record<string, WorkflowLaunchRoleBindingRequest>;
}

interface WorkflowBatchLaunchRequest {
  workspaceId: string;
  designId: string;
  version: number | null;
  items: Array<{
    inputs: Record<string, unknown>;
    additionalInstructions: string | null;
  }>;
  roleBindings: Record<string, WorkflowLaunchRoleBindingRequest>;
}

class WorkflowLaunchFieldError extends Error {
  readonly fieldErrors: Record<string, string>;

  constructor(path: string, message: string) {
    super(message);
    this.name = "WorkflowLaunchFieldError";
    this.fieldErrors = { [path]: message };
  }
}

async function buildLaunchWorkflowSummary(
  designStore: DbWorkflowDesignStore,
  designId: string,
  version?: number,
) {
  const design = await designStore.getDesign(designId);
  if (!design) throw new Error("Workflow was not found.");
  const publishedVersion = version ?? design.latestPublishedVersion;
  const published =
    publishedVersion == null
      ? null
      : await designStore.getVersion(designId, publishedVersion);
  return {
    id: design.designId,
    title: design.name,
    description: design.description,
    source: "published_design" as const,
    status: published ? ("ready" as const) : ("unavailable" as const),
    version: published?.version ?? publishedVersion ?? null,
    unavailableReason: published
      ? null
      : "Publish this workflow before running it.",
    canRun: Boolean(published),
    inputs: published
      ? summarizeLaunchInputs(published.resolvedDefinition)
      : [],
    roles: published ? summarizeLaunchRoles(published.resolvedDefinition) : [],
    launchSummary: published
      ? summarizeLaunchSummary(published.resolvedDefinition)
      : emptyLaunchSummary(),
  };
}

async function buildWorkflowDesignEditorModel(
  designStore: DbWorkflowDesignStore,
  designId: string,
) {
  const design = await designStore.getDesign(designId);
  if (!design) return null;
  const draft = design.currentDraftId
    ? await designStore.getDraft(design.currentDraftId)
    : null;
  if (draft) {
    return {
      designId: design.designId,
      name: design.name,
      description: design.description,
      draftId: draft.draftId,
      version: draft.baseVersion,
      readonly: false,
      definition: draft.definition as AgentWorkflowDefinitionV1,
      validationStatus: draft.validationStatus,
      validationIssues: draft.validationIssues,
    };
  }
  const published =
    design.latestPublishedVersion == null
      ? null
      : await designStore.getVersion(
          design.designId,
          design.latestPublishedVersion,
        );
  if (!published)
    throw new Error("Workflow design has no draft or published version.");
  return {
    designId: design.designId,
    name: design.name,
    description: design.description,
    draftId: null,
    version: published.version,
    readonly: true,
    definition: published.resolvedDefinition,
    validationStatus: "valid" as const,
    validationIssues: [],
  };
}

function summarizeLaunchSummary(definition: unknown) {
  const record = asRecord(definition) ?? {};
  const states = asRecord(record.states) ?? {};
  const roles = asRecord(record.roles) ?? {};
  const firstStateId = asString(record.initialState) ?? null;
  const firstState = firstStateId ? asRecord(states[firstStateId]) : null;
  const firstActorRoleId = firstState
    ? (asString(firstState.owner) ?? null)
    : null;
  const firstRole = firstActorRoleId ? asRecord(roles[firstActorRoleId]) : null;
  return {
    firstStateId,
    firstActorRoleId,
    firstActorLabel: firstRole
      ? (asString(firstRole.label) ?? firstActorRoleId)
      : firstActorRoleId,
    mayNeedHumanInput: Object.values(states).some((state) =>
      hasLaunchStepType(state, "human_form"),
    ),
    mayCallWorkflows: Object.values(states).some((state) =>
      hasLaunchStepType(state, "workflow_call"),
    ),
  };
}

function hasLaunchStepType(state: unknown, type: string): boolean {
  const steps = asRecord(state)?.steps;
  if (!Array.isArray(steps)) return false;
  return steps.some((step) => asRecord(step)?.type === type);
}

function emptyLaunchSummary() {
  return {
    firstStateId: null,
    firstActorRoleId: null,
    firstActorLabel: null,
    mayNeedHumanInput: false,
    mayCallWorkflows: false,
  };
}

function summarizeLaunchInputs(definition: unknown) {
  const inputs = asRecord(definition)?.inputs;
  const inputRecord = asRecord(inputs) ?? {};
  return Object.entries(inputRecord).map(([id, spec]) => {
    const record = asRecord(spec) ?? {};
    return {
      id,
      type: asString(record.type) ?? "string",
      required: record.required === true,
      description: asString(record.description) ?? null,
    };
  });
}

function summarizeLaunchRoles(definition: unknown) {
  const roles = asRecord(definition)?.roles;
  const roleRecord = asRecord(roles) ?? {};
  return Object.entries(roleRecord).map(([id, spec]) => {
    const record = asRecord(spec) ?? {};
    const preference = normalizeRoleExecutorPreference(
      record.executorPreference,
    );
    return {
      id,
      label: asString(record.label) ?? id,
      description: asString(record.description) ?? null,
      executorPreference: preference,
    };
  });
}

function normalizeRoleExecutorPreference(value: unknown): {
  executorType: string | null;
  model: string | null;
  mode: "preferred";
} | null {
  const record = asRecord(value);
  if (!record) return null;
  return {
    executorType: asString(record.executorType)?.trim() || null,
    model: asString(record.model)?.trim() || null,
    mode: "preferred",
  };
}

function resolveRolePreference(
  role: {
    executorPreference?: {
      executorType: string | null;
      model: string | null;
      mode: "preferred";
    } | null;
  },
  binding: WorkflowLaunchRoleBindingRequest,
): {
  executorType: string | null;
  model: string | null;
  source: "role_default" | "launch_override" | "workspace_default";
} {
  const bindingExecutor = binding.executorType?.trim();
  const bindingModel = binding.model?.trim();
  const rolePreference = role.executorPreference ?? null;
  return {
    executorType: bindingExecutor || rolePreference?.executorType || null,
    model: bindingModel || rolePreference?.model || null,
    source:
      bindingExecutor || bindingModel
        ? "launch_override"
        : rolePreference
          ? "role_default"
          : "workspace_default",
  };
}

function normalizeVkExecutor(value: string | null): Executor | null {
  if (!value) return null;
  const normalized = value
    .trim()
    .toUpperCase()
    .replace(/[-\s]+/g, "_");
  return WORKFLOW_EXECUTOR_TYPES.includes(normalized as never)
    ? (normalized as Executor)
    : null;
}

function modelMatchesExecutor(
  executorType: Executor | null,
  model: string | null,
): boolean {
  if (!model || !executorType) return true;
  return (
    WORKFLOW_EXECUTOR_MODEL_OPTIONS[executorType]?.models.includes(model) ??
    false
  );
}

function listWorkflowExecutorOptions() {
  return WORKFLOW_EXECUTOR_TYPES.map((executorType) => {
    const option = WORKFLOW_EXECUTOR_MODEL_OPTIONS[executorType];
    return { executorType, label: option.label, models: option.models };
  });
}

async function listLaunchSessions(
  options: RegisterWorkflowRoutesOptions,
  workspaceId: string,
) {
  if (!options.vkClient?.getSessions) return [];
  const sessions = await options.vkClient.getSessions(workspaceId);
  return sessions.map((session) => ({
    sessionId: session.id,
    name: session.name ?? null,
    executor: session.executor,
    model: session.model ?? null,
    workspaceId: session.workspace_id,
  }));
}

async function resolveLaunchRoleBindings(
  options: RegisterWorkflowRoutesOptions,
  workspaceId: string,
  workflow: Awaited<ReturnType<typeof buildLaunchWorkflowSummary>>,
  requested: Record<string, WorkflowLaunchRoleBindingRequest>,
) {
  const result: Record<
    string,
    {
      sessionId: string;
      workspaceId: string;
      executorType: string | null;
      model: string | null;
      preferenceMode: "preferred";
      preferenceSource:
        "role_default" | "launch_override" | "workspace_default";
    }
  > = {};
  for (const role of workflow.roles) {
    const binding = requested[role.id];
    if (!binding)
      throw new WorkflowLaunchFieldError(
        `role.${role.id}`,
        `Choose a session for ${role.label}.`,
      );
    const preference = resolveRolePreference(role, binding);
    const expectedExecutor = normalizeVkExecutor(preference.executorType);
    if (preference.executorType && !expectedExecutor) {
      throw new WorkflowLaunchFieldError(
        `role.${role.id}.executorType`,
        `${role.label} uses unsupported executor ${preference.executorType}.`,
      );
    }
    if (!modelMatchesExecutor(expectedExecutor, preference.model)) {
      throw new WorkflowLaunchFieldError(
        `role.${role.id}.model`,
        `${role.label} uses unsupported model ${preference.model} for ${expectedExecutor}.`,
      );
    }
    if (binding.mode === "existing") {
      const sessionId = binding.sessionId?.trim();
      if (!sessionId)
        throw new WorkflowLaunchFieldError(
          `role.${role.id}`,
          `Choose an existing session for ${role.label}.`,
        );
      if (options.vkClient?.getSession) {
        const session = await options.vkClient.getSession(sessionId);
        if (session.workspace_id !== workspaceId)
          throw new WorkflowLaunchFieldError(
            `role.${role.id}`,
            `${role.label} session belongs to another workspace.`,
          );
        if (expectedExecutor && session.executor !== expectedExecutor)
          throw new WorkflowLaunchFieldError(
            `role.${role.id}.executorType`,
            `${role.label} session uses ${session.executor}, but workflow prefers ${expectedExecutor}. Choose or create a compatible session.`,
          );
        if (
          preference.model &&
          session.model &&
          session.model !== preference.model
        )
          throw new WorkflowLaunchFieldError(
            `role.${role.id}.model`,
            `${role.label} session uses model ${session.model}, but workflow prefers ${preference.model}. Choose or create a compatible session.`,
          );
      }
      result[role.id] = {
        sessionId,
        workspaceId,
        executorType: expectedExecutor ?? null,
        model: preference.model,
        preferenceMode: "preferred",
        preferenceSource: preference.source,
      };
      continue;
    }
    const name = binding.name?.trim() || role.label;
    if (!options.vkClient?.getSessions || !options.vkClient.createSession) {
      throw new WorkflowLaunchFieldError(
        `role.${role.id}`,
        `Cannot create or reuse a session for ${role.label}.`,
      );
    }
    try {
      const sessions = await options.vkClient.getSessions(workspaceId);
      const reusable = [...sessions]
        .sort(
          (left, right) =>
            Date.parse(right.updated_at) - Date.parse(left.updated_at),
        )
        .find(
          (session) =>
            session.name === name &&
            (!expectedExecutor || session.executor === expectedExecutor) &&
            (!preference.model ||
              !session.model ||
              session.model === preference.model),
        );
      const session =
        reusable ??
        (await options.vkClient.createSession({
          workspace_id: workspaceId,
          executor: expectedExecutor ?? "CODEX",
          name,
          model: preference.model,
        }));
      if (session.workspace_id !== workspaceId)
        throw new Error(`${role.label} session belongs to another workspace.`);
      result[role.id] = {
        sessionId: session.id,
        workspaceId,
        executorType: expectedExecutor ?? session.executor ?? null,
        model: preference.model,
        preferenceMode: "preferred",
        preferenceSource: preference.source,
      };
    } catch (error) {
      throw new WorkflowLaunchFieldError(
        `role.${role.id}`,
        error instanceof Error
          ? error.message
          : `Cannot create or reuse a session for ${role.label}.`,
      );
    }
  }
  return result;
}

function validateLaunchInputs(
  workflow: Awaited<ReturnType<typeof buildLaunchWorkflowSummary>>,
  inputs: Record<string, unknown>,
): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const input of workflow.inputs) {
    const value = inputs[input.id];
    if (!input.required) continue;
    if (
      value === undefined ||
      value === null ||
      (typeof value === "string" && value.trim() === "")
    ) {
      errors[input.id] = "This field is required.";
    }
  }
  return errors;
}

function parseWorkflowLaunchRequest(record: Record<string, unknown> | null):
  | { ok: true; request: WorkflowLaunchRequest }
  | {
      ok: false;
      status: 400;
      error: string;
      message: string;
      fieldErrors?: Record<string, string>;
    } {
  const workspaceId = asString(record?.workspaceId)?.trim();
  const designId = asString(record?.designId)?.trim();
  const inputs = asRecord(record?.inputs) ?? {};
  const roleBindings = asRecord(record?.roleBindings) ?? {};
  const fieldErrors: Record<string, string> = {};
  if (!workspaceId) fieldErrors.workspaceId = "Workspace is required.";
  if (!designId) fieldErrors.designId = "Workflow is required.";
  if (Object.keys(fieldErrors).length > 0)
    return {
      ok: false,
      status: 400,
      error: "workflow_launch_validation_failed",
      message: "Please fix the launch details.",
      fieldErrors,
    };
  return {
    ok: true,
    request: {
      workspaceId: workspaceId!,
      designId: designId!,
      version: typeof record?.version === "number" ? record.version : null,
      inputs,
      additionalInstructions:
        asString(record?.additionalInstructions)?.trim() || null,
      roleBindings: normalizeRoleBindings(roleBindings),
    },
  };
}

function parseWorkflowBatchLaunchRequest(
  record: Record<string, unknown> | null,
):
  | { ok: true; request: WorkflowBatchLaunchRequest }
  | {
      ok: false;
      status: 400;
      error: string;
      message: string;
      fieldErrors?: Record<string, string>;
    } {
  const workspaceId = asString(record?.workspaceId)?.trim();
  const designId = asString(record?.designId)?.trim();
  const roleBindings = asRecord(record?.roleBindings) ?? {};
  const rawItems = Array.isArray(record?.items) ? record.items : [];
  const fieldErrors: Record<string, string> = {};
  if (!workspaceId) fieldErrors.workspaceId = "Workspace is required.";
  if (!designId) fieldErrors.designId = "Workflow is required.";
  if (rawItems.length === 0) fieldErrors.items = "Add at least one batch item.";
  if (Object.keys(fieldErrors).length > 0)
    return {
      ok: false,
      status: 400,
      error: "workflow_batch_validation_failed",
      message: "Please fix the batch details.",
      fieldErrors,
    };
  return {
    ok: true,
    request: {
      workspaceId: workspaceId!,
      designId: designId!,
      version: typeof record?.version === "number" ? record.version : null,
      items: rawItems.map((item) => {
        const itemRecord = asRecord(item) ?? {};
        return {
          inputs: asRecord(itemRecord.inputs) ?? {},
          additionalInstructions:
            asString(itemRecord.additionalInstructions)?.trim() || null,
        };
      }),
      roleBindings: normalizeRoleBindings(roleBindings),
    },
  };
}

function normalizeRoleBindings(
  input: Record<string, unknown>,
): Record<string, WorkflowLaunchRoleBindingRequest> {
  const bindings: Record<string, WorkflowLaunchRoleBindingRequest> = {};
  for (const [roleId, raw] of Object.entries(input)) {
    const record = asRecord(raw) ?? {};
    const mode =
      record.mode === "create_or_reuse" ? "create_or_reuse" : "existing";
    bindings[roleId] =
      mode === "existing"
        ? {
            mode,
            sessionId: asString(record.sessionId),
            executorType: asString(record.executorType),
            model: asString(record.model),
          }
        : {
            mode,
            name: asString(record.name),
            executorType: asString(record.executorType),
            model: asString(record.model),
          };
  }
  return bindings;
}

async function resolvePersistedWorkflowRuntime(
  options: RegisterWorkflowRoutesOptions,
  db: Kysely<DB>,
  designStore: DbWorkflowDesignStore,
): Promise<Pick<
  PersistedWorkflowRuntimeService,
  "launch" | "completeHumanForm" | "completeAgentTurn" | "getRun"
> | null> {
  if (options.persistedWorkflowRuntime) return options.persistedWorkflowRuntime;
  if (!options.vkClient?.queueFollowUp) return null;
  return new PersistedWorkflowRuntimeService({
    db,
    designStore,
    orchestrationStore: options.workflowOrchestrationStore,
    queue: {
      queueAgentTurn: async (request) => {
        const queued = await options.vkClient!.queueFollowUp!(
          request.sessionId,
          request.prompt,
          {
            source: "workflow",
            provenance: {
              ...request.provenance,
              workflow_role_id: request.role,
              workflow_role_executor:
                request.executorPreference?.executorType ?? null,
              workflow_role_model: request.executorPreference?.model ?? null,
            },
          },
        );
        return { queueItemRef: queued.queued_item.id };
      },
    },
  });
}

interface PersistedWorkflowWebhookCompletion {
  applied: boolean;
  reason:
    | "applied"
    | "duplicate"
    | "stale"
    | "terminal"
    | "not_persisted_workflow_turn"
    | "not_completed_event";
  runId: string | null;
  turnId: string | null;
  status: string | null;
}

async function completePersistedWorkflowTurnFromVkWebhook(
  options: RegisterWorkflowRoutesOptions,
  db: Kysely<DB>,
  designStore: DbWorkflowDesignStore,
  event: WorkflowWebhookEventRefs,
): Promise<PersistedWorkflowWebhookCompletion> {
  if (event.eventStatus !== "completed") {
    return {
      applied: false,
      reason: "not_completed_event",
      runId: null,
      turnId: null,
      status: event.eventStatus,
    };
  }
  if (!event.queueItemId || !event.executionProcessId) {
    return {
      applied: false,
      reason: "not_persisted_workflow_turn",
      runId: null,
      turnId: null,
      status: null,
    };
  }
  const match = await findPersistedWorkflowTurnByQueueItem(
    db,
    event.queueItemId,
  );
  if (!match) {
    return {
      applied: false,
      reason: "not_persisted_workflow_turn",
      runId: null,
      turnId: null,
      status: null,
    };
  }
  const runtime = await resolvePersistedWorkflowRuntime(
    options,
    db,
    designStore,
  );
  if (!runtime) {
    throw new Error(
      `Persisted workflow runtime is not configured for queued turn ${match.turnId}`,
    );
  }
  if (!options.vkClient?.getExecutionProcessFinalMessage) {
    throw new Error(
      `VK final-message read model is not configured for queued turn ${match.turnId}`,
    );
  }
  const finalResponse = await options.vkClient.getExecutionProcessFinalMessage(
    event.executionProcessId,
  );
  const completed = await runtime.completeAgentTurn({
    runId: match.runId,
    turnId: match.turnId,
    responseRef: event.executionProcessId,
    finalResponseText: finalResponse?.content ?? undefined,
  });
  const caughtUp = await catchUpPersistedWorkflowCompletedTurns(
    options,
    db,
    runtime,
    match.runId,
    new Set([event.executionProcessId]),
  );
  await new WorkflowBatchSchedulerService({
    db,
    designStore,
    runtime,
    capacity: options.workflowBatchCapacity,
  }).schedule();
  return {
    applied: completed.applied,
    reason: completed.reason,
    runId: match.runId,
    turnId: match.turnId,
    status: caughtUp.status,
  };
}

async function catchUpPersistedWorkflowCompletedTurns(
  options: RegisterWorkflowRoutesOptions,
  db: Kysely<DB>,
  runtime: Pick<
    PersistedWorkflowRuntimeService,
    "completeAgentTurn" | "getRun"
  >,
  runId: string,
  seenExecutionProcessIds = new Set<string>(),
): Promise<PersistedWorkflowRunReadModel> {
  let run = await runtime.getRun(runId);
  if (!run) throw new Error(`workflow run ${runId} not found`);
  for (let pass = 0; pass < 20 && run.status === "running"; pass += 1) {
    const completedTurnIds = new Set(
      run.coreSnapshot.history
        .filter((entry) => entry.kind === "agent_turn_completed")
        .map((entry) => entry.turnId),
    );
    let applied = false;
    for (const [turnId, queued] of Object.entries(run.queuedTurns)) {
      if (completedTurnIds.has(turnId)) continue;
      const event = await findCompletedVkWebhookByQueueItem(
        db,
        queued.queueItemRef,
        seenExecutionProcessIds,
      );
      if (!event?.executionProcessId) continue;
      seenExecutionProcessIds.add(event.executionProcessId);
      if (!options.vkClient?.getExecutionProcessFinalMessage) {
        throw new Error(
          `VK final-message read model is not configured for queued turn ${turnId}`,
        );
      }
      const finalResponse =
        await options.vkClient.getExecutionProcessFinalMessage(
          event.executionProcessId,
        );
      const completed = await runtime.completeAgentTurn({
        runId,
        turnId,
        responseRef: event.executionProcessId,
        finalResponseText: finalResponse.content ?? undefined,
      });
      run = completed.run;
      applied = completed.applied;
      break;
    }
    if (!applied) break;
  }
  return run;
}

async function findCompletedVkWebhookByQueueItem(
  db: Kysely<DB>,
  queueItemId: string,
  seenExecutionProcessIds: Set<string>,
): Promise<{ executionProcessId: string | null } | null> {
  const rows = await db
    .selectFrom("WorkflowWebhookInbox")
    .select(["executionProcessId"])
    .where("source", "=", "vk")
    .where("eventStatus", "=", "completed")
    .where("queueItemId", "=", queueItemId)
    .orderBy("receivedAt", "asc")
    .execute();
  return (
    rows.find(
      (row) =>
        row.executionProcessId &&
        !seenExecutionProcessIds.has(row.executionProcessId),
    ) ?? null
  );
}

async function findPersistedWorkflowTurnByQueueItem(
  db: Kysely<DB>,
  queueItemId: string,
): Promise<{ runId: string; turnId: string } | null> {
  const rows = await db
    .selectFrom("WorkflowPersistedRun")
    .select(["runId", "queuedTurnsJson"])
    .where("status", "in", ["running", "blocked"])
    .execute();
  for (const row of rows) {
    const queuedTurns = parseJsonRecord(row.queuedTurnsJson);
    for (const [turnId, rawTurn] of Object.entries(queuedTurns)) {
      const turn = asRecord(rawTurn);
      if (asString(turn?.queueItemRef) === queueItemId)
        return { runId: row.runId, turnId };
    }
  }
  return null;
}

function summarizeWorkflowBatch(
  batch: {
    batchId: string;
    designId: string;
    designVersion: number;
    workspaceId: string;
    status: string;
    counts: unknown;
    items: unknown[];
    updatedAt: number;
  },
  workflowName: string,
) {
  return {
    batchId: batch.batchId,
    workflowName,
    status: batch.status,
    counts: batch.counts,
    items: batch.items,
    updatedAt: batch.updatedAt,
    detailUrl: `/dashboard/workflow-batches/${batch.batchId}`,
  };
}

function summarizeWorkflowBatchDetail(
  batch: WorkflowBatchReadModel,
  workflowName: string,
  capacity: WorkflowBatchCapacitySnapshot,
) {
  const explanation =
    batch.counts.pending > 0 ? batchPendingExplanation(capacity) : null;
  return {
    batchId: batch.batchId,
    workflowName,
    status: batch.status,
    counts: batch.counts,
    capacity: { ...capacity, explanation },
    items: batch.items.map((item) => ({
      batchItemId: item.batchItemId,
      lineNumber: item.itemIndex + 1,
      itemIndex: item.itemIndex,
      inputSummary: summarizeBatchInput(item.input),
      status: item.status,
      runId: item.runId,
      runUrl: item.runId ? `/dashboard/workflows/${item.runId}` : null,
      error: item.error,
      startedAt: item.startedAt,
      completedAt: item.completedAt,
      updatedAt: item.updatedAt,
      pendingReason:
        item.status === "pending"
          ? (batchPendingExplanation(capacity) ??
            "This item will start when capacity is available.")
          : null,
    })),
    createdAt: batch.createdAt,
    updatedAt: batch.updatedAt,
  };
}

function batchPendingExplanation(capacity: {
  globalActiveRunLimit: number;
  workspaceActiveRunLimit: number;
  globalActiveRuns: number;
  workspaceActiveRuns: number;
}): string | null {
  if (capacity.workspaceActiveRuns >= capacity.workspaceActiveRunLimit)
    return `Pending items are waiting because this workspace already has ${capacity.workspaceActiveRuns} active run${capacity.workspaceActiveRuns === 1 ? "" : "s"}; the workspace limit is ${capacity.workspaceActiveRunLimit}.`;
  if (capacity.globalActiveRuns >= capacity.globalActiveRunLimit)
    return `Pending items are waiting because ${capacity.globalActiveRuns} workflow runs are active globally; the global limit is ${capacity.globalActiveRunLimit}.`;
  return "Pending items will start on the next scheduler pass.";
}

function summarizeBatchInput(input: Record<string, unknown>): string {
  const entries = Object.entries(input);
  if (!entries.length) return "No input fields provided.";
  return entries
    .slice(0, 3)
    .map(([key, value]) => `${key}: ${summarizeValue(value)}`)
    .join(" · ");
}

function summarizeValue(value: unknown): string {
  if (typeof value === "string")
    return value.length > 80 ? `${value.slice(0, 77)}…` : value;
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  if (value == null) return "empty";
  return JSON.stringify(value).slice(0, 80);
}

function summarizePersistedRun(run: PersistedWorkflowRunReadModel) {
  return {
    runId: run.runId,
    workspaceId: run.workspaceId,
    status: run.status,
    detailUrl: `/dashboard/workflows/${run.runId}`,
  };
}

function persistedHumanFormCatchUp(
  attention: WorkflowAttentionItemReadModel,
  coreSnapshotJson: string,
): { turnId: string; submission: Record<string, unknown> } | null {
  const snapshot = parseJsonRecord(coreSnapshotJson);
  const waitingFor = asRecord(snapshot.waitingFor);
  if (waitingFor?.kind !== "human_form") return null;
  const turnId = asString(waitingFor.turnId);
  if (!turnId) return null;
  const currentVisitId = asString(snapshot.visitId);
  const currentState = asString(waitingFor.state);
  const currentStepId = asString(waitingFor.stepId);
  const expectedAttentionId = `attention-${turnId}`;
  if (attention.attentionItemId !== expectedAttentionId) return null;
  if (!currentVisitId || attention.stateVisitId !== currentVisitId) return null;
  if (!currentStepId || attention.stepId !== currentStepId) return null;
  if (currentState && attention.stateId !== currentState) return null;
  const resolution = asRecord(attention.resolution);
  const submission = asRecord(resolution?.submission);
  if (!submission) return null;
  return { turnId, submission };
}

function parseJsonRecord(json: string): Record<string, unknown> {
  try {
    return asRecord(JSON.parse(json) as unknown) ?? {};
  } catch {
    return {};
  }
}

function getPresentationVkClient(options: RegisterWorkflowRoutesOptions) {
  if (
    options.vkClient?.getExecutionProcessFinalMessage &&
    options.vkClient.getExecutionProcessRepoStates
  ) {
    return {
      getExecutionProcessFinalMessage:
        options.vkClient.getExecutionProcessFinalMessage,
      getExecutionProcessRepoStates:
        options.vkClient.getExecutionProcessRepoStates,
    };
  }
  return undefined;
}

async function resolveDeclarativeDefinition(
  workflowId: string,
  rawDefinition: unknown,
  options: RegisterWorkflowRoutesOptions,
): Promise<DeclarativeWorkflowDefinition | null> {
  if (rawDefinition !== undefined) {
    const definition = normalizeDeclarativeWorkflowDefinition(rawDefinition);
    if (definition.id !== workflowId)
      throw new Error(
        `definition id ${definition.id} does not match requested workflow id ${workflowId}`,
      );
    return definition;
  }
  const stored =
    await options.declarativeWorkflowDefinitionStore?.getDefinition(workflowId);
  return (
    stored?.definition ?? getBuiltInDeclarativeWorkflowDefinition(workflowId)
  );
}

async function resolveDeclarativeDefinitionFromRegistry(
  definitionId: string,
  version: number | undefined,
  options: RegisterWorkflowRoutesOptions,
  opts: { includeDisabled?: boolean } = {},
) {
  const stored =
    await options.declarativeWorkflowDefinitionStore?.getDefinition(
      definitionId,
      version,
      opts,
    );
  if (stored) return { ...stored, source: "db" };
  if (!version || version === 1) {
    const builtIn = getBuiltInDeclarativeWorkflowDefinition(definitionId);
    if (builtIn)
      return {
        source: "built_in",
        definitionId: builtIn.id,
        version: builtIn.version,
        status: "active",
        name: builtIn.name,
        description: builtIn.description ?? null,
        trigger: builtIn.trigger,
        definition: builtIn,
      };
  }
  return null;
}

async function getCachedRepoAliases(
  cache: RepoAliasCache | undefined,
): Promise<CachedRepoAlias[]> {
  if (!cache) return [];
  try {
    const repos = await cache.get();
    return repos.map(normalizeCachedRepoAlias);
  } catch (error) {
    console.warn("Failed to read Git repo alias cache", error);
    return [];
  }
}

async function refreshCachedRepoAliases(
  cache: RepoAliasCache | undefined,
): Promise<CachedRepoAlias[] | null> {
  if (!cache?.refresh) return null;
  try {
    const repos = await cache.refresh();
    return repos.map(normalizeCachedRepoAlias);
  } catch (error) {
    console.warn("Failed to refresh Git repo alias cache", error);
    return null;
  }
}

function normalizeCachedRepoAlias(repo: CachedRepoAlias): CachedRepoAlias {
  return {
    name: repo.name,
    aliases: [...new Set(repo.aliases)],
  };
}

function parseWorkflowActivityPolicy(
  query: Record<string, string>,
): WorkflowSchedulerBudgetPolicy {
  return {
    maxActiveExecutions:
      parsePositiveInteger(query.maxActiveExecutions ?? null) ?? 8,
    maxWorkflowOwnedSessions: parsePositiveInteger(
      query.maxWorkflowOwnedSessions ?? null,
    ),
  };
}

function parseRoleSessionResolveRequest(input: unknown) {
  const record = asRecord(input);
  const team = asRecord(record?.team);
  const workspaceId = asString(record?.workspaceId);
  if (!team) throw new Error("team is required");
  if (!workspaceId) throw new Error("workspaceId is required");
  return {
    team: team as never,
    workspaceId,
    workflowId: asString(record?.workflowId) ?? "manual-agent-team-runner",
    instanceId: asString(record?.instanceId) ?? null,
    laneId: asString(record?.laneId) ?? null,
    roleIds: Array.isArray(record?.roleIds)
      ? record.roleIds.filter(
          (value): value is string => typeof value === "string",
        )
      : undefined,
    overrides: (asRecord(record?.overrides) ?? undefined) as never,
    allowAutoCreate:
      typeof record?.allowAutoCreate === "boolean"
        ? record.allowAutoCreate
        : true,
    allowRoleNameReuse:
      typeof record?.allowRoleNameReuse === "boolean"
        ? record.allowRoleNameReuse
        : true,
  };
}
