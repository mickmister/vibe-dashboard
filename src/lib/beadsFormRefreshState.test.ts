import { describe, expect, it } from 'vitest';

import {
  shouldHydrateRefreshedWorkspaceForms,
  workspaceFormsHydrationFingerprint,
} from './beadsFormRefreshState';

const cachedWorkspaceForms = {
  selected: {
    bead: { id: 'bd-1', title: 'Review' },
    selectedForm: { id: 'review', title: 'Review', questions: [{ id: 'q1' }] },
  },
  workspaceBeads: {
    workspaceId: 'workspace-1',
    repos: [{ dir: '/repo', beads: [{ id: 'bd-1' }] }],
  },
  cache: { status: 'cached' },
};

describe('BeadsForm refresh state', () => {
  it('skips hydration when fresh workspace data matches the cached payload', () => {
    const fresh = {
      ...cachedWorkspaceForms,
      cache: { status: 'fresh' },
    };

    expect(workspaceFormsHydrationFingerprint(cachedWorkspaceForms)).toBe(workspaceFormsHydrationFingerprint(fresh));
    expect(shouldHydrateRefreshedWorkspaceForms({
      cached: cachedWorkspaceForms,
      fresh,
      submittedLocked: false,
    })).toBe(false);
  });

  it('hydrates changed fresh data unless the form is locally submitted and locked', () => {
    const fresh = {
      ...cachedWorkspaceForms,
      selected: {
        ...cachedWorkspaceForms.selected,
        selectedForm: { id: 'review', title: 'Review', questions: [{ id: 'q1' }, { id: 'q2' }] },
      },
    };

    expect(shouldHydrateRefreshedWorkspaceForms({
      cached: cachedWorkspaceForms,
      fresh,
      submittedLocked: false,
    })).toBe(true);
    expect(shouldHydrateRefreshedWorkspaceForms({
      cached: cachedWorkspaceForms,
      fresh,
      submittedLocked: true,
    })).toBe(false);
  });
});
