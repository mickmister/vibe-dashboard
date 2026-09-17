import { spawnSync } from 'node:child_process';

const generatedPaths = [
  'db/dialects/sqlite/sqlite.schema.prisma',
  'src/store/db/migrations',
  'src/store/db/imported_migrations',
];

run('npm', ['run', 'db:prepare-schema']);
run('npm', ['run', 'db:generate-migration-imports']);
run('git', ['diff', '--exit-code', '--', ...generatedPaths]);
run('npm', ['run', 'db:smoke:external-integrations']);
run('pnpm', [
  'vitest',
  '--run',
  'src/modules/plugins/kanban/server/migrate.test.ts',
  'src/modules/plugins/kanban/server/repoProjectMappings.test.ts',
  '--config',
  'vitest.server.config.ts',
]);

function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
