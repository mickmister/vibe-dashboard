import type { PluginRegistryState } from '../modules/plugins/vibe-dashboard/types';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };
export type CapabilityName =
  | 'scripts' | 'same-origin' | 'forms' | 'modals' | 'downloads' | 'popups'
  | 'clipboard-read' | 'clipboard-write' | 'fullscreen';
export type EffectiveProvenance =
  | 'vd-built-in' | 'vk-built-in' | 'installed-plugin' | 'forwarded-project' | 'external-url';

export interface StoredPanelTarget {
  kind: string;
  version: number;
  payload: unknown;
}

export interface TrustedWorkspace {
  id: string;
  available: boolean;
  directory: string;
  origin: string;
  repositoryIds: string[];
  locations: { overview: string; code: string; changes: string; beads: string; forms: string };
}

interface OwnedBackendTarget { workspaceId: string; location: string }
interface BuiltInRoute { location: string; allowedCraftIds: string[]; capabilities?: unknown }

export interface PanelTargetResolutionContext {
  craftId: string;
  hostOrigin: string;
  crafts: Record<string, { workspaceId: string; allowedPluginTargets: string[] }>;
  workspaces: Record<string, TrustedWorkspace>;
  agentSessions: Record<string, OwnedBackendTarget>;
  terminals: Record<string, OwnedBackendTarget>;
  previews: Record<string, OwnedBackendTarget>;
  builtInRoutes: Record<string, BuiltInRoute>;
  getPluginRegistry(): PluginRegistryState;
  pluginCapabilities: Record<string, unknown>;
  resolveCustomUrl?(url: URL): URL | string;
}

export interface CapabilityPolicy {
  sandbox: string;
  allow: string;
  scripts: boolean;
  sameOrigin: boolean;
  forms: boolean;
  modals: boolean;
  downloads: boolean;
  popups: boolean;
  clipboardRead: boolean;
  clipboardWrite: boolean;
  fullscreen: boolean;
}

export type TargetRecoveryReason =
  | 'malformed' | 'unknown-kind' | 'unsupported-version' | 'craft-unavailable'
  | 'workspace-unavailable' | 'workspace-owner-mismatch' | 'target-scope-denied'
  | 'target-unavailable' | 'plugin-unavailable' | 'unsafe-url'
  | 'invalid-capability-policy' | 'resolver-failed' | 'invalid-resolver-result';

export interface ResolvedPanelTarget {
  status: 'resolved';
  target: { kind: string; version: number; payload: JsonObject };
  rendererKey: string;
  factoryKey: string;
  canonicalPayload: JsonObject;
  canonicalLocation: string;
  effectiveProvenance: EffectiveProvenance;
  capabilityPolicy: CapabilityPolicy;
  runtimeClass: 'retained' | 'recreatable';
  splitClass: string | null;
  equivalenceIdentity: string;
  backendSharingIdentity: string | null;
}

export interface QuarantinedPanelTarget {
  status: 'quarantined';
  reason: TargetRecoveryReason;
  recoveryKey: string;
  rendererKey: 'panel-target-recovery';
  capabilityPolicy: CapabilityPolicy;
}

export type PanelTargetResolution = ResolvedPanelTarget | QuarantinedPanelTarget;

type ResolverResult = Omit<ResolvedPanelTarget, 'status' | 'target'>;
export interface PanelTargetDefinition {
  kind: string;
  version: number;
  parse(value: unknown): JsonObject | null;
  migrate(value: unknown, fromVersion: number): JsonObject | null;
  resolve(value: JsonObject, context: PanelTargetResolutionContext): ResolverResult | null;
}

const CAPABILITIES = new Set<CapabilityName>([
  'scripts', 'same-origin', 'forms', 'modals', 'downloads', 'popups',
  'clipboard-read', 'clipboard-write', 'fullscreen',
]);
const KEY = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;
const DENY_ALL = policy([], 'external-url');

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exact(value: unknown, keys: string[]): value is Record<string, unknown> {
  return object(value) && Object.keys(value).sort().join('\0') === [...keys].sort().join('\0');
}

