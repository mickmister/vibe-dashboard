import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Kysely } from 'kysely';
import type { DB } from '../store/kysely_types';
import { initExternalIntegrationsDb, type ExternalIntegrationsDbHandle } from '../modules/plugins/kanban/server/database';
import { GithubIssueWorkspaceDbStore } from './github-issue-workspace-db';

const identity = {
  owner: 'owner',
  repo: 'repo',
  number: 42,
  normalizedIssueUrl: 'https://github.com/owner/repo/issues/42',
};
const request = {
  repoId: 'repo-id',
  targetBranch: 'origin/main',
  createBranch: true,
  checkoutBranch: null,
  name: 'Issue #42',
};

let handle: ExternalIntegrationsDbHandle;
let db: Kysely<DB>;
let store: GithubIssueWorkspaceDbStore;

beforeEach(async () => {
  handle = await initExternalIntegrationsDb({ path: ':memory:' });
  db = handle.db;
  store = new GithubIssueWorkspaceDbStore({ getDb: async () => db });
});

afterEach(async () => {
  await db.destroy();
  handle.sqlite.close();
});

describe('GithubIssueWorkspaceDbStore', () => {
  it('normalizes identity and keeps exactly one primary while preserving history', async () => {
    await store.upsert({ identity: { ...identity, owner: 'OWNER', repo: 'Repo' }, workspaceId: 'ws-1', branch: 'vk/one' });
    await store.upsert({ identity, workspaceId: 'ws-2', branch: 'vk/two' });

    await expect(store.get(identity)).resolves.toMatchObject({ workspaceId: 'ws-2', branch: 'vk/two' });
    const links = await db
      .selectFrom('ExternalIssueWorkspaceLink')
      .select(['isPrimary'])
      .orderBy('createdAt')
      .execute();
    expect(links).toHaveLength(2);
    expect(links.filter((link) => link.isPrimary)).toHaveLength(1);
  });

  it('grants one durable reservation lease and exposes in-progress state to competitors', async () => {
    const competingStore = new GithubIssueWorkspaceDbStore({ getDb: async () => db });
    const [first, second] = await Promise.all([
      store.claimReservation(identity, request),
      competingStore.claimReservation(identity, request),
    ]);

    expect([first.acquired, second.acquired].filter(Boolean)).toHaveLength(1);
    expect(first.reservation.state).toBe('provisioning');
    expect(second.reservation.state).toBe('provisioning');
  });

  it('reacquires a recoverable reservation and retains its created workspace', async () => {
    const claim = await store.claimReservation(identity, request);
    expect(claim.reservation.leaseToken).toBeTruthy();
    await store.recordWorkspace(identity, claim.reservation.leaseToken!, 'ws-1', 'vk/issue-42');
    await store.markReservationRecoverable(identity, claim.reservation.leaseToken!, new Error('mapping unavailable'));

    const recovered = await store.claimReservation(identity, { ...request, name: 'Different request' });
    expect(recovered.acquired).toBe(true);
    expect(recovered.reservation.workspaceId).toBe('ws-1');
    expect(recovered.reservation.request.name).toBe('Issue #42');

    await store.upsert({ identity, workspaceId: 'ws-1', branch: 'vk/issue-42' });
    await store.markReservationReady(identity, recovered.reservation.leaseToken!);
    const ready = await store.claimReservation(identity, request);
    expect(ready).toMatchObject({
      acquired: false,
      reservation: { state: 'ready', workspaceId: 'ws-1', branch: 'vk/issue-42' },
    });
  });

  it('lets an expired lease be recovered', async () => {
    let now = new Date('2026-09-22T00:00:00Z');
    const leasedStore = new GithubIssueWorkspaceDbStore({
      getDb: async () => db,
      now: () => now,
      leaseMs: 1000,
    });
    expect((await leasedStore.claimReservation(identity, request)).acquired).toBe(true);
    now = new Date('2026-09-22T00:00:02Z');
    expect((await leasedStore.claimReservation(identity, request)).acquired).toBe(true);
  });
});
