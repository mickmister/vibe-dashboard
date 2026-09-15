export type CapabilityName =
  | 'scripts' | 'same-origin' | 'forms' | 'modals' | 'downloads'
  | 'popups' | 'popup-escape' | 'top-navigation-by-user-activation'
  | 'clipboard-read' | 'clipboard-write' | 'fullscreen';
export type Provenance = 'vd-built-in' | 'vk-built-in' | 'installed-plugin' | 'forwarded-project' | 'external-url';
export type TrustedCapabilityDefinition = { provenance: Provenance; resolvedUrl: string; requested: CapabilityName[]; pluginId?: string };
export type CapabilityRegistry = { baseOrigin: string; definitions: Record<string, TrustedCapabilityDefinition>; installedPlugins: Set<string> };
export type EffectiveIframePolicy = {
  provenance: Provenance; resolvedUrl: string; sandbox: string; allow: string; messageOrigin: string | null;
  scripts: boolean; sameOrigin: boolean; forms: boolean; modals: boolean; downloads: boolean;
  popups: boolean; popupEscape: boolean; topNavigationByUserActivation: boolean;
  clipboardRead: boolean; clipboardWrite: boolean; fullscreen: boolean;
  acceptsNavigation: (url: string) => boolean;
};
export type RuntimeRegistration = { runtimeId: string; panelId: string; generation: number; sourceWindow: object; policy: EffectiveIframePolicy };

const CEILINGS: Record<Provenance, ReadonlySet<CapabilityName>> = {
  'vd-built-in': new Set(['scripts', 'same-origin', 'forms', 'modals', 'clipboard-read', 'clipboard-write', 'fullscreen']),
  'vk-built-in': new Set(['scripts', 'same-origin', 'forms', 'modals', 'clipboard-read', 'clipboard-write', 'fullscreen']),
  'installed-plugin': new Set(['scripts', 'same-origin', 'fullscreen']),
  // Caddy transports project-controlled content; the port-* hostname is not
  // proof that the content deserves ambient same-origin or clipboard access.
  'forwarded-project': new Set(['scripts', 'forms']),
  'external-url': new Set(['scripts']),
};
const SANDBOX_TOKEN: Partial<Record<CapabilityName, string>> = {
  scripts: 'allow-scripts', 'same-origin': 'allow-same-origin', forms: 'allow-forms', modals: 'allow-modals',
  downloads: 'allow-downloads', popups: 'allow-popups', 'popup-escape': 'allow-popups-to-escape-sandbox',
  'top-navigation-by-user-activation': 'allow-top-navigation-by-user-activation',
};
const ALLOW_TOKEN: Partial<Record<CapabilityName, string>> = {
  'clipboard-read': 'clipboard-read', 'clipboard-write': 'clipboard-write', fullscreen: 'fullscreen',
};

