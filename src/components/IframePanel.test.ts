import { describe, expect, it } from 'vitest';
import { IFRAME_REVEAL_DELAY_MS, getIframeRevealStyle, isBlankIframeBackgroundColor } from './IframePanel';

describe('iframe reveal behavior', () => {
  it('uses a short post-readiness reveal delay', () => {
    expect(IFRAME_REVEAL_DELAY_MS).toBe(250);
  });

  it('detects blank iframe background colors', () => {
    expect(isBlankIframeBackgroundColor('rgb(255, 255, 255)')).toBe(true);
    expect(isBlankIframeBackgroundColor('rgba(0, 0, 0, 0)')).toBe(true);
    expect(isBlankIframeBackgroundColor('rgb(10, 10, 10)')).toBe(false);
  });

  it('hides loading iframes so their unpainted document cannot flash through', () => {
    expect(getIframeRevealStyle(false)).toMatchObject({
      opacity: 0,
      pointerEvents: 'none',
      transition: 'none',
    });
  });

  it('reveals ready iframes with interactions enabled', () => {
    expect(getIframeRevealStyle(true)).toMatchObject({
      opacity: 1,
      pointerEvents: 'auto',
      transition: 'opacity 120ms ease-out',
    });
  });
});
