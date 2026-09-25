import { getPluginRegistrySnapshot } from '../modules/plugins/vibe-dashboard/registry';
import { parsePluginInternalUrl } from '../modules/plugins/vibe-dashboard/runtime';
import type { PluginRegistryState } from '../modules/plugins/vibe-dashboard/types';
import {
  resolveIframeCapabilityPolicy,
  validateEffectiveIframePolicy,
  type EffectiveIframePolicy,
  type IframeCapabilityName,
  type IframeProvenance,
} from '../lib/iframeCapabilityPolicy';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };
export type CapabilityName = IframeCapabilityName;
export type EffectiveProvenance = IframeProvenance;

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

interface OwnedBackendTarget { workspaceId: string; location: string; factoryKey?: string; allowedCraftIds?: string[] }
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
  getPluginRegistry?: () => PluginRegistryState;
  redirectGuards: Record<string, { deliveryUrl: string; upstreamOrigin: string }>;
  resolveCustomUrl?(url: URL): URL | string;
}

export type CapabilityPolicy = EffectiveIframePolicy;

export type TargetRecoveryReason =
  | 'malformed' | 'unknown-kind' | 'unsupported-version' | 'craft-unavailable'
  | 'workspace-unavailable' | 'workspace-owner-mismatch' | 'target-scope-denied'
  | 'target-unavailable' | 'ambiguous-target' | 'plugin-unavailable' | 'unsafe-url'
  | 'invalid-capability-policy' | 'redirect-boundary-required' | 'invalid-route-params'
  | 'resolver-failed' | 'invalid-resolver-result';

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
  validateResolved?(value: JsonObject, resolved: ResolverResult): boolean;
}

const KEY = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;
const DENY_ALL: CapabilityPolicy = {
  resolvedUrl: 'about:blank', sandbox: '', allow: '', messageOrigin: null,
  navigationEnforcement: 'sandbox-safe-unbounded', scripts: false, sameOrigin: false,
  forms: false, modals: false, downloads: false, popups: false, popupEscape: false,
  topNavigationByUserActivation: false, clipboardRead: false, clipboardWrite: false,
  fullscreen: false,
};

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
  provenance: EffectiveProvenance; capabilityPolicy: CapabilityPolicy; runtime?: 'retained' | 'recreatable';
  splitClass?: string | null; equivalence: string[]; sharing?: string[] | null;
}): ResolverResult {
  return {
    rendererKey: input.rendererKey,
    factoryKey: input.factoryKey ?? input.rendererKey,
    canonicalPayload: input.payload,
    canonicalLocation: input.location,
    effectiveProvenance: input.provenance,
    capabilityPolicy: input.capabilityPolicy,
    runtimeClass: input.runtime ?? 'retained',
    splitClass: input.splitClass === undefined ? 'workspace-tool' : input.splitClass,
    equivalenceIdentity: input.equivalence.join('\0'),
    backendSharingIdentity: input.sharing === null ? null : (input.sharing ?? input.equivalence).join('\0'),
  };
}

function authorizedResult(
  input: Omit<Parameters<typeof result>[0], 'capabilityPolicy'> & { targetKey: string; requested: unknown },
  context: PanelTargetResolutionContext,
): ResolverResult {
  const resolution = resolveIframeCapabilityPolicy({
    targetKey: input.targetKey,
    provenance: input.provenance,
    resolvedUrl: input.location,
    requested: input.requested,
  }, { applicationOrigin: context.hostOrigin, redirectGuards: context.redirectGuards });
  if (!resolution.ok) {
    return recoveryResolver(resolution.reason === 'invalid-definition'
      ? 'invalid-capability-policy'
      : 'redirect-boundary-required');
  }
  return result({ ...input, location: resolution.policy.resolvedUrl, capabilityPolicy: resolution.policy });
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
      const identity = [kind, owned.workspaceId];
      if (repoId) identity.push(repoId);
      if (typeof value.folderIntent === 'string') identity.push(value.folderIntent);
      if (typeof value.formId === 'string') identity.push(value.formId);
      return authorizedResult({ targetKey: `${kind}:${owned.workspaceId}`, rendererKey, payload: value, location, provenance: 'vk-built-in', requested: ['scripts', 'same-origin', 'forms', 'clipboard-read', 'clipboard-write', 'fullscreen'], equivalence: identity, sharing: ['workspace', owned.workspaceId] }, context);
    },
  };
}

