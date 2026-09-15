export const PANEL_TARGET_SCHEMA_VERSION = 1 as const;

export const CURRENT_PRODUCER_INVENTORY = [
  'vk-agent',
  'code',
  'beads',
  'forms',
  'custom-url-or-preset',
  'plugin-iframe-surface',
  'plugin-internal-route',
  'plugin-react-surface',
  'workspace-factory',
  'pair-placement',
  'spaces-overview-homepage',
  'create-workspace-action',
  'generated-ephemeral-surface',
] as const;

const KEY = /^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/;

export type PanelTarget =
  | { version: 1; kind: 'workspace-surface'; workspaceId: string; surfaceKey: string }
  | { version: 1; kind: 'plugin-surface'; craftId: string; pluginId: string; surfaceKey: string }
  | { version: 1; kind: 'custom-url'; requestedUrl: string };

export type RuntimeCapability =
  | { kind: 'leaseable-runtime' }
  | { kind: 'recreatable-transient-runtime'; continuity: string }
  | { kind: 'unsupported'; reason: string };

type Workspace = { available: boolean; containerRef: string };
type ResolveContext = { workspaceId?: string; workspace: Workspace; craftId?: string };

export type TrustedSurfaceDefinition = {
  pluginId?: string;
  rendererKey: string;
  runtime: RuntimeCapability;
  splitCompatibility: string[];
  resolve(context: ResolveContext): Record<string, unknown>;
  backendSharingKey(context: ResolveContext): string;
};

export type TrustedTargetRegistry = {
  crafts: Record<string, { workspaceId?: string }>;
  workspaces: Record<string, Workspace>;
  surfaces: Record<string, TrustedSurfaceDefinition>;
  installedPlugins: Set<string>;
  factories?: Record<string, { surfaceKeys: Record<string, string> }>;
  resolveCustomUrl(requestedUrl: string): {
    payload: Record<string, unknown>;
    rendererKey: string;
    provenance: string;
    capabilities: string[];
  } | null;
};

export type ResolvedPanelTarget = {
  ok: true;
  target: PanelTarget;
  payload: Record<string, unknown>;
  rendererKey: string;
  provenance: string;
  capabilities: string[];
  equivalenceKey: string;
  backendSharingKey: string;
  runtime: RuntimeCapability;
  splitCompatibility: string[];
};

type Resolution = ResolvedPanelTarget | { ok: false; reason: string };

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).sort().join('\0') === [...keys].sort().join('\0');
}

function validKey(value: unknown): value is string {
  return typeof value === 'string' && KEY.test(value) && !value.includes('..');
}

export function parsePanelTarget(value: unknown): PanelTarget | null {
  if (!isObject(value) || value.version !== 1 || typeof value.kind !== 'string') return null;
  if (value.kind === 'workspace-surface') {
    if (!exactKeys(value, ['version', 'kind', 'workspaceId', 'surfaceKey'])) return null;
    if (!validKey(value.workspaceId) || !validKey(value.surfaceKey)) return null;
    return { version: 1, kind: value.kind, workspaceId: value.workspaceId, surfaceKey: value.surfaceKey };
  }
  if (value.kind === 'plugin-surface') {
    if (!exactKeys(value, ['version', 'kind', 'craftId', 'pluginId', 'surfaceKey'])) return null;
    if (!validKey(value.craftId) || !validKey(value.pluginId) || !validKey(value.surfaceKey)) return null;
    return { version: 1, kind: value.kind, craftId: value.craftId, pluginId: value.pluginId, surfaceKey: value.surfaceKey };
  }
  if (value.kind === 'custom-url') {
    if (!exactKeys(value, ['version', 'kind', 'requestedUrl']) || typeof value.requestedUrl !== 'string' || !value.requestedUrl.trim()) return null;
    return { version: 1, kind: value.kind, requestedUrl: value.requestedUrl };
  }
  return null;
}

export function resolvePanelTarget(input: unknown, registry: TrustedTargetRegistry): Resolution {
  const target = parsePanelTarget(input);
  if (!target) return { ok: false, reason: 'invalid-target' };
  if (target.kind === 'custom-url') {
    const resolved = registry.resolveCustomUrl(target.requestedUrl);
    if (!resolved) return { ok: false, reason: 'custom-url-rejected' };
    return {
      ok: true,
      target,
      ...resolved,
      equivalenceKey: `custom-url:${String(resolved.payload.url)}`,
      backendSharingKey: `custom-url:${String(resolved.payload.url)}`,
      runtime: { kind: 'leaseable-runtime' },
      splitCompatibility: ['reference'],
    };
  }

  const pluginSurface = target.kind === 'plugin-surface';
  if (pluginSurface && !registry.installedPlugins.has(target.pluginId)) {
    return { ok: false, reason: 'plugin-unavailable' };
  }
  const surfaceLookupKey = pluginSurface
    ? `${target.pluginId}/${target.surfaceKey.replace(`${target.pluginId}/`, '')}`
    : target.surfaceKey;
  const surface = registry.surfaces[surfaceLookupKey];
  if (
    !surface ||
    (pluginSurface && surface.pluginId !== target.pluginId) ||
    (!pluginSurface && surface.pluginId)
  ) {
    return { ok: false, reason: 'surface-unavailable' };
  }

  const workspaceId = target.kind === 'workspace-surface'
    ? target.workspaceId
    : registry.crafts[target.craftId]?.workspaceId;
  if (target.kind === 'plugin-surface' && !registry.crafts[target.craftId]) {
    return { ok: false, reason: 'craft-unavailable' };
  }
  if (target.kind === 'plugin-surface' && !workspaceId) {
    return { ok: false, reason: 'craft-workspace-unavailable' };
  }
  const workspace = workspaceId ? registry.workspaces[workspaceId] : { available: true, containerRef: '' };
  if (!workspace?.available) return { ok: false, reason: 'workspace-unavailable' };
  const context = {
    ...(workspaceId ? { workspaceId } : {}),
    workspace,
    ...(target.kind === 'plugin-surface' ? { craftId: target.craftId } : {}),
  };
  const scope = target.kind === 'workspace-surface'
    ? `${target.workspaceId}:${target.surfaceKey}`
    : `${target.craftId}:${target.pluginId}/${target.surfaceKey}`;
  return {
    ok: true,
    target,
    payload: surface.resolve(context),
    rendererKey: surface.rendererKey,
    provenance: surface.pluginId ? `installed-plugin:${surface.pluginId}` : 'built-in',
    capabilities: surface.pluginId ? ['manifest-derived'] : ['same-origin', 'clipboard'],
    equivalenceKey: `${target.kind}:${scope}`,
    backendSharingKey: surface.backendSharingKey(context),
    runtime: surface.runtime,
    splitCompatibility: [...surface.splitCompatibility],
  };
}

