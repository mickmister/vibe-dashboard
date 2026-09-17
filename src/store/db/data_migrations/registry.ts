import type { DataMigration } from './runner';

// M2.4 establishes the production runner. M2.5 owns the first production
// migration: importing legacy Springboard/Voyage data.
export const dataMigrations: readonly DataMigration[] = [];