function recoveryResolver(reason: TargetRecoveryReason): ResolverResult {
  return { ...result({ rendererKey: 'panel-target-recovery', payload: {}, location: 'about:blank', provenance: 'external-url', capabilityPolicy: DENY_ALL, splitClass: null, equivalence: ['recovery', reason], sharing: null }), factoryKey: `recovery:${reason}` };
}

function backendDefinition(kind: 'agent-session' | 'terminal' | 'preview', idName: string): PanelTargetDefinition {
  const parse = (value: unknown): JsonObject | null => exact(value, ['workspaceId', idName])
    && key(value.workspaceId) && key(value[idName]) ? value as JsonObject : null;
  return {
    kind, version: 1, parse, migrate: (value, version) => version === 0 ? parse(value) : null,
    resolve(value, context) {
      const owned = common(value, context);
      if (typeof owned === 'string') return recoveryResolver(owned);
      const id = value[idName] as string;
      const source = kind === 'agent-session' ? context.agentSessions : kind === 'terminal' ? context.terminals : context.previews;
      const target = source[id];
      if (!target || target.workspaceId !== owned.workspaceId
        || (target.allowedCraftIds && !target.allowedCraftIds.includes(context.craftId))) return recoveryResolver('target-unavailable');
      const location = absolute(target.location, owned.workspace.origin);
      if (!location) return recoveryResolver('target-unavailable');
      return authorizedResult({ targetKey: `${kind}:${id}`, rendererKey: kind, factoryKey: target.factoryKey ?? kind, payload: value, location, provenance: kind === 'preview' ? 'forwarded-project' : 'vk-built-in', requested: ['scripts', 'same-origin', 'forms', 'clipboard-read', 'clipboard-write', 'fullscreen'], equivalence: [kind, id], sharing: [kind, id] }, context);
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
        return authorizedResult({ targetKey: `custom-url:${parsed.href}`, rendererKey: 'sandboxed-custom-url', payload: { url: parsed.href }, location, provenance: 'external-url', requested: ['scripts'], runtime: 'recreatable', splitClass: null, equivalence: ['custom-url', parsed.href], sharing: null }, context);
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
      const location = absolute(route.location, context.hostOrigin);
      if (!location) return recoveryResolver('target-unavailable');
      return authorizedResult({ targetKey: `internal-route:${routeId}`, rendererKey: 'internal-route', factoryKey: `internal-route:${routeId}`, payload: value, location, provenance: 'vd-built-in', requested: route.capabilities ?? ['scripts', 'same-origin'], equivalence: ['internal-route', routeId, stable(value.params as JsonObject)], sharing: ['internal-route', routeId] }, context);
    },
  },
];

