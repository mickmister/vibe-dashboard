const fs = require('node:fs');
const path = require('node:path');

const DATABASE_VERSION = 4;
const dbRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(dbRoot, '..');
const MIGRATIONS_FOLDER = path.join(dbRoot, 'dialects', 'sqlite', 'migrations');
const OUTPUT_MIGRATIONS_FOLDER = path.join(repoRoot, 'src', 'store', 'db', 'migrations');
const OUTPUT_IMPORTS_FOLDER = path.join(repoRoot, 'src', 'store', 'db', 'imported_migrations');

const migrationNames = fs.existsSync(MIGRATIONS_FOLDER)
  ? fs.readdirSync(MIGRATIONS_FOLDER).sort().filter((entry) => !entry.startsWith('.') && fs.statSync(path.join(MIGRATIONS_FOLDER, entry)).isDirectory())
  : [];

for (const migrationName of migrationNames) {
  const migrationSqlPath = path.join(MIGRATIONS_FOLDER, migrationName, 'migration.sql');
  const destinationDirectory = path.join(OUTPUT_MIGRATIONS_FOLDER, migrationName);
  fs.mkdirSync(destinationDirectory, { recursive: true });
  const migrationSqlContent = fs.readFileSync(migrationSqlPath, 'utf8').replace(/`/g, '\\`');
  fs.writeFileSync(path.join(destinationDirectory, 'migration.ts'), `export default \`\n${migrationSqlContent}\`;\n`);
}

fs.mkdirSync(OUTPUT_IMPORTS_FOLDER, { recursive: true });
const importStatements = migrationNames
  .map((migrationName) => `import _${migrationName} from '../migrations/${migrationName}/migration';`)
  .join('\n');
const migrationObjects = migrationNames
  .map((migrationName) => `  { name: '${migrationName}', migration: _${migrationName} },`)
  .join('\n');

fs.writeFileSync(path.join(OUTPUT_IMPORTS_FOLDER, 'imported_migrations.ts'), `${importStatements}\n\nexport const databaseVersion = ${DATABASE_VERSION};\n\nexport const migrations = [\n${migrationObjects}\n] as const;\n`);
console.log(`Generated ${migrationNames.length} migration import${migrationNames.length === 1 ? '' : 's'}`);
