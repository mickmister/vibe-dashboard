import { afterEach, describe, expect, it } from 'vitest';
import {
  IFRAME_PORT_PREFIX_REVEAL_DELAY_MS,
  IFRAME_REVEAL_DELAY_MS,
  __iframePanelTestUtils,
  getIframeRevealDelayMs,
  getIframeRevealStyle,
  isBlankIframeBackgroundColor,
} from './IframePanel';

describe('iframe reveal behavior', () => {
  afterEach(() => {
    __iframePanelTestUtils.clearState();
  });

  it('uses a short post-readiness reveal delay', () => {
    expect(IFRAME_REVEAL_DELAY_MS).toBe(250);
  });

  it('uses a longer best-effort reveal delay on port-prefixed hosts', () => {
    expect(getIframeRevealDelayMs('port-5173.example.com')).toBe(IFRAME_PORT_PREFIX_REVEAL_DELAY_MS);
    expect(getIframeRevealDelayMs('example.com')).toBe(IFRAME_REVEAL_DELAY_MS);
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

  it('clears first-activation tracking when an iframe is removed', () => {
    __iframePanelTestUtils.addRetainedIframeForTest('craft_workspace:agent');
    __iframePanelTestUtils.setActivatedIframeKeys(['craft_workspace:agent', 'craft_workspace:code']);

    __iframePanelTestUtils.removeIframeForTest('craft_workspace:agent');

    expect(__iframePanelTestUtils.getActivatedIframeKeys()).toEqual(['craft_workspace:code']);
  });

  it('clears first-activation tracking when all retained iframes are removed', () => {
    __iframePanelTestUtils.addRetainedIframeForTest('craft_workspace:agent');
    __iframePanelTestUtils.addRetainedIframeForTest('craft_workspace:code');
    __iframePanelTestUtils.setActivatedIframeKeys(['craft_workspace:agent', 'craft_workspace:code']);

    __iframePanelTestUtils.removeAllIframesForTest();

    expect(__iframePanelTestUtils.getActivatedIframeKeys()).toEqual([]);
  });
});
