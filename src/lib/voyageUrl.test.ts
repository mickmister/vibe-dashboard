import { describe, expect, it } from 'vitest';
import {
  buildCanonicalDashboardPath,
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

  it('preserves unknown dashboard query params while replacing voyage-owned params', () => {
    expect(
      buildCanonicalDashboardPath(
        '?from_gh_url=https%3A%2F%2Fgithub.com%2Fowner%2Frepo%2Fpull%2F1&session=legacy&voyage=old&craft=old&views=old',
        {
          slug: 'focused-session_1',
          craftParam: 'craft-1-2',
          viewTokens: ['agent-1', 'code-2'],
        },
      ),
    ).toBe(
      '/dashboard?from_gh_url=https%3A%2F%2Fgithub.com%2Fowner%2Frepo%2Fpull%2F1&voyage=focused-session_1&craft=craft-1-2&views=agent-1%2Ccode-2',
    );
  });

  it('preserves unknown dashboard query params when clearing voyage params', () => {
    expect(
      buildCanonicalDashboardPath(
        '?from_gh_url=https%3A%2F%2Fgithub.com%2Fowner%2Frepo%2Fissues%2F2&voyage=old&craft=old&views=old',
        undefined,
      ),
    ).toBe(
      '/dashboard?from_gh_url=https%3A%2F%2Fgithub.com%2Fowner%2Frepo%2Fissues%2F2',
    );
  });
});