function key(value: unknown): value is string {
  return typeof value === 'string' && KEY.test(value) && !value.includes('..');
}

function jsonObject(value: unknown): value is JsonObject {
  if (!object(value)) return false;
  return Object.values(value).every(jsonValue);
}

function jsonValue(value: unknown): value is JsonValue {
  return value === null || typeof value === 'string' || typeof value === 'boolean'
    || (typeof value === 'number' && Number.isFinite(value))
    || (Array.isArray(value) && value.every(jsonValue)) || jsonObject(value);
}

function strings(value: unknown): value is CapabilityName[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string' && CAPABILITIES.has(item as CapabilityName));
}

function policy(requested: CapabilityName[], provenance: EffectiveProvenance): CapabilityPolicy {
  const ceilings: Record<EffectiveProvenance, ReadonlySet<CapabilityName>> = {
    'vd-built-in': new Set(CAPABILITIES),
    'vk-built-in': new Set(CAPABILITIES),
    'installed-plugin': new Set(['scripts', 'fullscreen']),
    'forwarded-project': new Set(['scripts', 'forms']),
    'external-url': new Set(['scripts']),
  };
  const granted = new Set(requested.filter((capability) => ceilings[provenance].has(capability)));
  const has = (name: CapabilityName) => granted.has(name);
  const sandbox = [
    ['scripts', 'allow-scripts'], ['same-origin', 'allow-same-origin'], ['forms', 'allow-forms'],
    ['modals', 'allow-modals'], ['downloads', 'allow-downloads'], ['popups', 'allow-popups'],
  ].filter(([name]) => has(name as CapabilityName)).map(([, token]) => token).join(' ');
  const allow = [['clipboard-read', 'clipboard-read'], ['clipboard-write', 'clipboard-write'], ['fullscreen', 'fullscreen']]
    .filter(([name]) => has(name as CapabilityName)).map(([, token]) => token).join('; ');
  return {
    sandbox, allow, scripts: has('scripts'), sameOrigin: has('same-origin'), forms: has('forms'),
    modals: has('modals'), downloads: has('downloads'), popups: has('popups'),
    clipboardRead: has('clipboard-read'), clipboardWrite: has('clipboard-write'), fullscreen: has('fullscreen'),
  };
}

function absolute(location: string, origin: string): string | null {
  try {
    const parsed = new URL(location, origin);
    return ['http:', 'https:'].includes(parsed.protocol) && !parsed.username && !parsed.password ? parsed.href : null;
  } catch { return null; }
}

function common(value: JsonObject, context: PanelTargetResolutionContext):
  | { workspace: TrustedWorkspace; workspaceId: string }
  | TargetRecoveryReason {
  const craft = context.crafts[context.craftId];
  if (!craft) return 'craft-unavailable';
  const workspaceId = value.workspaceId;
  if (typeof workspaceId !== 'string' || craft.workspaceId !== workspaceId) return 'workspace-owner-mismatch';
  const workspace = context.workspaces[workspaceId];
  if (!workspace?.available) return 'workspace-unavailable';
  return { workspace, workspaceId };
}

function result(input: {
  rendererKey: string; factoryKey?: string; payload: JsonObject; location: string;
  provenance: EffectiveProvenance; requested: CapabilityName[]; runtime?: 'retained' | 'recreatable';
  splitClass?: string | null; equivalence: string[]; sharing?: string[] | null;
}): ResolverResult {
  return {
    rendererKey: input.rendererKey,
    factoryKey: input.factoryKey ?? input.rendererKey,
    canonicalPayload: input.payload,
    canonicalLocation: input.location,
    effectiveProvenance: input.provenance,
    capabilityPolicy: policy(input.requested, input.provenance),
    runtimeClass: input.runtime ?? 'retained',
    splitClass: input.splitClass === undefined ? 'workspace-tool' : input.splitClass,
    equivalenceIdentity: input.equivalence.join('\0'),
    backendSharingIdentity: input.sharing === null ? null : (input.sharing ?? input.equivalence).join('\0'),
  };
}

