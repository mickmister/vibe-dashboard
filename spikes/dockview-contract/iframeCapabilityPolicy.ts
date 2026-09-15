export type CapabilityName = 'scripts' | 'same-origin' | 'forms' | 'modals' | 'downloads' | 'popups' | 'popup-escape' | 'top-navigation-by-user-activation' | 'clipboard-read' | 'clipboard-write' | 'fullscreen';
export type Provenance = 'vd-built-in' | 'vk-built-in' | 'installed-plugin' | 'forwarded-project' | 'external-url';
export type TrustedCapabilityDefinition = { provenance: Provenance; resolvedUrl: string; requested: CapabilityName[]; pluginId?: string; pluginVersion?: string; contributionKey?: string };
export type CapabilityRegistry = {
  baseOrigin: string;
  definitions: Record<string, TrustedCapabilityDefinition>;
  plugins: Record<string, { version: string; contributions: Record<string, { allowed: CapabilityName[] }> }>;
  redirectGuards: Record<string, { deliveryUrl: string; upstreamOrigin: string }>;
};
export type EffectiveIframePolicy = {
  provenance: Provenance; resolvedUrl: string; sandbox: string; allow: string; messageOrigin: string | null;
  scripts: boolean; sameOrigin: boolean; forms: boolean; modals: boolean; downloads: boolean; popups: boolean;
  popupEscape: boolean; topNavigationByUserActivation: boolean; clipboardRead: boolean; clipboardWrite: boolean; fullscreen: boolean;
  navigationEnforcement: 'trusted-redirect-guard' | 'sandbox-safe-unbounded';
};
export type RuntimeRegistration = { runtimeId: string; panelId: string; generation: number; sourceWindow: object; policy: EffectiveIframePolicy };

const CEILINGS: Record<Provenance, ReadonlySet<CapabilityName>> = {
  'vd-built-in': new Set(['scripts', 'same-origin', 'forms', 'modals', 'clipboard-read', 'clipboard-write', 'fullscreen']),
  'vk-built-in': new Set(['scripts', 'same-origin', 'forms', 'modals', 'clipboard-read', 'clipboard-write', 'fullscreen']),
  // V1 plugins are always opaque-origin. A manifest cannot raise this ceiling.
  'installed-plugin': new Set(['scripts', 'fullscreen']),
  'forwarded-project': new Set(['scripts', 'forms']),
  'external-url': new Set(['scripts']),
};
const SANDBOX_TOKEN: Partial<Record<CapabilityName, string>> = {
  scripts: 'allow-scripts', 'same-origin': 'allow-same-origin', forms: 'allow-forms', modals: 'allow-modals', downloads: 'allow-downloads',
  popups: 'allow-popups', 'popup-escape': 'allow-popups-to-escape-sandbox', 'top-navigation-by-user-activation': 'allow-top-navigation-by-user-activation',
};
const ALLOW_TOKEN: Partial<Record<CapabilityName, string>> = { 'clipboard-read': 'clipboard-read', 'clipboard-write': 'clipboard-write', fullscreen: 'fullscreen' };

