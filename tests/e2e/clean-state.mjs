import fs from 'node:fs';
import path from 'node:path';

const port = process.argv[2] || '4173';
const stateDir = path.resolve('.e2e');
const paths = [
  path.join(stateDir, `kv-${port}.db`),
  path.join(stateDir, `vd-${port}.db`),
];

fs.mkdirSync(stateDir, { recursive: true });
for (const dbPath of paths) {
  for (const file of [dbPath, `${dbPath}-shm`, `${dbPath}-wal`]) {
    fs.rmSync(file, { force: true });
  }
}
