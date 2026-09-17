import type { DataMigration } from './runner';
import { migrateLegacyVoyages } from './20260917100000_migrate_legacy_voyages';

export const dataMigrations: readonly DataMigration[] = [migrateLegacyVoyages];