const workspaceParser = (optional: Record<string, (value: unknown) => boolean> = {}) => (value: unknown): JsonObject | null => {
  const required = ['workspaceId'];
  const permitted = [...required, ...Object.keys(optional)];
  if (!object(value) || Object.keys(value).some((name) => !permitted.includes(name)) || !required.every((name) => name in value) || !key(value.workspaceId)) return null;
  for (const [name, validate] of Object.entries(optional)) if (name in value && !validate(value[name])) return null;
  return value as JsonObject;
};
const optionalKey = (value: unknown) => key(value);
const paramsParser = (value: unknown) => jsonObject(value);

function workspaceDefinition(kind: string, locationKey: keyof TrustedWorkspace['locations'], rendererKey: string): PanelTargetDefinition {
  const parse = workspaceParser(kind === 'code' ? {
    repoId: optionalKey,
    folderIntent: (value) => value === 'workspace-root' || value === 'repository',
  } : kind === 'changes' ? { repoId: optionalKey } : kind === 'forms' ? { formId: optionalKey } : {});
  return {
    kind, version: 1, parse, migrate: (value, version) => version === 0 ? parse(value) : null,
    resolve(value, context) {
      const owned = common(value, context);
      if (typeof owned === 'string') return recoveryResolver(owned);
      const repoId = typeof value.repoId === 'string' ? value.repoId : undefined;
      if (repoId && !owned.workspace.repositoryIds.includes(repoId)) return recoveryResolver('target-scope-denied');
      const location = absolute(owned.workspace.locations[locationKey], owned.workspace.origin);
      if (!location) return recoveryResolver('target-unavailable');
      const identity = [kind, owned.workspaceId, repoId ?? '', typeof value.folderIntent === 'string' ? value.folderIntent : ''];
      return result({ rendererKey, payload: value, location, provenance: 'vk-built-in', requested: ['scripts', 'same-origin', 'forms', 'clipboard-read', 'clipboard-write', 'fullscreen'], equivalence: identity, sharing: ['workspace', owned.workspaceId] });
    },
  };
}

function recoveryResolver(reason: TargetRecoveryReason): ResolverResult {
  return { ...result({ rendererKey: 'panel-target-recovery', payload: {}, location: 'about:blank', provenance: 'external-url', requested: [], splitClass: null, equivalence: ['recovery', reason], sharing: null }), factoryKey: `recovery:${reason}` };
}

function backendDefinition(kind: 'agent-session' | 'terminal' | 'preview', idName: string): PanelTargetDefinition {
  const parse = workspaceParser({ [idName]: optionalKey });
  return {
    kind, version: 1, parse, migrate: (value, version) => version === 0 ? parse(value) : null,
    resolve(value, context) {
      const owned = common(value, context);
      if (typeof owned === 'string') return recoveryResolver(owned);
      const id = value[idName] as string;
      const source = kind === 'agent-session' ? context.agentSessions : kind === 'terminal' ? context.terminals : context.previews;
      const target = source[id];
      if (!target || target.workspaceId !== owned.workspaceId) return recoveryResolver('target-unavailable');
      const location = absolute(target.location, owned.workspace.origin);
      if (!location) return recoveryResolver('target-unavailable');
      return result({ rendererKey: kind, payload: value, location, provenance: kind === 'preview' ? 'forwarded-project' : 'vk-built-in', requested: ['scripts', 'same-origin', 'forms', 'clipboard-read', 'clipboard-write', 'fullscreen'], equivalence: [kind, id], sharing: [kind, id] });
    },
  };
}

