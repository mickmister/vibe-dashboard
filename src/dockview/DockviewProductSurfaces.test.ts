/* eslint-disable formatjs/no-literal-string-in-object -- Tests assert stable surface contract literals, not rendered copy. */
import { describe, expect, it } from 'vitest';
import {
  canSplitDockviewProductSurfaces,
  DOCKVIEW_PRODUCT_SURFACES,
  dockviewProductSurfaceKeys,
  resolveDockviewProductSurface,
} from './DockviewProductSurfaces';

describe('DockviewProductSurfaces', () => {
  it('declares only Agent, Code, and Forms as product surfaces', () => {
    expect(dockviewProductSurfaceKeys()).toEqual(['agent', 'code', 'forms']);
    expect(Object.keys(DOCKVIEW_PRODUCT_SURFACES)).toEqual(['agent', 'code', 'forms']);
  });

  it('records renderer and authority for each supported surface', () => {
    expect(DOCKVIEW_PRODUCT_SURFACES.agent).toMatchObject({
      title: 'Agent',
      targetKind: 'craft-overview',
      renderer: 'iframe',
      authority: 'vk-workspace',
    });
    expect(DOCKVIEW_PRODUCT_SURFACES.code).toMatchObject({
      title: 'Code',
      targetKind: 'code',
      renderer: 'iframe',
      authority: 'code-workspace-folder',
    });
    expect(DOCKVIEW_PRODUCT_SURFACES.forms).toMatchObject({
      title: 'Forms',
      targetKind: 'forms',
      renderer: 'react',
      authority: 'first-party-react-plugin',
    });
  });

  it('allows split views only between supported product surfaces', () => {
    for (const left of dockviewProductSurfaceKeys()) {
      for (const right of dockviewProductSurfaceKeys()) {
        expect(canSplitDockviewProductSurfaces(left, right)).toBe(true);
      }
    }
  });

  it('resolves both public surface keys and persisted target kinds', () => {
    expect(resolveDockviewProductSurface('agent')).toMatchObject({
      supported: true,
      surface: { key: 'agent' },
    });
    expect(resolveDockviewProductSurface('craft-overview')).toMatchObject({
      supported: true,
      surface: { key: 'agent' },
    });
    expect(resolveDockviewProductSurface('code')).toMatchObject({
      supported: true,
      surface: { key: 'code' },
    });
    expect(resolveDockviewProductSurface('forms')).toMatchObject({
      supported: true,
      surface: { key: 'forms' },
    });
  });

  it('fails closed for Beads, arbitrary plugins, custom URLs, and unknown surfaces', () => {
    expect(resolveDockviewProductSurface('beads')).toEqual({
      supported: false,
      reason: 'removed-beads-surface',
    });
    expect(resolveDockviewProductSurface('plugin-surface')).toEqual({
      supported: false,
      reason: 'external-plugin-out-of-scope',
    });
    expect(resolveDockviewProductSurface('internal-route')).toEqual({
      supported: false,
      reason: 'external-plugin-out-of-scope',
    });
    expect(resolveDockviewProductSurface('custom-url')).toEqual({
      supported: false,
      reason: 'custom-url-out-of-scope',
    });
    expect(resolveDockviewProductSurface('preview')).toEqual({
      supported: false,
      reason: 'unsupported-product-surface',
    });
  });
});
