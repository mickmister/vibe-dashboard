import { describe, expect, it } from 'vitest';
import { IFRAME_REVEAL_DELAY_MS, getIframeRevealStyle } from './IframePanel';

describe('iframe reveal behavior', () => {
  it('keeps the loading overlay up for a full second after iframe load', () => {
    expect(IFRAME_REVEAL_DELAY_MS).toBe(1000);
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
