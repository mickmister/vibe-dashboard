import { afterEach, describe, expect, it } from 'vitest';
import {
  IFRAME_PORT_PREFIX_REVEAL_DELAY_MS,
  IFRAME_REVEAL_DELAY_MS,
  IFRAME_VISUAL_READY_TIMEOUT_MS,
  __iframePanelTestUtils,
  getIframeLayerTabsForPanel,
  getIframeRevealDelayMs,
  getIframeRevealStyle,
  hasVisualReadyBackground,
  isBlankIframeBackgroundColor,
} from './IframePanel';
import type { Tab } from '../types';

const tab = (id: string): Tab => ({
  id,
  title: id,
  url: `https://example.com/${id}`,
});

const retained = (groupId: string, id: string) => ({
  tab: tab(id),
  iframeKey: `${groupId}:${id}`,
});

function createFakeElement({
  backgroundColor = 'rgba(0, 0, 0, 0)',
  width = 800,
  height = 600,
  text = '',
  parentElement = null,
}: {
  backgroundColor?: string;
  width?: number;
  height?: number;
  text?: string;
  parentElement?: Element | null;
}) {
  return {
    backgroundColor,
    parentElement,
    innerText: text,
    textContent: text,
    getBoundingClientRect: () => ({ width, height }),
  } as unknown as Element;
}

function createFakeDocument({
  bodyBackground = 'rgba(0, 0, 0, 0)',
  htmlBackground = 'rgba(0, 0, 0, 0)',
  shellBackground,
  bodyText = '',
  readyState = 'complete',
}: {
  bodyBackground?: string;
  htmlBackground?: string;
  shellBackground?: string;
  bodyText?: string;
  readyState?: DocumentReadyState;
}) {
  const html = createFakeElement({ backgroundColor: htmlBackground, width: 800, height: 600 });
  const body = createFakeElement({ backgroundColor: bodyBackground, width: 800, height: 600, text: bodyText, parentElement: html });
  const shell = shellBackground
    ? createFakeElement({ backgroundColor: shellBackground, width: 800, height: 600, parentElement: body })
    : null;
  const view = {
    innerWidth: 800,
    innerHeight: 600,
    getComputedStyle: (element: Element) => ({
      backgroundColor: (element as unknown as { backgroundColor?: string }).backgroundColor ?? 'rgba(0, 0, 0, 0)',
      display: 'block',
      visibility: 'visible',
      opacity: '1',
    }),
  } as unknown as Window;

  return {
    readyState,
    defaultView: view,
    body,
    documentElement: Object.assign(html, { clientWidth: 800, clientHeight: 600 }),
    elementFromPoint: () => shell,
    querySelector: () => shell,
  } as unknown as Document;
}

describe('getIframeLayerTabsForPanel', () => {
  it('renders only this panel visible iframe tabs when another owner supplies tiled retention scope', () => {
    const visibleInThisPanel = [retained('group_a', 'tab_a')];
    const retainedAcrossTiledLayout = [
      retained('group_a', 'tab_a'),
      retained('group_b', 'tab_b'),
    ];

    expect(
      getIframeLayerTabsForPanel(
        new Set(['tab_a', 'tab_b']),
        visibleInThisPanel,
        retainedAcrossTiledLayout,
      ).map((entry) => entry.tab.id),
    ).toEqual(['tab_a']);
  });

  it('renders retained tabs in normal single-panel mode so hidden iframes stay hosted', () => {
    const visibleInThisPanel = [retained('group_a', 'tab_a')];
    const retainedInSinglePanel = [
      retained('group_a', 'tab_a'),
      retained('group_b', 'tab_b'),
    ];

    expect(
      getIframeLayerTabsForPanel(
        undefined,
        visibleInThisPanel,
        retainedInSinglePanel,
      ).map((entry) => entry.tab.id),
    ).toEqual(['tab_a', 'tab_b']);
  });
});

describe('iframe reveal behavior', () => {
  afterEach(() => {
    __iframePanelTestUtils.clearState();
  });

  it('uses a short post-readiness reveal delay', () => {
    expect(IFRAME_REVEAL_DELAY_MS).toBe(250);
  });

  it('uses a 5 second visual readiness fallback timeout', () => {
    expect(IFRAME_VISUAL_READY_TIMEOUT_MS).toBe(5000);
  });

  it('uses a longer best-effort reveal delay on port-prefixed hosts', () => {
    expect(getIframeRevealDelayMs('port-5173.example.com')).toBe(IFRAME_PORT_PREFIX_REVEAL_DELAY_MS);
    expect(getIframeRevealDelayMs('example.com')).toBe(IFRAME_REVEAL_DELAY_MS);
  });

  it('accepts rendered app shells with transparent body and html backgrounds', () => {
    const doc = createFakeDocument({
      bodyBackground: 'rgba(0, 0, 0, 0)',
      htmlBackground: 'rgba(0, 0, 0, 0)',
      shellBackground: 'rgb(37, 37, 38)',
    });

    expect(hasVisualReadyBackground(doc)).toBe(true);
  });

  it('accepts complete light-themed pages with visible text content', () => {
    const doc = createFakeDocument({
      bodyBackground: 'rgb(255, 255, 255)',
      htmlBackground: 'rgb(255, 255, 255)',
      bodyText: 'What would you like to work on?',
    });

    expect(hasVisualReadyBackground(doc)).toBe(true);
  });

  it('keeps blank complete pages visually not ready', () => {
    const doc = createFakeDocument({
      bodyBackground: 'rgba(0, 0, 0, 0)',
      htmlBackground: 'rgba(0, 0, 0, 0)',
    });

    expect(hasVisualReadyBackground(doc)).toBe(false);
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
