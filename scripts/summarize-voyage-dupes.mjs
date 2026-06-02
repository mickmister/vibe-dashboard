import { execFileSync } from 'node:child_process';
const dbPath = process.argv[2] || 'data/kv.db';
const key = 'engine|module|workspace|state.persistent|workspace-sessions';
const value = execFileSync('sqlite3', [dbPath, `select value from kvstore where key='${key}';`], { encoding: 'utf8', maxBuffer: 100 * 1024 * 1024 });
const state = JSON.parse(value);
const sessions = Array.isArray(state)
  ? state
  : state?.version === 2 && Array.isArray(state.data)
    ? state.data
    : state?.sessions || [];
const sig = (s) => JSON.stringify({
  name: s.name || '',
  activeSpaceId: s.activeSpaceId,
  activeTabGroupId: s.activeTabGroupId,
  activeVoyageEntryId: s.activeVoyageEntryId || '',
  voyageEntries: (s.voyageEntries || []).map(e => ({ tabGroupId: e.tabGroupId, viewIds: e.viewIds || [] })),
  activeItemsByVoyageEntryId: Object.fromEntries(Object.entries(s.activeItemsByVoyageEntryId || {}).map(([k,v]) => [k.replace(/_[0-9]+$/, ''), v]).sort()),
  activeItems: Object.fromEntries(Object.entries(s.activeItems || {}).sort()),
  visitedTabGroupIds: s.visitedTabGroupIds || [],
});
const groups = new Map();
for (const s of sessions) (groups.get(sig(s)) || groups.set(sig(s), []).get(sig(s))).push(s);
const dupes = [...groups.values()].filter(g => g.length > 1).sort((a,b)=>b.length-a.length);
console.log(JSON.stringify({
  dbPath,
  totalSessions: sessions.length,
  duplicateGroups: dupes.length,
  duplicateSessions: dupes.reduce((n,g)=>n+g.length-1,0),
  largestGroups: dupes.slice(0,10).map(g => ({
    size: g.length,
    activeTabGroupId: g[0].activeTabGroupId,
    name: g[0].name || null,
    firstCreated: g.map(s=>s.createdAt).sort()[0],
    lastCreated: g.map(s=>s.createdAt).sort().at(-1),
    firstSlug: g[0].slug,
    sampleIds: g.slice(0,5).map(s=>s.id),
  }))
}, null, 2));