function httpUrl(input: string): URL | null {
  try {
    const url = new URL(input);
    return (url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password ? url : null;
  } catch { return null; }
}

function derivePolicy(definition: TrustedCapabilityDefinition, baseOrigin: string): EffectiveIframePolicy | null {
  const resolved = httpUrl(definition.resolvedUrl);
  const applicationOrigin = httpUrl(baseOrigin)?.origin;
  if (!resolved || !applicationOrigin || !Array.isArray(definition.requested)) return null;
  const ceiling = CEILINGS[definition.provenance];
  if (!ceiling || definition.requested.some((capability) => !Object.prototype.hasOwnProperty.call(SANDBOX_TOKEN, capability) && !Object.prototype.hasOwnProperty.call(ALLOW_TOKEN, capability))) return null;
  if (definition.provenance === 'forwarded-project') {
    const baseHostname = new URL(applicationOrigin).hostname;
    const match = resolved.hostname.match(/^port-(\d+)\.(.+)$/);
    const port = Number(match?.[1]);
    if (!match || match[2] !== baseHostname || !Number.isInteger(port) || port < 1 || port > 65_535) return null;
  }
  const granted = new Set<CapabilityName>();
  if (ceiling.has('scripts')) granted.add('scripts');
  for (const request of definition.requested) {
    // scripts + same-origin on the application origin removes the iframe's
    // effective sandbox boundary; installed plugin content must not request it.
    if (definition.provenance === 'installed-plugin' && request === 'same-origin' && resolved.origin === applicationOrigin) continue;
    if (ceiling.has(request)) granted.add(request);
  }
  const enabled = (name: CapabilityName) => granted.has(name);
  const sameOrigin = enabled('same-origin');
  return Object.freeze({
    provenance: definition.provenance,
    resolvedUrl: resolved.href,
    sandbox: [...granted].map((name) => SANDBOX_TOKEN[name]).filter((token): token is string => Boolean(token)).join(' '),
    allow: [...granted].map((name) => ALLOW_TOKEN[name]).filter((token): token is string => Boolean(token)).join('; '),
    messageOrigin: sameOrigin ? resolved.origin : null,
    scripts: enabled('scripts'), sameOrigin, forms: enabled('forms'), modals: enabled('modals'), downloads: enabled('downloads'),
    popups: enabled('popups'), popupEscape: enabled('popup-escape'), topNavigationByUserActivation: enabled('top-navigation-by-user-activation'),
    clipboardRead: enabled('clipboard-read'), clipboardWrite: enabled('clipboard-write'), fullscreen: enabled('fullscreen'),
    acceptsNavigation: (candidate: string) => {
      const destination = httpUrl(candidate);
      return Boolean(destination && (definition.provenance === 'external-url' || destination.origin === resolved.origin));
    },
  });
}

/** Persisted input is only a lookup key; authority-shaped claims are ignored. */
export function resolveIframeCapabilityPolicy(input: unknown, registry: CapabilityRegistry):
  | { ok: true; policy: EffectiveIframePolicy }
  | { ok: false; reason: 'invalid-target' | 'target-unavailable' | 'plugin-unavailable' | 'invalid-definition' } {
  if (typeof input !== 'object' || input === null || !('targetKey' in input) || typeof input.targetKey !== 'string' || !input.targetKey) return { ok: false, reason: 'invalid-target' };
  const definition = registry.definitions[input.targetKey];
  if (!definition) return { ok: false, reason: 'target-unavailable' };
  if (definition.provenance === 'installed-plugin' && (!definition.pluginId || !registry.installedPlugins.has(definition.pluginId))) return { ok: false, reason: 'plugin-unavailable' };
  const policy = derivePolicy(definition, registry.baseOrigin);
  return policy ? { ok: true, policy } : { ok: false, reason: 'invalid-definition' };
}

export function applyRuntimeLease(registration: RuntimeRegistration, hostId: string): { hostId: string; registration: RuntimeRegistration } {
  return { hostId, registration };
}

function isObject(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
export function validateRuntimeMessage(event: { origin: string; source: unknown; data: unknown }, registration: RuntimeRegistration):
  | { ok: true; type: 'runtime-ready' | 'runtime-state'; payload: Record<string, unknown> }
  | { ok: false; reason: string } {
  if (registration.policy.messageOrigin === null || event.origin !== registration.policy.messageOrigin) return { ok: false, reason: 'origin-mismatch' };
  if (event.source !== registration.sourceWindow) return { ok: false, reason: 'source-mismatch' };
  if (!isObject(event.data) || Object.keys(event.data).sort().join(',') !== 'generation,panelId,payload,runtimeId,schemaVersion,type') return { ok: false, reason: 'invalid-schema' };
  const data = event.data;
  if (data.schemaVersion !== 1 || (data.type !== 'runtime-ready' && data.type !== 'runtime-state') || data.runtimeId !== registration.runtimeId ||
    data.panelId !== registration.panelId || data.generation !== registration.generation || !isObject(data.payload)) return { ok: false, reason: 'invalid-schema' };
  return { ok: true, type: data.type, payload: data.payload };
}