function resolvePlugin(value: JsonObject, context: PanelTargetResolutionContext, internal: boolean): ResolverResult {
  const craft = context.crafts[context.craftId];
  if (!craft) return recoveryResolver('craft-unavailable');
  const workspace = context.workspaces[craft.workspaceId];
  if (!workspace?.available) return recoveryResolver('workspace-unavailable');
  const registry = (context.getPluginRegistry ?? getPluginRegistrySnapshot)();
  const routeId = internal ? value.routeId as string : `${value.pluginId}/${value.surfaceId}`;
  const contribution = internal ? registry.internalRoutes[routeId] : registry.craftSurfaces[routeId];
  const pluginId = internal ? routeId.slice(0, routeId.indexOf('/')) : value.pluginId as string;
  const plugin = pluginId ? registry.plugins[pluginId] : undefined;
  if (!plugin) return recoveryResolver('plugin-unavailable');
  if (!contribution || contribution.pluginId !== pluginId || contribution.key !== routeId) return recoveryResolver('target-unavailable');
  const manifestContribution = internal
    ? plugin.contributions.internalRoutes?.find((candidate) => candidate.key === contribution.sourceKey)
    : plugin.contributions.craftSurfaces?.find((candidate) => candidate.key === contribution.sourceKey);
  if (!manifestContribution
    || manifestContribution.urlTemplate !== contribution.urlTemplate
    || (internal && (!('path' in manifestContribution) || !('path' in contribution)
      || manifestContribution.path !== contribution.path))) {
    return recoveryResolver('target-unavailable');
  }
  if (internal && 'path' in contribution && Object.values(registry.internalRoutes).filter((candidate) => candidate.pluginId === pluginId && candidate.path === contribution.path).length !== 1) {
    return recoveryResolver('ambiguous-target');
  }
  if (!craft.allowedPluginTargets.includes(routeId)) return recoveryResolver('target-scope-denied');
  const requested = manifestContribution.capabilities ?? ['scripts'];
  const routePath = 'path' in contribution ? contribution.path : '/';
  const expanded = contribution.urlTemplate
    .replaceAll('{{origin}}', context.hostOrigin)
    .replaceAll('{{pluginId}}', pluginId)
    .replaceAll('{{routePath}}', routePath);
  const location = absolute(expanded, context.hostOrigin);
  if (!location) return recoveryResolver('target-unavailable');
  const params = value.params as JsonObject;
  if (internal) {
    const allowedParams = 'allowedParams' in manifestContribution ? manifestContribution.allowedParams : undefined;
    if (!Array.isArray(allowedParams)
      || allowedParams.some((name: unknown) => !key(name))
      || new Set(allowedParams).size !== allowedParams.length
      || Object.keys(params).some((name) => !allowedParams.includes(name))
      || Object.values(params).some((param) => typeof param !== 'string')) {
      return recoveryResolver('invalid-route-params');
    }
  }
  const canonicalLocation = internal ? withQuery(location, params) : location;
  return authorizedResult({
    targetKey: internal ? `plugin-internal-route:${routeId}` : `plugin-surface:${routeId}`,
    rendererKey: 'plugin-iframe', factoryKey: internal ? `plugin-internal-route:${routeId}` : `plugin-surface:${routeId}`,
    payload: internal ? { pluginId, routeKey: contribution.sourceKey, routePath, params } : { pluginId, surfaceId: contribution.sourceKey, params },
    location: canonicalLocation, provenance: 'installed-plugin', requested, runtime: 'recreatable', splitClass: 'plugin-opaque',
    equivalence: [internal ? 'plugin-internal-route' : 'plugin-surface', routeId, stable(params)],
    sharing: internal ? ['plugin-internal-route', routeId] : null,
  }, context);
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
  const resolverKeys = [
    'backendSharingIdentity', 'canonicalLocation', 'canonicalPayload', 'capabilityPolicy',
    'effectiveProvenance', 'equivalenceIdentity', 'factoryKey', 'rendererKey',
    'runtimeClass', 'splitClass',
  ];
  const provenances = new Set<EffectiveProvenance>(['vd-built-in', 'vk-built-in', 'installed-plugin', 'forwarded-project', 'external-url']);
  const capabilities = value.capabilityPolicy;
  return Object.keys(value).sort().join('\0') === resolverKeys.sort().join('\0')
    && typeof value.rendererKey === 'string' && value.rendererKey.length > 0
    && typeof value.factoryKey === 'string' && value.factoryKey.length > 0
    && jsonObject(value.canonicalPayload) && typeof value.canonicalLocation === 'string'
    && provenances.has(value.effectiveProvenance as EffectiveProvenance)
    && object(capabilities)
    && (value.runtimeClass === 'retained' || value.runtimeClass === 'recreatable')
    && (typeof value.splitClass === 'string' || value.splitClass === null)
    && typeof value.equivalenceIdentity === 'string'
    && (typeof value.backendSharingIdentity === 'string' || value.backendSharingIdentity === null);
}

function validateResolvedSemantics(
  resolved: ResolverResult,
  context: PanelTargetResolutionContext,
): boolean {
  const location = absolute(resolved.canonicalLocation, context.hostOrigin);
  if (!location || location !== resolved.canonicalLocation
    || resolved.capabilityPolicy.resolvedUrl !== location
    || !resolved.equivalenceIdentity
    || resolved.equivalenceIdentity.split('\0').some((part) => !part)
    || (resolved.backendSharingIdentity !== null
      && resolved.backendSharingIdentity.split('\0').some((part) => !part))) {
    return false;
  }
  if (!validateEffectiveIframePolicy(
    resolved.capabilityPolicy,
    resolved.effectiveProvenance,
    context.hostOrigin,
  )) return false;
  const ambient = resolved.capabilityPolicy.sameOrigin
    || resolved.capabilityPolicy.clipboardRead
    || resolved.capabilityPolicy.clipboardWrite;
  if (ambient && !Object.values(context.redirectGuards).some(
    (guard) => absolute(guard.deliveryUrl, context.hostOrigin) === location,
  )) return false;
  if (resolved.effectiveProvenance === 'installed-plugin'
    && (resolved.runtimeClass !== 'recreatable' || resolved.capabilityPolicy.sameOrigin)) return false;
  if (resolved.effectiveProvenance === 'external-url'
    && (resolved.runtimeClass !== 'recreatable' || resolved.splitClass !== null)) return false;
  return true;
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
      if (!exact(input, ['kind', 'version', 'payload']) || typeof input.kind !== 'string' || !Number.isSafeInteger(input.version)) return quarantine('malformed', input);
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
      const customDefinition = (options.customDefinitions ?? []).includes(definition);
      const customAmbient = customDefinition && (resolved.capabilityPolicy.sameOrigin
        || resolved.capabilityPolicy.clipboardRead
        || resolved.capabilityPolicy.clipboardWrite);
      try {
        if (!validateResolvedSemantics(resolved, context)
          || customAmbient
          || (customDefinition
            && (!definition.validateResolved || !definition.validateResolved(payload, resolved)))) {
          return quarantine('invalid-resolver-result', input);
        }
      } catch { return quarantine('invalid-resolver-result', input); }
      const storedPayload = definition.kind === 'custom-url'
        ? { url: resolved.canonicalPayload.url as string }
        : payload;
      return { status: 'resolved', target: { kind: definition.kind, version: definition.version, payload: storedPayload }, ...resolved };
    },
  };
}

