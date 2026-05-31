#!/usr/bin/env node
import Database from 'better-sqlite3';
import { copyFileSync, existsSync } from 'node:fs';

const WORKSPACE_KEY = 'engine|module|workspace|state.persistent|workspace';
const SESSIONS_KEY = 'engine|module|workspace|state.persistent|workspace-sessions';
const ORIGIN_RESUME_KEY = 'engine|module|workspace|state.persistent|workspace-origin-session-resume';

const args = process.argv.slice(2);
const write = args.includes('--write');
const dbPath = args.find((arg) => !arg.startsWith('--')) || 'data/kv.db';

function usage() {
  console.error('Usage: node scripts/remove-home-voyages.mjs [--write] <path-to-kv.db>');
}

if (!existsSync(dbPath)) {
  usage();
  throw new Error(`Database not found: ${dbPath}`);
}

function parseState(row, fallback) {
  return row?.value ? JSON.parse(row.value) : fallback;
}

function getVoyageDisplayName(session, tabGroupLabelsById) {
  const explicitName = session.name?.trim();
  if (explicitName) return explicitName;
  return tabGroupLabelsById.get(session.activeTabGroupId) || 'Saved voyage';
}

function isHomeVoyage(session, tabGroupLabelsById) {
  const displayName = getVoyageDisplayName(session, tabGroupLabelsById).trim();
  return displayName.toLowerCase() === 'home';
}

const db = new Database(dbPath);
const getValue = db.prepare('select value from kvstore where key = ?');
const workspaceRow = getValue.get(WORKSPACE_KEY);
const sessionsRow = getValue.get(SESSIONS_KEY);
const originResumeRow = getValue.get(ORIGIN_RESUME_KEY);

if (!sessionsRow?.value) {
  throw new Error(`Missing kvstore key: ${SESSIONS_KEY}`);
}

const workspaceState = parseState(workspaceRow, { tabGroups: [] });
const sessionsState = parseState(sessionsRow, { sessions: [] });
const originResumeState = parseState(originResumeRow, { lastSessionByOrigin: {} });
const tabGroupLabelsById = new Map(
  (workspaceState.tabGroups || []).map((tabGroup) => [tabGroup.id, tabGroup.label || '']),
);
const sessions = sessionsState.sessions || [];
const removedSessions = sessions.filter((session) => isHomeVoyage(session, tabGroupLabelsById));
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
  removedHomeVoyages: removedSessions.length,
  originReferencesRemoved,
  removedByActiveTabGroup: Object.fromEntries(
    [...removedSessions.reduce((counts, session) => {
      const key = session.activeTabGroupId || '(none)';
      counts.set(key, (counts.get(key) || 0) + 1);
      return counts;
    }, new Map())].sort((a, b) => b[1] - a[1]),
  ),
  sampleRemoved: removedSessions.slice(0, 10).map((session) => ({
    id: session.id,
    slug: session.slug,
    name: session.name,
    activeTabGroupId: session.activeTabGroupId,
    displayName: getVoyageDisplayName(session, tabGroupLabelsById),
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
