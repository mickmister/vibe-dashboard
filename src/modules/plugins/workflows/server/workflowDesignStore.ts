import { createHash } from 'node:crypto';
import type { Kysely, Selectable, Transaction } from 'kysely';
import {
  WorkflowDefinitionError,
  normalizeWorkflowDefinitionV1,
  type AgentWorkflowDefinitionV1,
  type WorkflowConfigIssue,
} from '@vibe-dashboard/workflow-core';
import type {
  DB,
  WorkflowDesign,
  WorkflowDesignDraft,
  WorkflowDesignRunSnapshot,
  WorkflowDesignVersion,
  WorkflowLibraryRecordSource,
  WorkflowPromptAsset,
  WorkflowSkillAsset,
} from '../../../../store/kysely_types';

export type WorkflowAssetRefKind = 'prompt' | 'skill';

export interface WorkflowAssetRef {
  kind: WorkflowAssetRefKind;
  id: string;
  version?: number;
}

export interface WorkflowPromptComposition {
  template?: string;
  refs?: WorkflowAssetRef[];
}

export interface WorkflowTemplateCatalogEntry {
  templateId: string;
  name: string;
  description?: string;
  definition: unknown;
  promptAssets?: CreateWorkflowPromptAssetInput[];
  skillAssets?: CreateWorkflowSkillAssetInput[];
}

export interface WorkflowTemplateCatalogReadModel extends WorkflowTemplateCatalogEntry {
  validationStatus: 'valid' | 'invalid';
  validationIssues: WorkflowConfigIssue[];
  unavailableReason: string | null;
}

type WorkflowDesignDb = Kysely<DB> | Transaction<DB>;

type ResolvedWorkflowAsset = {
  kind: WorkflowAssetRefKind;
  id: string;
  version: number;
  name: string;
  bodyMarkdown: string;
  contentHash: string;
};

export interface WorkflowDesignReadModel {
  designId: string;
  source: WorkflowLibraryRecordSource;
  name: string;
  description: string | null;
  currentDraftId: string | null;
  latestPublishedVersion: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface WorkflowDesignDraftReadModel {
  draftId: string;
  designId: string;
  baseVersion: number | null;
  definition: unknown;
  validationStatus: 'unknown' | 'valid' | 'invalid';
  validationIssues: WorkflowConfigIssue[];
  createdAt: number;
  updatedAt: number;
}

export interface WorkflowDesignVersionReadModel {
  designId: string;
  version: number;
  sourceDraftId: string | null;
  definition: unknown;
  resolvedDefinition: AgentWorkflowDefinitionV1;
  resolvedPromptSnapshot: WorkflowResolvedPromptSnapshot;
  definitionHash: string;
  publishedAt: number;
  createdAt: number;
}

export interface WorkflowPromptAssetReadModel {
  promptAssetId: string;
  version: number;
  source: WorkflowLibraryRecordSource;
  name: string;
  description: string | null;
  bodyMarkdown: string;
  inputSchema: unknown | null;
  contentHash: string;
  createdAt: number;
  updatedAt: number;
}

export interface WorkflowSkillAssetReadModel {
  skillAssetId: string;
  version: number;
  source: WorkflowLibraryRecordSource;
  name: string;
  description: string | null;
  bodyMarkdown: string;
  contentHash: string;
  createdAt: number;
  updatedAt: number;
}

export interface WorkflowDesignRunSnapshotReadModel {
  runSnapshotId: string;
  designId: string;
  designVersion: number;
  workspaceId: string;
  runInput: unknown;
  roleBindings: unknown;
  additionalInstructions: string | null;
  resolvedDefinition: AgentWorkflowDefinitionV1;
  resolvedPromptSnapshot: WorkflowResolvedPromptSnapshot;
  createdAt: number;
}

export interface CreateWorkflowPromptAssetInput {
  promptAssetId: string;
  version?: number;
  source?: WorkflowLibraryRecordSource;
  name: string;
  description?: string | null;
  bodyMarkdown: string;
  inputSchema?: unknown | null;
}

export interface CreateWorkflowSkillAssetInput {
  skillAssetId: string;
  version?: number;
  source?: WorkflowLibraryRecordSource;
  name: string;
  description?: string | null;
  bodyMarkdown: string;
}

export interface WorkflowResolvedPromptSnapshot {
  assets: Array<{
    kind: WorkflowAssetRefKind;
    id: string;
    version: number;
    name: string;
    contentHash: string;
    bodyMarkdown: string;
  }>;
  prompts: Array<{
    path: string;
    text: string;
    assetRefs: WorkflowAssetRef[];
  }>;
}

export class WorkflowDesignValidationError extends Error {
  readonly issues: WorkflowConfigIssue[];

