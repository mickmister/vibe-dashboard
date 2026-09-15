export const PANEL_TARGET_SCHEMA_VERSION = 1 as const;

export const CURRENT_PRODUCER_INVENTORY = [
  'vk-agent', 'code', 'beads', 'forms', 'custom-url-or-preset',
  'plugin-iframe-surface', 'plugin-internal-route', 'plugin-react-surface',
  'workspace-factory', 'pair-placement', 'spaces-overview-homepage',
  'create-workspace-action', 'generated-ephemeral-surface',
] as const;

const KEY = /^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/;
const RENDERER_KEY = /^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/;

export type PanelTarget =
  | { version: 1; kind: 'workspace-surface'; workspaceId: string; surfaceKey: string }
  | { version: 1; kind: 'plugin-surface'; pluginId: string; surfaceKey: string }
  | { version: 1; kind: 'plugin-internal-route'; pluginId: string; routeKey: string; params: Record<string, string> }
  | { version: 1; kind: 'custom-url'; requestedUrl: string };

export type RuntimeCapability =
  | { kind: 'leaseable-runtime' }
  | { kind: 'recreatable-transient-runtime'; continuity: string }
  | { kind: 'unsupported'; reason: string };

export type CapabilityDescriptor = {
  sandbox: string[];
  clipboardRead: boolean;
  clipboardWrite: boolean;
  sameOrigin: boolean;
  navigation: 'none' | 'resolved-origin' | 'any-http-origin';
};

export type TrustedDefinitionResult = {
  rendererKey: string;
  payload: Record<string, unknown>;
  provenance: 'built-in' | `installed-plugin:${string}` | 'untrusted-custom-url';
  capabilities: CapabilityDescriptor;
  runtime: RuntimeCapability;
  splitCompatibility: string[];
  equivalenceInputs: string[];
  sharingInputs: string[];
};

type ResolveContext = {
  craftId: string;
  workspaceId?: string;
  workspace?: { available: boolean; containerRef: string };
  params?: Record<string, string>;
  requestedUrl?: string;
};

export type TrustedDefinition = {
  pluginId?: string;
  allowedParams?: string[];
  resolve(context: ResolveContext): TrustedDefinitionResult;
};

export type TrustedTargetRegistry = {
  crafts: Record<string, { workspaceId: string; allowedScopes: string[] }>;
  workspaces: Record<string, { available: boolean; containerRef: string }>;
  surfaces: Record<string, TrustedDefinition>;
  internalRoutes: Record<string, TrustedDefinition>;
  installedPlugins: Set<string>;
  factories: Record<string, { surfaceKeys: Record<string, string> }>;
  customUrl: TrustedDefinition;
};

export type TargetOwnerContext = { craftId: string };
export type ResolvedPanelTarget = TrustedDefinitionResult & {
  ok: true;
  target: PanelTarget;
  equivalenceKey: string;
  backendSharingKey: string;
};
export type TargetRecoveryReason =
  | 'invalid-target' | 'craft-unavailable' | 'workspace-unavailable'
  | 'workspace-owner-mismatch' | 'target-scope-denied' | 'plugin-unavailable'
  | 'surface-unavailable' | 'internal-route-unavailable' | 'invalid-route-params'
  | 'custom-url-rejected' | 'resolver-failed' | 'invalid-resolver-result';
type Resolution = ResolvedPanelTarget | { ok: false; reason: TargetRecoveryReason };

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function exactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).sort().join('\0') === [...keys].sort().join('\0');
}
function validKey(value: unknown): value is string {
  return typeof value === 'string' && KEY.test(value) && !value.includes('..');
}
function parseParams(value: unknown): Record<string, string> | null {
  if (!isObject(value) || Object.values(value).some((item) => typeof item !== 'string')) return null;
  return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right))) as Record<string, string>;
}

