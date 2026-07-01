import { describe, expect, it } from 'vitest';
import { getIframeLayerTabsForPanel } from './IframePanel';
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