const DEFINITIONS: PanelTargetDefinition[] = [
  workspaceDefinition('craft-overview', 'overview', 'craft-overview'),
  backendDefinition('agent-session', 'sessionId'),
  workspaceDefinition('code', 'code', 'workspace-code'),
  workspaceDefinition('changes', 'changes', 'workspace-changes'),
  workspaceDefinition('beads', 'beads', 'workspace-beads'),
  workspaceDefinition('forms', 'forms', 'workspace-forms'),
  backendDefinition('terminal', 'terminalId'),
  backendDefinition('preview', 'previewId'),
  {
    kind: 'custom-url', version: 1,
    parse: (value) => exact(value, ['url']) && typeof value.url === 'string' ? { url: value.url } : null,
    migrate: (value, version) => version === 0 && exact(value, ['requestedUrl']) && typeof value.requestedUrl === 'string' ? { url: value.requestedUrl } : null,
    resolve(value, context) {
      const craft = context.crafts[context.craftId];
      if (!craft) return recoveryResolver('craft-unavailable');
      if (!context.workspaces[craft.workspaceId]?.available) return recoveryResolver('workspace-unavailable');
      let parsed: URL;
      try { parsed = new URL(value.url as string); } catch { return recoveryResolver('unsafe-url'); }
      if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) return recoveryResolver('unsafe-url');
      try {
        const resolved = context.resolveCustomUrl ? context.resolveCustomUrl(parsed) : parsed;
        const location = absolute(String(resolved), context.hostOrigin);
        if (!location) return recoveryResolver('unsafe-url');
        return result({ rendererKey: 'sandboxed-custom-url', payload: { url: parsed.href }, location, provenance: 'external-url', requested: ['scripts'], runtime: 'recreatable', splitClass: null, equivalence: ['custom-url', parsed.href], sharing: null });
      } catch { return recoveryResolver('resolver-failed'); }
    },
  },
  {
    kind: 'plugin-surface', version: 1,
    parse: (value) => exact(value, ['pluginId', 'surfaceId', 'params']) && key(value.pluginId) && key(value.surfaceId) && paramsParser(value.params) ? value as JsonObject : null,
    migrate: (value, version) => version === 0 && exact(value, ['pluginId', 'surfaceKey', 'params']) && key(value.pluginId) && key(value.surfaceKey) && paramsParser(value.params) ? { pluginId: value.pluginId, surfaceId: value.surfaceKey, params: value.params } : null,
    resolve(value, context) { return resolvePlugin(value, context, false); },
  },
  {
    kind: 'internal-route', version: 1,
    parse: (value) => exact(value, ['routeId', 'params']) && key(value.routeId) && paramsParser(value.params) ? value as JsonObject : null,
    migrate: (value, version) => version === 0 && exact(value, ['routeId', 'params']) && key(value.routeId) && paramsParser(value.params) ? value as JsonObject : null,
    resolve(value, context) {
      const routeId = value.routeId as string;
      if (routeId.includes('/')) return resolvePlugin(value, context, true);
      const craft = context.crafts[context.craftId];
      if (!craft) return recoveryResolver('craft-unavailable');
      if (!context.workspaces[craft.workspaceId]?.available) return recoveryResolver('workspace-unavailable');
      const route = context.builtInRoutes[routeId];
      if (!route || !route.allowedCraftIds.includes(context.craftId)) return recoveryResolver('target-unavailable');
      if (route.capabilities !== undefined && !strings(route.capabilities)) return recoveryResolver('invalid-capability-policy');
      const location = absolute(route.location, context.hostOrigin);
      if (!location) return recoveryResolver('target-unavailable');
      return result({ rendererKey: 'internal-route', factoryKey: `internal-route:${routeId}`, payload: value, location, provenance: 'vd-built-in', requested: route.capabilities ?? ['scripts', 'same-origin'], equivalence: ['internal-route', routeId, stable(value.params as JsonObject)], sharing: ['internal-route', routeId] });
    },
  },
];

