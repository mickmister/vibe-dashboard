#!/usr/bin/env node
import Database from 'better-sqlite3';
import { copyFileSync, existsSync } from 'node:fs';

const SESSIONS_KEY = 'engine|module|workspace|state.persistent|workspace-sessions';
const ORIGIN_RESUME_KEY = 'engine|module|workspace|state.persistent|workspace-origin-session-resume';

const args = process.argv.slice(2);
const write = args.includes('--write');
const dbPath = args.find((arg) => !arg.startsWith('--')) || 'data/kv.db';

function usage() {
  console.error('Usage: node scripts/dedupe-voyages.mjs [--write] <path-to-kv.db>');
}

if (!existsSync(dbPath)) {
  usage();
  throw new Error(`Database not found: ${dbPath}`);
}

function canonicalObjectEntries(value) {
  return Object.fromEntries(Object.entries(value || {}).sort(([a], [b]) => a.localeCompare(b)));
}

function sessionSignature(session) {
  return JSON.stringify({
    name: session.name || '',
    activeSpaceId: session.activeSpaceId || '',
    activeTabGroupId: session.activeTabGroupId || '',
    activeVoyageEntryId: session.activeVoyageEntryId || '',
    voyageEntries: (session.voyageEntries || []).map((entry) => ({
      tabGroupId: entry.tabGroupId,
      viewIds: entry.viewIds || [],
    })),
    activeItemsByVoyageEntryId: canonicalObjectEntries(session.activeItemsByVoyageEntryId),
    activeItems: canonicalObjectEntries(session.activeItems),
    visitedTabGroupIds: session.visitedTabGroupIds || [],
  });
}

function timestampValue(value) {
  const time = Date.parse(value || '');
  return Number.isFinite(time) ? time : 0;
}

function chooseKeeper(group, referencedSessionIds) {
  return [...group].sort((a, b) => {
    const aReferenced = referencedSessionIds.has(a.id) ? 1 : 0;
    const bReferenced = referencedSessionIds.has(b.id) ? 1 : 0;
    if (aReferenced !== bReferenced) return bReferenced - aReferenced;

    const aNamed = a.name ? 1 : 0;
    const bNamed = b.name ? 1 : 0;
    if (aNamed !== bNamed) return bNamed - aNamed;

    const updatedDiff = timestampValue(b.updatedAt) - timestampValue(a.updatedAt);
    if (updatedDiff !== 0) return updatedDiff;

    const createdDiff = timestampValue(b.createdAt) - timestampValue(a.createdAt);
    if (createdDiff !== 0) return createdDiff;

    return String(a.id).localeCompare(String(b.id));
  })[0];
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
function getSessions(state) {
  if (Array.isArray(state)) return state;
  if (state?.version === 2 && Array.isArray(state.data)) return state.data;
  if (Array.isArray(state?.sessions)) return state.sessions;
  return [];
}

function createSessionsState(sessions) {
  return { version: 2, data: sessions };
}

const sessions = getSessions(sessionsState);
const referencedSessionIds = new Set(
  Object.values(originResumeState.lastSessionByOrigin || {}).filter(Boolean),
);

const groupsBySignature = new Map();
for (const session of sessions) {
  const signature = sessionSignature(session);
  const group = groupsBySignature.get(signature) || [];
  group.push(session);
  groupsBySignature.set(signature, group);
}

const duplicateGroups = [...groupsBySignature.values()].filter((group) => group.length > 1);
const removedToKept = new Map();
const keepIds = new Set();
const groupSummaries = [];

for (const group of duplicateGroups) {
  const keeper = chooseKeeper(group, referencedSessionIds);
  keepIds.add(keeper.id);
  const removed = group.filter((session) => session.id !== keeper.id);
  for (const session of removed) {
    removedToKept.set(session.id, keeper.id);
  }
  groupSummaries.push({
    size: group.length,
    keepId: keeper.id,
    keepSlug: keeper.slug,
    activeTabGroupId: keeper.activeTabGroupId,
    removed: removed.length,
    firstCreated: group.map((session) => session.createdAt).sort()[0],
    lastCreated: group.map((session) => session.createdAt).sort().at(-1),
  });
}

const nextSessions = sessions.filter((session) => !removedToKept.has(session.id));
const nextOriginResume = structuredClone(originResumeState);
let originReferencesUpdated = 0;
for (const [origin, sessionId] of Object.entries(nextOriginResume.lastSessionByOrigin || {})) {
  const replacementId = removedToKept.get(sessionId);
  if (replacementId) {
    nextOriginResume.lastSessionByOrigin[origin] = replacementId;
    originReferencesUpdated += 1;
  }
}

const summary = {
  dbPath,
  mode: write ? 'write' : 'dry-run',
  beforeSessions: sessions.length,
  afterSessions: nextSessions.length,
  duplicateGroups: duplicateGroups.length,
  removedSessions: removedToKept.size,
  originReferencesUpdated,
  groups: groupSummaries.sort((a, b) => b.size - a.size),
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
  updateValue.run(JSON.stringify(createSessionsState(nextSessions)), SESSIONS_KEY);
  if (originResumeRow?.value) {
    updateValue.run(JSON.stringify(nextOriginResume), ORIGIN_RESUME_KEY);
  }
});
transaction();
db.pragma('wal_checkpoint(TRUNCATE)');
db.close();
console.log(`Wrote ${dbPath}`);
console.log(`Backup: ${backupPath}`);
