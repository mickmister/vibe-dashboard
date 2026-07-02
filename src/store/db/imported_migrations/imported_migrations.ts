import _20260702000000_external_integrations from '../migrations/20260702000000_external_integrations/migration';

export const databaseVersion = 1;

export const migrations = [
  { name: '20260702000000_external_integrations', migration: _20260702000000_external_integrations },
] as const;