function resolvePlugin(value: JsonObject, context: PanelTargetResolutionContext, internal: boolean): ResolverResult {
  const craft = context.crafts[context.craftId];
  if (!craft) return recoveryResolver('craft-unavailable');
  const workspace = context.workspaces[craft.workspaceId];
  if (!workspace?.available) return recoveryResolver('workspace-unavailable');
  const registry = context.getPluginRegistry();
  const routeId = internal ? value.routeId as string : `${value.pluginId}/${value.surfaceId}`;
  const contribution = internal ? registry.internalRoutes[routeId] : registry.craftSurfaces[routeId];
  const pluginId = internal ? routeId.slice(0, routeId.indexOf('/')) : value.pluginId as string;
  const plugin = pluginId ? registry.plugins[pluginId] : undefined;
  if (!plugin) return recoveryResolver('plugin-unavailable');
  if (!contribution || contribution.pluginId !== pluginId || contribution.key !== routeId) return recoveryResolver('target-unavailable');
  if (!craft.allowedPluginTargets.includes(routeId)) return recoveryResolver('target-scope-denied');
  const requested = context.pluginCapabilities[routeId] ?? ['scripts'];
  if (!strings(requested)) return recoveryResolver('invalid-capability-policy');
  const routePath = 'path' in contribution ? contribution.path : '/';
  const expanded = contribution.urlTemplate
    .replaceAll('{{origin}}', context.hostOrigin)
    .replaceAll('{{pluginId}}', pluginId)
    .replaceAll('{{routePath}}', routePath);
  const location = absolute(expanded, context.hostOrigin);
  if (!location) return recoveryResolver('target-unavailable');
  const params = value.params as JsonObject;
  const canonicalLocation = internal ? withQuery(location, params) : location;
  return result({
    rendererKey: 'plugin-iframe', factoryKey: internal ? `plugin-internal-route:${routeId}` : `plugin-surface:${routeId}`,
    payload: internal ? { pluginId, routeKey: contribution.sourceKey, routePath, params } : { pluginId, surfaceId: contribution.sourceKey, params },
    location: canonicalLocation, provenance: 'installed-plugin', requested, runtime: 'recreatable', splitClass: 'plugin-opaque',
    equivalence: [internal ? 'plugin-internal-route' : 'plugin-surface', routeId, stable(params)], sharing: null,
  });
}

function withQuery(location: string, params: JsonObject): string {
  const url = new URL(location);
  for (const [name, value] of Object.entries(params).sort(([left], [right]) => left.localeCompare(right))) {
    if (typeof value !== 'string') continue;
    url.searchParams.set(name, value);
  }
  return url.href;
}

function stable(value: JsonObject): string {
  return JSON.stringify(Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right))));
}

function validResolver(value: unknown): value is ResolverResult {
  if (!object(value)) return false;
  const provenances = new Set<EffectiveProvenance>(['vd-built-in', 'vk-built-in', 'installed-plugin', 'forwarded-project', 'external-url']);
  const capabilityKeys = ['allow', 'clipboardRead', 'clipboardWrite', 'downloads', 'forms', 'fullscreen', 'modals', 'popups', 'sameOrigin', 'sandbox', 'scripts'];
  const capabilities = value.capabilityPolicy;
  return typeof value.rendererKey === 'string' && value.rendererKey.length > 0
    && typeof value.factoryKey === 'string' && value.factoryKey.length > 0
    && jsonObject(value.canonicalPayload) && typeof value.canonicalLocation === 'string'
    && provenances.has(value.effectiveProvenance as EffectiveProvenance)
    && object(capabilities) && Object.keys(capabilities).sort().join('\0') === capabilityKeys.sort().join('\0')
    && typeof capabilities.sandbox === 'string' && typeof capabilities.allow === 'string'
    && capabilityKeys.filter((key) => key !== 'sandbox' && key !== 'allow').every((key) => typeof capabilities[key] === 'boolean')
    && (value.runtimeClass === 'retained' || value.runtimeClass === 'recreatable')
    && (typeof value.splitClass === 'string' || value.splitClass === null)
    && typeof value.equivalenceIdentity === 'string'
    && (typeof value.backendSharingIdentity === 'string' || value.backendSharingIdentity === null);
}