export function parsePanelTarget(value: unknown): PanelTarget | null {
  if (!isObject(value) || value.version !== 1 || typeof value.kind !== 'string') return null;
  if (value.kind === 'workspace-surface') {
    if (!exactKeys(value, ['version', 'kind', 'workspaceId', 'surfaceKey']) || !validKey(value.workspaceId) || !validKey(value.surfaceKey)) return null;
    return { version: 1, kind: value.kind, workspaceId: value.workspaceId, surfaceKey: value.surfaceKey };
  }
  if (value.kind === 'plugin-surface') {
    if (!exactKeys(value, ['version', 'kind', 'pluginId', 'surfaceKey']) || !validKey(value.pluginId) || !validKey(value.surfaceKey)) return null;
    return { version: 1, kind: value.kind, pluginId: value.pluginId, surfaceKey: value.surfaceKey };
  }
  if (value.kind === 'plugin-internal-route') {
    const params = parseParams(value.params);
    if (!exactKeys(value, ['version', 'kind', 'pluginId', 'routeKey', 'params']) || !validKey(value.pluginId) || !validKey(value.routeKey) || !params) return null;
    return { version: 1, kind: value.kind, pluginId: value.pluginId, routeKey: value.routeKey, params };
  }
  if (value.kind === 'custom-url') {
    if (!exactKeys(value, ['version', 'kind', 'requestedUrl']) || typeof value.requestedUrl !== 'string' || !value.requestedUrl.trim()) return null;
    return { version: 1, kind: value.kind, requestedUrl: value.requestedUrl };
  }
  return null;
}

function isCapabilityDescriptor(value: unknown): value is CapabilityDescriptor {
  if (!isObject(value)) return false;
  return exactKeys(value, ['sandbox', 'clipboardRead', 'clipboardWrite', 'sameOrigin', 'navigation']) &&
    Array.isArray(value.sandbox) && value.sandbox.every((item) => typeof item === 'string') &&
    typeof value.clipboardRead === 'boolean' && typeof value.clipboardWrite === 'boolean' &&
    typeof value.sameOrigin === 'boolean' &&
    ['none', 'resolved-origin', 'any-http-origin'].includes(String(value.navigation));
}

function validDefinitionResult(value: unknown): value is TrustedDefinitionResult {
  if (!isObject(value) || typeof value.rendererKey !== 'string' || !RENDERER_KEY.test(value.rendererKey) || !isObject(value.payload) || !isCapabilityDescriptor(value.capabilities)) return false;
  if (typeof value.provenance !== 'string' || !(value.provenance === 'built-in' || value.provenance === 'untrusted-custom-url' || value.provenance.startsWith('installed-plugin:'))) return false;
  if (!isObject(value.runtime) || !['leaseable-runtime', 'recreatable-transient-runtime', 'unsupported'].includes(String(value.runtime.kind))) return false;
  if (value.runtime.kind === 'recreatable-transient-runtime' && (typeof value.runtime.continuity !== 'string' || !value.runtime.continuity.trim())) return false;
  if (value.runtime.kind === 'unsupported' && (typeof value.runtime.reason !== 'string' || !value.runtime.reason.trim())) return false;
  if (!Array.isArray(value.splitCompatibility) || !value.splitCompatibility.every((item) => typeof item === 'string')) return false;
  return ['equivalenceInputs', 'sharingInputs'].every((key) =>
    Array.isArray(value[key]) && value[key].length > 0 && value[key].every((item) => typeof item === 'string' && item.length > 0));
}

function invokeDefinition(
  definition: TrustedDefinition,
  context: ResolveContext,
  target: PanelTarget,
  expectedProvenance: TrustedDefinitionResult['provenance'],
  exceptionReason: TargetRecoveryReason = 'resolver-failed',
): Resolution {
  try {
    const result: unknown = definition.resolve(context);
    if (!validDefinitionResult(result) || result.provenance !== expectedProvenance) return { ok: false, reason: 'invalid-resolver-result' };
    return { ok: true, target, ...result, equivalenceKey: result.equivalenceInputs.join(':'), backendSharingKey: result.sharingInputs.join(':') };
  } catch {
    return { ok: false, reason: exceptionReason };
  }
}