  constructor(issues: WorkflowConfigIssue[]) {
    super(`Workflow design validation failed with ${issues.length} issue(s)`);
    this.name = 'WorkflowDesignValidationError';
    this.issues = issues;
  }
}

export class DbWorkflowDesignStore {
  private readonly getDb: () => Promise<Kysely<DB>> | Kysely<DB>;
  private readonly now: () => number;
  private readonly templates: WorkflowTemplateCatalogEntry[];

  constructor(options: { db?: Kysely<DB>; getDb?: () => Promise<Kysely<DB>> | Kysely<DB>; now?: () => number; templates?: WorkflowTemplateCatalogEntry[] }) {
    if (!options.db && !options.getDb) throw new Error('DbWorkflowDesignStore requires db or getDb');
    this.getDb = options.getDb ?? (() => options.db!);
    this.now = options.now ?? Date.now;
    this.templates = options.templates ?? [];
  }

  listTemplateCatalog(): WorkflowTemplateCatalogEntry[] {
    return deepClone(this.templates);
  }

  async listTemplateCatalogReadModels(): Promise<WorkflowTemplateCatalogReadModel[]> {
    const rows: WorkflowTemplateCatalogReadModel[] = [];
    for (const template of this.templates) {
      const validation = await this.validateTemplateEntry(template);
      rows.push({
        ...deepClone(template),
        validationStatus: validation.issues.length > 0 ? 'invalid' : 'valid',
        validationIssues: validation.issues,
        unavailableReason: validation.issues.length > 0 ? validation.issues.map((issue) => `${issue.code} at ${issue.path}: ${issue.message}`).join('\n') : null,
      });
    }
    return rows;
  }

  async createPromptAsset(input: CreateWorkflowPromptAssetInput): Promise<WorkflowPromptAssetReadModel> {
    const db = await this.getDb();
    const now = this.now();
    const version = input.version ?? 1;
    await this.upsertPromptAsset(db, input, now);
    return this.getRequiredPromptAsset(input.promptAssetId, version);
  }

  async createSkillAsset(input: CreateWorkflowSkillAssetInput): Promise<WorkflowSkillAssetReadModel> {
    const db = await this.getDb();
    const now = this.now();
    const version = input.version ?? 1;
    await this.upsertSkillAsset(db, input, now);
    return this.getRequiredSkillAsset(input.skillAssetId, version);
  }

  async getPromptAsset(promptAssetId: string, version?: number): Promise<WorkflowPromptAssetReadModel | null> {
    const db = await this.getDb();
    let query = db.selectFrom('WorkflowPromptAsset').selectAll().where('promptAssetId', '=', promptAssetId);
    if (version != null) query = query.where('version', '=', version);
    const row = await query.orderBy('version', 'desc').executeTakeFirst();
    return row ? mapPromptAsset(row) : null;
  }

  async listPromptAssets(limit = 100): Promise<WorkflowPromptAssetReadModel[]> {
    const db = await this.getDb();
    const rows = await db.selectFrom('WorkflowPromptAsset').selectAll().orderBy('updatedAt', 'desc').limit(limit).execute();
    return rows.map(mapPromptAsset);
  }

  async getSkillAsset(skillAssetId: string, version?: number): Promise<WorkflowSkillAssetReadModel | null> {
    const db = await this.getDb();
    let query = db.selectFrom('WorkflowSkillAsset').selectAll().where('skillAssetId', '=', skillAssetId);
    if (version != null) query = query.where('version', '=', version);
    const row = await query.orderBy('version', 'desc').executeTakeFirst();
    return row ? mapSkillAsset(row) : null;
  }

  async listSkillAssets(limit = 100): Promise<WorkflowSkillAssetReadModel[]> {
    const db = await this.getDb();
    const rows = await db.selectFrom('WorkflowSkillAsset').selectAll().orderBy('updatedAt', 'desc').limit(limit).execute();
    return rows.map(mapSkillAsset);
  }

