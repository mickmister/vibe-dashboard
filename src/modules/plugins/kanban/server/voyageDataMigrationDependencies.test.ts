/* eslint-disable formatjs/no-literal-string-in-object -- exact startup fixture keys */
import { describe, expect, it, vi } from 'vitest';
import { dockviewM32HarnessStartupFlag } from '../../../../dockview/DockviewM32HarnessStartup';
import { externalTrackerDataMigrationDependencies } from './voyageDataMigrationDependencies';

describe('external tracker Voyage data migration dependencies', () => {
  it('uses harness dependencies when the DockView harness is enabled', async () => {
    const production = vi.fn(async () => ({ services: { legacyTargetContextForCraft: () => null } }));
    const dependencies = await externalTrackerDataMigrationDependencies({
      env: { [dockviewM32HarnessStartupFlag]: '1', VITE_VK_BASE_ORIGIN: 'https://harness.test' },
      production,
    });

    expect(production).not.toHaveBeenCalled();
    expect(dependencies.services?.legacyTargetContextForCraft).toBeTypeOf('function');
  });

  it('uses production dependencies before opening the shared external tracker database', async () => {
    const expected = { services: { legacyTargetContextForCraft: () => null } };
    const production = vi.fn(async () => expected);

    await expect(externalTrackerDataMigrationDependencies({
      env: {},
      production,
    })).resolves.toBe(expected);
    expect(production).toHaveBeenCalledOnce();
  });
});