export function findSplitCompatibleTargets(
  invoking: ResolvedPanelTarget,
  invokingCraftId: string,
  candidates: Array<{ craftId: string; target: StoredPanelTarget }>,
  contextForCraft: (craftId: string) => PanelTargetResolutionContext | null,
  registry = createPanelTargetRegistry(),
): Array<{ craftId: string; target: StoredPanelTarget; resolved: ResolvedPanelTarget }> {
  if (!invoking.splitClass) return [];
  return candidates.flatMap((candidate) => {
    const context = contextForCraft(candidate.craftId);
    if (!context || context.craftId !== candidate.craftId) return [];
    const resolved = registry.resolve(candidate.target, context);
    return resolved.status === 'resolved' && resolved.splitClass === invoking.splitClass
      ? [{ ...candidate, resolved }]
      : [];
  }).sort((left, right) => Number(right.craftId === invokingCraftId) - Number(left.craftId === invokingCraftId)
    || left.resolved.equivalenceIdentity.localeCompare(right.resolved.equivalenceIdentity)
    || left.craftId.localeCompare(right.craftId));
}

export function classifyLegacyPanelRepresentation(input: {
  groupId: string;
  view: { id: string; title?: string; url: string; ephemeral?: { kind?: string } };
  pair?: { id: string; tabIds: string[] };
  views?: unknown[];
  resolveMember?: (view: { id: string; url: string }) => StoredPanelTarget | null;
}):
  | { outcome: 'skip'; reason: 'homepage-representation' | 'ephemeral-plugin-placeholder' | 'removed-beads-surface' }
  | { outcome: 'pair'; reason: 'pair-cardinality'; diagnostics: Array<{ tabId: string; status: 'invalid'; reason: 'pair-cardinality' }>; targets: [] }
  | { outcome: 'pair'; diagnostics: Array<{ tabId: string; status: 'resolved' | 'missing' | 'malformed' | 'skipped' | 'unresolvable'; reason?: string }>; targets: StoredPanelTarget[]; topology?: { pairId: string; memberIndexes: [0, 1] } }
  | { outcome: 'durable-candidate' } {
  if (input.pair) {
    const tabIds = input.pair.tabIds;
    if (tabIds.length !== 2 || new Set(tabIds).size !== tabIds.length) {
      return { outcome: 'pair', reason: 'pair-cardinality', targets: [], diagnostics: tabIds.map((tabId) => ({ tabId, status: 'invalid', reason: 'pair-cardinality' })) };
    }
    const diagnostics: Array<{ tabId: string; status: 'resolved' | 'missing' | 'malformed' | 'skipped' | 'unresolvable'; reason?: string }> = [];
    const targets: StoredPanelTarget[] = [];
    for (const tabId of tabIds) {
      const raw = (input.views ?? []).find((candidate) => object(candidate) && candidate.id === tabId);
      if (!raw) { diagnostics.push({ tabId, status: 'missing', reason: 'missing-view' }); continue; }
      if (!exactLegacyView(raw)) { diagnostics.push({ tabId, status: 'malformed', reason: 'malformed-view' }); continue; }
      const classification = classifyLegacyPanelRepresentation({ groupId: input.groupId, view: raw });
      if (classification.outcome === 'skip') { diagnostics.push({ tabId, status: 'skipped', reason: classification.reason }); continue; }
      let target: StoredPanelTarget | null = null;
      try { target = input.resolveMember?.(raw) ?? null; }
      catch { target = null; }
      if (!target) { diagnostics.push({ tabId, status: 'unresolvable', reason: 'target-unresolvable' }); continue; }
      diagnostics.push({ tabId, status: 'resolved' });
      targets.push(target);
    }
    return { outcome: 'pair', targets, diagnostics, ...(targets.length === 2 ? { topology: { pairId: input.pair.id, memberIndexes: [0, 1] as [0, 1] } } : {}) };
  }
  if (input.view.ephemeral?.kind === 'craft-surface') return { outcome: 'skip', reason: 'ephemeral-plugin-placeholder' };
  if (input.view.id === 'beads' || input.view.title?.trim().toLowerCase() === 'beads') return { outcome: 'skip', reason: 'removed-beads-surface' };
  if (input.groupId === 'tg_home' || input.view.id === 'tab_overview' || input.view.url === 'internal://spaces-overview') return { outcome: 'skip', reason: 'homepage-representation' };
  return { outcome: 'durable-candidate' };
}

