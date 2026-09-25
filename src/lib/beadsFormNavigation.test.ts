import { describe, expect, it } from 'vitest';
import { PENDING_BEADS_FORMS_LINK, PENDING_BEADS_FORMS_PATH } from './beadsFormNavigation';

describe('pending BeadsForms navigation metadata', () => {
  it('uses the stable Forms queue route and user-facing discovery copy', () => {
    expect(PENDING_BEADS_FORMS_PATH).toBe('/dashboard/forms');
    expect(PENDING_BEADS_FORMS_LINK).toEqual({
      href: '/dashboard/forms',
      label: 'Pending BeadsForms',
      sidebarLabel: 'Forms',
      description: 'Review forms waiting for your response.',
    });
  });
});