  async createDesign(input: { designId: string; name: string; description?: string | null; source?: WorkflowLibraryRecordSource; draftId: string; definition: unknown; baseVersion?: number | null }): Promise<{ design: WorkflowDesignReadModel; draft: WorkflowDesignDraftReadModel }> {
    const db = await this.getDb();
    const now = this.now();
    const validation = await this.validateDefinition(input.definition);
    await db.transaction().execute(async (trx) => {
      await this.insertDesignWithDraft(trx, {
        designId: input.designId,
        draftId: input.draftId,
        name: input.name,
        description: input.description ?? null,
        source: input.source ?? 'user',
        definition: input.definition,
        baseVersion: input.baseVersion ?? null,
        validationIssues: validation.issues,
        now,
      });
    });
    return { design: await this.getRequiredDesign(input.designId), draft: await this.getRequiredDraft(input.draftId) };
  }

  async updateDraft(draftId: string, definition: unknown): Promise<WorkflowDesignDraftReadModel> {
    const db = await this.getDb();
    const now = this.now();
    const validation = await this.validateDefinition(definition);
    await db.updateTable('WorkflowDesignDraft').set({
      definitionJson: stableJson(definition),
      validationStatus: validation.issues.length ? 'invalid' : 'valid',
      validationIssuesJson: stableJson(validation.issues),
      updatedAt: now,
    }).where('draftId', '=', draftId).execute();
    return this.getRequiredDraft(draftId);
  }

  async useTemplate(input: { templateId: string; designId: string; draftId: string; name?: string; description?: string | null }): Promise<{ design: WorkflowDesignReadModel; draft: WorkflowDesignDraftReadModel }> {
    const template = this.templates.find((entry) => entry.templateId === input.templateId);
    if (!template) throw new Error(`Workflow template ${input.templateId} not found`);
    const validation = await this.validateTemplateEntry(template);
    if (validation.issues.length > 0) throw new WorkflowDesignValidationError(validation.issues);

    const db = await this.getDb();
    const now = this.now();
    await db.transaction().execute(async (trx) => {
      for (const prompt of template.promptAssets ?? []) {
        await this.upsertPromptAsset(trx, { ...prompt, source: prompt.source ?? 'built_in' }, now);
      }
      for (const skill of template.skillAssets ?? []) {
        await this.upsertSkillAsset(trx, { ...skill, source: skill.source ?? 'built_in' }, now);
      }
      await this.insertDesignWithDraft(trx, {
        designId: input.designId,
        draftId: input.draftId,
        name: input.name ?? template.name,
        description: input.description ?? template.description ?? null,
        source: 'user',
        definition: deepClone(template.definition),
        baseVersion: null,
        validationIssues: [],
        now,
      });
    });
    return { design: await this.getRequiredDesign(input.designId), draft: await this.getRequiredDraft(input.draftId) };
  }

  async publishDraft(draftId: string): Promise<WorkflowDesignVersionReadModel> {
    const db = await this.getDb();
    const draft = await this.getRequiredDraft(draftId);
    const resolved = await this.resolveDefinition(draft.definition, {});
    const issues = [
      ...validateResolvedDefinition(resolved.definition),
      ...await validateWorkflowCallReferences(db, resolved.definition),
    ];
    if (issues.length) {
      await this.markDraftInvalid(draftId, issues);
      throw new WorkflowDesignValidationError(issues);
    }
    const now = this.now();
    const design = await this.getRequiredDesign(draft.designId);
    const nextVersion = (design.latestPublishedVersion ?? 0) + 1;
    const definitionJson = stableJson(draft.definition);
    const resolvedDefinitionJson = stableJson(resolved.definition);
    await db.transaction().execute(async (trx) => {
      await trx.insertInto('WorkflowDesignVersion').values({
        designId: draft.designId,
        version: nextVersion,
        sourceDraftId: draft.draftId,
        definitionJson,
        resolvedDefinitionJson,
        resolvedPromptSnapshotJson: stableJson(resolved.promptSnapshot),
        definitionHash: sha256(resolvedDefinitionJson),
        publishedAt: now,
        createdAt: now,
      }).execute();
      await trx.updateTable('WorkflowDesign').set({ latestPublishedVersion: nextVersion, updatedAt: now }).where('designId', '=', draft.designId).execute();
      await trx.updateTable('WorkflowDesignDraft').set({ validationStatus: 'valid', validationIssuesJson: '[]', baseVersion: nextVersion, updatedAt: now }).where('draftId', '=', draftId).execute();
    });
    return this.getRequiredVersion(draft.designId, nextVersion);
  }