export function resolvePanelTarget(input: unknown, owner: TargetOwnerContext, registry: TrustedTargetRegistry): Resolution {
  const target = parsePanelTarget(input);
  if (!target) return { ok: false, reason: 'invalid-target' };
  const craft = registry.crafts[owner.craftId];
  if (!craft) return { ok: false, reason: 'craft-unavailable' };
  const ownerWorkspace = registry.workspaces[craft.workspaceId];
  if (!ownerWorkspace?.available) return { ok: false, reason: 'workspace-unavailable' };
  if (target.kind === 'custom-url') {
    if (!craft.allowedScopes.includes('custom-url')) return { ok: false, reason: 'target-scope-denied' };
    return invokeDefinition(registry.customUrl, { craftId: owner.craftId, workspaceId: craft.workspaceId, workspace: ownerWorkspace, requestedUrl: target.requestedUrl }, target, 'untrusted-custom-url', 'custom-url-rejected');
  }
  const pluginId = target.kind === 'workspace-surface' ? undefined : target.pluginId;
  if (pluginId && !registry.installedPlugins.has(pluginId)) return { ok: false, reason: 'plugin-unavailable' };
  const definitionKey = target.kind === 'plugin-internal-route'
    ? `${target.pluginId}/${target.routeKey}`
    : target.kind === 'plugin-surface' ? `${target.pluginId}/${target.surfaceKey}` : target.surfaceKey;
  const definition = target.kind === 'plugin-internal-route' ? registry.internalRoutes[definitionKey] : registry.surfaces[definitionKey];
  if (!definition || definition.pluginId !== pluginId) return { ok: false, reason: target.kind === 'plugin-internal-route' ? 'internal-route-unavailable' : 'surface-unavailable' };
  if (!craft.allowedScopes.includes(definitionKey)) return { ok: false, reason: 'target-scope-denied' };
  if (target.kind === 'workspace-surface' && craft.workspaceId !== target.workspaceId) return { ok: false, reason: 'workspace-owner-mismatch' };
  if (target.kind === 'plugin-internal-route') {
    const allowed = new Set(definition.allowedParams ?? []);
    if (Object.keys(target.params).some((key) => !allowed.has(key))) return { ok: false, reason: 'invalid-route-params' };
  }
  return invokeDefinition(
    definition,
    { craftId: owner.craftId, workspaceId: craft.workspaceId, workspace: ownerWorkspace, ...(target.kind === 'plugin-internal-route' ? { params: target.params } : {}) },
    target,
    pluginId ? `installed-plugin:${pluginId}` : 'built-in',
  );
}

export function findCompatibleSplitTargets(invoking: ResolvedPanelTarget, invokingCraftId: string, candidates: ReadonlyArray<{ craftId: string; target: PanelTarget }>, registry: TrustedTargetRegistry): Array<{ craftId: string; target: PanelTarget; resolved: ResolvedPanelTarget }> {
  if (invoking.runtime.kind === 'unsupported') return [];
  return candidates
    .map((candidate) => ({ ...candidate, resolved: resolvePanelTarget(candidate.target, { craftId: candidate.craftId }, registry) }))
    .filter((candidate): candidate is { craftId: string; target: PanelTarget; resolved: ResolvedPanelTarget } => candidate.resolved.ok && candidate.resolved.runtime.kind !== 'unsupported' && candidate.resolved.splitCompatibility.some((key) => invoking.splitCompatibility.includes(key)))
    .sort((left, right) => Number(right.craftId === invokingCraftId) - Number(left.craftId === invokingCraftId) || left.resolved.equivalenceKey.localeCompare(right.resolved.equivalenceKey));
}

export type LegacyView = {
  id: string;
  title: string;
  url: string;
  ephemeral?: { kind: 'craft-surface'; pluginId: string; surfaceKey: string; sourceKey: string };
  internalRoute?: { pluginId: string; routeKey: string; params: Record<string, string> };
};
export type LegacyRepresentation =
  | { kind: 'view'; craftId: string; groupId: string; workspaceId?: string; view: LegacyView }
  | { kind: 'pair'; craftId: string; groupId: string; pairId: string; members: LegacyView[]; workspaceId?: string }
  | { kind: 'temporary-create-workspace'; craftId: string }
  | { kind: 'factory-view'; craftId: string; groupId: string; workspaceId: string; pluginId: string; factoryKey: string; surfaceKey: string; expandedUrl: string };
