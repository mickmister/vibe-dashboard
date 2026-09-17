import { describe, expect, it } from 'vitest';
import { GasCityE2eFixtureStore } from './gasCityE2eFixture';

const forbidden = /\b(?:gc|bd|git)\s+[\w:./=-]+|\/Users\/|\/tmp\/|\/private\/var\/|stdout|stderr|provider diagnostics|queue[_ -]?item|webhook|trigger|delivery ID|execution process ID|raw XML|raw JSON|generated-packs/i;

describe('GasCityE2eFixtureStore GCW-14B', () => {
  it('applies product-concept events deterministically and exposes typed bead state', async () => {
    const fixture = new GasCityE2eFixtureStore({ workspaceId: 'workspace-a' }, { now: () => 100 });

    const ready = fixture.applyEvent({ eventId: 'event-1', type: 'mark_bead_ready', workspaceId: 'workspace-a', beadId: 'bead-a', title: 'Implement thing' });
    expect(ready.status).toBe('applied');
    expect(ready.state.beads).toEqual([expect.objectContaining({ id: 'bead-a', status: 'ready', readiness: 'ready' })]);

    const approved = fixture.applyEvent({ eventId: 'event-2', type: 'mark_tester_approved', workspaceId: 'workspace-a', beadId: 'bead-a', summary: 'Tester approved' });
    expect(approved.state.beads[0]).toMatchObject({ status: 'closed', readiness: 'terminal' });

    await expect(fixture.getBeadsByIds({ workspaceId: 'workspace-a', beadIds: ['bead-a'] })).resolves.toEqual([
      expect.objectContaining({ id: 'bead-a', status: 'closed' }),
    ]);
  });

  it('is idempotent for duplicate event replay and blocks mismatched replay', () => {
    const fixture = new GasCityE2eFixtureStore({ workspaceId: 'workspace-a' }, { now: () => 100 });
    const event = { eventId: 'same-key', type: 'mark_review_approved' as const, workspaceId: 'workspace-a', beadId: 'bead-a', summary: 'Approved' };

    expect(fixture.applyEvent(event).status).toBe('applied');
    expect(fixture.applyEvent(event).status).toBe('already_applied');
    expect(fixture.snapshot().events).toHaveLength(1);
    expect(fixture.applyEvent({ ...event, type: 'mark_tester_found_bug' }).status).toBe('conflict');
    expect(fixture.snapshot().events).toHaveLength(1);
  });

  it('scrubs hostile provider text and local path details from fixture snapshots', () => {
    const fixture = new GasCityE2eFixtureStore({ workspaceId: 'workspace-a' }, { now: () => 100 });
    fixture.applyEvent({
      eventId: 'unsafe',
      type: 'record_agent_result_note',
      workspaceId: 'workspace-a',
      beadId: 'bead-a',
      title: 'Run git merge /Users/me/project',
      summary: 'stdout raw XML <decision/> webhook provider diagnostics /tmp/secret bd show',
      metadata: { detail: 'stderr raw JSON /private/var/folders git status' },
    });

    expect(JSON.stringify(fixture.snapshot())).not.toMatch(forbidden);
  });

  it('represents provider unavailable without throwing or leaking diagnostics', async () => {
    const fixture = new GasCityE2eFixtureStore({ workspaceId: 'workspace-a', beads: [{ id: 'bead-a', title: 'Task', status: 'ready', readiness: 'ready', workspaceId: 'workspace-a', dependencyBeadIds: [], convoyIds: [] }] }, { now: () => 100 });
    const result = fixture.applyEvent({ eventId: 'unavailable', type: 'simulate_provider_unavailable', workspaceId: 'workspace-a' });

    expect(result.state.fixture.providerAvailable).toBe(false);
    expect(result.state.warnings).toEqual(['Workflow fixture provider is unavailable.']);
    await expect(fixture.listBeads({ workspaceId: 'workspace-a', readiness: 'ready' })).resolves.toEqual([]);
    expect(JSON.stringify(result.state)).not.toMatch(forbidden);
  });

  it('supports idempotent product-safe result note writes', async () => {
    const fixture = new GasCityE2eFixtureStore({ workspaceId: 'workspace-a', beads: [{ id: 'bead-a', title: 'Task', status: 'ready', readiness: 'ready', workspaceId: 'workspace-a', dependencyBeadIds: [], convoyIds: [] }] }, { now: () => 100 });
    const write = { workspaceId: 'workspace-a', beadId: 'bead-a', noteKey: 'note-1', summary: 'Completed', idempotencyKey: 'note-key' };

    await expect(fixture.writeWorkflowResultNote(write)).resolves.toMatchObject({ status: 'created' });
    await expect(fixture.writeWorkflowResultNote(write)).resolves.toMatchObject({ status: 'already_applied' });
    await expect(fixture.writeWorkflowResultNote({ ...write, summary: 'Different' })).resolves.toMatchObject({ status: 'conflict' });
  });
});