  async duplicateDesign(input: { sourceDesignId: string; designId: string; draftId: string; name: string; description?: string | null }): Promise<{ design: WorkflowDesignReadModel; draft: WorkflowDesignDraftReadModel }> {
    const source = await this.getRequiredDesign(input.sourceDesignId);
    const sourceDraft = source.currentDraftId ? await this.getDraft(source.currentDraftId) : null;
    const sourceVersion = source.latestPublishedVersion != null ? await this.getVersion(source.designId, source.latestPublishedVersion) : null;
    const definition = sourceDraft?.definition ?? sourceVersion?.definition;
    if (!definition) throw new Error(`Workflow design ${input.sourceDesignId} has no draft or published version to duplicate`);
    return this.createDesign({
      designId: input.designId,
      draftId: input.draftId,
      name: input.name,
      description: input.description ?? source.description,
      source: 'user',
      definition: deepClone(definition),
      baseVersion: null,
    });
  }

  async createRunSnapshot(input: { runSnapshotId: string; designId: string; version?: number; workspaceId: string; runInput: unknown; roleBindings: unknown; additionalInstructions?: string | null }): Promise<WorkflowDesignRunSnapshotReadModel> {
    const db = await this.getDb();
    const design = await this.getRequiredDesign(input.designId);
    const version = input.version ?? design.latestPublishedVersion;
    if (version == null) throw new Error(`Workflow design ${input.designId} has no published version`);
    const published = await this.getRequiredVersion(input.designId, version);
    const additionalInstructions = input.additionalInstructions?.trim() || null;
    const runResolvedDefinition = appendAdditionalInstructionsToDefinition(published.resolvedDefinition, additionalInstructions);
    const runPromptSnapshot = appendAdditionalInstructionsToPromptSnapshot(published.resolvedPromptSnapshot, additionalInstructions);
    const now = this.now();
    await db.insertInto('WorkflowDesignRunSnapshot').values({
      runSnapshotId: input.runSnapshotId,
      designId: input.designId,
      designVersion: version,
      workspaceId: input.workspaceId,
      runInputJson: stableJson(input.runInput ?? {}),
      roleBindingsJson: stableJson(input.roleBindings ?? {}),
      additionalInstructions,
      resolvedDefinitionJson: stableJson(runResolvedDefinition),
      resolvedPromptSnapshotJson: stableJson(runPromptSnapshot),
      createdAt: now,
    }).execute();
    return this.getRequiredRunSnapshot(input.runSnapshotId);
  }

  async replacePublishedVersionDefinition(): Promise<never> {
    throw new Error('Published workflow design versions are immutable');
  }

  async getDesign(designId: string): Promise<WorkflowDesignReadModel | null> {
    const db = await this.getDb();
    const row = await db.selectFrom('WorkflowDesign').selectAll().where('designId', '=', designId).executeTakeFirst();
    return row ? mapDesign(row) : null;
  }

  async getDraft(draftId: string): Promise<WorkflowDesignDraftReadModel | null> {
    const db = await this.getDb();
    const row = await db.selectFrom('WorkflowDesignDraft').selectAll().where('draftId', '=', draftId).executeTakeFirst();
    return row ? mapDraft(row) : null;
  }

  async getVersion(designId: string, version?: number): Promise<WorkflowDesignVersionReadModel | null> {
    const db = await this.getDb();
    let query = db.selectFrom('WorkflowDesignVersion').selectAll().where('designId', '=', designId);
    if (version != null) query = query.where('version', '=', version);
    const row = await query.orderBy('version', 'desc').executeTakeFirst();
    return row ? mapVersion(row) : null;
  }

  async listDesigns(): Promise<WorkflowDesignReadModel[]> {
    const db = await this.getDb();
    const rows = await db.selectFrom('WorkflowDesign').selectAll().orderBy('name', 'asc').execute();
    return rows.map(mapDesign);
  }

  async getRunSnapshot(runSnapshotId: string): Promise<WorkflowDesignRunSnapshotReadModel | null> {
    const db = await this.getDb();
    const row = await db.selectFrom('WorkflowDesignRunSnapshot').selectAll().where('runSnapshotId', '=', runSnapshotId).executeTakeFirst();
    return row ? mapRunSnapshot(row) : null;
  }

  private async insertDesignWithDraft(db: WorkflowDesignDb, input: { designId: string; name: string; description?: string | null; source: WorkflowLibraryRecordSource; draftId: string; definition: unknown; baseVersion?: number | null; validationIssues: WorkflowConfigIssue[]; now: number }): Promise<void> {
    await db.insertInto('WorkflowDesign').values({
      designId: input.designId,
      source: input.source,
      name: input.name,
      description: input.description ?? null,
      currentDraftId: input.draftId,
      latestPublishedVersion: null,
      createdAt: input.now,
      updatedAt: input.now,
    }).execute();
    await db.insertInto('WorkflowDesignDraft').values({
      draftId: input.draftId,
      designId: input.designId,
      baseVersion: input.baseVersion ?? null,
      definitionJson: stableJson(input.definition),
      validationStatus: input.validationIssues.length ? 'invalid' : 'valid',
      validationIssuesJson: stableJson(input.validationIssues),
      createdAt: input.now,
      updatedAt: input.now,
    }).execute();
  }

