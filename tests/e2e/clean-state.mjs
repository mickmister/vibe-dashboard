import fs from 'node:fs';
import path from 'node:path';

const port = process.argv[2] || '4173';
const stateDir = path.resolve('.e2e');
const dbPath = path.join(stateDir, `kv-${port}.db`);

fs.mkdirSync(stateDir, { recursive: true });
for (const file of [dbPath, `${dbPath}-shm`, `${dbPath}-wal`]) {
  fs.rmSync(file, { force: true });
}