/**
 * Adapts a legacy View into a stored intent, then requires the current trusted
 * registry to resolve it. Expanded locations and capability claims are never
 * copied into persistence.
 */
export function resolveLegacyPanelTarget(input: {
  view: { id: string; url: string };
  workspaceId: string;
  context: PanelTargetResolutionContext;
  registry?: ReturnType<typeof createPanelTargetRegistry>;
}): StoredPanelTarget | null {
  const payload = { workspaceId: input.workspaceId };
  let candidate: StoredPanelTarget | null = null;
  if (input.view.id === 'code') candidate = { kind: 'code', version: 1, payload: { ...payload, folderIntent: 'workspace-root' } };
  else if (input.view.id === 'changes') candidate = { kind: 'changes', version: 1, payload };
  else if (input.view.id === 'beads') candidate = { kind: 'beads', version: 1, payload };
  else if (input.view.id === 'forms') candidate = { kind: 'forms', version: 1, payload };
  else if (input.view.id === 'overview' || input.view.id === 'craft-overview') candidate = { kind: 'craft-overview', version: 1, payload };
  else {
    const pluginRegistry = (input.context.getPluginRegistry ?? getPluginRegistrySnapshot)();
    const matchingSurfaces = Object.values(pluginRegistry.craftSurfaces).filter((surface) => {
      const expanded = surface.urlTemplate
        .replaceAll('{{origin}}', input.context.hostOrigin)
        .replaceAll('{{pluginId}}', surface.pluginId);
      try { return new URL(expanded, input.context.hostOrigin).href === new URL(input.view.url, input.context.hostOrigin).href; }
      catch { return false; }
    });
    if (matchingSurfaces.length > 1) return null;
    if (matchingSurfaces.length === 1) {
      const surface = matchingSurfaces[0]!;
      candidate = { kind: 'plugin-surface', version: 1, payload: { pluginId: surface.pluginId, surfaceId: surface.sourceKey, params: {} } };
    }
    const queryIndex = input.view.url.indexOf('?');
    const pluginRoute = parsePluginInternalUrl(queryIndex < 0 ? input.view.url : input.view.url.slice(0, queryIndex));
    if (!candidate && pluginRoute) {
      const matches = Object.values(pluginRegistry.internalRoutes)
        .filter((route) => route.pluginId === pluginRoute.pluginId && route.path === pluginRoute.routePath);
      if (matches.length !== 1) return null;
      const search = new URLSearchParams(queryIndex < 0 ? '' : input.view.url.slice(queryIndex + 1));
      const names = [...search.keys()];
      if (new Set(names).size !== names.length) return null;
      const params = Object.fromEntries(search);
      candidate = { kind: 'internal-route', version: 1, payload: { routeId: matches[0]!.key, params } };
    } else if (!candidate) {
      try {
        const url = new URL(input.view.url);
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
        if (url.pathname.includes('/dashboard/plugins/')) return null;
        candidate = { kind: 'custom-url', version: 1, payload: { url: url.href } };
      } catch { return null; }
    }
  }
  const resolution = (input.registry ?? createPanelTargetRegistry()).resolve(candidate, input.context);
  return resolution.status === 'resolved' ? resolution.target : null;
}

function exactLegacyView(value: unknown): value is { id: string; title: string; url: string; pinned?: boolean; ephemeral?: { kind?: string } } {
  if (!object(value) || typeof value.id !== 'string' || typeof value.title !== 'string' || typeof value.url !== 'string') return false;
  if (value.pinned !== undefined && typeof value.pinned !== 'boolean') return false;
  if (value.ephemeral === undefined) return true;
  return object(value.ephemeral) && value.ephemeral.kind === 'craft-surface';
}