  private async upsertPromptAsset(db: WorkflowDesignDb, input: CreateWorkflowPromptAssetInput, now: number): Promise<void> {
    const version = input.version ?? 1;
    await db.insertInto('WorkflowPromptAsset').values({
      promptAssetId: input.promptAssetId,
      version,
      source: input.source ?? 'user',
      name: input.name,
      description: input.description ?? null,
      bodyMarkdown: input.bodyMarkdown,
      inputSchemaJson: input.inputSchema == null ? null : stableJson(input.inputSchema),
      contentHash: sha256(input.bodyMarkdown),
      createdAt: now,
      updatedAt: now,
    }).onConflict((oc) => oc.columns(['promptAssetId', 'version']).doUpdateSet({
      source: input.source ?? 'user',
      name: input.name,
      description: input.description ?? null,
      bodyMarkdown: input.bodyMarkdown,
      inputSchemaJson: input.inputSchema == null ? null : stableJson(input.inputSchema),
      contentHash: sha256(input.bodyMarkdown),
      updatedAt: now,
    })).execute();
  }

  private async upsertSkillAsset(db: WorkflowDesignDb, input: CreateWorkflowSkillAssetInput, now: number): Promise<void> {
    const version = input.version ?? 1;
    await db.insertInto('WorkflowSkillAsset').values({
      skillAssetId: input.skillAssetId,
      version,
      source: input.source ?? 'user',
      name: input.name,
      description: input.description ?? null,
      bodyMarkdown: input.bodyMarkdown,
      contentHash: sha256(input.bodyMarkdown),
      createdAt: now,
      updatedAt: now,
    }).onConflict((oc) => oc.columns(['skillAssetId', 'version']).doUpdateSet({
      source: input.source ?? 'user',
      name: input.name,
      description: input.description ?? null,
      bodyMarkdown: input.bodyMarkdown,
      contentHash: sha256(input.bodyMarkdown),
      updatedAt: now,
    })).execute();
  }

  private async validateTemplateEntry(template: WorkflowTemplateCatalogEntry): Promise<{ issues: WorkflowConfigIssue[] }> {
    try {
      const resolved = await this.resolveDefinition(template.definition, { assetOverrides: buildTemplateAssetOverrides(template) });
      return { issues: validateResolvedDefinition(resolved.definition) };
    } catch (error) {
      if (error instanceof WorkflowDesignValidationError) return { issues: error.issues };
      throw error;
    }
  }

  private async getRequiredDesign(designId: string): Promise<WorkflowDesignReadModel> {
    const design = await this.getDesign(designId);
    if (!design) throw new Error(`Workflow design ${designId} not found`);
    return design;
  }

  private async getRequiredDraft(draftId: string): Promise<WorkflowDesignDraftReadModel> {
    const draft = await this.getDraft(draftId);
    if (!draft) throw new Error(`Workflow design draft ${draftId} not found`);
    return draft;
  }

  private async getRequiredVersion(designId: string, version: number): Promise<WorkflowDesignVersionReadModel> {
    const published = await this.getVersion(designId, version);
    if (!published) throw new Error(`Workflow design ${designId} version ${version} not found`);
    return published;
  }

  private async getRequiredPromptAsset(promptAssetId: string, version: number): Promise<WorkflowPromptAssetReadModel> {
    const asset = await this.getPromptAsset(promptAssetId, version);
    if (!asset) throw new Error(`Workflow prompt asset ${promptAssetId}@${version} not found`);
    return asset;
  }

  private async getRequiredSkillAsset(skillAssetId: string, version: number): Promise<WorkflowSkillAssetReadModel> {
    const asset = await this.getSkillAsset(skillAssetId, version);
    if (!asset) throw new Error(`Workflow skill asset ${skillAssetId}@${version} not found`);
    return asset;
  }

  private async getRequiredRunSnapshot(runSnapshotId: string): Promise<WorkflowDesignRunSnapshotReadModel> {
    const snapshot = await this.getRunSnapshot(runSnapshotId);
    if (!snapshot) throw new Error(`Workflow design run snapshot ${runSnapshotId} not found`);
    return snapshot;
  }

