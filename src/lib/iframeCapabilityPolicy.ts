export const IFRAME_CAPABILITY_NAMES = [
  'scripts',
  'same-origin',
  'forms',
  'modals',
  'downloads',
  'popups',
  'popup-escape',
  'top-navigation-by-user-activation',
  'clipboard-read',
  'clipboard-write',
  'fullscreen',
] as const;

export type IframeCapabilityName = (typeof IFRAME_CAPABILITY_NAMES)[number];
export type IframeProvenance =
  | 'vd-built-in'
  | 'vk-built-in'
  | 'installed-plugin'
  | 'forwarded-project'
  | 'external-url';

export interface TrustedIframeCapabilityDefinition {
  targetKey: string;
  provenance: IframeProvenance;
  resolvedUrl: string;
  requested: unknown;
}

export interface IframePolicyEnvironment {
  applicationOrigin: string;
  redirectGuards: Record<string, { deliveryUrl: string; upstreamOrigin: string }>;
}

export interface EffectiveIframePolicy {
  resolvedUrl: string;
  sandbox: string;
  allow: string;
  messageOrigin: string | null;
  navigationEnforcement: 'trusted-redirect-guard' | 'sandbox-safe-unbounded';
  scripts: boolean;
  sameOrigin: boolean;
  forms: boolean;
  modals: boolean;
  downloads: boolean;
  popups: boolean;
  popupEscape: boolean;
  topNavigationByUserActivation: boolean;
  clipboardRead: boolean;
  clipboardWrite: boolean;
  fullscreen: boolean;
}

const KNOWN = new Set<string>(IFRAME_CAPABILITY_NAMES);
const CEILINGS: Record<IframeProvenance, ReadonlySet<IframeCapabilityName>> = {
  'vd-built-in': new Set(IFRAME_CAPABILITY_NAMES),
  'vk-built-in': new Set(IFRAME_CAPABILITY_NAMES),
  'installed-plugin': new Set(['scripts', 'fullscreen']),
  'forwarded-project': new Set(['scripts', 'forms']),
  'external-url': new Set(['scripts']),
};
const SANDBOX: Partial<Record<IframeCapabilityName, string>> = {
  scripts: 'allow-scripts',
  'same-origin': 'allow-same-origin',
  forms: 'allow-forms',
  modals: 'allow-modals',
  downloads: 'allow-downloads',
  popups: 'allow-popups',
  'popup-escape': 'allow-popups-to-escape-sandbox',
  'top-navigation-by-user-activation': 'allow-top-navigation-by-user-activation',
};
const ALLOW: Partial<Record<IframeCapabilityName, string>> = {
  'clipboard-read': 'clipboard-read',
  'clipboard-write': 'clipboard-write',
  fullscreen: 'fullscreen',
};

export function isIframeCapabilityArray(value: unknown): value is IframeCapabilityName[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string' && KNOWN.has(item));
}

function httpUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url : null;
  } catch {
    return null;
  }
}

export function resolveIframeCapabilityPolicy(
  definition: TrustedIframeCapabilityDefinition,
  environment: IframePolicyEnvironment,
): { ok: true; policy: EffectiveIframePolicy } | { ok: false; reason: 'invalid-definition' | 'redirect-boundary-required' } {
  const resolved = httpUrl(definition.resolvedUrl);
  const application = httpUrl(environment.applicationOrigin);
  if (!resolved || !application || !isIframeCapabilityArray(definition.requested)) {
    return { ok: false, reason: 'invalid-definition' };
  }
  const ceiling = CEILINGS[definition.provenance];
  if (!ceiling) return { ok: false, reason: 'invalid-definition' };
  if (definition.provenance === 'forwarded-project') {
    const match = resolved.hostname.match(/^port-(\d+)\.(.+)$/);
    const port = Number(match?.[1]);
    if (!match || match[2] !== application.hostname || !Number.isInteger(port) || port < 1 || port > 65_535) {
      return { ok: false, reason: 'invalid-definition' };
    }
  }
  const granted = new Set<IframeCapabilityName>(
    definition.requested.filter((capability) => ceiling.has(capability)),
  );
  if (granted.has('popup-escape') && !granted.has('popups')) {
    return { ok: false, reason: 'invalid-definition' };
  }
  const ambient = [...granted].some(
    (capability) => capability === 'same-origin' || capability.startsWith('clipboard-'),
  );
  const guard = environment.redirectGuards[definition.targetKey];
  const delivery = guard ? httpUrl(guard.deliveryUrl) : null;
  const upstream = guard ? httpUrl(guard.upstreamOrigin) : null;
  if (ambient && (!delivery || upstream?.origin !== resolved.origin)) {
    return { ok: false, reason: 'redirect-boundary-required' };
  }
  const has = (capability: IframeCapabilityName) => granted.has(capability);
  return {
    ok: true,
    policy: {
      resolvedUrl: ambient ? delivery!.href : resolved.href,
      sandbox: [...granted].flatMap((capability) => SANDBOX[capability] ?? []).join(' '),
      allow: [...granted].flatMap((capability) => ALLOW[capability] ?? []).join('; '),
      messageOrigin: has('same-origin') ? delivery!.origin : null,
      navigationEnforcement: ambient ? 'trusted-redirect-guard' : 'sandbox-safe-unbounded',
      scripts: has('scripts'),
      sameOrigin: has('same-origin'),
      forms: has('forms'),
      modals: has('modals'),
      downloads: has('downloads'),
      popups: has('popups'),
      popupEscape: has('popup-escape'),
      topNavigationByUserActivation: has('top-navigation-by-user-activation'),
      clipboardRead: has('clipboard-read'),
      clipboardWrite: has('clipboard-write'),
      fullscreen: has('fullscreen'),
    },
  };
}

