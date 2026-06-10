import { describe, expect, it } from 'vitest';
import { getIframeLayerTabsForPanel } from './IframePanel';
import type { Tab } from '../types';

const tab = (id: string): Tab => ({
  id,
  title: id,
  url: `https://example.com/${id}`,
});

describe('getIframeLayerTabsForPanel', () => {
  it('renders only this panel visible iframe tabs when another owner supplies tiled retention scope', () => {
    const visibleInThisPanel = [tab('tab_a')];
    const retainedAcrossTiledLayout = [tab('tab_a'), tab('tab_b')];

    expect(
      getIframeLayerTabsForPanel(
        new Set(['tab_a', 'tab_b']),
        visibleInThisPanel,
        retainedAcrossTiledLayout,
      ).map((entry) => entry.id),
    ).toEqual(['tab_a']);
  });

  it('renders retained tabs in normal single-panel mode so hidden iframes stay hosted', () => {
    const visibleInThisPanel = [tab('tab_a')];
    const retainedInSinglePanel = [tab('tab_a'), tab('tab_b')];

    expect(
      getIframeLayerTabsForPanel(
        undefined,
        visibleInThisPanel,
        retainedInSinglePanel,
      ).map((entry) => entry.id),
    ).toEqual(['tab_a', 'tab_b']);
  });
});