  private async markDraftInvalid(draftId: string, issues: WorkflowConfigIssue[]): Promise<void> {
    const db = await this.getDb();
    await db.updateTable('WorkflowDesignDraft').set({ validationStatus: 'invalid', validationIssuesJson: stableJson(issues), updatedAt: this.now() }).where('draftId', '=', draftId).execute();
  }

  private async validateDefinition(definition: unknown): Promise<{ issues: WorkflowConfigIssue[] }> {
    try {
      const db = await this.getDb();
      const resolved = await this.resolveDefinition(definition, {});
      return {
        issues: [
          ...validateResolvedDefinition(resolved.definition),
          ...await validateWorkflowCallReferences(db, resolved.definition),
        ],
      };
    } catch (error) {
      if (error instanceof WorkflowDesignValidationError) return { issues: error.issues };
      throw error;
    }
  }

  private async resolveDefinition(definition: unknown, options: { additionalInstructions?: string | null; assetOverrides?: Map<string, ResolvedWorkflowAsset> }): Promise<{ definition: AgentWorkflowDefinitionV1; promptSnapshot: WorkflowResolvedPromptSnapshot }> {
    const cloned = deepClone(definition) as Record<string, unknown>;
    const snapshot: WorkflowResolvedPromptSnapshot = { assets: [], prompts: [] };
    const states = isRecord(cloned.states) ? cloned.states : {};
    for (const [stateId, state] of Object.entries(states)) {
      if (!isRecord(state) || state.terminal === true || !Array.isArray(state.steps)) continue;
      for (let index = 0; index < state.steps.length; index += 1) {
        const step = state.steps[index];
        if (!isRecord(step)) continue;
        if (step.prompt !== undefined) {
          step.prompt = await this.resolvePromptComposition(step.prompt, `states.${stateId}.steps.${index}.prompt`, snapshot, options);
        }
      }
      if (isRecord(state.actions)) {
        for (const [actionId, action] of Object.entries(state.actions)) {
          const handoffRecord = isRecord(action) && isRecord(action.handoff) ? action.handoff : null;
          const promptHolder = handoffRecord && isRecord(handoffRecord.prompt) ? handoffRecord.prompt : null;
          if (promptHolder) {
            handoffRecord!.prompt = await this.resolvePromptComposition(promptHolder, `states.${stateId}.actions.${actionId}.handoff.prompt`, snapshot, { assetOverrides: options.assetOverrides });
          }
        }
      }
    }
    return { definition: cloned as unknown as AgentWorkflowDefinitionV1, promptSnapshot: snapshot };
  }

