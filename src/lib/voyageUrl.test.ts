import { describe, expect, it } from 'vitest';
import {
  buildCraftParam,
  buildViewParam,
  buildVoyageSlug,
  parseCraftParam,
  parseViewsParam,
} from './voyageUrl';
import type { Craft, VoyageEntry } from '../types';

describe('voyageUrl', () => {
  it('builds stable voyage slugs from labels and full stable ids', () => {
    expect(buildVoyageSlug('Agent + Code', 'session_abc_123')).toBe(
      'agent-code-session_abc_123',
    );
    expect(buildVoyageSlug(undefined, 'session_456')).toBe('voyage-session_456');
  });

  it('round-trips craft params by suffix while allowing descriptive labels', () => {
    const craft = {
      id: 'tg_workspace_42',
      label: 'My Workspace',
      tabs: [],
      pairs: [],
      order: 0,
    } satisfies Craft;
    const entry = {
      id: 've_tg_workspace_42_7',
      tabGroupId: craft.id,
      viewIds: ['tab_agent_1'],
    } satisfies VoyageEntry;

    expect(buildCraftParam(craft, entry)).toBe('my-workspace-42-7');
    expect(parseCraftParam('my-workspace-42-7')).toEqual({
      tabGroupSuffix: '42',
      entrySuffix: '7',
    });
  });

  it('parses ordered view suffixes from view params', () => {
    expect(
      parseViewsParam(
        [
          buildViewParam('Agent', 'tab_agent_1'),
          buildViewParam('Code', 'tab_code_2'),
        ].join(','),
      ),
    ).toEqual(['1', '2']);
  });
});
