/* eslint-disable formatjs/no-literal-string-in-object -- Stable surface titles mirror persisted/product identifiers; rendered UI owns translation. */
export type DockviewProductSurfaceKey = 'agent' | 'code' | 'forms';

export type DockviewProductSurfaceRenderer = 'iframe' | 'react';

export type DockviewProductSurfaceAuthority =
  | 'vk-workspace'
  | 'code-workspace-folder'
  | 'first-party-react-plugin';

export interface DockviewProductSurfaceContract {
  key: DockviewProductSurfaceKey;
  title: string;
  targetKind: 'craft-overview' | 'code' | 'forms';
  renderer: DockviewProductSurfaceRenderer;
  authority: DockviewProductSurfaceAuthority;
  split: {
    leaseable: boolean;
    compatibleWith: readonly DockviewProductSurfaceKey[];
  };
}

export type UnsupportedDockviewProductSurfaceReason =
  | 'unsupported-product-surface'
  | 'removed-beads-surface'
  | 'external-plugin-out-of-scope'
  | 'custom-url-out-of-scope';

export interface UnsupportedDockviewProductSurface {
  supported: false;
  reason: UnsupportedDockviewProductSurfaceReason;
}

export interface SupportedDockviewProductSurface {
  supported: true;
  surface: DockviewProductSurfaceContract;
}

export type DockviewProductSurfaceResolution =
  | SupportedDockviewProductSurface
  | UnsupportedDockviewProductSurface;

const SURFACES = [
  {
    key: 'agent',
    title: 'Agent',
    targetKind: 'craft-overview',
    renderer: 'iframe',
    authority: 'vk-workspace',
    split: { leaseable: true, compatibleWith: ['agent', 'code', 'forms'] },
  },
  {
    key: 'code',
    title: 'Code',
    targetKind: 'code',
    renderer: 'iframe',
    authority: 'code-workspace-folder',
    split: { leaseable: true, compatibleWith: ['agent', 'code', 'forms'] },
  },
  {
    key: 'forms',
    title: 'Forms',
    targetKind: 'forms',
    renderer: 'react',
    authority: 'first-party-react-plugin',
    split: { leaseable: false, compatibleWith: ['agent', 'code', 'forms'] },
  },
] as const satisfies readonly DockviewProductSurfaceContract[];

export const DOCKVIEW_PRODUCT_SURFACES: Readonly<Record<
  DockviewProductSurfaceKey,
  DockviewProductSurfaceContract
>> = Object.freeze(Object.fromEntries(SURFACES.map((surface) => [
  surface.key,
  Object.freeze({
    ...surface,
    split: Object.freeze({
      ...surface.split,
      compatibleWith: Object.freeze([...surface.split.compatibleWith]),
    }),
  }),
])) as Record<DockviewProductSurfaceKey, DockviewProductSurfaceContract>);

const targetKindToSurface = new Map<string, DockviewProductSurfaceContract>(
  SURFACES.map((surface) => [surface.targetKind, DOCKVIEW_PRODUCT_SURFACES[surface.key]]),
);

export function dockviewProductSurfaceKeys(): readonly DockviewProductSurfaceKey[] {
  return SURFACES.map((surface) => surface.key);
}

export function resolveDockviewProductSurface(
  keyOrTargetKind: string,
): DockviewProductSurfaceResolution {
  if (isDockviewProductSurfaceKey(keyOrTargetKind)) {
    return { supported: true, surface: DOCKVIEW_PRODUCT_SURFACES[keyOrTargetKind] };
  }

  const byTargetKind = targetKindToSurface.get(keyOrTargetKind);
  if (byTargetKind) return { supported: true, surface: byTargetKind };

  if (keyOrTargetKind === 'beads') {
    return { supported: false, reason: 'removed-beads-surface' };
  }
  if (keyOrTargetKind === 'plugin-surface' || keyOrTargetKind === 'internal-route') {
    return { supported: false, reason: 'external-plugin-out-of-scope' };
  }
  if (keyOrTargetKind === 'custom-url') {
    return { supported: false, reason: 'custom-url-out-of-scope' };
  }
  return { supported: false, reason: 'unsupported-product-surface' };
}

export function isDockviewProductSurfaceKey(
  value: string,
): value is DockviewProductSurfaceKey {
  return Object.prototype.hasOwnProperty.call(DOCKVIEW_PRODUCT_SURFACES, value);
}

export function canSplitDockviewProductSurfaces(
  left: DockviewProductSurfaceKey,
  right: DockviewProductSurfaceKey,
): boolean {
  return DOCKVIEW_PRODUCT_SURFACES[left].split.compatibleWith.includes(right)
    && DOCKVIEW_PRODUCT_SURFACES[right].split.compatibleWith.includes(left);
}
