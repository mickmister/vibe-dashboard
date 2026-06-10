import { describe, expect, it } from 'vitest';
import { getSubVoyageDropTarget } from './WorkspaceContentView';

describe('getSubVoyageDropTarget', () => {
  const rect = { left: 100, top: 50, width: 300, height: 180 };

  it('maps side and corner hover regions to SubVoyage drop targets', () => {
    expect(getSubVoyageDropTarget(rect, { x: 110, y: 60 })).toBe('top-left');
    expect(getSubVoyageDropTarget(rect, { x: 390, y: 60 })).toBe('top-right');
    expect(getSubVoyageDropTarget(rect, { x: 110, y: 220 })).toBe('bottom-left');
    expect(getSubVoyageDropTarget(rect, { x: 390, y: 220 })).toBe('bottom-right');
    expect(getSubVoyageDropTarget(rect, { x: 110, y: 140 })).toBe('left');
    expect(getSubVoyageDropTarget(rect, { x: 390, y: 140 })).toBe('right');
    expect(getSubVoyageDropTarget(rect, { x: 250, y: 60 })).toBe('top');
    expect(getSubVoyageDropTarget(rect, { x: 250, y: 220 })).toBe('bottom');
  });

  it('defaults a center hover to the right side', () => {
    expect(getSubVoyageDropTarget(rect, { x: 250, y: 140 })).toBe('right');
  });
});