export type MigrationResult =
  | { outcome: 'panel'; target: PanelTarget }
  | { outcome: 'skip'; reason: 'ephemeral-plugin-placeholder' | 'homepage-representation' | 'temporary-create-workspace' }
  | { outcome: 'quarantine'; reason: string }
  | { outcome: 'pair'; targets: PanelTarget[]; diagnostics: Array<{ viewId: string; outcome: string; reason?: string }>; topology?: { pairId: string; memberIndexes: [number, number] } };

function panelOrRecovery(target: PanelTarget, craftId: string, registry: TrustedTargetRegistry): MigrationResult {
  const resolution = resolvePanelTarget(target, { craftId }, registry);
  return resolution.ok ? { outcome: 'panel', target } : { outcome: 'quarantine', reason: resolution.reason };
}

export function classifyLegacyRepresentation(input: LegacyRepresentation, registry: TrustedTargetRegistry): MigrationResult {
  if (input.kind === 'temporary-create-workspace') return { outcome: 'skip', reason: 'temporary-create-workspace' };
  if (input.kind === 'pair') {
    const memberResults = input.members.map((view) => classifyLegacyRepresentation({ kind: 'view', craftId: input.craftId, groupId: input.groupId, workspaceId: input.workspaceId, view }, registry));
    const targets = memberResults.flatMap((result) => result.outcome === 'panel' ? [result.target] : []);
    const diagnostics = memberResults.map((result, index) => ({ viewId: input.members[index]!.id, outcome: result.outcome, ...(result.outcome === 'quarantine' || result.outcome === 'skip' ? { reason: result.reason } : {}) }));
    return { outcome: 'pair', targets, diagnostics, ...(targets.length === 2 && input.members.length === 2 ? { topology: { pairId: input.pairId, memberIndexes: [0, 1] as [number, number] } } : {}) };
  }
  if (input.kind === 'factory-view') {
    const factory = registry.factories[`${input.pluginId}/${input.factoryKey}`];
    const surfaceKey = factory?.surfaceKeys[input.surfaceKey];
    if (!registry.installedPlugins.has(input.pluginId) || !surfaceKey) return { outcome: 'quarantine', reason: 'factory-unavailable' };
    return panelOrRecovery({ version: 1, kind: 'workspace-surface', workspaceId: input.workspaceId, surfaceKey }, input.craftId, registry);
  }
  if (input.view.ephemeral?.kind === 'craft-surface') return { outcome: 'skip', reason: 'ephemeral-plugin-placeholder' };
  if (input.groupId === 'tg_home' || input.view.id === 'tab_overview' || input.view.url === 'internal://spaces-overview') return { outcome: 'skip', reason: 'homepage-representation' };
  if (input.view.internalRoute) {
    return panelOrRecovery({
      version: 1,
      kind: 'plugin-internal-route',
      pluginId: input.view.internalRoute.pluginId,
      routeKey: input.view.internalRoute.routeKey,
      params: input.view.internalRoute.params,
    }, input.craftId, registry);
  }
  if (input.workspaceId && ['agent', 'code', 'beads', 'forms'].includes(input.view.id)) return panelOrRecovery({ version: 1, kind: 'workspace-surface', workspaceId: input.workspaceId, surfaceKey: `builtin/${input.view.id}` }, input.craftId, registry);
  return panelOrRecovery({ version: 1, kind: 'custom-url', requestedUrl: input.view.url }, input.craftId, registry);
}

export function reconstructGeneratedSurface(craftId: string, pluginId: string, surfaceKey: string, registry: TrustedTargetRegistry): Resolution {
  return resolvePanelTarget({ version: 1, kind: 'plugin-surface', pluginId, surfaceKey }, { craftId }, registry);
}

export function classifyLegacyVoyage(inputs: LegacyRepresentation[], registry: TrustedTargetRegistry) {
  const results = inputs.map((input) => classifyLegacyRepresentation(input, registry));
  return { results, counts: results.reduce((counts, result) => ({ ...counts, [result.outcome]: (counts[result.outcome] ?? 0) + 1 }), {} as Record<string, number>), omitVoyage: results.every((result) => result.outcome === 'skip') };
}