export function validateEffectiveIframePolicy(
  policy: EffectiveIframePolicy,
  provenance: IframeProvenance,
  applicationOrigin: string,
): boolean {
  const expectedKeys = [
    'allow', 'clipboardRead', 'clipboardWrite', 'downloads', 'forms', 'fullscreen',
    'messageOrigin', 'modals', 'navigationEnforcement', 'popupEscape', 'popups',
    'resolvedUrl', 'sameOrigin', 'sandbox', 'scripts',
    'topNavigationByUserActivation',
  ];
  if (Object.keys(policy).sort().join('\0') !== expectedKeys.sort().join('\0')
    || typeof policy.resolvedUrl !== 'string' || typeof policy.sandbox !== 'string'
    || typeof policy.allow !== 'string'
    || (policy.messageOrigin !== null && typeof policy.messageOrigin !== 'string')
    || !['trusted-redirect-guard', 'sandbox-safe-unbounded'].includes(policy.navigationEnforcement)
    || expectedKeys.filter((key) => !['resolvedUrl', 'sandbox', 'allow', 'messageOrigin', 'navigationEnforcement'].includes(key))
      .some((key) => typeof (policy as unknown as Record<string, unknown>)[key] !== 'boolean')) {
    return false;
  }
  const resolved = httpUrl(policy.resolvedUrl);
  const application = httpUrl(applicationOrigin);
  if (!resolved || !application) return false;
  const enabled = new Set<IframeCapabilityName>();
  const flags: Array<[IframeCapabilityName, boolean]> = [
    ['scripts', policy.scripts], ['same-origin', policy.sameOrigin], ['forms', policy.forms],
    ['modals', policy.modals], ['downloads', policy.downloads], ['popups', policy.popups],
    ['popup-escape', policy.popupEscape],
    ['top-navigation-by-user-activation', policy.topNavigationByUserActivation],
    ['clipboard-read', policy.clipboardRead], ['clipboard-write', policy.clipboardWrite],
    ['fullscreen', policy.fullscreen],
  ];
  for (const [name, active] of flags) if (active) enabled.add(name);
  if ([...enabled].some((name) => !CEILINGS[provenance]?.has(name))) return false;
  if (policy.popupEscape && !policy.popups) return false;
  if (provenance === 'forwarded-project') {
    const match = resolved.hostname.match(/^port-(\d+)\.(.+)$/);
    const port = Number(match?.[1]);
    if (!match || match[2] !== application.hostname || !Number.isInteger(port) || port < 1 || port > 65_535) return false;
  }
  const sandbox = [...enabled].flatMap((name) => SANDBOX[name] ?? []).join(' ');
  const allow = [...enabled].flatMap((name) => ALLOW[name] ?? []).join('; ');
  if (policy.sandbox !== sandbox || policy.allow !== allow) return false;
  const ambient = policy.sameOrigin || policy.clipboardRead || policy.clipboardWrite;
  if (ambient) {
    return policy.navigationEnforcement === 'trusted-redirect-guard'
      && policy.messageOrigin === (policy.sameOrigin ? resolved.origin : null);
  }
  return policy.navigationEnforcement === 'sandbox-safe-unbounded' && policy.messageOrigin === null;
}

export interface IframeRuntimeRegistration {
  runtimeId: string;
  panelId: string;
  generation: number;
  sourceWindow: unknown;
  policy: EffectiveIframePolicy;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function validateIframeRuntimeMessage(
  event: { origin: string; source: unknown; data: unknown },
  registration: IframeRuntimeRegistration,
): { ok: true; type: 'runtime-ready' | 'runtime-state'; payload: Record<string, unknown> } | { ok: false; reason: string } {
  if (registration.policy.messageOrigin === null || event.origin !== registration.policy.messageOrigin) return { ok: false, reason: 'origin-mismatch' };
  if (event.source !== registration.sourceWindow) return { ok: false, reason: 'source-mismatch' };
  if (!record(event.data) || Object.keys(event.data).sort().join(',') !== 'generation,panelId,payload,runtimeId,schemaVersion,type') return { ok: false, reason: 'invalid-schema' };
  const data = event.data;
  if (data.schemaVersion !== 1 || data.runtimeId !== registration.runtimeId || data.panelId !== registration.panelId || data.generation !== registration.generation || !record(data.payload)) return { ok: false, reason: 'invalid-schema' };
  if (data.type === 'runtime-ready' && Object.keys(data.payload).length === 1 && data.payload.protocolVersion === 1) return { ok: true, type: data.type, payload: { protocolVersion: 1 } };
  if (data.type === 'runtime-state' && Object.keys(data.payload).sort().join(',') === 'heartbeat,visibility' && (data.payload.visibility === 'active' || data.payload.visibility === 'inactive') && Number.isSafeInteger(data.payload.heartbeat) && Number(data.payload.heartbeat) >= 0) return { ok: true, type: data.type, payload: { visibility: data.payload.visibility, heartbeat: data.payload.heartbeat } };
  return { ok: false, reason: 'invalid-payload' };
}
