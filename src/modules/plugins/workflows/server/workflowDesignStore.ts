import { createHash } from 'node:crypto';
import type { Kysely, Selectable, Transaction } from 'kysely';
import {
  WorkflowDefinitionError,
  normalizeWorkflowDefinitionV1,
  type AgentWorkflowDefinitionV1,
  type WorkflowConfigIssue,
} from '@vibe-dashboard/workflow-core';
import { createDefaultWorkflowExtensionRegistry, type WorkflowExtensionRegistry } from '../extensions/workflowExtensionRegistry';
import type {
  DB,
  WorkflowDesign,
  WorkflowDesignDraft,
  WorkflowDesignRunSnapshot,
  WorkflowDesignVersion,
  WorkflowLibraryRecordSource,
  WorkflowPromptAsset,
  WorkflowRoleTemplate,
  WorkflowSkillAsset,
} from '../../../../store/kysely_types';

export type WorkflowAssetRefKind = 'prompt' | 'skill';

export interface WorkflowAssetRef {
  kind: WorkflowAssetRefKind;
  id: string;
  version?: number;
  versionMode?: 'latest' | 'pinned';
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

export interface WorkflowRoleTemplateRef {
  templateId: string;
  version?: number;
}

export interface WorkflowRoleTemplateReadModel {
  roleTemplateId: string;
  version: number;
  source: WorkflowLibraryRecordSource;
  name: string;
  description: string | null;
  promptMarkdown: string;
  promptRefs: WorkflowAssetRef[];
  skillRefs: WorkflowAssetRef[];
  executorPreference: AgentWorkflowDefinitionV1['roles'][string]['executorPreference'] | null;
  active: boolean;
  contentHash: string;
  createdAt: number;
  updatedAt: number;
}

export interface CreateWorkflowRoleTemplateInput {
  roleTemplateId: string;
  version?: number;
  source?: WorkflowLibraryRecordSource;
  name: string;
  description?: string | null;
  promptMarkdown: string;
  promptRefs?: WorkflowAssetRef[];
  skillRefs?: WorkflowAssetRef[];
  executorPreference?: AgentWorkflowDefinitionV1['roles'][string]['executorPreference'] | null;
  active?: boolean;
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
  roleTemplates?: Array<{
    roleId: string;
    templateId: string;
    version: number;
    name: string;
    contentHash: string;
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
  private readonly extensionRegistry: WorkflowExtensionRegistry;

  constructor(options: { db?: Kysely<DB>; getDb?: () => Promise<Kysely<DB>> | Kysely<DB>; now?: () => number; templates?: WorkflowTemplateCatalogEntry[]; extensionRegistry?: WorkflowExtensionRegistry }) {
    if (!options.db && !options.getDb) throw new Error('DbWorkflowDesignStore requires db or getDb');
    this.getDb = options.getDb ?? (() => options.db!);
    this.now = options.now ?? Date.now;
    this.templates = options.templates ?? [];
    this.extensionRegistry = options.extensionRegistry ?? createDefaultWorkflowExtensionRegistry();
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
    const normalized = normalizeCreatePromptAssetInput(input);
    const version = normalized.version ?? 1;
    const existing = await this.getPromptAsset(normalized.promptAssetId, version);
    if (existing) {
      throw new WorkflowDesignValidationError([{ code: 'WORKFLOW_CONFIG_INVALID_REFERENCE', path: `promptAssets.${normalized.promptAssetId}.version`, message: `prompt asset ${normalized.promptAssetId}@${version} already exists; create a new version instead` }]);
    }
    await this.upsertPromptAsset(db, normalized, now);
    return this.getRequiredPromptAsset(normalized.promptAssetId, version);
  }

  async createSkillAsset(input: CreateWorkflowSkillAssetInput): Promise<WorkflowSkillAssetReadModel> {
    const db = await this.getDb();
    const now = this.now();
    const normalized = normalizeCreateSkillAssetInput(input);
    const version = normalized.version ?? 1;
    const existing = await this.getSkillAsset(normalized.skillAssetId, version);
    if (existing) {
      throw new WorkflowDesignValidationError([{ code: 'WORKFLOW_CONFIG_INVALID_REFERENCE', path: `skillAssets.${normalized.skillAssetId}.version`, message: `skill asset ${normalized.skillAssetId}@${version} already exists; create a new version instead` }]);
    }
    await this.upsertSkillAsset(db, normalized, now);
    return this.getRequiredSkillAsset(normalized.skillAssetId, version);
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

  async createRoleTemplate(input: CreateWorkflowRoleTemplateInput): Promise<WorkflowRoleTemplateReadModel> {
    const db = await this.getDb();
    const now = this.now();
    const normalized = normalizeCreateRoleTemplateInput(input);
    const version = normalized.version ?? 1;
    await this.validateRoleTemplateAssetRefs(normalized);
    const existing = await this.getRoleTemplate(normalized.roleTemplateId, version);
    if (existing) {
      throw new WorkflowDesignValidationError([{
        code: 'WORKFLOW_CONFIG_INVALID_REFERENCE',
        path: `roleTemplates.${normalized.roleTemplateId}.version`,
        message: `role template ${normalized.roleTemplateId}@${version} already exists; create a new version instead`,
      }]);
    }
    await this.insertRoleTemplate(db, normalized, now);
    return this.getRequiredRoleTemplate(normalized.roleTemplateId, version);
  }

  async getRoleTemplate(roleTemplateId: string, version?: number): Promise<WorkflowRoleTemplateReadModel | null> {
    const db = await this.getDb();
    let query = db.selectFrom('WorkflowRoleTemplate').selectAll().where('roleTemplateId', '=', roleTemplateId);
    if (version != null) query = query.where('version', '=', version);
    const row = await query.orderBy('version', 'desc').executeTakeFirst();
    return row ? mapRoleTemplate(row) : null;
  }

  async listRoleTemplates(limit = 100): Promise<WorkflowRoleTemplateReadModel[]> {
    const db = await this.getDb();
    const rows = await db.selectFrom('WorkflowRoleTemplate').selectAll().orderBy('updatedAt', 'desc').limit(limit).execute();
    return rows.map(mapRoleTemplate);
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
      ...validateExtensionProviders(resolved.definition, this.extensionRegistry),
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
    const runResolved = await this.resolveDefinition(published.definition, { additionalInstructions });
    const runResolvedDefinition = runResolved.definition;
    const runPromptSnapshot = runResolved.promptSnapshot;
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

  private async validateRoleTemplateAssetRefs(input: CreateWorkflowRoleTemplateInput): Promise<void> {
    const issues: WorkflowConfigIssue[] = [];
    for (const [index, ref] of (input.promptRefs ?? []).entries()) {
      const asset = await this.getPromptAsset(ref.id, ref.version);
      if (!asset) issues.push({ code: 'WORKFLOW_CONFIG_INVALID_REFERENCE', path: `roleTemplates.${input.roleTemplateId}.promptRefs.${index}`, message: `unknown prompt asset ${ref.id}${ref.version ? `@${ref.version}` : ''}` });
    }
    for (const [index, ref] of (input.skillRefs ?? []).entries()) {
      const asset = await this.getSkillAsset(ref.id, ref.version);
      if (!asset) issues.push({ code: 'WORKFLOW_CONFIG_INVALID_REFERENCE', path: `roleTemplates.${input.roleTemplateId}.skillRefs.${index}`, message: `unknown skill asset ${ref.id}${ref.version ? `@${ref.version}` : ''}` });
    }
    if (issues.length) throw new WorkflowDesignValidationError(issues);
  }

  private async insertRoleTemplate(db: WorkflowDesignDb, input: CreateWorkflowRoleTemplateInput, now: number): Promise<void> {
    const version = input.version ?? 1;
    const promptRefs = input.promptRefs ?? [];
    const skillRefs = input.skillRefs ?? [];
    for (const [index, ref] of promptRefs.entries()) {
      if (ref.kind !== 'prompt' || !ref.id) {
        throw new WorkflowDesignValidationError([{ code: 'WORKFLOW_CONFIG_INVALID_REFERENCE', path: `roleTemplates.${input.roleTemplateId}.promptRefs.${index}`, message: 'role template prompt refs must reference prompt assets' }]);
      }
    }
    for (const [index, ref] of skillRefs.entries()) {
      if (ref.kind !== 'skill' || !ref.id) {
        throw new WorkflowDesignValidationError([{ code: 'WORKFLOW_CONFIG_INVALID_REFERENCE', path: `roleTemplates.${input.roleTemplateId}.skillRefs.${index}`, message: 'role template skill refs must reference skill assets' }]);
      }
    }
    const assetRefs = [...promptRefs, ...skillRefs];
    const contentHash = sha256(stableJson({ promptMarkdown: input.promptMarkdown, promptRefs, skillRefs, executorPreference: input.executorPreference ?? null }));
    await db.insertInto('WorkflowRoleTemplate').values({
      roleTemplateId: input.roleTemplateId,
      version,
      source: input.source ?? 'user',
      name: input.name,
      description: input.description ?? null,
      promptMarkdown: input.promptMarkdown,
      skillRefsJson: stableJson(assetRefs),
      executorPreferenceJson: input.executorPreference ? stableJson(input.executorPreference) : null,
      active: input.active === false ? 0 : 1,
      contentHash,
      createdAt: now,
      updatedAt: now,
    }).execute();
  }

  private async validateTemplateEntry(template: WorkflowTemplateCatalogEntry): Promise<{ issues: WorkflowConfigIssue[] }> {
    try {
      const resolved = await this.resolveDefinition(template.definition, { assetOverrides: buildTemplateAssetOverrides(template) });
      return { issues: [...validateResolvedDefinition(resolved.definition), ...validateExtensionProviders(resolved.definition, this.extensionRegistry)] };
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

  private async getRequiredRoleTemplate(roleTemplateId: string, version: number): Promise<WorkflowRoleTemplateReadModel> {
    const template = await this.getRoleTemplate(roleTemplateId, version);
    if (!template) throw new Error(`Workflow role template ${roleTemplateId}@${version} not found`);
    return template;
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
          ...validateExtensionProviders(resolved.definition, this.extensionRegistry),
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
    const roleTemplatePrompts = new Map<string, string>();
    const roles = isRecord(cloned.roles) ? cloned.roles : {};
    for (const [roleId, role] of Object.entries(roles)) {
      if (!isRecord(role) || !isRecord(role.templateRef)) continue;
      const templateId = role.templateRef.templateId;
      const version = role.templateRef.version;
      if (typeof templateId !== 'string' || !Number.isInteger(version)) continue;
      const template = await this.getRoleTemplate(templateId, Number(version));
      if (!template || !template.active) {
        throw new WorkflowDesignValidationError([{ code: 'WORKFLOW_CONFIG_INVALID_REFERENCE', path: `roles.${roleId}.templateRef`, message: `role template ${templateId}@${version} is unavailable` }]);
      }
      const resolvedTemplatePrompt = await this.resolvePromptComposition(
        { template: template.promptMarkdown, refs: [...template.promptRefs, ...template.skillRefs] },
        `roles.${roleId}.templateRef`,
        snapshot,
        options,
      ) as { template?: string };
      roleTemplatePrompts.set(roleId, resolvedTemplatePrompt.template ?? template.promptMarkdown);
      if (!role.executorPreference && template.executorPreference) role.executorPreference = template.executorPreference;
      snapshot.roleTemplates = [
        ...(snapshot.roleTemplates ?? []),
        { roleId, templateId: template.roleTemplateId, version: template.version, name: template.name, contentHash: template.contentHash },
      ];
    }
    const states = isRecord(cloned.states) ? cloned.states : {};
    for (const [stateId, state] of Object.entries(states)) {
      if (!isRecord(state) || state.terminal === true || !Array.isArray(state.steps)) continue;
      const roleTemplatePrompt = typeof state.owner === 'string' ? roleTemplatePrompts.get(state.owner) : undefined;
      for (let index = 0; index < state.steps.length; index += 1) {
        const step = state.steps[index];
        if (!isRecord(step)) continue;
        if (roleTemplatePrompt && isRecord(step.prompt)) {
          step.prompt = prependRoleTemplatePrompt(step.prompt, roleTemplatePrompt);
        }
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


function validateExtensionProviders(definition: unknown, registry: WorkflowExtensionRegistry): WorkflowConfigIssue[] {
  return registry
    .validateWorkflowConfig(definition)
    .map((issue) => ({
      code: issue.code === 'WORKFLOW_EXTENSION_UNKNOWN_STEP_PROVIDER'
        ? 'WORKFLOW_CONFIG_INVALID_STEP'
        : issue.code === 'WORKFLOW_EXTENSION_UNKNOWN_ARTIFACT_PROVIDER'
          ? 'WORKFLOW_CONFIG_INVALID_REFERENCE'
          : 'WORKFLOW_CONFIG_INVALID_STEP',
      path: issue.path,
      message: issue.message,
    } satisfies WorkflowConfigIssue));
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

function normalizeCreatePromptAssetInput(input: CreateWorkflowPromptAssetInput): CreateWorkflowPromptAssetInput {
  const promptAssetId = input.promptAssetId?.trim();
  const name = input.name?.trim();
  const bodyMarkdown = input.bodyMarkdown?.trim();
  const version = input.version ?? 1;
  const issues: WorkflowConfigIssue[] = [];
  if (!promptAssetId) issues.push({ code: 'WORKFLOW_CONFIG_INVALID_REFERENCE', path: 'promptAssets.promptAssetId', message: 'prompt asset id is required' });
  if (!name) issues.push({ code: 'WORKFLOW_CONFIG_INVALID_REFERENCE', path: 'promptAssets.new.name', message: 'prompt asset name is required' });
  if (!bodyMarkdown) issues.push({ code: 'WORKFLOW_CONFIG_INVALID_REFERENCE', path: 'promptAssets.new.bodyMarkdown', message: 'prompt markdown is required' });
  if (!Number.isInteger(version) || version < 1) issues.push({ code: 'WORKFLOW_CONFIG_INVALID_REFERENCE', path: 'promptAssets.new.version', message: 'prompt asset version must be a positive integer' });
  if (issues.length) throw new WorkflowDesignValidationError(issues);
  return { ...input, promptAssetId, name, bodyMarkdown, version, description: input.description?.trim() || null };
}

function normalizeCreateSkillAssetInput(input: CreateWorkflowSkillAssetInput): CreateWorkflowSkillAssetInput {
  const skillAssetId = input.skillAssetId?.trim();
  const name = input.name?.trim();
  const bodyMarkdown = input.bodyMarkdown?.trim();
  const version = input.version ?? 1;
  const issues: WorkflowConfigIssue[] = [];
  if (!skillAssetId) issues.push({ code: 'WORKFLOW_CONFIG_INVALID_REFERENCE', path: 'skillAssets.skillAssetId', message: 'skill asset id is required' });
  if (!name) issues.push({ code: 'WORKFLOW_CONFIG_INVALID_REFERENCE', path: 'skillAssets.new.name', message: 'skill name is required' });
  if (!bodyMarkdown) issues.push({ code: 'WORKFLOW_CONFIG_INVALID_REFERENCE', path: 'skillAssets.new.bodyMarkdown', message: 'skill markdown is required' });
  if (!Number.isInteger(version) || version < 1) issues.push({ code: 'WORKFLOW_CONFIG_INVALID_REFERENCE', path: 'skillAssets.new.version', message: 'skill asset version must be a positive integer' });
  if (issues.length) throw new WorkflowDesignValidationError(issues);
  return { ...input, skillAssetId, name, bodyMarkdown, version, description: input.description?.trim() || null };
}

function normalizeCreateRoleTemplateInput(input: CreateWorkflowRoleTemplateInput): CreateWorkflowRoleTemplateInput {
  const roleTemplateId = input.roleTemplateId.trim();
  const name = input.name.trim();
  const promptMarkdown = input.promptMarkdown.trim();
  const issues: WorkflowConfigIssue[] = [];
  if (!roleTemplateId) {
    issues.push({ code: 'WORKFLOW_CONFIG_REQUIRED_FIELD', path: 'roleTemplates.roleTemplateId', message: 'role template id is required' });
  }
  if (!name) {
    issues.push({ code: 'WORKFLOW_CONFIG_REQUIRED_FIELD', path: `roleTemplates.${roleTemplateId || 'new'}.name`, message: 'role template name is required' });
  }
  if (!promptMarkdown) {
    issues.push({ code: 'WORKFLOW_CONFIG_REQUIRED_FIELD', path: `roleTemplates.${roleTemplateId || 'new'}.promptMarkdown`, message: 'role template prompt is required' });
  }
  if (input.version != null && (!Number.isInteger(input.version) || input.version < 1)) {
    issues.push({ code: 'WORKFLOW_CONFIG_INVALID_REFERENCE', path: `roleTemplates.${roleTemplateId || 'new'}.version`, message: 'role template version must be a positive integer' });
  }
  if (issues.length) throw new WorkflowDesignValidationError(issues);
  return {
    ...input,
    roleTemplateId,
    name,
    description: input.description?.trim() || null,
    promptMarkdown,
    promptRefs: normalizeRoleTemplateRefs(input.promptRefs ?? [], 'prompt'),
    skillRefs: normalizeRoleTemplateRefs(input.skillRefs ?? [], 'skill'),
  };
}

function normalizeRoleTemplateRefs(refs: WorkflowAssetRef[], kind: WorkflowAssetRefKind): WorkflowAssetRef[] {
  const seen = new Set<string>();
  const normalized: WorkflowAssetRef[] = [];
  const issues: WorkflowConfigIssue[] = [];
  for (const [index, ref] of refs.entries()) {
    if (ref.kind !== kind) continue;
    const id = ref.id.trim();
    if (!id) continue;
    const versionMode = ref.versionMode === 'pinned' || ref.version != null ? 'pinned' : 'latest';
    const version = versionMode === 'pinned' ? ref.version : undefined;
    if (versionMode === 'pinned' && (!Number.isInteger(version) || version == null || version < 1)) {
      issues.push({ code: 'WORKFLOW_CONFIG_INVALID_REFERENCE', path: `roleTemplates.new.${kind}Refs.${index}.version`, message: `${kind} attachment pinned version must be a positive integer` });
      continue;
    }
    const key = `${kind}:${id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push({ kind, id, versionMode, version });
  }
  if (issues.length) throw new WorkflowDesignValidationError(issues);
  return normalized;
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

function mapRoleTemplate(row: Selectable<WorkflowRoleTemplate>): WorkflowRoleTemplateReadModel {
  return {
    roleTemplateId: row.roleTemplateId,
    version: row.version,
    source: row.source,
    name: row.name,
    description: row.description,
    promptMarkdown: row.promptMarkdown,
    promptRefs: (JSON.parse(row.skillRefsJson) as WorkflowAssetRef[]).filter((ref) => ref.kind === 'prompt'),
    skillRefs: (JSON.parse(row.skillRefsJson) as WorkflowAssetRef[]).filter((ref) => ref.kind === 'skill'),
    executorPreference: row.executorPreferenceJson ? JSON.parse(row.executorPreferenceJson) as WorkflowRoleTemplateReadModel['executorPreference'] : null,
    active: row.active === 1,
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

function prependRoleTemplatePrompt(prompt: Record<string, unknown>, roleTemplatePrompt: string): Record<string, unknown> {
  return {
    ...prompt,
    template: [roleTemplatePrompt, typeof prompt.template === 'string' ? prompt.template : '']
      .map((part) => part.trim())
      .filter(Boolean)
      .join('\n\n'),
  };
}

function readAssetRef(value: unknown): WorkflowAssetRef | null {
  if (!isRecord(value)) return null;
  if (value.kind !== 'prompt' && value.kind !== 'skill') return null;
  if (typeof value.id !== 'string') return null;
  const version = typeof value.version === 'number' ? value.version : undefined;
  const versionMode = value.versionMode === 'latest' || value.versionMode === 'pinned' ? value.versionMode : (version == null ? 'latest' : 'pinned');
  if (versionMode === 'pinned' && (!Number.isInteger(version) || version == null || version < 1)) return null;
  return { kind: value.kind, id: value.id, version: versionMode === 'pinned' ? version : undefined, versionMode };
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
