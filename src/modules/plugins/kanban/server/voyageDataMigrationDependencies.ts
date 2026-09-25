import { dockviewM32HarnessDataMigrationDependencies } from '../../../../dockview/DockviewM32HarnessStartup';
import { createProductionVoyageDataMigrationDependencies } from '../../../../store/voyagePersistenceAuthority';
import type { DataMigrationDependencies } from '../../../../store/db/data_migrations/runner';

export async function externalTrackerDataMigrationDependencies(
  input: {
    env?: Record<string, string | undefined>;
    production?: () => Promise<DataMigrationDependencies>;
  } = {},
): Promise<DataMigrationDependencies> {
  return dockviewM32HarnessDataMigrationDependencies(input.env)
    ?? await (input.production ?? createProductionVoyageDataMigrationDependencies)();
}