function quarantine(reason: TargetRecoveryReason, target: unknown): QuarantinedPanelTarget {
  const stored = object(target) ? `${String(target.kind)}:${String(target.version)}` : 'invalid';
  return { status: 'quarantined', reason, recoveryKey: `${stored}:${reason}`, rendererKey: 'panel-target-recovery', capabilityPolicy: DENY_ALL };
}

export function createPanelTargetRegistry(options: { customDefinitions?: PanelTargetDefinition[] } = {}) {
  const allDefinitions = [...DEFINITIONS, ...(options.customDefinitions ?? [])];
  const definitions = new Map(allDefinitions.map((definition) => [definition.kind, definition]));
  if (definitions.size !== allDefinitions.length) throw new Error('Duplicate Panel target definition');
  return {
    resolve(input: unknown, context: PanelTargetResolutionContext): PanelTargetResolution {
      if (!object(input) || typeof input.kind !== 'string' || !Number.isSafeInteger(input.version) || !('payload' in input)) return quarantine('malformed', input);
      const definition = definitions.get(input.kind);
      if (!definition) return quarantine('unknown-kind', input);
      const version = input.version as number;
      if (version > definition.version || version < 0) return quarantine('unsupported-version', input);
      let payload: JsonObject | null;
      try { payload = version === definition.version ? definition.parse(input.payload) : definition.migrate(input.payload, version); }
      catch { return quarantine('malformed', input); }
      if (!payload) return quarantine('malformed', input);
      let resolved: ResolverResult | null;
      try { resolved = definition.resolve(payload, context); }
      catch { return quarantine('resolver-failed', input); }
      if (!validResolver(resolved)) return quarantine('invalid-resolver-result', input);
      if (resolved.rendererKey === 'panel-target-recovery') return quarantine(resolved.factoryKey.slice('recovery:'.length) as TargetRecoveryReason, input);
      const storedPayload = definition.kind === 'custom-url'
        ? { url: resolved.canonicalPayload.url as string }
        : payload;
      return { status: 'resolved', target: { kind: definition.kind, version: definition.version, payload: storedPayload }, ...resolved };
    },
  };
}

export function findSplitCompatibleTargets(
  invoking: ResolvedPanelTarget,
  candidates: StoredPanelTarget[],
  context: PanelTargetResolutionContext,
  registry = createPanelTargetRegistry(),
): ResolvedPanelTarget[] {
  if (!invoking.splitClass) return [];
  return candidates.map((target) => registry.resolve(target, context))
    .filter((candidate): candidate is ResolvedPanelTarget => candidate.status === 'resolved' && candidate.splitClass === invoking.splitClass)
    .sort((left, right) => left.equivalenceIdentity.localeCompare(right.equivalenceIdentity));
}

export function classifyLegacyPanelRepresentation(input: {
  groupId: string;
  view: { id: string; url: string; ephemeral?: { kind?: string } };
  pair?: { tabIds: string[] };
  views?: Array<{ id: string; url: string }>;
}):
  | { outcome: 'skip'; reason: 'homepage-representation' | 'ephemeral-plugin-placeholder' }
  | { outcome: 'pair-audit'; diagnostics: Array<{ tabId: string; status: 'present' | 'missing' }> }
  | { outcome: 'durable-candidate' } {
  if (input.pair) {
    const ids = new Set((input.views ?? []).map((view) => view.id));
    return { outcome: 'pair-audit', diagnostics: input.pair.tabIds.map((tabId) => ({ tabId, status: ids.has(tabId) ? 'present' : 'missing' })) };
  }
  if (input.view.ephemeral?.kind === 'craft-surface') return { outcome: 'skip', reason: 'ephemeral-plugin-placeholder' };
  if (input.groupId === 'tg_home' || input.view.id === 'tab_overview' || input.view.url === 'internal://spaces-overview') return { outcome: 'skip', reason: 'homepage-representation' };
  return { outcome: 'durable-candidate' };
}