function httpUrl(input: string): URL | null {
  try { const url = new URL(input); return (url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password ? url : null; }
  catch { return null; }
}

function derivePolicy(targetKey: string, definition: TrustedCapabilityDefinition, registry: CapabilityRegistry): EffectiveIframePolicy | null {
  const resolved = httpUrl(definition.resolvedUrl);
  const applicationOrigin = httpUrl(registry.baseOrigin)?.origin;
  if (!resolved || !applicationOrigin || !Array.isArray(definition.requested)) return null;
  const ceiling = CEILINGS[definition.provenance];
  if (!ceiling || definition.requested.some((capability) => !Object.hasOwn(SANDBOX_TOKEN, capability) && !Object.hasOwn(ALLOW_TOKEN, capability))) return null;
  if (definition.provenance === 'forwarded-project') {
    const match = resolved.hostname.match(/^port-(\d+)\.(.+)$/);
    const port = Number(match?.[1]);
    if (!match || match[2] !== new URL(applicationOrigin).hostname || !Number.isInteger(port) || port < 1 || port > 65_535) return null;
  }
  const granted = new Set<CapabilityName>();
  if (ceiling.has('scripts')) granted.add('scripts');
  for (const request of definition.requested) {
    if (ceiling.has(request)) granted.add(request);
  }
  const ambient = [...granted].some((capability) => capability === 'same-origin' || capability.startsWith('clipboard-'));
  const guard = registry.redirectGuards[targetKey];
  const delivery = guard && httpUrl(guard.deliveryUrl);
  if (ambient && (!delivery || httpUrl(guard.upstreamOrigin)?.origin !== resolved.origin)) return null;
  const enabled = (name: CapabilityName) => granted.has(name);
  const sameOrigin = enabled('same-origin');
  return Object.freeze({
    provenance: definition.provenance, resolvedUrl: ambient ? delivery!.href : resolved.href,
    sandbox: [...granted].flatMap((name) => SANDBOX_TOKEN[name] ?? []).join(' '),
    allow: [...granted].flatMap((name) => ALLOW_TOKEN[name] ?? []).join('; '),
    messageOrigin: sameOrigin ? delivery!.origin : null,
    scripts: enabled('scripts'), sameOrigin, forms: enabled('forms'), modals: enabled('modals'), downloads: enabled('downloads'),
    popups: enabled('popups'), popupEscape: enabled('popup-escape'), topNavigationByUserActivation: enabled('top-navigation-by-user-activation'),
    clipboardRead: enabled('clipboard-read'), clipboardWrite: enabled('clipboard-write'), fullscreen: enabled('fullscreen'),
    navigationEnforcement: ambient ? 'trusted-redirect-guard' : 'sandbox-safe-unbounded',
  });
}

/** Persisted input is only a lookup key; authority-shaped claims are ignored. */
export function resolveIframeCapabilityPolicy(input: unknown, registry: CapabilityRegistry):
  | { ok: true; policy: EffectiveIframePolicy }
  | { ok: false; reason: 'invalid-target' | 'target-unavailable' | 'plugin-unavailable' | 'invalid-definition' | 'redirect-boundary-required' } {
  if (typeof input !== 'object' || input === null || !('targetKey' in input) || typeof input.targetKey !== 'string' || !input.targetKey) return { ok: false, reason: 'invalid-target' };
  const definition = registry.definitions[input.targetKey];
  if (!definition) return { ok: false, reason: 'target-unavailable' };
  let effectiveDefinition = definition;
  if (definition.provenance === 'installed-plugin') {
    const plugin = definition.pluginId ? registry.plugins[definition.pluginId] : undefined;
    const contribution = definition.contributionKey ? plugin?.contributions[definition.contributionKey] : undefined;
    if (!plugin) return { ok: false, reason: 'plugin-unavailable' };
    if (!definition.pluginVersion || plugin.version !== definition.pluginVersion || !contribution) return { ok: false, reason: 'invalid-definition' };
    effectiveDefinition = { ...definition, requested: definition.requested.filter((capability) => contribution.allowed.includes(capability)) };
  }
  const resolved = httpUrl(effectiveDefinition.resolvedUrl);
  if (!resolved || !Array.isArray(effectiveDefinition.requested)) return { ok: false, reason: 'invalid-definition' };
  const classCeiling = CEILINGS[effectiveDefinition.provenance];
  const requestsAmbient = effectiveDefinition.requested.some((capability) => classCeiling?.has(capability) && (capability === 'clipboard-read' || capability === 'clipboard-write')) ||
    (classCeiling?.has('same-origin') && effectiveDefinition.requested.includes('same-origin'));
  const guard = registry.redirectGuards[input.targetKey];
  if (requestsAmbient && (!guard || httpUrl(guard.upstreamOrigin)?.origin !== resolved.origin || !httpUrl(guard.deliveryUrl))) return { ok: false, reason: 'redirect-boundary-required' };
  const policy = derivePolicy(input.targetKey, effectiveDefinition, registry);
  return policy ? { ok: true, policy } : { ok: false, reason: 'invalid-definition' };
}

export function applyRuntimeLease(registration: RuntimeRegistration, hostId: string): { hostId: string; registration: RuntimeRegistration } { return { hostId, registration }; }
function isObject(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
export function validateRuntimeMessage(event: { origin: string; source: unknown; data: unknown }, registration: RuntimeRegistration):
  | { ok: true; type: 'runtime-ready' | 'runtime-state'; payload: Record<string, unknown> } | { ok: false; reason: string } {
  if (registration.policy.messageOrigin === null || event.origin !== registration.policy.messageOrigin) return { ok: false, reason: 'origin-mismatch' };
  if (event.source !== registration.sourceWindow) return { ok: false, reason: 'source-mismatch' };
  if (!isObject(event.data) || Object.keys(event.data).sort().join(',') !== 'generation,panelId,payload,runtimeId,schemaVersion,type') return { ok: false, reason: 'invalid-schema' };
  const data = event.data;
  if (data.schemaVersion !== 1 || data.runtimeId !== registration.runtimeId || data.panelId !== registration.panelId || data.generation !== registration.generation || !isObject(data.payload)) return { ok: false, reason: 'invalid-schema' };
  if (data.type === 'runtime-ready' && Object.keys(data.payload).length === 1 && data.payload.protocolVersion === 1) return { ok: true, type: data.type, payload: { protocolVersion: 1 } };
  if (data.type === 'runtime-state' && Object.keys(data.payload).sort().join(',') === 'heartbeat,visibility' && (data.payload.visibility === 'active' || data.payload.visibility === 'inactive') && Number.isSafeInteger(data.payload.heartbeat) && Number(data.payload.heartbeat) >= 0) return { ok: true, type: data.type, payload: { visibility: data.payload.visibility, heartbeat: data.payload.heartbeat } };
  return { ok: false, reason: 'invalid-payload' };
}