  private async resolvePromptComposition(value: unknown, path: string, snapshot: WorkflowResolvedPromptSnapshot, options: { additionalInstructions?: string | null; assetOverrides?: Map<string, ResolvedWorkflowAsset> }): Promise<unknown> {
    const record = asRecord(value);
    if (!record) return value;
    for (const key of Object.keys(record)) {
      if (key !== 'template' && key !== 'refs') {
        throw new WorkflowDesignValidationError([{ code: 'WORKFLOW_CONFIG_UNKNOWN_FIELD', path: `${path}.${key}`, message: `unknown prompt composition field ${key}` }]);
      }
    }
    const parts: string[] = [];
    if (record.refs !== undefined && !Array.isArray(record.refs)) {
      throw new WorkflowDesignValidationError([{ code: 'WORKFLOW_CONFIG_INVALID_STEP', path: `${path}.refs`, message: 'prompt refs must be an array' }]);
    }
    const refs = Array.isArray(record.refs) ? record.refs.map((ref, index) => {
      const parsed = readAssetRef(ref);
      if (!parsed) {
        throw new WorkflowDesignValidationError([{ code: 'WORKFLOW_CONFIG_INVALID_REFERENCE', path: `${path}.refs.${index}`, message: 'prompt asset ref must include kind prompt|skill and id' }]);
      }
      return parsed;
    }) : [];
    for (const ref of refs) {
      const asset = options.assetOverrides?.get(assetKey(ref.kind, ref.id, ref.version))
        ?? options.assetOverrides?.get(assetKey(ref.kind, ref.id))
        ?? (ref.kind === 'prompt'
          ? await this.getPromptAsset(ref.id, ref.version)
          : await this.getSkillAsset(ref.id, ref.version));
      if (!asset) {
        throw new WorkflowDesignValidationError([{ code: 'WORKFLOW_CONFIG_INVALID_REFERENCE', path: `${path}.refs`, message: `unknown ${ref.kind} asset ${ref.id}${ref.version ? `@${ref.version}` : ''}` }]);
      }
      parts.push(asset.bodyMarkdown);
      if (!snapshot.assets.some((existing) => existing.kind === ref.kind && existing.id === ref.id && existing.version === asset.version)) {
        snapshot.assets.push({ kind: ref.kind, id: ref.id, version: asset.version, name: asset.name, contentHash: asset.contentHash, bodyMarkdown: asset.bodyMarkdown });
      }
      ref.version = asset.version;
    }
    if (typeof record.template === 'string' && record.template.trim()) parts.push(record.template);
    const additional = options.additionalInstructions?.trim();
    if (additional) parts.push(`Additional instructions for this run:\n${additional}`);
    const text = parts.join('\n\n');
    snapshot.prompts.push({ path, text, assetRefs: deepClone(refs) });
    return { template: text };
  }
}



function buildTemplateAssetOverrides(template: WorkflowTemplateCatalogEntry): Map<string, ResolvedWorkflowAsset> {
  const assets = new Map<string, ResolvedWorkflowAsset>();
  for (const prompt of template.promptAssets ?? []) {
    const asset = templatePromptAsset(prompt);
    assets.set(assetKey(asset.kind, asset.id, asset.version), asset);
    if (prompt.version == null) assets.set(assetKey(asset.kind, asset.id), asset);
  }
  for (const skill of template.skillAssets ?? []) {
    const asset = templateSkillAsset(skill);
    assets.set(assetKey(asset.kind, asset.id, asset.version), asset);
    if (skill.version == null) assets.set(assetKey(asset.kind, asset.id), asset);
  }
  return assets;
}

function templatePromptAsset(input: CreateWorkflowPromptAssetInput): ResolvedWorkflowAsset {
  return {
    kind: 'prompt',
    id: input.promptAssetId,
    version: input.version ?? 1,
    name: input.name,
    bodyMarkdown: input.bodyMarkdown,
    contentHash: sha256(input.bodyMarkdown),
  };
}

function templateSkillAsset(input: CreateWorkflowSkillAssetInput): ResolvedWorkflowAsset {
  return {
    kind: 'skill',
    id: input.skillAssetId,
    version: input.version ?? 1,
    name: input.name,
    bodyMarkdown: input.bodyMarkdown,
    contentHash: sha256(input.bodyMarkdown),
  };
}

function assetKey(kind: WorkflowAssetRefKind, id: string, version?: number): string {
  return `${kind}:${id}:${version ?? 'latest'}`;
}

function appendAdditionalInstructionsToDefinition(
  definition: AgentWorkflowDefinitionV1,
  additionalInstructions: string | null,
): AgentWorkflowDefinitionV1 {
  const cloned = deepClone(definition);
  if (!additionalInstructions) return cloned;
  const block = additionalInstructionsBlock(additionalInstructions);
  for (const state of Object.values(cloned.states)) {
    if ('terminal' in state) continue;
    for (const step of state.steps) {
      if (step.type === 'agent_turn') {
        step.prompt = { template: appendBlock(step.prompt.template, block) };
      }
    }
  }
  return cloned;
}

function appendAdditionalInstructionsToPromptSnapshot(
  snapshot: WorkflowResolvedPromptSnapshot,
  additionalInstructions: string | null,
): WorkflowResolvedPromptSnapshot {
  const cloned = deepClone(snapshot);
  if (!additionalInstructions) return cloned;
  const block = additionalInstructionsBlock(additionalInstructions);
  return {
    ...cloned,
    prompts: cloned.prompts.map((prompt) => ({ ...prompt, text: appendBlock(prompt.text, block) })),
  };
}

function additionalInstructionsBlock(additionalInstructions: string): string {
  return `Additional instructions for this run:
${additionalInstructions}`;
}

function appendBlock(value: string, block: string): string {
  return value.trim() ? `${value}

${block}` : block;
}

function validateResolvedDefinition(definition: unknown): WorkflowConfigIssue[] {
  try {
    normalizeWorkflowDefinitionV1(definition);
    return [];
  } catch (error) {
    if (error instanceof WorkflowDefinitionError) return error.issues;
    throw error;
  }
}

async function validateWorkflowCallReferences(
  db: WorkflowDesignDb,
  definition: AgentWorkflowDefinitionV1,
): Promise<WorkflowConfigIssue[]> {
  const issues: WorkflowConfigIssue[] = [];
  for (const [stateId, state] of Object.entries(definition.states)) {
    if ('terminal' in state) continue;
    for (const [index, step] of state.steps.entries()) {
      if (step.type !== 'workflow_call') continue;
      const path = `states.${stateId}.steps.${index}.workflow.designId`;
      const design = await db.selectFrom('WorkflowDesign').select(['designId', 'latestPublishedVersion']).where('designId', '=', step.workflow.designId).executeTakeFirst();
      const version = step.workflow.version ?? design?.latestPublishedVersion;
      if (!design || version == null) {
        issues.push({ code: 'WORKFLOW_CONFIG_INVALID_REFERENCE', path, message: `child workflow design ${step.workflow.designId} is not published` });
        continue;
      }
      const published = await db.selectFrom('WorkflowDesignVersion').select(['designId']).where('designId', '=', step.workflow.designId).where('version', '=', version).executeTakeFirst();
      if (!published) {
        issues.push({ code: 'WORKFLOW_CONFIG_INVALID_REFERENCE', path: `states.${stateId}.steps.${index}.workflow.version`, message: `child workflow design ${step.workflow.designId} version ${version} not found` });
      }
    }
  }
  return issues;
}

function mapDesign(row: Selectable<WorkflowDesign>): WorkflowDesignReadModel {
  return { ...row };
}

function mapDraft(row: Selectable<WorkflowDesignDraft>): WorkflowDesignDraftReadModel {
  return {
    draftId: row.draftId,
    designId: row.designId,
    baseVersion: row.baseVersion,
    definition: JSON.parse(row.definitionJson) as unknown,
    validationStatus: row.validationStatus,
    validationIssues: JSON.parse(row.validationIssuesJson) as WorkflowConfigIssue[],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapVersion(row: Selectable<WorkflowDesignVersion>): WorkflowDesignVersionReadModel {
  return {
    designId: row.designId,
    version: row.version,
    sourceDraftId: row.sourceDraftId,
    definition: JSON.parse(row.definitionJson) as unknown,
    resolvedDefinition: JSON.parse(row.resolvedDefinitionJson) as AgentWorkflowDefinitionV1,
    resolvedPromptSnapshot: JSON.parse(row.resolvedPromptSnapshotJson) as WorkflowResolvedPromptSnapshot,
    definitionHash: row.definitionHash,
    publishedAt: row.publishedAt,
    createdAt: row.createdAt,
  };
}

function mapPromptAsset(row: Selectable<WorkflowPromptAsset>): WorkflowPromptAssetReadModel {
  return {
    promptAssetId: row.promptAssetId,
    version: row.version,
    source: row.source,
    name: row.name,
    description: row.description,
    bodyMarkdown: row.bodyMarkdown,
    inputSchema: row.inputSchemaJson ? JSON.parse(row.inputSchemaJson) as unknown : null,
    contentHash: row.contentHash,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapSkillAsset(row: Selectable<WorkflowSkillAsset>): WorkflowSkillAssetReadModel {
  return {
    skillAssetId: row.skillAssetId,
    version: row.version,
    source: row.source,
    name: row.name,
    description: row.description,
    bodyMarkdown: row.bodyMarkdown,
    contentHash: row.contentHash,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapRunSnapshot(row: Selectable<WorkflowDesignRunSnapshot>): WorkflowDesignRunSnapshotReadModel {
  return {
    runSnapshotId: row.runSnapshotId,
    designId: row.designId,
    designVersion: row.designVersion,
    workspaceId: row.workspaceId,
    runInput: JSON.parse(row.runInputJson) as unknown,
    roleBindings: JSON.parse(row.roleBindingsJson) as unknown,
    additionalInstructions: row.additionalInstructions,
    resolvedDefinition: JSON.parse(row.resolvedDefinitionJson) as AgentWorkflowDefinitionV1,
    resolvedPromptSnapshot: JSON.parse(row.resolvedPromptSnapshotJson) as WorkflowResolvedPromptSnapshot,
    createdAt: row.createdAt,
  };
}

function readAssetRef(value: unknown): WorkflowAssetRef | null {
  if (!isRecord(value)) return null;
  if (value.kind !== 'prompt' && value.kind !== 'skill') return null;
  if (typeof value.id !== 'string') return null;
  return { kind: value.kind, id: value.id, version: typeof value.version === 'number' ? value.version : undefined };
}


function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function stableJson(value: unknown): string {
  return JSON.stringify(value);
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
