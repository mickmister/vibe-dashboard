#!/usr/bin/env node
import Database from 'better-sqlite3';
import { copyFileSync, existsSync } from 'node:fs';

const SESSIONS_KEY = 'engine|module|workspace|state.persistent|workspace-sessions';
const ORIGIN_RESUME_KEY = 'engine|module|workspace|state.persistent|workspace-origin-session-resume';

const args = process.argv.slice(2);
const write = args.includes('--write');
const idsArg = args.find((arg) => arg.startsWith('--ids='));
const ids = new Set((idsArg?.slice('--ids='.length) || '').split(',').map((id) => id.trim()).filter(Boolean));
const dbPath = args.find((arg) => !arg.startsWith('--')) || 'data/kv.db';

if (!ids.size) {
  console.error('Usage: node scripts/remove-voyages-by-id.mjs [--write] --ids=id1,id2 <path-to-kv.db>');
  process.exit(1);
}

if (!existsSync(dbPath)) {
  throw new Error(`Database not found: ${dbPath}`);
}

const db = new Database(dbPath);
const getValue = db.prepare('select value from kvstore where key = ?');
const sessionsRow = getValue.get(SESSIONS_KEY);
if (!sessionsRow?.value) {
  throw new Error(`Missing kvstore key: ${SESSIONS_KEY}`);
}
const originResumeRow = getValue.get(ORIGIN_RESUME_KEY);
const sessionsState = JSON.parse(sessionsRow.value);
const originResumeState = originResumeRow?.value
  ? JSON.parse(originResumeRow.value)
  : { lastSessionByOrigin: {} };
const sessions = sessionsState.sessions || [];
const removedSessions = sessions.filter((session) => ids.has(session.id));
const removedIds = new Set(removedSessions.map((session) => session.id));
const nextSessions = sessions.filter((session) => !removedIds.has(session.id));
const nextOriginResume = structuredClone(originResumeState);
let originReferencesRemoved = 0;
for (const [origin, sessionId] of Object.entries(nextOriginResume.lastSessionByOrigin || {})) {
  if (removedIds.has(sessionId)) {
    delete nextOriginResume.lastSessionByOrigin[origin];
    originReferencesRemoved += 1;
  }
}

const summary = {
  dbPath,
  mode: write ? 'write' : 'dry-run',
  beforeVoyages: sessions.length,
  afterVoyages: nextSessions.length,
  requestedIds: [...ids],
  removedVoyages: removedSessions.length,
  originReferencesRemoved,
  removed: removedSessions.map((session) => ({
    id: session.id,
    slug: session.slug,
    name: session.name,
    activeTabGroupId: session.activeTabGroupId,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  })),
};
console.log(JSON.stringify(summary, null, 2));

if (!write) {
  console.log('Dry run only. Re-run with --write to update the database.');
  db.close();
  process.exit(0);
}

const backupPath = `${dbPath}.bak-${new Date().toISOString().replace(/[:.]/g, '-')}`;
copyFileSync(dbPath, backupPath);
const updateValue = db.prepare('update kvstore set value = ? where key = ?');
const transaction = db.transaction(() => {
  updateValue.run(JSON.stringify({ ...sessionsState, sessions: nextSessions }), SESSIONS_KEY);
  if (originResumeRow?.value) {
    updateValue.run(JSON.stringify(nextOriginResume), ORIGIN_RESUME_KEY);
  }
});
transaction();
db.pragma('wal_checkpoint(TRUNCATE)');
db.close();
console.log(`Wrote ${dbPath}`);
console.log(`Backup: ${backupPath}`);
