/* eslint-disable formatjs/no-literal-string-in-object */
import { describe, expect, it } from 'vitest';
import { getSingleViewActiveItemId } from './UnifiedTabView';
import type { TabGroup } from '../types';

const craft: TabGroup = {
  id: 'craft_workspace',
  label: 'Workspace Craft',
  tabs: [
    { id: 'agent', title: 'Agent', url: 'internal://agent' },
    { id: 'code', title: 'Code', url: 'internal://code' },
    { id: 'forms', title: 'Forms', url: 'internal://forms' },
  ],
  pairs: [
    { id: 'code+forms', tabIds: ['code', 'forms'], ratios: [50, 50] },
    { id: 'stale+forms', tabIds: ['missing', 'forms'], ratios: [50, 50] },
    { id: 'stale+missing', tabIds: ['missing-a', 'missing-b'], ratios: [50, 50] },
  ],
  order: 0,
};

describe('getSingleViewActiveItemId', () => {
  it('leaves desktop active pair selection unchanged', () => {
    expect(getSingleViewActiveItemId(craft, 'code+forms', false)).toBe('code+forms');
  });

  it('keeps a mobile active tab focused', () => {
    expect(getSingleViewActiveItemId(craft, 'forms', true)).toBe('forms');
  });

  it('maps a mobile active split pair to the first valid member instead of the first Craft tab', () => {
    expect(getSingleViewActiveItemId(craft, 'code+forms', true)).toBe('code');
  });

  it('skips stale split pair members on mobile before falling back', () => {
    expect(getSingleViewActiveItemId(craft, 'stale+forms', true)).toBe('forms');
    expect(getSingleViewActiveItemId(craft, 'stale+missing', true)).toBe('agent');
  });

  it('recovers malformed mobile focus to the first available Panel without changing desktop focus', () => {
    expect(getSingleViewActiveItemId(craft, 'missing', true)).toBe('agent');
    expect(getSingleViewActiveItemId(craft, 'missing', false)).toBe('missing');
  });
});
