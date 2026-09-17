import type { Kysely, Transaction } from 'kysely';
import type { DB } from '../../kysely_types';

export interface DataMigrationPaths {
  sourcePath: string;
  targetPath: string;
}

export type DataMigrationPhase =
  | 'source-read'
  | 'ledger-reserved'
  | 'migration-complete'
  | string;

export interface DataMigrationContext {
  db: Transaction<DB>;
  source: unknown;
  paths: Readonly<DataMigrationPaths>;
  services: Readonly<Record<string, unknown>>;
  checkpoint(phase: DataMigrationPhase): Promise<void>;
}

export interface DataMigration {
  id: string;
  requiresSource?: boolean;
  run(context: DataMigrationContext): Promise<void>;
}

export interface DataMigrationDependencies {
  readSource?(paths: Readonly<DataMigrationPaths>, migrationId: string): Promise<unknown>;
  services?: Readonly<Record<string, unknown>>;
  onPhase?(migrationId: string, phase: DataMigrationPhase): Promise<void> | void;
}

export interface RunDataMigrationsOptions {
  db: Kysely<DB>;
  migrations: readonly DataMigration[];
  paths: Readonly<DataMigrationPaths>;
  dependencies?: DataMigrationDependencies;
}

export class DataMigrationRegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DataMigrationRegistryError';
  }
}

export class DataMigrationStartupError extends Error {
  readonly migrationId: string;
  readonly phase: DataMigrationPhase;
  readonly causeCode: string;

  constructor(migrationId: string, phase: DataMigrationPhase, cause: unknown) {
    const error = cause as { code?: unknown; name?: unknown } | null;
    const candidateCode = typeof error?.code === 'string'
      ? error.code
      : typeof error?.name === 'string' ? error.name : 'UnknownError';
    const causeCode = /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(candidateCode)
      ? candidateCode
      : 'UnknownError';
    super(`Data migration ${migrationId} failed during ${phase} [${causeCode}]`);
    this.name = 'DataMigrationStartupError';
    this.migrationId = migrationId;
    this.phase = phase;
    this.causeCode = causeCode;
  }
}

const migrationIdPattern = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})_[a-z0-9]+(?:_[a-z0-9]+)*$/;

function isValidMigrationId(id: string): boolean {
  const match = migrationIdPattern.exec(id);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() + 1 === month
    && date.getUTCDate() === day
    && date.getUTCHours() === hour
    && date.getUTCMinutes() === minute
    && date.getUTCSeconds() === second;
}

export function validateDataMigrationRegistry(migrations: readonly DataMigration[]): void {
  const seen = new Set<string>();
  let previous: string | undefined;
  for (const migration of migrations) {
    if (!isValidMigrationId(migration.id)) {
      throw new DataMigrationRegistryError(
        `Invalid data migration id ${JSON.stringify(migration.id)}; expected a real UTC YYYYMMDDHHMMSS_description timestamp`,
      );
    }
    if (seen.has(migration.id)) {
      throw new DataMigrationRegistryError(`Duplicate data migration id ${migration.id}`);
    }
    if (previous !== undefined && migration.id <= previous) {
      throw new DataMigrationRegistryError(
        `Data migration registry is out of order: ${migration.id} follows ${previous}`,
      );
    }
    seen.add(migration.id);
    previous = migration.id;
  }
}

const targetQueues = new Map<string, Promise<void>>();

export async function runDataMigrations(options: RunDataMigrationsOptions): Promise<string[]> {
  validateDataMigrationRegistry(options.migrations);
  const paths = Object.freeze({ ...options.paths });
  const previous = targetQueues.get(paths.targetPath) ?? Promise.resolve();
  let release!: () => void;
  const turn = new Promise<void>((resolve) => { release = resolve; });
  const queued = previous.catch(() => undefined).then(() => turn);
  targetQueues.set(paths.targetPath, queued);

  await previous.catch(() => undefined);
  try {
    return await runSerially({ ...options, paths });
  } finally {
    release();
    if (targetQueues.get(paths.targetPath) === queued) targetQueues.delete(paths.targetPath);
  }
}

async function runSerially(options: RunDataMigrationsOptions): Promise<string[]> {
  const applied: string[] = [];
  const dependencies = options.dependencies ?? {};
  const services = Object.freeze({ ...dependencies.services });

  for (const migration of options.migrations) {
    let phase: DataMigrationPhase = 'ledger-check';
    try {
      const recorded = await options.db
        .selectFrom('Migration')
        .select('name')
        .where('name', '=', migration.id)
        .executeTakeFirst();
      if (recorded) continue;

      phase = 'source-read';
      let source: unknown;
      if (migration.requiresSource) {
        if (!dependencies.readSource) throw new Error('Required source reader is not configured');
        source = await dependencies.readSource(options.paths, migration.id);
      }

      const committed = await options.db.transaction().execute(async (transaction) => {
        const reservation = await transaction
          .insertInto('Migration')
          .values({ name: migration.id })
          .onConflict((conflict) => conflict.column('name').doNothing())
          .returning('name')
          .executeTakeFirst();
        if (!reservation) return false;

        phase = 'ledger-reserved';
        await dependencies.onPhase?.(migration.id, phase);
        await migration.run({
          db: transaction,
          source,
          paths: options.paths,
          services,
          checkpoint: async (nextPhase) => {
            phase = nextPhase;
            await dependencies.onPhase?.(migration.id, phase);
          },
        });
        phase = 'migration-complete';
        await dependencies.onPhase?.(migration.id, phase);
        return true;
      });
      if (committed) applied.push(migration.id);
    } catch (cause) {
      throw new DataMigrationStartupError(migration.id, phase, cause);
    }
  }
  return applied;
}