type SplitCandidate = { craftId: string; target: PanelTarget };

export function findCompatibleSplitTargets(
  invoking: ResolvedPanelTarget,
  invokingCraftId: string,
  candidates: readonly SplitCandidate[],
  registry: TrustedTargetRegistry,
): Array<SplitCandidate & { resolved: ResolvedPanelTarget }> {
  if (invoking.runtime.kind === 'unsupported') return [];
  return candidates
    .map((candidate) => ({ ...candidate, resolved: resolvePanelTarget(candidate.target, registry) }))
    .filter((candidate): candidate is SplitCandidate & { resolved: ResolvedPanelTarget } =>
      candidate.resolved.ok &&
      candidate.resolved.runtime.kind !== 'unsupported' &&
      candidate.resolved.splitCompatibility.some((key) => invoking.splitCompatibility.includes(key)))
    .sort((left, right) =>
      Number(right.craftId === invokingCraftId) - Number(left.craftId === invokingCraftId) ||
      left.resolved.equivalenceKey.localeCompare(right.resolved.equivalenceKey));
}

export type LegacyRepresentation =
  | { kind: 'view'; craftId: string; workspaceId?: string; view: { id: string; title: string; url: string; ephemeral?: { kind: 'craft-surface'; pluginId: string; surfaceKey: string; sourceKey: string } } }
  | { kind: 'pair'; craftId: string; pairId: string; viewIds: string[] }
  | { kind: 'temporary-create-workspace'; craftId: string }
  | { kind: 'factory-view'; craftId: string; workspaceId: string; pluginId: string; factoryKey: string; surfaceKey: string; expandedUrl: string };

export function classifyLegacyRepresentation(input: LegacyRepresentation, registry: TrustedTargetRegistry):
  | { outcome: 'panel'; target: PanelTarget }
  | { outcome: 'placement-only' | 'homepage-state' | 'skip' }
  | { outcome: 'quarantine'; reason: string } {
  if (input.kind === 'pair') return { outcome: 'placement-only' };
  if (input.kind === 'temporary-create-workspace') return { outcome: 'skip' };
  if (input.kind === 'factory-view') {
    const factory = registry.factories?.[`${input.pluginId}/${input.factoryKey}`];
    const surfaceKey = factory?.surfaceKeys[input.surfaceKey];
    if (!registry.installedPlugins.has(input.pluginId) || !surfaceKey) {
      return { outcome: 'quarantine', reason: 'factory-unavailable' };
    }
    const target: PanelTarget = {
      version: 1,
      kind: 'workspace-surface',
      workspaceId: input.workspaceId,
      surfaceKey,
    };
    const resolution = resolvePanelTarget(target, registry);
    return resolution.ok ? { outcome: 'panel', target } : { outcome: 'quarantine', reason: resolution.reason };
  }

  if (input.view.url === 'internal://spaces-overview') return { outcome: 'homepage-state' };
  if (input.view.ephemeral?.kind === 'craft-surface') {
    const ephemeral = input.view.ephemeral;
    const target: PanelTarget = {
      version: 1,
      kind: 'plugin-surface',
      craftId: input.craftId,
      pluginId: ephemeral.pluginId,
      surfaceKey: ephemeral.sourceKey,
    };
    const resolution = resolvePanelTarget(target, registry);
    return resolution.ok ? { outcome: 'panel', target } : { outcome: 'quarantine', reason: resolution.reason };
  }
  if (input.workspaceId && ['agent', 'code', 'beads', 'forms'].includes(input.view.id)) {
    const target: PanelTarget = {
      version: 1,
      kind: 'workspace-surface',
      workspaceId: input.workspaceId,
      surfaceKey: `builtin/${input.view.id}`,
    };
    const resolution = resolvePanelTarget(target, registry);
    return resolution.ok ? { outcome: 'panel', target } : { outcome: 'quarantine', reason: resolution.reason };
  }
  const target: PanelTarget = { version: 1, kind: 'custom-url', requestedUrl: input.view.url };
  const resolution = resolvePanelTarget(target, registry);
  return resolution.ok ? { outcome: 'panel', target } : { outcome: 'quarantine', reason: resolution.reason };
}
